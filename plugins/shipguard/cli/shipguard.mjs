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
    if ((q === '"' || q === "'") && v.endsWith(q) && v.length >= 2) return v.slice(1, -1);
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

// Placeholder subcommands — replaced by real implementations task by task.
function cmdServe() { console.error('serve: not implemented yet'); return EXIT.CONFIG; }
function cmdStop() { console.error('stop: not implemented yet'); return EXIT.CONFIG; }
function cmdCrawl() {
  const { config, errors } = loadConfig(process.cwd());
  if (!config || errors.length) { errors.forEach((e) => console.error(`config: ${e}`)); return EXIT.CONFIG; }
  console.error('crawl: not implemented yet');
  return EXIT.CONFIG;
}
function cmdRun() { console.error('run: not implemented yet'); return EXIT.CONFIG; }
function cmdReview() { console.error('review: not implemented yet'); return EXIT.CONFIG; }
function cmdStatus() { console.error('status: not implemented yet'); return EXIT.CONFIG; }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve(main(process.argv.slice(2))).then((code) => process.exit(code ?? 0));
}
