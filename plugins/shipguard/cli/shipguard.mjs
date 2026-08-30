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
 * Exit codes (stable contract). Each code is an instruction, and the axis
 * between 2 and 3 is whether re-running unchanged could ever help:
 *   0  ran clean, no findings — nothing to look at
 *   1  ran, findings present — look at your product
 *   2  infrastructure error — retry; the tooling failed and this run's
 *      evidence cannot be trusted (app won't start, healthcheck timeout,
 *      agent-browser missing or crashed, dashboard build crashed)
 *   3  the run could not be assembled or completed as declared — fix a
 *      declared file; retrying unchanged changes nothing (missing/bad config,
 *      unknown profile/check, a manifest that does not parse or names an
 *      unknown action, a scope that selects nothing, coverage bounded below
 *      the site, a run in which no lane evaluated anything)
 *
 * Precedence when several are true at once: 2 > 3 > 1 > 0. Untrustworthy
 * evidence outranks a wrong declaration, because a human who fixes only the
 * declaration gets another untrustworthy run; and an incomplete recette
 * outranks its own findings, because a partial finding list must not read as
 * a complete one. Incomplete is never clean.
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

# Crawler bound (used by: shipguard crawl / run). Reaching it is reported as
# "truncated" in crawl-results.json — raise it for a site larger than the cap.
# crawl:
#   max_pages: 200

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

// The page cap bounds the RUN, not the site: a site larger than the cap is not
// defective, so reaching it is declared (see `truncated` below), never a failure.
// crawl.max_pages in _config.yaml / --max-pages=N raises it.
export const DEFAULT_MAX_PAGES = 200;

export function resolveMaxPages(config, flags = {}) {
  const raw = flags['max-pages'] ?? (config && config.crawl ? config.crawl.max_pages : undefined);
  // A valueless "--max-pages" (or "max_pages: true") parses as boolean true and
  // Number(true) is 1 — that would silently cap the crawl at a single page.
  const n = typeof raw === 'boolean' ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_PAGES;
}

export async function crawl(baseUrl, opts = {}) {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const start = new URL(baseUrl).href;
  const queue = [start];
  const visitedPages = new Set();
  const checkedAssets = new Map(); // url -> status
  const broken = [];
  let unreachable = 0;

  let first = true;
  while (queue.length && visitedPages.size < maxPages) {
    const pageUrl = queue.shift();
    if (visitedPages.has(pageUrl)) continue;
    visitedPages.add(pageUrl);
    let res;
    try { res = await fetch(pageUrl, { signal: AbortSignal.timeout(8000) }); }
    catch {
      if (first) return { pages: 0, assets_checked: 0, broken: [], infra_error: `base_url unreachable: ${pageUrl}` };
      // Same rule the asset loop below already applies: a URL that cannot be
      // fetched is status 0 and a finding. It was never crawled, so it is not
      // a page either — counting it would inflate coverage with a dead page.
      unreachable++;
      broken.push({ url: pageUrl, status: 0, found_on: pageUrl, tag: 'page' });
      continue;
    }
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
  // Reason-carrying and present ONLY when there is a gap — the same asymmetry
  // buildRunJson enforces on lanes (a "ran" lane carries no reason). A non-empty
  // leftover queue is exactly "stopped early with known work left".
  const queuedUnvisited = new Set(queue.filter((u) => !visitedPages.has(u))).size;
  const pages = visitedPages.size - unreachable;
  const out = { pages, assets_checked: checkedAssets.size, broken };
  if (queuedUnvisited) out.truncated = { reason: `page cap ${maxPages} reached: crawled ${pages} page(s), at least ${queuedUnvisited} known URL(s) left unvisited (plus whatever they link to) — coverage is partial`, max_pages: maxPages, queued_unvisited: queuedUnvisited };
  return out;
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

// agent-browser spells element refs two ways across versions: the bracketed
// attribute emitted by 0.27+ (`- button "Buy now" [ref=e2]`) and the older bare
// token (`- button "Buy now" @e2`). Both name the same element, and every
// command that consumes one (`click`, `fill`, `select`, `upload`) wants `@eN`:
// a bare `e2` is refused ("Unknown ref: e2") and `[ref=e2]` is read as a CSS
// attribute selector and finds nothing. So accept both spellings, always emit
// `@eN`. Quoted spans are accessible names, not attributes — a link named
// `"Weird ref=e99 link"` must not shadow the real `[ref=e6]` on its own line —
// and `ref=` is only an attribute when it opens or follows a bracketed field,
// which keeps `[ref=e6, url=...?ref=e99]` (snapshot -u) reading as e6.
function snapshotRefOf(line) {
  const attrs = String(line).replace(/"[^"]*"/g, '""');
  const bracketed = attrs.match(/[[,]\s*ref\s*=\s*(e\d+)\s*[,\]]/);
  if (bracketed) return `@${bracketed[1]}`;
  const bare = attrs.match(/@(e\d+)\b/);
  return bare ? `@${bare[1]}` : null;
}

export function matchSnapshotRef(snapshotText, target) {
  const needle = String(target).toLowerCase();
  let substringHit = null;
  for (const line of String(snapshotText).split('\n')) {
    const ref = snapshotRefOf(line);
    if (!ref) continue;
    const quoted = line.match(/"([^"]+)"/);
    if (quoted && quoted[1].toLowerCase() === needle) return ref;
    if (!substringHit && line.toLowerCase().includes(needle)) substringHit = ref;
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

// A lane's status says WHAT happened; `remedy` says WHO can fix it, which is
// the only thing the exit code needs and the one thing a status word cannot
// carry (the five above are a closed set, and build-review.mjs coerces any
// unrecognised TEST status to STALE — inventing words is not an option here).
// Additive and present only when a lane needs one, the same asymmetry
// buildRunJson already enforces on `reason`.
export const LANE_REMEDIES = {
  // the machine failed; this run's evidence cannot be trusted, a retry may work
  INFRA: 'infrastructure',
  // a declared file is wrong or too narrow; retrying it unchanged is a no-op
  DECLARATION: 'declaration',
};

// The lanes that can produce a verdict about the product. audit/process are
// always not-applicable in this CLI, llm_checks is a declared handoff to the
// agent layer, and review only renders what the others found — so none of them
// can make a run "evaluated". A future evaluation lane left out of this list
// fails closed (more 3s, never a false 0).
const EVALUATION_LANES = ['crawl', 'visual'];

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
  crawl   [--base-url=URL] [--max-pages=N]
                             Check local links/assets over HTTP -> _results/crawl-results.json
                             (page cap: --max-pages, else crawl.max_pages, else 200; reaching it
                             is declared as "truncated" in the artifact, not a failure)
  run     [--profile=NAME] [--scope=STR] [--serve] [--no-crawl] [--max-pages=N]
                             Full mechanical recette: serve if needed, execute manifests
                             (mechanical steps), checks, artifacts, dashboard
  review  [--serve] [--port=N]  Build (and optionally serve) the review dashboard
  status                     Show app/review server state

exit codes — each one is an instruction, not a severity:
  0  clean            nothing to look at: every declared lane ran and found nothing
  1  findings         look at your product (failed assertion, UI drift, broken asset)
  2  infrastructure   retry: the tooling failed, so this run's evidence cannot be
                      trusted (app won't start, agent-browser missing or crashed,
                      dashboard build crashed)
  3  declaration      fix a declared file: the run could not be assembled or
                      completed as declared, and retrying it unchanged changes
                      nothing (bad config, unknown profile/check, valueless
                      --scope, a manifest that does not parse or names an unknown
                      action, a scope that selects nothing, a crawl bounded below
                      the site, a run in which no lane evaluated anything)
  precedence when several apply: 2 > 3 > 1 > 0. Incomplete is never clean.
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
  const result = await crawl(baseUrl, { maxPages: resolveMaxPages(config, args.flags) });
  if (result.infra_error) { console.error(`crawl: ${result.infra_error}`); return EXIT.INFRA; }
  const resultsDir = join(root, 'visual-tests', '_results');
  mkdirSync(resultsDir, { recursive: true });
  const artifact = {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    base_url: baseUrl,
    pages: result.pages,
    assets_checked: result.assets_checked,
    broken: result.broken,
  };
  if (result.truncated) artifact.truncated = result.truncated;
  writeFileSync(join(resultsDir, 'crawl-results.json'), JSON.stringify(artifact, null, 2));
  console.log(`crawl: ${result.pages} pages, ${result.assets_checked} assets checked, ${result.broken.length} broken`);
  if (result.truncated) console.log(`crawl: INCOMPLETE — ${result.truncated.reason}; raise crawl.max_pages in _config.yaml or pass --max-pages=N`);
  for (const b of result.broken) console.log(`  BROKEN [${b.tag}] ${b.url} (HTTP ${b.status}) on ${b.found_on}`);
  // Same aggregation rule as cmdRun, so the two entry points cannot disagree
  // about the same crawl: a bound below the site is a declaration a human must
  // widen (3) — never "clean", and never INFRA, whose sentence is "retry".
  // It outranks the findings it may itself have truncated away, so a partial
  // finding list is never read as a complete one.
  if (result.truncated) return EXIT.CONFIG;
  return result.broken.length ? EXIT.FINDINGS : EXIT.CLEAN;
}
// ── Manifest loading + mechanical execution ──────────────────────────────────
export const MECHANICAL_ACTIONS = ['open', 'click', 'fill', 'press', 'wait', 'assert_url', 'assert_text', 'screenshot', 'select', 'upload'];

// Actions the declared grammar defines but this deterministic layer does not
// execute — the agent lane (/sg-visual-run) owns them. Listed so a manifest
// written in the declared grammar is never mistaken for an invalid one.
export const AGENT_ACTIONS = ['llm-check', 'llm-wait', 'include'];

// Returns {entries, unloadable} the way loadConfig returns {config, errors}: a
// manifest that cannot be loaded is lost coverage, and lost coverage is
// reported, never dropped. Three different situations used to leave by the
// same silent door; they now leave by three:
//   unreadable / parse threw   -> unloadable, reported as an uncovered route
//   parsed but no `steps` list -> unloadable, reported as an uncovered route
//   deprecated: true           -> excluded on purpose, and silently: a retired
//                                 manifest is not missing coverage
//                                 (cli-smoke-test.mjs pins the exclusion)
// `unloadable` does not depend on `scope`: a manifest that never parsed has no
// readable path-or-url pair to test a scope against, so the loss is declared in
// every run rather than filtered out by a scope it cannot be compared to.
export function loadManifests(projectRoot, scope) {
  const base = join(projectRoot, 'visual-tests');
  const entries = [];
  const unloadable = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.ya?ml$/.test(entry.name)) continue;
      const rel = relative(base, full).split(sep).join('/');
      let manifest;
      try { manifest = yamlParse(readFileSync(full, 'utf8')); }
      catch (e) { unloadable.push({ path: rel, reason: 'manifest_unreadable', detail: String((e && e.message) || e) }); continue; }
      if (manifest && manifest.deprecated === true) continue;
      if (!manifest || !Array.isArray(manifest.steps)) {
        unloadable.push({ path: rel, reason: 'manifest_not_parseable', detail: 'no "steps" list — the file did not parse into a manifest' });
        continue;
      }
      const id = rel.replace(/\.ya?ml$/, '');
      const openStep = manifest.steps.find((s) => s && s.action === 'open');
      const url = openStep && typeof openStep.url === 'string' ? openStep.url : '';
      if (scope && scope !== 'all' && !rel.includes(scope) && !url.includes(scope)) continue;
      entries.push({ id, path: full, manifest, url });
    }
  };
  if (existsSync(base)) walk(base);
  return { entries, unloadable };
}

function interpolate(value, ctx) {
  return String(value)
    .replaceAll('{base_url}', ctx.baseUrl)
    .replace(/\{credentials\.(\w+)\}/g, (_, k) => (ctx.config.credentials && ctx.config.credentials[k]) || '')
    .replace(/\{data\.(\w+)\}/g, (_, k) => (ctx.data && ctx.data[k] != null ? String(ctx.data[k]) : ''));
}

// Per-step cap: a manifest may not park the recette for longer than this.
const WAIT_CAP_MS = 30000;

// A failed step reports WHY it failed, not only that it failed. Every
// {ok:false} return carries the marker `kind`, and executeManifest maps it to
// one of the declared statuses:
//   kind: 'tool'   the browser tooling itself failed (crash, non-zero exit,
//                  unreadable capture) — no evidence was collected  -> ERROR
//   kind: 'stale'  the browser answered, but a declared selector no longer
//                  resolves in the accessibility tree (UI drift)    -> STALE
//   (absent)       the browser answered and the product did not satisfy what
//                  the step declared                        -> FAIL / ERROR
// Absence of evidence is never reported as evidence of absence.
async function runStep(step, ctx) {
  const action = step.action;
  switch (action) {
    case 'open': {
      const r = browser(['open', interpolate(step.url, ctx)]);
      if (!r.ok) return { ok: false, kind: 'tool', reason: `open failed: ${r.stderr || r.stdout}`.trim() };
      return { ok: true };
    }
    case 'click':
    case 'fill':
    case 'select':
    case 'upload': {
      const snap = browser(['snapshot', '-i']);
      if (!snap.ok) return { ok: false, kind: 'tool', reason: `snapshot failed: ${snap.stderr}` };
      const ref = matchSnapshotRef(snap.stdout, interpolate(step.target, ctx));
      if (!ref) return { ok: false, kind: 'stale', reason: `target not found in accessibility tree: "${step.target}"` };
      const extra = action === 'fill' ? [interpolate(step.value ?? step.text ?? '', ctx)]
        : action === 'select' ? [interpolate(step.option ?? step.value ?? '', ctx)]
        : action === 'upload' ? [interpolate(step.file ?? '', ctx)]
        : [];
      const r = browser([action, ref, ...extra]);
      return r.ok ? { ok: true } : { ok: false, kind: 'tool', reason: `${action} failed: ${r.stderr || r.stdout}`.trim() };
    }
    case 'press': {
      const r = browser(['press', step.key || interpolate(step.target ?? '', ctx)]);
      return r.ok ? { ok: true } : { ok: false, kind: 'tool', reason: `press failed: ${r.stderr}` };
    }
    case 'wait': {
      // A declared duration is honoured or reported — never silently replaced
      // by a default or clipped to the cap. An absent one keeps the 1s default.
      const raw = step.duration ?? step.value;
      if (raw == null) { await new Promise((r) => setTimeout(r, 1000)); return { ok: true }; }
      const m = /^(\d+)\s*(ms|s)?$/.exec(String(raw).trim());
      if (!m) return { ok: false, reason: `unsupported duration ${JSON.stringify(String(raw))} (use "1500ms", "2s", or a number of ms)` };
      const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
      if (ms > WAIT_CAP_MS) return { ok: false, reason: `duration ${raw} exceeds the ${WAIT_CAP_MS / 1000}s per-step cap` };
      await new Promise((r) => setTimeout(r, ms));
      return { ok: true };
    }
    case 'assert_url': {
      const r = browser(['get', 'url']);
      if (!r.ok) return { ok: false, kind: 'tool', reason: `get url failed: ${r.stderr || r.stdout}`.trim() };
      const expected = interpolate(step.url ?? step.value ?? '', ctx);
      return r.stdout.trim().includes(expected.replace(/\/$/, ''))
        ? { ok: true } : { ok: false, reason: `url is "${r.stdout.trim()}", expected to include "${expected}"` };
    }
    case 'assert_text': {
      const snap = browser(['snapshot']);
      if (!snap.ok) return { ok: false, kind: 'tool', reason: `snapshot failed: ${snap.stderr || snap.stdout}`.trim() };
      const expected = interpolate(step.text ?? step.value ?? '', ctx);
      return snap.stdout.toLowerCase().includes(expected.toLowerCase())
        ? { ok: true } : { ok: false, reason: `text not found on page: "${expected}"` };
    }
    case 'screenshot': {
      const file = join(ctx.screenshotsDir, step.screenshot || step.file || `${ctx.slug}-step.png`);
      const r = browser(['screenshot', file]);
      const v = validateScreenshot(file);
      if (!r.ok || !v.ok) return { ok: false, kind: 'tool', reason: `screenshot invalid (${v.reason || r.stderr})` };
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
  // Counted, never inspected for a verdict: this only records whether THIS
  // layer evaluated anything at all, which is what separates PASS from SKIPPED
  // below. No classification here depends on it.
  let mechanicalSteps = 0;
  for (const step of entry.manifest.steps) {
    if (!step || !step.action) continue;
    if (step.action === 'llm-check' || step.action === 'llm-wait') { result.llm_steps_pending++; continue; }
    if (!MECHANICAL_ACTIONS.includes(step.action)) {
      // Declared but agent-owned (llm-check/llm-wait are short-circuited above,
      // `include` reaches here): pending agent work, already declared as the
      // needs-agent lane — not a defect.
      if (AGENT_ACTIONS.includes(step.action)) { result.llm_steps_pending++; continue; }
      // Anything else never ran, so nothing about it was observed and the test
      // cannot be PASS. Set here, in the mirror of the branch above, and never
      // through runStep: its `kind` marker describes a step that ran, and an
      // unknown action never runs. ERROR is the only declared status that means
      // "no verdict was produced"; `manifest_error` tells the aggregator this
      // ERROR is an invalid manifest, not a browser crash.
      result.status = 'ERROR';
      result.manifest_error = `unknown action "${step.action}"`;
      result.failure_reason = result.manifest_error;
      break;
    }
    mechanicalSteps++;
    const r = await runStep(step, local);
    if (!r.ok) {
      result.status = r.kind === 'stale' ? 'STALE'
        : (r.kind === 'tool' || !step.action.startsWith('assert')) ? 'ERROR' : 'FAIL';
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
    if (!errs.ok || !cons.ok) {
      // The bridge collected nothing: "no errors" was never observed, so it
      // must not be concluded. Additive field, so an existing verdict stands.
      result.console_capture_error = `browser error capture failed: ${((errs.ok ? cons : errs).stderr || '').trim()}`;
      if (result.status === 'PASS') { result.status = 'ERROR'; result.failure_reason = result.console_capture_error; }
    } else if (result.status === 'PASS' && result.browser_errors.some((e) => e.level === 'error')) {
      result.status = 'FAIL';
      result.failure_reason = `browser errors: ${result.browser_errors.filter((e) => e.level === 'error').length}`;
    }
  }
  if (ctx.checks.includes('screenshots')) {
    const file = local.lastScreenshot || join(ctx.screenshotsDir, `${slug}.png`);
    if (!local.lastScreenshot) browser(['screenshot', file, '--full']);
    const v = validateScreenshot(file);
    if (v.ok) result.screenshot = `screenshots/${file.split(sep).pop()}`;
    else {
      // Record the tooling failure even when a verdict was already reached —
      // additive, so a product FAIL keeps its own reason and its own status.
      result.screenshot_error = `screenshot ${v.reason}`;
      if (result.status === 'PASS') { result.status = 'ERROR'; result.failure_reason = result.screenshot_error; }
    }
  }
  // No mechanical step ran, and no check reached a verdict either: this layer
  // observed nothing, so PASS would claim an evaluation it never made. SKIPPED
  // is the declared status for exactly that (report-formats.md; build-review.mjs
  // already counts it), and the work itself stays declared in llm_steps_pending
  // and in the needs-agent lane. A manifest that mixes agent and mechanical
  // steps keeps its mechanical verdict — only a wholly un-evaluated one flips.
  if (result.status === 'PASS' && mechanicalSteps === 0) result.status = 'SKIPPED';
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
    `Tests: ${summary.total} run, ${summary.pass} pass, ${summary.fail} fail, ${summary.stale} stale, ${summary.error} error, ${summary.skipped} skipped`,
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
    const { entries: manifests, unloadable } = loadManifests(root, scope);
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
      crawlResult = await crawl(baseUrl, { maxPages: resolveMaxPages(config, args.flags) });
      if (crawlResult.infra_error) { lanes.crawl = { status: 'error', reason: crawlResult.infra_error }; }
      else {
        const crawlArtifact = {
          schema_version: '1.0', timestamp: new Date().toISOString(), base_url: baseUrl,
          pages: crawlResult.pages, assets_checked: crawlResult.assets_checked, broken: crawlResult.broken,
        };
        if (crawlResult.truncated) crawlArtifact.truncated = crawlResult.truncated;
        writeFileSync(join(resultsDir, 'crawl-results.json'), JSON.stringify(crawlArtifact, null, 2));
        lanes.crawl = { status: 'ran', results: 'crawl-results.json' };
        // Declared coverage gap, not a lane error. The remedy is a human raising
        // crawl.max_pages / --max-pages, never a retry: re-running an unchanged
        // truncated crawl stops at exactly the same page. That is a declaration
        // fault (3), and never EXIT.INFRA, whose whole sentence is "retry".
        if (crawlResult.truncated) {
          lanes.crawl.truncated = crawlResult.truncated;
          lanes.crawl.remedy = LANE_REMEDIES.DECLARATION;
        }
        findings += crawlResult.broken.length;
        console.log(`crawl: ${crawlResult.pages} pages, ${crawlResult.broken.length} broken assets${crawlResult.truncated ? ` — INCOMPLETE: ${crawlResult.truncated.reason}` : ''}`);
      }
    }

    // 3. visual lane (mechanical)
    if (manifests.length === 0) {
      // Nothing ran. If manifests were lost on the way in, that is a coverage
      // loss, not an empty suite — run.json is the artifact that must carry it,
      // since no visual-results.json is written on this path.
      // A suite that EXISTS but matched nothing is a scope the human mistyped
      // (a declaration fault); a project with no visual suite at all is not at
      // fault here, and is judged only by whether any lane evaluated anything.
      const onDisk = loadManifests(root, 'all');
      const suiteExists = onDisk.entries.length + onDisk.unloadable.length > 0;
      lanes.visual = unloadable.length
        ? { status: 'error', reason: `${unloadable.length} manifest(s) could not be loaded and none remained to run: ${unloadable.map((u) => u.path).join(', ')}`, remedy: LANE_REMEDIES.DECLARATION }
        : suiteExists
          ? { status: 'skipped', reason: `no manifests match scope "${scope}" — ${onDisk.entries.length} manifest(s) on disk match neither that path fragment nor an open url; fix the scope or run /sg-visual-discover`, remedy: LANE_REMEDIES.DECLARATION }
          : { status: 'skipped', reason: 'no visual manifests in visual-tests/ — run /sg-visual-discover' };
    } else {
      const ctx = { baseUrl, config, checks, screenshotsDir };
      const tests = [];
      let llmPending = 0;
      for (const [i, entry] of manifests.entries()) {
        const t = await executeManifest(entry, ctx);
        tests.push(t);
        llmPending += t.llm_steps_pending;
        findings += (t.status === 'FAIL' || t.status === 'STALE') ? 1 : 0;
        console.log(`[shipguard run] ${i + 1}/${manifests.length} ${t.id} — ${t.status}${t.llm_steps_pending ? ` (${t.llm_steps_pending} agent steps pending)` : ''}`);
      }
      const summary = {
        total: tests.length,
        pass: tests.filter((t) => t.status === 'PASS').length,
        fail: tests.filter((t) => t.status === 'FAIL').length,
        error: tests.filter((t) => t.status === 'ERROR').length,
        stale: tests.filter((t) => t.status === 'STALE').length,
        // Armed: a test in which no mechanical step ran is SKIPPED, so this
        // count is the number of manifests this layer did not evaluate. It does
        // NOT include `deprecated: true` manifests — those are retired on
        // purpose and never enter the suite (see loadManifests).
        skipped: tests.filter((t) => t.status === 'SKIPPED').length,
        duration_ms: tests.reduce((s, t) => s + t.duration_ms, 0),
      };
      // full_suite_total must count the manifests that were MEANT to run, or
      // the field whose job is to reveal missing coverage inherits the loss it
      // is supposed to expose. Deprecated ones are retired on purpose and stay
      // out of both counts.
      const fullSuite = loadManifests(root, 'all');
      writeFileSync(join(resultsDir, 'visual-results.json'), JSON.stringify({
        schema_version: '1.0',
        run_id: `visual-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`,
        timestamp: new Date().toISOString(),
        base_url: baseUrl,
        scope: {
          ...scopeDesc,
          // Declared work that could not be executed stays in the machine
          // contract instead of disappearing from it (report-formats.md).
          uncovered_routes: unloadable.map((u) => ({
            route: `visual-tests/${u.path}`, status: 'uncovered', reason: u.reason, detail: u.detail,
          })),
          selected_total: tests.length,
          full_suite_total: fullSuite.entries.length + fullSuite.unloadable.length,
        },
        summary,
        tests,
      }, null, 2));
      // A test that errored collected no evidence — the recette is incomplete,
      // which is an infra outcome, never a product finding. A manifest lost on
      // the way in is the same incompleteness one step earlier. The reason
      // keeps the two apart, and `manifest_error` marks the invalid-manifest
      // tests, so a later aggregation can give them their own exit code (an
      // invalid manifest is closer to a bad config than to a broken machine)
      // without re-deriving anything here.
      const invalidTests = tests.filter((t) => t.manifest_error).length;
      const toolingErrors = summary.error - invalidTests;
      const incomplete = [
        toolingErrors > 0 && `${toolingErrors} test(s) errored (tooling)`,
        invalidTests > 0 && `${invalidTests} test(s) stopped on an invalid manifest`,
        unloadable.length > 0 && `${unloadable.length} manifest(s) could not be loaded: ${unloadable.map((u) => u.path).join(', ')}`,
      ].filter(Boolean);
      if (incomplete.length) {
        // Both remedies can be true at once. Infrastructure wins: a human who
        // fixes only the manifest still gets a run whose evidence is untrusted.
        lanes.visual = {
          status: 'error', reason: incomplete.join('; '), results: 'visual-results.json',
          remedy: toolingErrors > 0 ? LANE_REMEDIES.INFRA : LANE_REMEDIES.DECLARATION,
        };
      } else if (summary.skipped === summary.total) {
        // Every selected manifest is a handoff to the agent layer, so this lane
        // produced no verdict. Calling that "ran" would let a run that
        // evaluated nothing satisfy the aggregation's evaluation test.
        lanes.visual = { status: 'skipped', reason: `${summary.total} manifest(s) selected, none with a step this deterministic layer can evaluate — the agent lane owns them (/sg-visual-run)`, results: 'visual-results.json' };
      } else {
        lanes.visual = { status: 'ran', results: 'visual-results.json' };
      }
      if (llmPending > 0) lanes.llm_checks = { status: 'needs-agent', reason: `${llmPending} step(s) need the agent lane — llm-check/llm-wait/include (/sg-visual-run)`, count: llmPending };
      writeReportMd(resultsDir, summary, tests, crawlResult);
    }

    writeRun();

    // 4. dashboard
    const builder = resolveBuildReview(root);
    if (builder) {
      // logic-016: a dashboard that never built was silently logged and left
      // out of every lane, so a run whose review artifact does not exist could
      // still exit 0. cmdReview already maps a build-review crash to
      // EXIT.INFRA; declaring it as a lane is what makes the two entry points
      // agree, at no cost to the aggregation.
      try { execFileSync('node', [builder], { cwd: root, stdio: 'inherit' }); lanes.review = { status: 'ran', results: 'review.html' }; }
      catch (e) {
        lanes.review = { status: 'error', reason: `dashboard build failed: ${(e && e.message ? String(e.message) : 'build-review.mjs exited non-zero').split('\n')[0]}`, remedy: LANE_REMEDIES.INFRA };
        console.error('run: dashboard build failed (the other artifacts are written; the dashboard is not)');
      }
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
      // Optional tooling that is deliberately absent — declared, no remedy, and
      // no effect on the exit code.
      lanes.review = { status: 'skipped', reason: 'build-review.mjs not found in visual-tests/ or the plugin — dashboard not built' };
      console.log('note: build-review.mjs not found — dashboard skipped (copy it from the plugin: cp "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/build-review.mjs" visual-tests/)');
    }

    // ── exit aggregation ────────────────────────────────────────────────────
    // An incomplete recette is never "clean", and a broken tool never
    // masquerades as a product finding. Both halves of that rule need to know
    // WHO can fix a lane, not only that it is unhappy — which is what `remedy`
    // carries. Precedence 2 > 3 > 1 > 0, justified at the top of this file.
    const hasRemedy = (want) => Object.values(lanes).some((l) => l && l.remedy === want);
    // A run in which no lane evaluated anything asserts nothing about the
    // product, so it cannot be clean — and no single lane is at fault, so the
    // fact is run-level. Each lane's own skip may be perfectly legitimate; it
    // is their conjunction that is empty.
    const nothingEvaluated = !EVALUATION_LANES.some((n) => lanes[n] && lanes[n].status === 'ran');
    const exitCode = hasRemedy(LANE_REMEDIES.INFRA) ? EXIT.INFRA
      : (hasRemedy(LANE_REMEDIES.DECLARATION) || nothingEvaluated) ? EXIT.CONFIG
        : findings ? EXIT.FINDINGS : EXIT.CLEAN;
    const why = exitCode === EXIT.INFRA ? ', tooling failed — this run\'s evidence cannot be trusted (retry)'
      : exitCode === EXIT.CONFIG
        ? (nothingEvaluated && !hasRemedy(LANE_REMEDIES.DECLARATION)
          ? ', and this run evaluated nothing — no lane produced a verdict (add manifests or enable a check)'
          : ', and the run is incomplete as declared — fix the declaration named above (a retry changes nothing)')
        : '';
    console.log(`run: ${findings} finding(s)${why}. exit ${exitCode}`);
    // The three infra early-returns already record the code they returned;
    // recording it here too makes run.json self-describing on every path.
    writeRun({ exit_code: exitCode });
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
  catch (e) {
    // u-03: mapping every non-zero code to infra assumed build-review.mjs can
    // only fail as a tool. It cannot: a missing visual-tests/_config.yaml is a
    // config fault and says so with code 3. Read the code the builder reported
    // instead of assuming one, and name any other code on stderr so the next
    // one added there is not swallowed the same way. Its exit 1 (PID file,
    // port) stays infra: a tooling failure is never "findings present".
    const code = e && Number.isInteger(e.status) ? e.status : null;
    if (code === EXIT.CONFIG) return EXIT.CONFIG;
    console.error(`review: build-review.mjs ${code === null
      ? `did not report an exit code (${(e && (e.signal || e.code)) || 'unknown'})`
      : `exited ${code}`} — treated as infra`);
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
