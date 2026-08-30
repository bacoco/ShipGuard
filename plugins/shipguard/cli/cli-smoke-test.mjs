#!/usr/bin/env node
// cli-smoke-test.mjs — pure-function + subprocess tests for shipguard.mjs
import {
  yamlParse, EXIT, validateConfig, resolveProfile, KNOWN_CHECKS,
  tolerantJson, normalizeConsole, validateScreenshot, matchSnapshotRef, buildRunJson,
  loadManifests, MECHANICAL_ACTIONS,
} from './shipguard.mjs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdtempSync, readFileSync as rf, writeFileSync as wf, existsSync as ex, mkdirSync, symlinkSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'shipguard.mjs');
let fails = 0;
function assert(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); }
  else { console.error(`  FAIL ${label}`); fails++; }
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ── yamlParse: config v2 shape ──
const cfg = yamlParse(`
version: 2
base_url: "http://localhost:3000"
credentials:
  username: "u"
  password: "p"
app:
  type: static-site
  root: docs
  start: "python3 -m http.server {port} --bind 127.0.0.1"
  healthcheck: "/index.html"
  startup_timeout_ms: 30000
profiles:
  site-accessible:
    scope: "site-accessible"
    checks:
      - page-load
      - local-assets
  all:
    scope: all
    checks: [page-load, screenshots]
`);
assert(cfg.version === 2, 'yaml: version number');
assert(cfg.credentials.username === 'u', 'yaml: 1-level nesting');
assert(cfg.app.start.includes('{port}'), 'yaml: quoted string with braces');
assert(cfg.app.startup_timeout_ms === 30000, 'yaml: nested number');
assert(cfg.profiles['site-accessible'].scope === 'site-accessible', 'yaml: 2-level nesting');
assert(deepEq(cfg.profiles['site-accessible'].checks, ['page-load', 'local-assets']), 'yaml: nested block list');
assert(deepEq(cfg.profiles.all.checks, ['page-load', 'screenshots']), 'yaml: inline list');

// ── yamlParse: manifest shape (steps list of maps) ──
const man = yamlParse(`
name: "Home page"
priority: high
requires_auth: false
tags: [pages, smoke]
steps:
  - action: open
    url: "{base_url}/index.html"
  - action: llm-check
    criteria: "Page renders"
    screenshot: home.png
`);
assert(man.steps.length === 2, 'yaml: steps list length');
assert(man.steps[0].action === 'open' && man.steps[0].url === '{base_url}/index.html', 'yaml: list-of-maps item 1');
assert(man.steps[1].screenshot === 'home.png', 'yaml: list-of-maps item 2');
assert(man.requires_auth === false, 'yaml: boolean');

// ── exit codes constant ──
assert(EXIT.CLEAN === 0 && EXIT.FINDINGS === 1 && EXIT.INFRA === 2 && EXIT.CONFIG === 3, 'EXIT contract');

// ── subprocess: --help exits 0 and prints subcommands ──
const help = execFileSync('node', [CLI, '--help'], { encoding: 'utf8' });
for (const cmd of ['init', 'serve', 'stop', 'crawl', 'run', 'review']) {
  assert(help.includes(cmd), `help mentions ${cmd}`);
}
assert(help.includes('exit codes'), 'help documents exit codes');

// ── subprocess: unknown subcommand exits 3 ──
let code = 0;
try { execFileSync('node', [CLI, 'frobnicate'], { encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code = e.status; }
assert(code === EXIT.CONFIG, 'unknown subcommand -> exit 3');

// ── validateConfig ──
assert(validateConfig({ base_url: 'http://x' }).length === 0, 'config: minimal v1 config valid');
assert(validateConfig({ app: { start: 'python3 -m http.server {port}' } }).length === 0, 'config: app.start without base_url valid');
assert(validateConfig({}).length === 1, 'config: needs base_url or app.start');
assert(validateConfig({ base_url: 'http://x', profiles: { p: { checks: ['nope'] } } })
  .some(e => e.includes('unknown check')), 'config: unknown check rejected');
assert(validateConfig({ base_url: 'http://x', app: { start: 42 } })
  .some(e => e.includes('app.start')), 'config: non-string app.start rejected');
assert(validateConfig({ base_url: '127.0.0.1:4711' }).some(e => e.includes('base_url')), 'config: scheme-less base_url rejected');
assert(validateConfig({ base_url: 'localhost:3000' }).some(e => e.includes('base_url')), 'config: non-http base_url rejected');
assert(validateConfig({ base_url: 8080 }).some(e => e.includes('base_url')), 'config: non-string base_url rejected');
assert(validateConfig({ base_url: 'https://staging.example.com:8443/app' }).length === 0, 'config: absolute https base_url valid');
assert(validateConfig({ base_url: 'http://127.0.0.1:{port}', app: { start: 'python3 -m http.server {port}' } }).length === 0,
  'config: {port} placeholder in base_url still valid');

// ── resolveProfile ──
const cfg2 = { base_url: 'http://x', profiles: { acc: { scope: 'site-accessible', checks: ['page-load'] } } };
const p1 = resolveProfile(cfg2, 'acc');
assert(p1.errors.length === 0 && p1.scope === 'site-accessible' && deepEq(p1.checks, ['page-load']), 'profile: named');
const p2 = resolveProfile(cfg2, null);
assert(p2.errors.length === 0 && p2.scope === 'all' && deepEq(p2.checks, KNOWN_CHECKS), 'profile: default = all checks');
assert(resolveProfile(cfg2, 'ghost').errors.length === 1, 'profile: unknown -> error');

// ── init: scaffolds and is idempotent ──
const tmp = mkdtempSync(join(tmpdir(), 'sg-init-'));
execFileSync('node', [CLI, 'init'], { cwd: tmp, encoding: 'utf8' });
assert(ex(join(tmp, 'visual-tests', '_config.yaml')), 'init: config scaffolded');
assert(ex(join(tmp, 'visual-tests', '_results')), 'init: _results dir');
const gi1 = rf(join(tmp, '.gitignore'), 'utf8');
assert(gi1.includes('visual-tests/_results/') && gi1.includes('.DS_Store'), 'init: gitignore guard-rails');
assert(gi1.includes('# visual-tests/_regressions.yaml'), 'init: regressions line commented (kept in git by default)');
wf(join(tmp, 'visual-tests', '_config.yaml'), 'base_url: "http://keep-me"\n');
execFileSync('node', [CLI, 'init'], { cwd: tmp, encoding: 'utf8' });
assert(rf(join(tmp, 'visual-tests', '_config.yaml'), 'utf8').includes('keep-me'), 'init: never overwrites config');
const gi2 = rf(join(tmp, '.gitignore'), 'utf8');
assert(gi1 === gi2, 'init: gitignore idempotent');

// ── missing config -> exit 3 for crawl ──
let code3 = 0;
try { execFileSync('node', [CLI, 'crawl'], { cwd: mkdtempSync(join(tmpdir(), 'sg-noconf-')), encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code3 = e.status; }
assert(code3 === EXIT.CONFIG, 'crawl without config -> exit 3');

// ── unusable base_url -> exit 3 (config), not an uncaught throw in startApp ──
const projBad = mkdtempSync(join(tmpdir(), 'sg-badurl-'));
mkdirSync(join(projBad, 'visual-tests'), { recursive: true });
wf(join(projBad, 'visual-tests', '_config.yaml'), 'base_url: "127.0.0.1:4711"\napp:\n  start: "python3 -m http.server 4711"\n');
let code4 = 0;
try { execFileSync('node', [CLI, 'run', '--no-crawl'], { cwd: projBad, encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code4 = e.status; }
assert(code4 === EXIT.CONFIG, 'run: unusable base_url -> exit 3');

// ── valueless --scope -> exit 3, never a silent empty selection ──
const projScope = mkdtempSync(join(tmpdir(), 'sg-scope-'));
mkdirSync(join(projScope, 'visual-tests'), { recursive: true });
wf(join(projScope, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:1"\n');
let code5 = 0;
try { execFileSync('node', [CLI, 'run', '--scope', '--no-crawl'], { cwd: projScope, encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code5 = e.status; }
assert(code5 === EXIT.CONFIG, 'run: valueless --scope -> exit 3');

// ── tolerantJson ──
assert(deepEq(tolerantJson('{"a":1}'), { a: 1 }), 'tolerantJson: plain object');
assert(deepEq(tolerantJson('"{\\"a\\":1}"'), { a: 1 }), 'tolerantJson: escaped JSON string unwrapped');
assert(tolerantJson('not json at all') === null, 'tolerantJson: garbage -> null');
assert(deepEq(tolerantJson('  [1,2] '), [1, 2]), 'tolerantJson: array with whitespace');

// ── normalizeConsole ──
const cons = normalizeConsole(`[error] Failed to load resource: 404 (Not Found)
[warning] Deprecated API
info: fine
pageerror: Uncaught TypeError: x is not a function`);
assert(cons.length === 3, 'console: 3 entries (info dropped)');
assert(cons[0].level === 'error' && cons[0].text.includes('404'), 'console: error entry');
assert(cons[1].level === 'warn', 'console: warning normalized to warn');
assert(cons[2].level === 'error' && cons[2].text.includes('TypeError'), 'console: pageerror -> error');

// ── validateScreenshot ──
const shotDir = mkdtempSync(join(tmpdir(), 'sg-shot-'));
wf(join(shotDir, 'good.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
wf(join(shotDir, 'empty.png'), '');
assert(validateScreenshot(join(shotDir, 'good.png')).ok, 'screenshot: non-empty ok');
assert(validateScreenshot(join(shotDir, 'empty.png')).ok === false, 'screenshot: empty rejected');
assert(validateScreenshot(join(shotDir, 'ghost.png')).reason === 'missing', 'screenshot: missing rejected');

// ── matchSnapshotRef ──
const snap = `- button "Nouvelle conversation" @e3
- link "Accueil" @e7
- textbox "Nom d'utilisateur" @e9`;
assert(matchSnapshotRef(snap, 'Nouvelle conversation') === '@e3', 'snapshot: match by text');
assert(matchSnapshotRef(snap, 'accueil') === '@e7', 'snapshot: case-insensitive');
assert(matchSnapshotRef(snap, 'Inexistant') === null, 'snapshot: no match -> null');

// ── buildRunJson ──
const run = buildRunJson({
  scope: { type: 'profile', value: 'site-accessible' },
  lanes: {
    audit: { status: 'not-applicable', reason: 'static recette profile' },
    visual: { status: 'ran', results: 'visual-results.json' },
  },
});
assert(run.schema_version === '1.0' && run.scope.value === 'site-accessible', 'run.json: shape');
assert(run.lanes.audit.status === 'not-applicable' && run.lanes.audit.reason, 'run.json: declared n/a with reason');
let threw = false;
try { buildRunJson({ scope: {}, lanes: { visual: { status: 'skipped' } } }); } catch { threw = true; }
assert(threw, 'run.json: non-ran lane without reason throws');

// ── loadManifests: scope filtering ──
const projR = mkdtempSync(join(tmpdir(), 'sg-run-'));
mkdirSync(join(projR, 'visual-tests', 'site-accessible'), { recursive: true });
mkdirSync(join(projR, 'visual-tests', 'site-inaccessible'), { recursive: true });
mkdirSync(join(projR, 'visual-tests', '_shared'), { recursive: true });
wf(join(projR, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:1"\n');
wf(join(projR, 'visual-tests', 'site-accessible', 'index.yaml'),
  'name: "Acc index"\nsteps:\n  - action: open\n    url: "{base_url}/site-accessible/index.html"\n');
wf(join(projR, 'visual-tests', 'site-inaccessible', 'index.yaml'),
  'name: "Inacc index"\nsteps:\n  - action: open\n    url: "{base_url}/site-inaccessible/index.html"\n');
wf(join(projR, 'visual-tests', 'site-accessible', 'old.yaml'), 'name: "Old"\ndeprecated: true\nsteps:\n  - action: open\n    url: "{base_url}/x.html"\n');
wf(join(projR, 'visual-tests', '_shared', 'login.yaml'), 'name: "login"\nsteps:\n  - action: open\n    url: "{base_url}/login"\n');

assert(loadManifests(projR, 'all').length === 2, 'manifests: all excludes _shared and deprecated');
const scoped = loadManifests(projR, 'site-accessible');
assert(scoped.length === 1 && scoped[0].id === 'site-accessible/index', 'manifests: scope filter');
assert(MECHANICAL_ACTIONS.includes('open') && !MECHANICAL_ACTIONS.includes('llm-check'), 'mechanical actions list');

// ── run without agent-browser -> exit 2 (infra), run.json declares it ──
// SHIPGUARD_AGENT_BROWSER points at a nonexistent binary (agent-browser shares
// nvm's bin dir with node, so PATH restriction cannot hide one without the other).
let codeR = 0;
try {
  execFileSync('node', [CLI, 'run', '--scope=site-accessible', '--no-crawl'],
    { cwd: projR, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, SHIPGUARD_AGENT_BROWSER: '/nonexistent/agent-browser' } });
} catch (e) { codeR = e.status; }
assert(codeR === EXIT.INFRA, 'run: agent-browser missing -> exit 2');
const runJson = JSON.parse(rf(join(projR, 'visual-tests', '_results', 'run.json'), 'utf8'));
assert(runJson.lanes.visual.status === 'error' && runJson.lanes.visual.reason.includes('agent-browser'),
  'run: run.json declares visual lane error with reason');
assert(runJson.lanes.audit.status === 'not-applicable', 'run: audit lane declared not-applicable by CLI recette');

// ── uncaught throw -> exit 2 (infra), never 1 (findings) ──
// Without a top-level catch, any throw becomes an unhandled rejection and Node
// exits 1 — the code reserved for "ran, findings present". Both halves matter:
// main() and 4 of the 7 subcommands are synchronous, so a sync throw escapes a
// catch chained onto Promise.resolve(main(...)) evaluated eagerly.
function cliRun(cmd, cwd, env) {
  try { execFileSync('node', [CLI, cmd], { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...env } }); }
  catch (e) { return { code: e.status, err: String(e.stderr || '') }; }
  return { code: 0, err: '' };
}

// async path: a scheme-less base_url with a fixed-port app.start makes startApp
// throw "Invalid URL" before it spawns anything.
const projT = mkdtempSync(join(tmpdir(), 'sg-throw-'));
mkdirSync(join(projT, 'visual-tests'), { recursive: true });
wf(join(projT, 'visual-tests', '_config.yaml'),
  'base_url: "127.0.0.1:4711"\napp:\n  start: "python3 -m http.server 4711 --bind 127.0.0.1"\n');
const thrownAsync = cliRun('serve', projT, {});
assert(thrownAsync.code === EXIT.INFRA, 'async throw -> exit 2 (infra), not 1 (findings)');
assert(/^shipguard: /m.test(thrownAsync.err), 'async throw -> one-line "shipguard:" diagnostic');
assert(!thrownAsync.err.includes('at new URL'), 'async throw -> no raw stack by default');
assert(cliRun('serve', projT, { SHIPGUARD_DEBUG: '1' }).err.includes('at new URL'),
  'SHIPGUARD_DEBUG=1 restores the stack');

// sync path: a regular file where visual-tests/ must be a directory makes
// cmdInit's mkdirSync throw ENOTDIR synchronously, before any promise exists.
const projS = mkdtempSync(join(tmpdir(), 'sg-syncthrow-'));
wf(join(projS, 'visual-tests'), 'not a directory\n');
const thrownSync = cliRun('init', projS, {});
assert(thrownSync.code === EXIT.INFRA, 'sync throw -> exit 2 (infra), not 1 (findings)');
assert(/^shipguard: /m.test(thrownSync.err), 'sync throw -> one-line "shipguard:" diagnostic');

// ── entry guard: a symlinked invocation path must still run the CLI ──
// process.argv[1] keeps the path the caller typed; import.meta.url carries the
// one the ESM loader resolved. A symlink anywhere in the path makes the two
// strings differ for the same file (macOS /var -> /private/var, i.e. every
// mktemp -d), and a string comparison then reads "imported as a library":
// the CLI ran nothing, printed nothing and exited 0.
const linkBase = mkdtempSync(join(tmpdir(), 'sg-guard-'));
const realDir = join(linkBase, 'real');
mkdirSync(realDir);
copyFileSync(CLI, join(realDir, 'shipguard.mjs'));
symlinkSync(realDir, join(linkBase, 'link'));
const viaLink = join(linkBase, 'link', 'shipguard.mjs');

const helpL = execFileSync('node', [viaLink, '--help'], { encoding: 'utf8' });
assert(helpL.includes('Subcommands:'), 'entry guard: symlinked path still runs the CLI');
let codeL = -1;
try { execFileSync('node', [viaLink, 'frobnicate'], { encoding: 'utf8', stdio: 'pipe' }); codeL = 0; }
catch (e) { codeL = e.status; }
assert(codeL === EXIT.CONFIG, 'entry guard: symlinked path still reports exit 3, not a silent 0');

// non-regression, the reason the guard exists: importing the module must expose
// its functions without executing the CLI. This very file imports it above.
wf(join(realDir, 'consumer.mjs'),
  "import { main, EXIT, loadManifests } from './shipguard.mjs';\n"
  + "console.log('imported', typeof main, typeof loadManifests, EXIT.INFRA);\n");
for (const [label, entry] of [['direct', join(realDir, 'consumer.mjs')], ['through symlink', join(linkBase, 'link', 'consumer.mjs')]]) {
  const libOut = execFileSync('node', [entry], { encoding: 'utf8' });
  assert(libOut.trim() === 'imported function function 2', `entry guard: library import (${label}) does not run the CLI`);
}

console.log(fails === 0 ? 'cli-smoke-test: ALL PASS' : `cli-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
