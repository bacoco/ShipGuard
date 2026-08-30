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

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, appendFileSync, copyFileSync, realpathSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
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
  if (cfg.base_url != null) {
    if (typeof cfg.base_url !== 'string') errors.push('base_url must be a string URL');
    else {
      // Every consumer (fetch, new URL(path, base), agent-browser) needs an absolute
      // http(s) URL; app.start substitutes {port} first, so probe with a placeholder.
      let protocol = null;
      try { protocol = new URL(cfg.base_url.replaceAll('{port}', '1')).protocol; } catch { /* stays null */ }
      if (protocol !== 'http:' && protocol !== 'https:') errors.push(`base_url must be an absolute http(s) URL — got "${cfg.base_url}"`);
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
const ASSET_TAG_RE = /<(img|script|link|video|audio|source|iframe|track|a)\b([^>]*)>/gi;
const ATTR_URL_RE = /\s(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
const ATTR_SRCSET_RE = /\ssrcset\s*=\s*["']([^"']+)["']/gi;

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
  // Two-phase scan: one tag can carry several URL attributes
  // (e.g. <video src="clip.mp4" poster="poster.jpg">) — capture them all.
  for (const tagMatch of String(html).matchAll(ASSET_TAG_RE)) {
    const tag = tagMatch[1].toLowerCase();
    const attrs = tagMatch[2];
    for (const m of attrs.matchAll(ATTR_URL_RE)) push(m[1], tag);
    for (const m of attrs.matchAll(ATTR_SRCSET_RE)) {
      for (const candidate of m[1].split(',')) push(candidate.trim().split(/\s+/)[0] || '', tag);
    }
  }
  return out;
}

// A local <a>/<iframe> URL worth following in the BFS: explicit .html/.htm,
// a directory URL, or a clean URL (no extension in the last path segment).
// Non-HTML responses are filtered by content-type after fetch anyway.
export function isFollowablePage(url) {
  let path;
  try { path = new URL(url).pathname; } catch { return false; }
  if (/\.html?$/i.test(path)) return true;
  if (path.endsWith('/')) return true;
  const last = path.split('/').pop();
  return last !== '' && !last.includes('.');
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
      const isPageLink = tag === 'a' || tag === 'iframe';
      if (isPageLink && isFollowablePage(url) && !visitedPages.has(url)) queue.push(url);
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
  // SHIPGUARD_AGENT_BROWSER overrides the binary (alternate install path, tests)
  const bin = process.env.SHIPGUARD_AGENT_BROWSER || 'agent-browser';
  try {
    const stdout = execFileSync(bin, cmdArgs, { encoding: 'utf8', timeout: opts.timeout ?? 60000, stdio: ['ignore', 'pipe', 'pipe'] });
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
// ── Manifest loading + mechanical execution ──────────────────────────────────
export const MECHANICAL_ACTIONS = ['open', 'click', 'fill', 'press', 'wait', 'assert_url', 'assert_text', 'screenshot', 'select', 'upload'];

export function loadManifests(projectRoot, scope) {
  const base = join(projectRoot, 'visual-tests');
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.ya?ml$/.test(entry.name)) continue;
      let manifest;
      try { manifest = yamlParse(readFileSync(full, 'utf8')); } catch { continue; }
      if (!manifest || manifest.deprecated === true || !Array.isArray(manifest.steps)) continue;
      const rel = relative(base, full).split(sep).join('/');
      const id = rel.replace(/\.ya?ml$/, '');
      const openStep = manifest.steps.find((s) => s && s.action === 'open');
      const url = openStep && typeof openStep.url === 'string' ? openStep.url : '';
      if (scope && scope !== 'all' && !rel.includes(scope) && !url.includes(scope)) continue;
      out.push({ id, path: full, manifest, url });
    }
  };
  if (existsSync(base)) walk(base);
  return out;
}

function interpolate(value, ctx) {
  return String(value)
    .replaceAll('{base_url}', ctx.baseUrl)
    .replace(/\{credentials\.(\w+)\}/g, (_, k) => (ctx.config.credentials && ctx.config.credentials[k]) || '')
    .replace(/\{data\.(\w+)\}/g, (_, k) => (ctx.data && ctx.data[k] != null ? String(ctx.data[k]) : ''));
}

async function runStep(step, ctx) {
  const action = step.action;
  switch (action) {
    case 'open': {
      const r = browser(['open', interpolate(step.url, ctx)]);
      if (!r.ok) return { ok: false, reason: `open failed: ${r.stderr || r.stdout}`.trim() };
      return { ok: true };
    }
    case 'click':
    case 'fill':
    case 'select':
    case 'upload': {
      const snap = browser(['snapshot', '-i']);
      if (!snap.ok) return { ok: false, reason: `snapshot failed: ${snap.stderr}` };
      const ref = matchSnapshotRef(snap.stdout, interpolate(step.target, ctx));
      if (!ref) return { ok: false, reason: `target not found in accessibility tree: "${step.target}"` };
      const extra = action === 'fill' ? [interpolate(step.value ?? step.text ?? '', ctx)]
        : action === 'select' ? [interpolate(step.option ?? step.value ?? '', ctx)]
        : action === 'upload' ? [interpolate(step.file ?? '', ctx)]
        : [];
      const r = browser([action, ref, ...extra]);
      return r.ok ? { ok: true } : { ok: false, reason: `${action} failed: ${r.stderr || r.stdout}`.trim() };
    }
    case 'press': {
      const r = browser(['press', step.key || interpolate(step.target ?? '', ctx)]);
      return r.ok ? { ok: true } : { ok: false, reason: `press failed: ${r.stderr}` };
    }
    case 'wait': {
      const ms = /^\d+s$/.test(String(step.duration)) ? parseInt(step.duration) * 1000 : Number(step.duration) || 1000;
      await new Promise((r) => setTimeout(r, Math.min(ms, 30000)));
      return { ok: true };
    }
    case 'assert_url': {
      const r = browser(['get', 'url']);
      const expected = interpolate(step.url ?? step.value ?? '', ctx);
      return r.ok && r.stdout.trim().includes(expected.replace(/\/$/, ''))
        ? { ok: true } : { ok: false, reason: `url is "${r.stdout.trim()}", expected to include "${expected}"` };
    }
    case 'assert_text': {
      const snap = browser(['snapshot']);
      const expected = interpolate(step.text ?? step.value ?? '', ctx);
      return snap.ok && snap.stdout.toLowerCase().includes(expected.toLowerCase())
        ? { ok: true } : { ok: false, reason: `text not found on page: "${expected}"` };
    }
    case 'screenshot': {
      const file = join(ctx.screenshotsDir, step.screenshot || step.file || `${ctx.slug}-step.png`);
      const r = browser(['screenshot', file]);
      const v = validateScreenshot(file);
      if (!r.ok || !v.ok) return { ok: false, reason: `screenshot invalid (${v.reason || r.stderr})` };
      ctx.lastScreenshot = file;
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

export async function executeManifest(entry, ctx) {
  const t0 = Date.now();
  const slug = entry.id.split('/').pop();
  const local = { ...ctx, slug, data: entry.manifest.data || {}, lastScreenshot: null };
  const result = {
    id: entry.id,
    manifest: `visual-tests/${entry.id}.yaml`,
    name: entry.manifest.name || entry.id,
    url: entry.url ? interpolate(entry.url, local).replace(local.baseUrl, '') || '/' : null,
    status: 'PASS',
    duration_ms: 0,
    screenshot: null,
    failure_reason: null,
    browser_errors: [],
    llm_steps_pending: 0,
  };
  browser(['console', '--clear']);
  for (const step of entry.manifest.steps) {
    if (!step || !step.action) continue;
    if (step.action === 'llm-check' || step.action === 'llm-wait') { result.llm_steps_pending++; continue; }
    if (!MECHANICAL_ACTIONS.includes(step.action)) continue;
    const r = await runStep(step, local);
    if (!r.ok) {
      result.status = step.action.startsWith('assert') ? 'FAIL' : 'ERROR';
      result.failure_reason = `${step.action}: ${r.reason}`;
      break;
    }
  }
  if (ctx.checks.includes('browser-errors')) {
    const errs = browser(['errors']);
    const cons = browser(['console']);
    result.browser_errors = [
      ...normalizeConsole(errs.ok ? errs.stdout : ''),
      ...normalizeConsole(cons.ok ? cons.stdout : ''),
    ];
    if (result.status === 'PASS' && result.browser_errors.some((e) => e.level === 'error')) {
      result.status = 'FAIL';
      result.failure_reason = `browser errors: ${result.browser_errors.filter((e) => e.level === 'error').length}`;
    }
  }
  if (ctx.checks.includes('screenshots')) {
    const file = local.lastScreenshot || join(ctx.screenshotsDir, `${slug}.png`);
    if (!local.lastScreenshot) browser(['screenshot', file, '--full']);
    const v = validateScreenshot(file);
    if (v.ok) result.screenshot = `screenshots/${file.split(sep).pop()}`;
    else if (result.status === 'PASS') { result.status = 'ERROR'; result.failure_reason = `screenshot ${v.reason}`; }
  }
  result.duration_ms = Date.now() - t0;
  return result;
}

// ── run / review subcommands ─────────────────────────────────────────────────
function resolveBuildReview(projectRoot) {
  const project = join(projectRoot, 'visual-tests', 'build-review.mjs');
  if (existsSync(project)) return project;
  // build-review.mjs resolves everything relative to its own directory, so it
  // must live in the project's visual-tests/ — copy it there from the plugin.
  const sibling = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'sg-visual-review', 'build-review.mjs');
  if (existsSync(sibling) && existsSync(join(projectRoot, 'visual-tests'))) {
    copyFileSync(sibling, project);
    const template = join(dirname(sibling), '_review-template.html');
    if (existsSync(template)) copyFileSync(template, join(projectRoot, 'visual-tests', '_review-template.html'));
    console.log('copied build-review.mjs (+ template) from the plugin into visual-tests/');
    return project;
  }
  return null;
}

async function urlAlive(url) {
  if (!url) return false;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.status < 500; } catch { return false; }
}

function writeReportMd(resultsDir, summary, tests, crawlResult) {
  const lines = [
    `# Visual Report — ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`,
    '',
    `Tests: ${summary.total} run, ${summary.pass} pass, ${summary.fail} fail`,
    '',
    '| test | status |',
    '|---|---|',
    ...tests.map((t) => `| ${t.id} | ${t.status} |`),
  ];
  const pending = tests.filter((t) => t.llm_steps_pending > 0);
  if (pending.length) {
    lines.push('', '## Pending LLM checks (mechanical run cannot evaluate these — run /sg-visual-run)');
    lines.push(...pending.map((t) => `- ${t.id}: ${t.llm_steps_pending} step(s)`));
  }
  if (crawlResult && crawlResult.broken && crawlResult.broken.length) {
    lines.push('', '## Broken local assets (measured)');
    lines.push(...crawlResult.broken.map((b) => `- [${b.tag}] ${b.url} → HTTP ${b.status} (on ${b.found_on})`));
  }
  writeFileSync(join(resultsDir, 'report.md'), lines.join('\n') + '\n');
}

async function cmdRun(args) {
  const root = process.cwd();
  const { config, errors } = loadConfig(root);
  if (!config || errors.length) { errors.forEach((e) => console.error(`config: ${e}`)); return EXIT.CONFIG; }
  const profile = resolveProfile(config, args.flags.profile ?? null);
  if (profile.errors.length) { profile.errors.forEach((e) => console.error(`config: ${e}`)); return EXIT.CONFIG; }
  if (args.flags.scope === true) { console.error('config: --scope needs a value (e.g. --scope=auth)'); return EXIT.CONFIG; }
  const scope = String(args.flags.scope || profile.scope || 'all');
  const checks = profile.checks;
  const resultsDir = join(root, 'visual-tests', '_results');
  const screenshotsDir = join(resultsDir, 'screenshots');
  mkdirSync(screenshotsDir, { recursive: true });

  const lanes = {
    audit: { status: 'not-applicable', reason: 'CLI recette covers the deterministic lanes only — run /sg-code-audit for the static lane' },
    process: { status: 'not-applicable', reason: 'CLI recette covers the deterministic lanes only — run /sg-process-check for the behavior lane' },
    crawl: { status: 'skipped', reason: 'local-assets check not in profile' },
    visual: { status: 'skipped', reason: 'not started' },
  };
  const scopeDesc = { type: args.flags.profile ? 'profile' : 'scope', value: args.flags.profile || scope };
  const writeRun = (extra = {}) => writeFileSync(join(resultsDir, 'run.json'),
    JSON.stringify({ ...buildRunJson({ scope: scopeDesc, lanes }), ...extra }, null, 2));

  let startedApp = false;
  let findings = 0;
  try {
    // 0. tool preconditions — a missing tool is infra, diagnosed before any network gate
    const manifests = loadManifests(root, scope);
    if (manifests.length > 0) {
      const probe = browser(['--version']);
      if (!probe.ok && probe.code === -1) {
        lanes.visual = { status: 'error', reason: 'agent-browser not installed (npm i -g agent-browser)' };
        writeRun({ exit_code: EXIT.INFRA });
        console.error('run: agent-browser not installed');
        return EXIT.INFRA;
      }
    }

    // 1. app lifecycle
    let baseUrl = resolveBaseUrl(config, root);
    const needServe = args.flags.serve || (config.app && config.app.start && !(await urlAlive(baseUrl)));
    if (needServe && config.app && config.app.start) {
      const r = await startApp(config, root);
      if (!r.ok) {
        console.error(`run: ${r.error}`);
        lanes.visual = { status: 'error', reason: `app server failed to start: ${r.error}` };
        writeRun({ exit_code: EXIT.INFRA });
        return EXIT.INFRA;
      }
      baseUrl = r.baseUrl;
      startedApp = !r.reused;
      console.log(`app server: ${baseUrl}`);
    }
    if (!baseUrl || !(await urlAlive(baseUrl))) {
      lanes.visual = { status: 'error', reason: `base_url unreachable: ${baseUrl} (infrastructure, not a product finding)` };
      writeRun({ exit_code: EXIT.INFRA });
      console.error(`run: base_url unreachable: ${baseUrl}`);
      return EXIT.INFRA;
    }

    // 2. crawl lane (measured link/asset checks)
    let crawlResult = null;
    if (checks.includes('local-assets') && args.flags['no-crawl']) {
      lanes.crawl = { status: 'skipped', reason: 'local-assets check disabled by --no-crawl' };
    }
    if (checks.includes('local-assets') && !args.flags['no-crawl']) {
      crawlResult = await crawl(baseUrl);
      if (crawlResult.infra_error) { lanes.crawl = { status: 'error', reason: crawlResult.infra_error }; }
      else {
        writeFileSync(join(resultsDir, 'crawl-results.json'), JSON.stringify({
          schema_version: '1.0', timestamp: new Date().toISOString(), base_url: baseUrl,
          pages: crawlResult.pages, assets_checked: crawlResult.assets_checked, broken: crawlResult.broken,
        }, null, 2));
        lanes.crawl = { status: 'ran', results: 'crawl-results.json' };
        findings += crawlResult.broken.length;
        console.log(`crawl: ${crawlResult.pages} pages, ${crawlResult.broken.length} broken assets`);
      }
    }

    // 3. visual lane (mechanical)
    if (manifests.length === 0) {
      lanes.visual = { status: 'skipped', reason: `no manifests match scope "${scope}" — run /sg-visual-discover` };
    } else {
      const ctx = { baseUrl, config, checks, screenshotsDir };
      const tests = [];
      let llmPending = 0;
      for (const [i, entry] of manifests.entries()) {
        const t = await executeManifest(entry, ctx);
        tests.push(t);
        llmPending += t.llm_steps_pending;
        findings += (t.status === 'FAIL' || t.status === 'ERROR') ? 1 : 0;
        console.log(`[shipguard run] ${i + 1}/${manifests.length} ${t.id} — ${t.status}${t.llm_steps_pending ? ` (${t.llm_steps_pending} llm steps pending)` : ''}`);
      }
      const summary = {
        total: tests.length,
        pass: tests.filter((t) => t.status === 'PASS').length,
        fail: tests.filter((t) => t.status === 'FAIL').length,
        error: tests.filter((t) => t.status === 'ERROR').length,
        stale: 0,
        skipped: 0,
        duration_ms: tests.reduce((s, t) => s + t.duration_ms, 0),
      };
      writeFileSync(join(resultsDir, 'visual-results.json'), JSON.stringify({
        schema_version: '1.0',
        run_id: `visual-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`,
        timestamp: new Date().toISOString(),
        base_url: baseUrl,
        scope: { ...scopeDesc, selected_total: tests.length, full_suite_total: loadManifests(root, 'all').length },
        summary,
        tests,
      }, null, 2));
      lanes.visual = { status: 'ran', results: 'visual-results.json' };
      if (llmPending > 0) lanes.llm_checks = { status: 'needs-agent', reason: `${llmPending} llm-check/llm-wait steps require an agent lane (/sg-visual-run)`, count: llmPending };
      writeReportMd(resultsDir, summary, tests, crawlResult);
    }

    writeRun();

    // 4. dashboard
    const builder = resolveBuildReview(root);
    if (builder) {
      try { execFileSync('node', [builder], { cwd: root, stdio: 'inherit' }); }
      catch { console.error('run: dashboard build failed (continuing — artifacts are written)'); }
      if (args.flags.serve) {
        // A fixed port collides silently on busy hosts (spawn is detached) —
        // allocate a free one, then confirm the server actually came up
        // (the free port could be stolen between allocation and listen).
        const reviewPort = await findFreePort();
        const child = spawn('node', [builder, '--serve', `--port=${reviewPort}`], { cwd: root, detached: true, stdio: 'ignore' });
        child.unref();
        const reviewUrl = `http://127.0.0.1:${reviewPort}/review.html`;
        if (await (async () => {
          const deadline = Date.now() + 4000;
          while (Date.now() < deadline) {
            if (await urlAlive(reviewUrl)) return true;
            await new Promise((r) => setTimeout(r, 250));
          }
          return false;
        })()) {
          console.log(`review server: ${reviewUrl} (stop with: shipguard stop --all)`);
        } else {
          console.error('review server did not come up — run "shipguard review --serve" manually');
        }
      }
    } else {
      console.log('note: build-review.mjs not found — dashboard skipped (copy it from the plugin: cp "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/build-review.mjs" visual-tests/)');
    }

    // An errored lane means the recette is incomplete — that is an infra
    // outcome (2), never "clean". Findings and lane details stay in run.json.
    const laneError = Object.values(lanes).some((l) => l && l.status === 'error');
    const exitCode = laneError ? EXIT.INFRA : (findings ? EXIT.FINDINGS : EXIT.CLEAN);
    console.log(`run: ${findings} finding(s)${laneError ? ', 1+ lane errored (infra)' : ''}. exit ${exitCode}`);
    return exitCode;
  } finally {
    browser(['close']);
    if (startedApp && !args.flags.serve) stopApp(root);
  }
}

function cmdReview(args) {
  const builder = resolveBuildReview(process.cwd());
  if (!builder) { console.error('review: build-review.mjs not found in visual-tests/ or plugin'); return EXIT.INFRA; }
  const extra = [];
  if (args.flags.serve) extra.push('--serve');
  if (args.flags.port) extra.push(`--port=${args.flags.port}`);
  try { execFileSync('node', [builder, ...extra], { cwd: process.cwd(), stdio: 'inherit' }); return EXIT.CLEAN; }
  catch {
    // build-review.mjs exits 1 for its own config/PID/port errors — that is a
    // tooling failure, never "findings present". Map to infra, not 1.
    return EXIT.INFRA;
  }
}

// Direct invocation vs library import. process.argv[1] keeps the path the caller
// typed while import.meta.url carries the one the ESM loader resolved, so the two
// name the same file through different strings whenever a symlink is in the path
// (macOS /var -> /private/var, i.e. every mktemp -d). Comparing them as strings
// made the CLI a silent no-op there: exit 0, no output, no command run. Compare
// resolved real paths instead; on any error, assume library import and stay quiet.
function invokedAsCli() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (invokedAsCli()) {
  // main() and 4 of the 7 subcommands are synchronous: calling main inside
  // .then() turns a synchronous throw into a rejection .catch can see.
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .then((code) => process.exit(code ?? 0))
    // An uncaught throw is a tooling failure, never "findings present" — the same
    // mapping cmdReview applies to a build-review.mjs crash. Without this catch an
    // unhandled rejection exits 1, the code reserved for product findings.
    .catch((e) => {
      console.error(`shipguard: ${(e && e.message) || e}`);
      if (process.env.SHIPGUARD_DEBUG) console.error(e && e.stack);
      process.exit(EXIT.INFRA);
    });
}
