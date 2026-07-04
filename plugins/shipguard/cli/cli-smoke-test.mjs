#!/usr/bin/env node
// cli-smoke-test.mjs — pure-function + subprocess tests for shipguard.mjs
import { yamlParse, EXIT, validateConfig, resolveProfile, KNOWN_CHECKS } from './shipguard.mjs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdtempSync, readFileSync as rf, writeFileSync as wf, existsSync as ex, mkdirSync } from 'fs';
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

console.log(fails === 0 ? 'cli-smoke-test: ALL PASS' : `cli-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
