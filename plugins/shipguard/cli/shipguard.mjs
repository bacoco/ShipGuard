#!/usr/bin/env node
/**
 * shipguard.mjs — ShipGuard deterministic recette CLI (single-file, zero-dep).
 *
 * Layered design: this file is the DETERMINISTIC layer (server lifecycle,
 * mechanical manifest execution, crawling, artifacts, exit codes). LLM
 * assertions (llm-check/llm-wait), code audit, and process simulation stay
 * in the sg-* skills, which call this CLI.
 *
 * Like build-review.mjs, this file is designed to be copied alone into a
 * target project's visual-tests/ directory:
 *   cp "$SHIPGUARD_PLUGIN_ROOT/cli/shipguard.mjs" visual-tests/
 *   node visual-tests/shipguard.mjs <subcommand>
 *
 * Exit codes (stable contract):
 *   0  ran clean, no findings
 *   1  ran, findings present
 *   2  infrastructure error (app won't start, healthcheck timeout,
 *      agent-browser missing or crashed)
 *   3  invalid configuration (missing/bad config, unknown profile/check)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, appendFileSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn, execFileSync } from 'child_process';
import net from 'net';

export const EXIT = { CLEAN: 0, FINDINGS: 1, INFRA: 2, CONFIG: 3 };

// ─────────────────────────────────────────────────────────────────────────────
// YAML subset parser (indentation-based, recursive).
// Supported subset (everything ShipGuard configs and manifests use):
//   nested maps at any depth, block lists of scalars, block lists of maps
//   (first key inline after "- "), inline [a, b] lists, single/double quoted
//   strings, numbers, true/false/null/~, trailing "# comments".
// NOT supported: block scalars (| >), anchors, multi-line strings, flow maps.
// ─────────────────────────────────────────────────────────────────────────────
export function yamlParse(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    lines.push(raw.replace(/\t/g, '  '));
  }
  let pos = 0;
  const indentOf = (s) => s.match(/^ */)[0].length;

  function scalar(v) {
    v = String(v).trim();
    if (v === '') return null;
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q) && v.length >= 2) {
      const inner = v.slice(1, -1);
      return q === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner;
    }
    const hash = v.search(/\s#/);
    if (hash !== -1) v = v.slice(0, hash).trim();
    if (v === '' || v === 'null' || v === '~') return null;
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1).trim();
      return inner === '' ? [] : inner.split(',').map((x) => scalar(x));
    }
    return v;
  }

  function parseBlock(indent) {
    if (pos >= lines.length) return null;
    return lines[pos].trim().startsWith('- ') || lines[pos].trim() === '-'
      ? parseList(indent)
      : parseMap(indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (pos < lines.length) {
      const raw = lines[pos];
      const ind = indentOf(raw);
      if (ind < indent) break;
      if (ind > indent) { pos++; continue; } // stray deeper line — skip defensively
      const m = raw.trim().match(/^([^:#][^:]*?):(?:\s+(.*)|\s*)$/);
      if (!m) break;
      const key = m[1].trim().replace(/^["']|["']$/g, '');
      const rest = m[2] === undefined ? '' : m[2];
      pos++;
      if (rest.trim() === '') {
        if (pos < lines.length && indentOf(lines[pos]) > indent) obj[key] = parseBlock(indentOf(lines[pos]));
        else obj[key] = null;
      } else {
        obj[key] = scalar(rest);
      }
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (pos < lines.length) {
      const raw = lines[pos];
      const ind = indentOf(raw);
      if (ind !== indent || !(raw.trim().startsWith('- ') || raw.trim() === '-')) break;
      const rest = raw.trim() === '-' ? '' : raw.trim().slice(2);
      const itemIndent = ind + 2;
      if (rest === '') {
        pos++;
        arr.push(pos < lines.length && indentOf(lines[pos]) > ind ? parseBlock(indentOf(lines[pos])) : null);
        continue;
      }
      const km = rest.match(/^([^:#][^:]*?):(?:\s+(.*)|\s*)$/);
      if (km) {
        pos++;
        const obj = {};
        const inline = km[2] === undefined ? '' : km[2];
        if (inline.trim() === '') {
          obj[km[1].trim()] = pos < lines.length && indentOf(lines[pos]) > itemIndent
            ? parseBlock(indentOf(lines[pos])) : null;
        } else {
          obj[km[1].trim()] = scalar(inline);
        }
        while (pos < lines.length && indentOf(lines[pos]) === itemIndent
               && !lines[pos].trim().startsWith('- ')) {
          Object.assign(obj, parseMap(itemIndent));
        }
        arr.push(obj);
      } else {
        arr.push(scalar(rest));
        pos++;
      }
    }
    return arr;
  }

  return parseMap(0);
}

// ── Config v2 ────────────────────────────────────────────────────────────────
export const KNOWN_CHECKS = ['page-load', 'local-assets', 'browser-errors', 'screenshots'];

export function validateConfig(cfg) {
  const errors = [];
  if (cfg == null || typeof cfg !== 'object' || Array.isArray(cfg)) return ['config is not a YAML mapping'];
  if (cfg.app != null) {
    if (typeof cfg.app !== 'object' || Array.isArray(cfg.app)) errors.push('app: must be a mapping');
    else {
      if (cfg.app.start != null && typeof cfg.app.start !== 'string') errors.push('app.start must be a string command');
      if (cfg.app.healthcheck != null && typeof cfg.app.healthcheck !== 'string') errors.push('app.healthcheck must be a path or URL string');
      if (cfg.app.startup_timeout_ms != null && !Number.isFinite(cfg.app.startup_timeout_ms)) errors.push('app.startup_timeout_ms must be a number');
    }
  }
  if (cfg.profiles != null) {
    if (typeof cfg.profiles !== 'object' || Array.isArray(cfg.profiles)) errors.push('profiles: must be a mapping of name -> {scope, checks}');
    else {
      for (const [name, p] of Object.entries(cfg.profiles)) {
        if (p == null || typeof p !== 'object' || Array.isArray(p)) { errors.push(`profile "${name}": must be a mapping`); continue; }
        if (p.scope != null && typeof p.scope !== 'string') errors.push(`profile "${name}": scope must be a string`);
        if (p.checks != null) {
          if (!Array.isArray(p.checks)) errors.push(`profile "${name}": checks must be a list`);
          else for (const c of p.checks) if (!KNOWN_CHECKS.includes(c)) errors.push(`profile "${name}": unknown check "${c}" (valid: ${KNOWN_CHECKS.join(', ')})`);
        }
      }
    }
  }
  if (!cfg.base_url && !(cfg.app && typeof cfg.app === 'object' && cfg.app.start)) {
    errors.push('config needs base_url or app.start (so serve can derive the URL)');
  }
  return errors;
}

export function loadConfig(projectRoot) {
  const path = join(projectRoot, 'visual-tests', '_config.yaml');
  if (!existsSync(path)) return { config: null, errors: [`missing ${relative(projectRoot, path)} — run "shipguard init" or /sg-visual-discover`], path };
  let config;
  try { config = yamlParse(readFileSync(path, 'utf8')); }
  catch (e) { return { config: null, errors: [`unparseable _config.yaml: ${e.message}`], path }; }
  return { config, errors: validateConfig(config), path };
}

export function resolveProfile(cfg, name) {
  if (name == null) return { name: 'default', scope: 'all', checks: [...KNOWN_CHECKS], errors: [] };
  const p = cfg && cfg.profiles && typeof cfg.profiles === 'object' ? cfg.profiles[name] : undefined;
  if (!p) return { name, scope: null, checks: [], errors: [`unknown profile "${name}" — declare it under profiles: in _config.yaml`] };
  return {
    name,
    scope: typeof p.scope === 'string' && p.scope ? p.scope : 'all',
    checks: Array.isArray(p.checks) && p.checks.length ? p.checks : [...KNOWN_CHECKS],
    errors: [],
  };
}

// ── init ─────────────────────────────────────────────────────────────────────
export const GITIGNORE_BLOCK = [
  '# ShipGuard session artifacts (added by shipguard init)',
  'visual-tests/_results/',
  '.DS_Store',
  '# visual-tests/_regressions.yaml  # uncomment to keep regression memory out of git',
];

const CONFIG_TEMPLATE = `# visual-tests/_config.yaml — ShipGuard project configuration (v2)
version: 2
base_url: "http://localhost:3000"
credentials:
  username: "testuser"
  password: "testpass"
screenshots_dir: "visual-tests/_results/screenshots"
report_path: "visual-tests/_results/report.md"
build_command: null

# App-under-test lifecycle (used by: shipguard serve / run --serve).
# {port} is replaced by a free port; base_url is then derived automatically.
# app:
#   type: static-site
#   root: docs
#   start: "python3 -m http.server {port} --bind 127.0.0.1"
#   healthcheck: "/index.html"
#   startup_timeout_ms: 30000

# Named recette profiles (used by: shipguard run --profile=NAME).
# scope matches manifest paths and step URLs; checks pick the deterministic lanes.
# profiles:
#   site-accessible:
#     scope: "site-accessible"
#     checks: [page-load, local-assets, browser-errors, screenshots]
`;

function ensureGitignore(projectRoot) {
  const path = join(projectRoot, '.gitignore');
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = new Set(current.split('\n').map((l) => l.trim()));
  const missing = GITIGNORE_BLOCK.filter((l) => !lines.has(l.trim()));
  if (missing.length === 0) return false;
  const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
  appendFileSync(path, `${prefix}${missing.join('\n')}\n`);
  return true;
}

// ── App-under-test lifecycle ─────────────────────────────────────────────────
const APP_PID_FILE = (root) => join(root, 'visual-tests', '_results', '.app.pid');

export function findFreePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

function readAppPid(root) {
  const f = APP_PID_FILE(root);
  if (!existsSync(f)) return null;
  const [pid, port, baseUrl] = readFileSync(f, 'utf8').trim().split('\n');
  return { pid: Number(pid), port: Number(port), baseUrl: baseUrl || null, file: f };
}

export async function startApp(config, projectRoot) {
  const app = config.app || {};
  if (!app.start || typeof app.start !== 'string') return { ok: false, error: 'no app.start in config (nothing to serve)' };

  const prev = readAppPid(projectRoot);
  if (prev && pidAlive(prev.pid)) return { ok: true, ...prev, reused: true };

  const needsPort = app.start.includes('{port}');
  const port = needsPort ? await findFreePort() : (config.base_url ? Number(new URL(config.base_url).port || 80) : 80);
  const cmd = app.start.replaceAll('{port}', String(port));
  const baseUrl = needsPort || !config.base_url ? `http://127.0.0.1:${port}` : config.base_url;

  const cwd = app.root && existsSync(join(projectRoot, app.root)) ? join(projectRoot, app.root) : projectRoot;
  const child = spawn(cmd, { cwd, shell: true, detached: true, stdio: 'ignore' });
  child.unref();

  const health = new URL(app.healthcheck || '/', baseUrl).href;
  const timeout = Number.isFinite(app.startup_timeout_ms) ? app.startup_timeout_ms : 30000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(health, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) {
        mkdirSync(join(projectRoot, 'visual-tests', '_results'), { recursive: true });
        writeFileSync(APP_PID_FILE(projectRoot), `${child.pid}\n${port}\n${baseUrl}\n`);
        return { ok: true, baseUrl, pid: child.pid, port };
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  try { process.kill(-child.pid); } catch { /* already dead */ }
  return { ok: false, error: `healthcheck ${health} not answering after ${timeout} ms (infrastructure error, not a product finding)` };
}

export function stopApp(projectRoot) {
  const info = readAppPid(projectRoot);
  if (!info) return { stopped: false, message: 'no app server pidfile — nothing to stop' };
  if (pidAlive(info.pid)) {
    try { process.kill(-info.pid); } catch { try { process.kill(info.pid); } catch { /* gone */ } }
  }
  try { unlinkSync(info.file); } catch { /* ignore */ }
  return { stopped: true, message: `app server stopped (PID ${info.pid})` };
}

export function resolveBaseUrl(config, projectRoot) {
  const info = readAppPid(projectRoot);
  if (info && pidAlive(info.pid) && info.baseUrl) return info.baseUrl;
  return (config && config.base_url) || null;
}

// ── Static crawler (measured evidence: real HTTP checks, no LLM) ────────────
const ASSET_ATTR_RE = /<(img|script|link|video|audio|source|iframe|track|a)\b[^>]*?\s(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
const SRCSET_RE = /<(img|source)\b[^>]*?\ssrcset\s*=\s*["']([^"']+)["']/gi;

export function extractAssets(html, pageUrl) {
  const page = new URL(pageUrl);
  const out = [];
  const seen = new Set();
  const push = (rawUrl, tag) => {
    const v = String(rawUrl).trim();
    if (!v || v.startsWith('#') || /^(mailto:|tel:|javascript:|data:)/i.test(v)) return;
    let abs;
    try { abs = new URL(v, page); } catch { return; }
    if (abs.origin !== page.origin) return;
    abs.hash = '';
    const key = `${abs.href}|${tag}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url: abs.href, tag });
  };
  for (const m of String(html).matchAll(ASSET_ATTR_RE)) push(m[2], m[1].toLowerCase());
  for (const m of String(html).matchAll(SRCSET_RE)) {
    for (const candidate of m[2].split(',')) push(candidate.trim().split(/\s+/)[0] || '', m[1].toLowerCase());
  }
  return out;
}

async function checkUrl(url) {
  try {
    let r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    if (r.status === 405 || r.status === 501) r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    return r.status;
  } catch { return 0; }
}

export async function crawl(baseUrl, opts = {}) {
  const maxPages = opts.maxPages ?? 200;
  const start = new URL(baseUrl).href;
  const queue = [start];
  const visitedPages = new Set();
  const checkedAssets = new Map(); // url -> status
  const broken = [];

  let first = true;
  while (queue.length && visitedPages.size < maxPages) {
    const pageUrl = queue.shift();
    if (visitedPages.has(pageUrl)) continue;
    visitedPages.add(pageUrl);
    let res;
    try { res = await fetch(pageUrl, { signal: AbortSignal.timeout(8000) }); }
    catch { if (first) return { pages: 0, assets_checked: 0, broken: [], infra_error: `base_url unreachable: ${pageUrl}` }; continue; }
    first = false;
    if (!res.ok) { broken.push({ url: pageUrl, status: res.status, found_on: pageUrl, tag: 'page' }); continue; }
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) continue;
    const html = await res.text();
    for (const { url, tag } of extractAssets(html, pageUrl)) {
      const isPageLink = tag === 'a' || (tag === 'iframe' && url.endsWith('.html'));
      if (isPageLink && /\.html?($|\?)/.test(url) && !visitedPages.has(url)) queue.push(url);
      if (!checkedAssets.has(url)) {
        const status = await checkUrl(url);
        checkedAssets.set(url, status);
        if (status === 0 || status >= 400) broken.push({ url, status, found_on: pageUrl, tag });
      } else {
        const status = checkedAssets.get(url);
        if ((status === 0 || status >= 400) && !broken.some((b) => b.url === url && b.found_on === pageUrl)) {
          broken.push({ url, status, found_on: pageUrl, tag });
        }
      }
    }
  }
  return { pages: visitedPages.size, assets_checked: checkedAssets.size, broken };
}

// ── Browser output robustness layer ──────────────────────────────────────────
export function tolerantJson(text) {
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(String(text).trim());
  if (typeof v === 'string' && /^[[{]/.test(v.trim())) {
    const inner = tryParse(v);
    if (inner !== undefined) return inner;
  }
  if (v !== undefined) return v;
  const unescaped = String(text).trim().replace(/^["']|["']$/g, '').replace(/\\"/g, '"');
  v = tryParse(unescaped);
  return v === undefined ? null : v;
}

export function normalizeConsole(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[?(error|warning|warn|pageerror|unhandledrejection)\]?\s*:?\s*(.*)$/i);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    const level = kind === 'warn' || kind === 'warning' ? 'warn' : 'error';
    if (m[2]) out.push({ level, text: m[2] });
  }
  return out;
}

export function validateScreenshot(path) {
  if (!existsSync(path)) return { ok: false, size: 0, reason: 'missing' };
  const size = statSync(path).size;
  if (size === 0) return { ok: false, size, reason: 'empty file' };
  return { ok: true, size };
}

export function matchSnapshotRef(snapshotText, target) {
  const needle = String(target).toLowerCase();
  let substringHit = null;
  for (const line of String(snapshotText).split('\n')) {
    const ref = line.match(/@e\d+/);
    if (!ref) continue;
    const quoted = line.match(/"([^"]+)"/);
    if (quoted && quoted[1].toLowerCase() === needle) return ref[0];
    if (!substringHit && line.toLowerCase().includes(needle)) substringHit = ref[0];
  }
  return substringHit;
}

export function browser(cmdArgs, opts = {}) {
  try {
    const stdout = execFileSync('agent-browser', cmdArgs, { encoding: 'utf8', timeout: opts.timeout ?? 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout, stderr: '', code: 0 };
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: false, stdout: '', stderr: 'agent-browser not installed', code: -1 };
    return { ok: false, stdout: e.stdout ? String(e.stdout) : '', stderr: e.stderr ? String(e.stderr) : String(e.message), code: e.status ?? 1 };
  }
}

// ── run.json (lane manifest — declared work, never silent skips) ─────────────
const LANE_STATUSES = ['ran', 'skipped', 'not-applicable', 'error', 'needs-agent'];

export function buildRunJson({ scope, lanes }) {
  const ts = new Date();
  for (const [name, lane] of Object.entries(lanes || {})) {
    if (!lane || !LANE_STATUSES.includes(lane.status)) throw new Error(`lane "${name}": status must be one of ${LANE_STATUSES.join('|')}`);
    if (lane.status !== 'ran' && !lane.reason) throw new Error(`lane "${name}": status "${lane.status}" requires a reason`);
  }
  return {
    schema_version: '1.0',
    run_id: `run-${ts.toISOString().replace(/[-:T]/g, '').slice(0, 14)}`,
    timestamp: ts.toISOString(),
    scope: scope || { type: 'all', value: null },
    lanes: lanes || {},
  };
}

// ── CLI plumbing ─────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq === -1) args.flags[a.slice(2)] = true;
      else args.flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else args._.push(a);
  }
  return args;
}

const HELP = `shipguard — ShipGuard deterministic recette CLI

Usage: node shipguard.mjs <subcommand> [flags]

Subcommands:
  init                       Scaffold visual-tests/_config.yaml, _results/, .gitignore guard-rails
  serve   [--port=N]         Start the app under test (config app.start), wait for healthcheck
  stop    [--all]            Stop the app server started by serve (--all: also the review server)
  crawl   [--base-url=URL]   Check local links/assets over HTTP -> _results/crawl-results.json
  run     [--profile=NAME] [--scope=STR] [--serve] [--no-crawl]
                             Full mechanical recette: serve if needed, execute manifests
                             (mechanical steps), checks, artifacts, dashboard
  review  [--serve] [--port=N]  Build (and optionally serve) the review dashboard
  status                     Show app/review server state

exit codes: 0 clean | 1 findings | 2 infrastructure error | 3 invalid configuration
`;

export function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || args.flags.help || cmd === 'help' || cmd === '--help') {
    console.log(HELP);
    return EXIT.CLEAN;
  }
  const commands = { init: cmdInit, serve: cmdServe, stop: cmdStop, crawl: cmdCrawl, run: cmdRun, review: cmdReview, status: cmdStatus };
  const fn = commands[cmd];
  if (!fn) {
    console.error(`Unknown subcommand "${cmd}". Run with --help.`);
    return EXIT.CONFIG;
  }
  return fn(args);
}

function cmdInit() {
  const root = process.cwd();
  mkdirSync(join(root, 'visual-tests', '_results'), { recursive: true });
  const cfgPath = join(root, 'visual-tests', '_config.yaml');
  if (!existsSync(cfgPath)) {
    writeFileSync(cfgPath, CONFIG_TEMPLATE, 'utf8');
    console.log('created visual-tests/_config.yaml');
  } else {
    console.log('visual-tests/_config.yaml exists — left untouched');
  }
  console.log(ensureGitignore(root) ? 'updated .gitignore guard-rails' : '.gitignore guard-rails already present');
  console.log('init done.');
  return EXIT.CLEAN;
}

async function cmdServe(args) {
  const { config, errors } = loadConfig(process.cwd());
  if (!config || errors.length) { errors.forEach((e) => console.error(`config: ${e}`)); return EXIT.CONFIG; }
  if (!config.app || !config.app.start) { console.error('config: app.start missing — declare the app block to let shipguard own the server'); return EXIT.CONFIG; }
  const r = await startApp(config, process.cwd());
  if (!r.ok) { console.error(`serve: ${r.error}`); return EXIT.INFRA; }
  console.log(`${r.reused ? 'already running' : 'started'} — base_url: ${r.baseUrl} (pid ${r.pid})`);
  return EXIT.CLEAN;
}

function cmdStop(args) {
  const r = stopApp(process.cwd());
  console.log(r.message);
  if (args.flags.all) {
    const br = join(process.cwd(), 'visual-tests', 'build-review.mjs');
    if (existsSync(br)) {
      try { execFileSync('node', [br, '--stop'], { stdio: 'inherit' }); } catch { /* reported by the script */ }
    }
  }
  return EXIT.CLEAN;
}

function cmdStatus() {
  const root = process.cwd();
  const app = readAppPid(root);
  console.log(app && pidAlive(app.pid) ? `app server: running (pid ${app.pid}, ${app.baseUrl})` : 'app server: not running');
  const srvPid = join(root, 'visual-tests', '_results', '.server.pid');
  if (existsSync(srvPid)) {
    const [pid, port] = readFileSync(srvPid, 'utf8').trim().split('\n');
    console.log(pidAlive(Number(pid)) ? `review server: running (pid ${pid}, port ${port || '8888'})` : 'review server: stale pidfile');
  } else console.log('review server: not running');
  return EXIT.CLEAN;
}
async function cmdCrawl(args) {
  const root = process.cwd();
  const { config, errors } = loadConfig(root);
  if (!config || errors.length) { errors.forEach((e) => console.error(`config: ${e}`)); return EXIT.CONFIG; }
  const baseUrl = String(args.flags['base-url'] || resolveBaseUrl(config, root) || '');
  if (!baseUrl) { console.error('config: no base_url and no running app server'); return EXIT.CONFIG; }
  console.log(`crawling ${baseUrl} ...`);
  const result = await crawl(baseUrl);
  if (result.infra_error) { console.error(`crawl: ${result.infra_error}`); return EXIT.INFRA; }
  const resultsDir = join(root, 'visual-tests', '_results');
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, 'crawl-results.json'), JSON.stringify({
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    base_url: baseUrl,
    pages: result.pages,
    assets_checked: result.assets_checked,
    broken: result.broken,
  }, null, 2));
  console.log(`crawl: ${result.pages} pages, ${result.assets_checked} assets checked, ${result.broken.length} broken`);
  for (const b of result.broken) console.log(`  BROKEN [${b.tag}] ${b.url} (HTTP ${b.status}) on ${b.found_on}`);
  return result.broken.length ? EXIT.FINDINGS : EXIT.CLEAN;
}
function cmdRun() { console.error('run: not implemented yet'); return EXIT.CONFIG; }
function cmdReview() { console.error('review: not implemented yet'); return EXIT.CONFIG; }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve(main(process.argv.slice(2))).then((code) => process.exit(code ?? 0));
}
