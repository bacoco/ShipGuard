#!/usr/bin/env node
// cli-smoke-test.mjs — pure-function + subprocess tests for shipguard.mjs
import {
  yamlParse, EXIT, validateConfig, resolveProfile, KNOWN_CHECKS,
  tolerantJson, normalizeConsole, validateScreenshot, matchSnapshotRef, buildRunJson,
  loadManifests, MECHANICAL_ACTIONS, AGENT_ACTIONS, executeManifest,
} from './shipguard.mjs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdtempSync, readFileSync as rf, writeFileSync as wf, existsSync as ex, mkdirSync, symlinkSync, copyFileSync, chmodSync } from 'fs';
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
// Line shape copied from real `agent-browser 0.27.0 snapshot -i` output (element
// names kept from the original fixture). The previous fixture invented an `@eN`
// snapshot shape the binary never emits, so these assertions only ever proved
// the parser agreed with whoever wrote the fixture. The live probe at the end of
// this file is what actually pins the shape to the installed binary.
const snap = `- heading "Espace client" [level=1, ref=e1]
- button "Nouvelle conversation" [ref=e3]
- combobox [expanded=false, ref=e5]: Alpha
- link "Accueil" [ref=e7]
- textbox "Nom d'utilisateur" [ref=e9]`;
assert(matchSnapshotRef(snap, 'Nouvelle conversation') === '@e3', 'snapshot: match by text');
assert(matchSnapshotRef(snap, 'accueil') === '@e7', 'snapshot: case-insensitive');
assert(matchSnapshotRef(snap, 'Inexistant') === null, 'snapshot: no match -> null');
// The ref is returned as `@eN` because that is the only spelling the consuming
// commands accept: `agent-browser click e9` answers "Unknown ref", and
// `click "[ref=e9]"` is parsed as a CSS attribute selector and finds nothing.
assert(/^@e\d+$/.test(matchSnapshotRef(snap, 'Alpha') || ''), 'snapshot: ref returned in @eN command form');
// Older agent-browser emitted the bare token; keep reading it.
const legacySnap = `- button "Nouvelle conversation" @e3
- link "Accueil" @e7`;
assert(matchSnapshotRef(legacySnap, 'Nouvelle conversation') === '@e3', 'snapshot: legacy @eN still matched');
assert(matchSnapshotRef(legacySnap, 'Introuvable') === null, 'snapshot: legacy no match -> null');
// An accessible name (or a `-u` url) that itself contains `ref=eN` must not
// shadow the line's real ref.
const trapSnap = '- link "Weird ref=e99 link" [ref=e6, url=file:///deep/link?ref=e99]';
assert(matchSnapshotRef(trapSnap, 'Weird ref=e99 link') === '@e6', 'snapshot: quoted/url ref decoy ignored');

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

assert(loadManifests(projR, 'all').entries.length === 2, 'manifests: all excludes _shared and deprecated');
const scoped = loadManifests(projR, 'site-accessible').entries;
assert(scoped.length === 1 && scoped[0].id === 'site-accessible/index', 'manifests: scope filter');
assert(MECHANICAL_ACTIONS.includes('open') && !MECHANICAL_ACTIONS.includes('llm-check'), 'mechanical actions list');
assert(AGENT_ACTIONS.includes('llm-check') && AGENT_ACTIONS.includes('include')
  && !AGENT_ACTIONS.some((a) => MECHANICAL_ACTIONS.includes(a)), 'agent actions list: declared, and disjoint from mechanical');
// A healthy suite reports no lost coverage — deprecated is excluded silently.
assert(loadManifests(projR, 'all').unloadable.length === 0, 'manifests: a deprecated manifest is not reported as lost coverage');

// ── loadManifests: a manifest that cannot be loaded is reported, not dropped ──
const projU = mkdtempSync(join(tmpdir(), 'sg-unloadable-'));
mkdirSync(join(projU, 'visual-tests', 'pages'), { recursive: true });
wf(join(projU, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:1"\n');
wf(join(projU, 'visual-tests', 'pages', 'ok.yaml'),
  'name: "Ok"\nsteps:\n  - action: open\n    url: "{base_url}/ok.html"\n');
// leading "---" (the idiomatic YAML document marker) — yamlParse returns {}
wf(join(projU, 'visual-tests', 'pages', 'login.yaml'),
  '---\nname: "Login"\nsteps:\n  - action: open\n    url: "{base_url}/login.html"\n');
wf(join(projU, 'visual-tests', 'pages', 'old.yaml'), 'name: "Old"\ndeprecated: true\nsteps: []\n');
const loadedU = loadManifests(projU, 'all');
assert(loadedU.entries.length === 1 && loadedU.entries[0].id === 'pages/ok', 'manifests: unloadable stays out of the suite');
assert(loadedU.unloadable.length === 1 && loadedU.unloadable[0].path === 'pages/login.yaml'
  && loadedU.unloadable[0].reason === 'manifest_not_parseable', 'manifests: unloadable is reported with its path and reason');
// The scope filter runs after the parse gate, so a lost manifest is declared
// whatever the scope — it has no readable path/url pair to filter it on.
assert(loadManifests(projU, 'pages/ok').unloadable.length === 1, 'manifests: unloadable is scope-independent');
// End to end, through a live app and a stand-in browser, so the run reaches the
// visual lane instead of short-circuiting on an infra precondition (an
// unreachable base_url or a missing browser would make this pass for the wrong
// reason). Same app.start idiom as appserver-smoke-test.mjs.
const APP_U = `node -e "require('http').createServer((q,s)=>{s.end('<html>Ok</html>')}).listen({port},'127.0.0.1')"`;
wf(join(projU, 'visual-tests', '_config.yaml'),
  `version: 2\napp:\n  start: "${APP_U.replace(/"/g, '\\"')}"\n  healthcheck: "/"\n  startup_timeout_ms: 15000\n`);
const FAKE_BIN = join(projU, 'fake-agent-browser');
wf(FAKE_BIN, '#!/bin/sh\ncase "$1" in\n  snapshot) printf \'%s\\n\' \'- heading "Ok" @e1\' ;;\n  screenshot) printf \'PNGFAKE\' > "$2" ;;\n  get) [ "$2" = url ] && printf \'%s\\n\' \'http://127.0.0.1/ok.html\' ;;\nesac\nexit 0\n');
chmodSync(FAKE_BIN, 0o755);
let codeU = 0;
try {
  execFileSync('node', [CLI, 'run', '--no-crawl'],
    { cwd: projU, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, SHIPGUARD_AGENT_BROWSER: FAKE_BIN } });
} catch (e) { codeU = e.status; }
const runU = JSON.parse(rf(join(projU, 'visual-tests', '_results', 'run.json'), 'utf8'));
const visU = JSON.parse(rf(join(projU, 'visual-tests', '_results', 'visual-results.json'), 'utf8'));
assert(visU.summary.pass === 1 && visU.summary.error === 0,
  'run: the loadable manifest really ran (the run did not stop on an infra precondition)');
assert(codeU !== EXIT.CLEAN, 'run: a suite with an unloadable manifest never exits clean');
assert(runU.lanes.visual.status === 'error' && /pages\/login\.yaml/.test(runU.lanes.visual.reason),
  'run: an unloadable manifest makes the visual lane an errored lane that names it');
assert(visU.scope.uncovered_routes.length === 1
  && visU.scope.uncovered_routes[0].route === 'visual-tests/pages/login.yaml'
  && visU.scope.uncovered_routes[0].status === 'uncovered',
  'run: the lost manifest is preserved as an uncovered route');
assert(visU.scope.full_suite_total === 2 && visU.scope.selected_total === 1,
  'run: full_suite_total counts the manifest that was meant to run, not only the one that could');

// ── executeManifest: an unknown action is an invalid manifest, never a PASS ──
const invalid = await executeManifest(
  { id: 'pages/typo', url: '', manifest: { name: 'Typo', steps: [{ action: 'assert_txt', text: 'Home' }] } },
  { baseUrl: 'http://127.0.0.1:1', config: {}, checks: [], screenshotsDir: join(projU, 'visual-tests', '_results') });
assert(invalid.status === 'ERROR' && /unknown action "assert_txt"/.test(invalid.manifest_error || ''),
  'steps: an unknown action stops the test and names itself in manifest_error');
const agentOnly = await executeManifest(
  { id: 'pages/inc', url: '', manifest: { name: 'Inc', steps: [{ action: 'include', path: '_shared/login.yaml' }] } },
  { baseUrl: 'http://127.0.0.1:1', config: {}, checks: [], screenshotsDir: join(projU, 'visual-tests', '_results') });
assert(!agentOnly.manifest_error && agentOnly.llm_steps_pending === 1,
  'steps: a declared agent-owned action is pending agent work, not an invalid manifest');

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

// async path: a DIRECTORY where run.json must be written makes cmdRun throw
// EISDIR mid-await. The trigger used to be a scheme-less base_url — until
// validateConfig started rejecting that at load and returning exit 3 before
// anything could throw. Two correct fixes, and the old fixture stopped
// reproducing its own scenario: the config here is deliberately VALID, so the
// only thing left to fail is the write itself.
const projT = mkdtempSync(join(tmpdir(), 'sg-throw-'));
mkdirSync(join(projT, 'visual-tests', '_results', 'run.json'), { recursive: true });
wf(join(projT, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:4711"\n');
const thrownAsync = cliRun('run', projT, {});
assert(thrownAsync.code === EXIT.INFRA, 'async throw -> exit 2 (infra), not 1 (findings)');
assert(/^shipguard: /m.test(thrownAsync.err), 'async throw -> one-line "shipguard:" diagnostic');
assert(!thrownAsync.err.includes('at writeFileSync'), 'async throw -> no raw stack by default');
assert(cliRun('run', projT, { SHIPGUARD_DEBUG: '1' }).err.includes('at writeFileSync'),
  'SHIPGUARD_DEBUG=1 restores the stack');

// sync path: a regular file where visual-tests/ must be a directory makes
// cmdInit's mkdirSync throw ENOTDIR synchronously, before any promise exists.
const projS = mkdtempSync(join(tmpdir(), 'sg-syncthrow-'));
wf(join(projS, 'visual-tests'), 'not a directory\n');
const thrownSync = cliRun('init', projS, {});
assert(thrownSync.code === EXIT.INFRA, 'sync throw -> exit 2 (infra), not 1 (findings)');
assert(/^shipguard: /m.test(thrownSync.err), 'sync throw -> one-line "shipguard:" diagnostic');

// ── review: the exit code is read from build-review.mjs, not assumed (u-03) ──
// Every non-zero code used to become EXIT.INFRA on the untested assumption that
// the builder can only fail as a tool. A missing visual-tests/_config.yaml is a
// config fault; the builder says so with code 3 and `review` must pass it on
// instead of reporting a broken machine.
const projRv = mkdtempSync(join(tmpdir(), 'sg-review-'));
mkdirSync(join(projRv, 'visual-tests'), { recursive: true });
const reviewNoConfig = cliRun('review', projRv, {});
assert(reviewNoConfig.code === EXIT.CONFIG, `review: missing _config.yaml -> exit 3 (got ${reviewNoConfig.code})`);
// The builder's other failures stay infra, and the observed code is named
// rather than swallowed.
wf(join(projRv, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:4711"\n');
wf(join(projRv, 'visual-tests', 'build-review.mjs'), 'console.error("builder blew up"); process.exit(7);\n');
const reviewBroken = cliRun('review', projRv, {});
assert(reviewBroken.code === EXIT.INFRA, `review: an unknown builder code stays infra (got ${reviewBroken.code})`);
assert(/exited 7/.test(reviewBroken.err), `review: the observed exit code is not reported (stderr: ${JSON.stringify(reviewBroken.err)})`);

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
// ── matchSnapshotRef vs the real binary (fixture-vs-binary guard) ──
// The fixtures above are captured, not invented — but a captured fixture still
// freezes. This probe re-derives the contract from whatever agent-browser is
// installed: snapshot shape in, `@eN` out, and the ref actually accepted by a
// consuming command. A future format change fails here instead of silently
// breaking every click/fill/select/upload in the field. Skipped (never failed)
// when no browser is available, so this stays a smoke test, not an e2e suite.
const abBin = process.env.SHIPGUARD_AGENT_BROWSER || 'agent-browser';
const abSession = 'sg-cli-smoke';
const ab = (...a) => execFileSync(abBin, ['--session', abSession, ...a], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
const liveDir = mkdtempSync(join(tmpdir(), 'sg-live-'));
const livePage = join(liveDir, 'probe.html');
wf(livePage, '<!doctype html><meta charset="utf-8"><title>sg probe</title>'
  + '<button onclick="document.getElementById(\'o\').textContent=\'HIT\'">Nouvelle conversation</button>'
  + '<p id="o">MISS</p>');
let liveSkip = null;
try {
  ab('open', `file://${livePage}`);
  const liveSnap = ab('snapshot', '-i');
  const liveRef = matchSnapshotRef(liveSnap, 'Nouvelle conversation');
  assert(liveRef !== null, `live: ${abBin} snapshot parsed (got: ${JSON.stringify(liveSnap.trim().split('\n')[0])})`);
  if (liveRef) {
    ab('click', liveRef);
    assert(ab('get', 'text', '#o').trim() === 'HIT', 'live: ref returned by matchSnapshotRef is clickable');
  }
} catch (e) {
  liveSkip = e.code === 'ENOENT' ? `${abBin} not installed` : String(e.stderr || e.message).trim().split('\n')[0];
} finally {
  try { ab('close'); } catch { /* browser already gone */ }
}
if (liveSkip) console.log(`  SKIP live agent-browser format check (${liveSkip})`);

console.log(fails === 0 ? 'cli-smoke-test: ALL PASS' : `cli-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
