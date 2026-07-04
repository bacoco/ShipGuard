# ShipGuard v2.5.0 — Recette Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 11 improvements from the "Retour ShipGuard" feedback: a deterministic `shipguard` CLI (init / serve / stop / crawl / run / review), config v2 (`app:` + `profiles:`), app-under-test lifecycle, a persisted `run.json` lane manifest, a derived unified `findings.json` with `evidence: measured|reasoned|manual`, a Findings tab + dynamic default tab + lane-status chips in the dashboard, static-site link/asset crawling, browser-output robustness, `.gitignore` hygiene, and a stable exit-code contract (0/1/2/3).

**Architecture:** Layered: the *deterministic* layer becomes a single self-contained zero-dependency Node CLI (`plugins/shipguard/cli/shipguard.mjs`, same DNA as `build-review.mjs` — copied into the target project's `visual-tests/` and run as `node visual-tests/shipguard.mjs`). The *LLM* layer (llm-check, audits, process reasoning) stays in skills, which now call the CLI for server lifecycle and artifact scaffolding. The three canonical result schemas are **not** changed (CLAUDE.md contract) — `findings.json` and `run.json` are additive, derived artifacts. `findings.json` is built inside `build-review.mjs` (it is copied alone, so no sibling imports).

**Tech Stack:** Node ≥18 (dev machine has v22), zero npm dependencies, standalone `.mjs` smoke tests (repo convention — no test framework), `agent-browser` CLI for browser automation.

## Global Constraints

- **Zero npm dependencies.** No `package.json` anywhere. All scripts are standalone `.mjs`.
- **Self-contained scripts.** `shipguard.mjs` and `build-review.mjs` must each work when copied alone into `visual-tests/` — no relative imports between them.
- **Results contract is additive-only.** Never change existing fields/shapes of `audit-results.json`, `process-results.json`, `visual-results.json` (CLAUDE.md: "Keep these paths and JSON shapes stable"). New artifacts: `visual-tests/_results/run.json`, `visual-tests/_results/findings.json`, `visual-tests/_results/crawl-results.json`.
- **Exit-code contract (CLI-wide):** `0` = ran clean, no findings; `1` = ran, findings present; `2` = infrastructure error (app won't start, healthcheck timeout, agent-browser missing/crashed); `3` = invalid configuration (missing/unparseable config, unknown profile/check, bad manifest).
- **Never run `agent-browser` commands in parallel** (single Playwright daemon). Always `agent-browser close` on any exit path.
- **`--model=haiku` audit ban untouched.** Do not touch protected Spark-track files.
- **Version bump to 2.5.0 in all 4 manifests:** `plugins/shipguard/.claude-plugin/plugin.json`, `plugins/shipguard/.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`.
- **`_regressions.yaml` is NOT gitignored by default** (it is cross-run regression memory); `shipguard init` adds it as a commented optional line only.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## New/Modified File Map

| File | Role |
|---|---|
| Create `plugins/shipguard/cli/shipguard.mjs` | Single-file CLI: exit codes, YAML subset parser, config load/validate, app server lifecycle, crawler, mechanical manifest runner, run.json writer, review delegation. Exports pure helpers; `main()` guarded by `import.meta.url` check. |
| Create `plugins/shipguard/cli/cli-smoke-test.mjs` | Tests: yamlParse, validateConfig, resolveProfile, init idempotence, exit 3 paths, buildRunJson. |
| Create `plugins/shipguard/cli/appserver-smoke-test.mjs` | Tests: free-port allocation, serve→healthcheck→pidfile→stop lifecycle, exit 2 on dead healthcheck. |
| Create `plugins/shipguard/cli/crawl-smoke-test.mjs` | Tests: extractAssets, crawl against a fixture site with one broken asset → exit 1, measured finding in crawl-results.json. |
| Modify `plugins/shipguard/skills/sg-visual-review/build-review.mjs` | Add buildFindings(), load run.json/crawl-results/fix-manifest, write findings.json, inject 3 new placeholders (`__PLACEHOLDER_FINDINGS_DATA__`, `__PLACEHOLDER_RUN_DATA__`, laneAvailability in data). |
| Modify `plugins/shipguard/skills/sg-visual-review/_review-template.html` | Findings tab (first), lane-status chips, dynamic default tab, declared skip reasons in empty states. |
| Modify `plugins/shipguard/skills/sg-visual-review/review-smoke-test.mjs` | Extend: findings.json written, placeholders injected, default-tab data, config-v2 parse safety. |
| Modify SKILL.md files: sg-visual-run, sg-ship, sg-visual-review, sg-visual-review-stop, sg-visual-discover ref `static-html-discovery.md`, sg-visual-run ref `report-formats.md` | Lifecycle via CLI, run.json writing, screenshot byte check, browser_errors capture, app block auto-detect, CLI aliases. |
| Modify `examples/_config.yaml`, `visual-tests/_config.yaml` | Config v2 example (`app:` + `profiles:`). |
| Modify `docs/architecture.md`, `docs/product-roadmap.md`, `README.md`, `plugins/shipguard/README.md` | CLI section, artifacts, exit codes, "Shipped in 2.5.0". |
| Modify 4 version manifests | 2.4.0 → 2.5.0. |

---

### Task 1: Branch

**Files:** none (git only)

- [ ] **Step 1: Create the feature branch**

```bash
cd /data/loic/ShipGuard && git checkout -b feat/recette-engine-v2.5
```

Expected: `Switched to a new branch 'feat/recette-engine-v2.5'`. All later commits happen on this branch.

- [ ] **Step 2: Commit the plan file** (this document)

```bash
git add docs/superpowers/plans/2026-07-04-recette-engine-v2.5.md
git commit -m "docs: implementation plan for v2.5.0 recette engine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: CLI skeleton — exit codes, YAML parser, arg parsing, help

**Files:**
- Create: `plugins/shipguard/cli/shipguard.mjs`
- Test: `plugins/shipguard/cli/cli-smoke-test.mjs`

**Interfaces:**
- Produces (exported from `shipguard.mjs`, consumed by later tasks and smoke tests):
  - `EXIT = { CLEAN: 0, FINDINGS: 1, INFRA: 2, CONFIG: 3 }`
  - `yamlParse(text: string) -> object` — indentation-based subset parser: nested maps (any depth), lists of scalars and of maps, inline `[a, b]`, quoted strings, numbers/bools/null, `#` comments. Documented subset: what ShipGuard configs/manifests use.
  - `main(argv)` guarded: `if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))`

- [ ] **Step 1: Write the failing test**

Create `plugins/shipguard/cli/cli-smoke-test.mjs`:

```js
#!/usr/bin/env node
// cli-smoke-test.mjs — pure-function + subprocess tests for shipguard.mjs
import { yamlParse, EXIT } from './shipguard.mjs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

console.log(fails === 0 ? 'cli-smoke-test: ALL PASS' : `cli-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node plugins/shipguard/cli/cli-smoke-test.mjs`
Expected: FAIL with `Cannot find module '.../shipguard.mjs'`

- [ ] **Step 3: Write the skeleton implementation**

Create `plugins/shipguard/cli/shipguard.mjs`:

```js
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
import { join, dirname, resolve, relative, sep } from 'path';
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
      const key = scalar(m[1]) ?? m[1].trim();
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

// Placeholder subcommands — implemented in later tasks. Each returns an exit code.
function cmdInit() { console.error('init: not implemented yet'); return EXIT.CONFIG; }
function cmdServe() { console.error('serve: not implemented yet'); return EXIT.CONFIG; }
function cmdStop() { console.error('stop: not implemented yet'); return EXIT.CONFIG; }
function cmdCrawl() { console.error('crawl: not implemented yet'); return EXIT.CONFIG; }
function cmdRun() { console.error('run: not implemented yet'); return EXIT.CONFIG; }
function cmdReview() { console.error('review: not implemented yet'); return EXIT.CONFIG; }
function cmdStatus() { console.error('status: not implemented yet'); return EXIT.CONFIG; }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve(main(process.argv.slice(2))).then((code) => process.exit(code ?? 0));
}
```

Note: `main` may become async once serve/run are implemented — the `Promise.resolve(...)` wrapper already handles both. `cmdInit`..`cmdStatus` bodies are replaced in Tasks 3–7 (their "not implemented" stubs intentionally return `EXIT.CONFIG` so nothing half-works silently).

- [ ] **Step 4: Run test to verify it passes**

Run: `node plugins/shipguard/cli/cli-smoke-test.mjs`
Expected: `cli-smoke-test: ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/shipguard/cli/shipguard.mjs plugins/shipguard/cli/cli-smoke-test.mjs
git commit -m "feat(cli): shipguard.mjs skeleton — exit-code contract, YAML subset parser, arg parsing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Config v2 — load, validate, resolveProfile, `init` subcommand

**Files:**
- Modify: `plugins/shipguard/cli/shipguard.mjs` (replace `cmdInit`, add config helpers)
- Modify: `plugins/shipguard/cli/cli-smoke-test.mjs` (append tests)

**Interfaces:**
- Produces:
  - `KNOWN_CHECKS = ['page-load', 'local-assets', 'browser-errors', 'screenshots']`
  - `validateConfig(cfg: object) -> string[]` (empty array = valid)
  - `loadConfig(projectRoot: string) -> { config, errors: string[], path }` — reads `visual-tests/_config.yaml`; missing file → `errors: ['missing']`-style message
  - `resolveProfile(cfg, nameOrNull) -> { name, scope, checks, errors: string[] }` — null name → default profile `{name:'default', scope:'all', checks: all four}`; unknown name → error
  - `cmdInit(args) -> number` — creates `visual-tests/`, `visual-tests/_results/`, `_config.yaml` (only if missing, with the v2 template below), and appends missing `.gitignore` guard-rails idempotently
  - `GITIGNORE_BLOCK` — the exact lines init manages

- [ ] **Step 1: Append failing tests to `cli-smoke-test.mjs`** (before the final `console.log`/`process.exit` lines)

```js
// ── validateConfig ──
import { validateConfig, resolveProfile, KNOWN_CHECKS } from './shipguard.mjs';
import { mkdtempSync, readFileSync as rf, writeFileSync as wf, existsSync as ex } from 'fs';
import { tmpdir } from 'os';

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
```

(Move the `import`s to the top of the test file with the others — ESM imports must be top-level.)

- [ ] **Step 2: Run to verify failure** — `node plugins/shipguard/cli/cli-smoke-test.mjs` → FAIL (`validateConfig` not exported).

- [ ] **Step 3: Implement in `shipguard.mjs`**

Add below the YAML parser:

```js
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
```

Also replace `cmdCrawl`'s stub so the "missing config → 3" test passes now (full crawl comes in Task 5):

```js
function cmdCrawl(args) {
  const { config, errors } = loadConfig(process.cwd());
  if (!config || errors.length) { errors.forEach((e) => console.error(`config: ${e}`)); return EXIT.CONFIG; }
  console.error('crawl: not implemented yet');
  return EXIT.CONFIG;
}
```

Delete the old one-line `cmdInit` stub.

- [ ] **Step 4: Run to verify pass** — `node plugins/shipguard/cli/cli-smoke-test.mjs` → `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add plugins/shipguard/cli/
git commit -m "feat(cli): config v2 (app + profiles), validation, shipguard init with gitignore guard-rails

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: App-under-test lifecycle — `serve` / `stop` / `status`

**Files:**
- Modify: `plugins/shipguard/cli/shipguard.mjs`
- Test: create `plugins/shipguard/cli/appserver-smoke-test.mjs`

**Interfaces:**
- Produces:
  - `findFreePort() -> Promise<number>`
  - `startApp(config, projectRoot) -> Promise<{ ok, baseUrl?, pid?, port?, error? }>` — substitutes `{port}` in `app.start`, spawns detached with `shell: true`, polls `baseUrl + (app.healthcheck || '/')` via `fetch` every 500 ms until HTTP < 500 or `app.startup_timeout_ms` (default 30000), writes pidfile
  - App pidfile: `visual-tests/_results/.app.pid` — 3 lines: `pid`, `port`, `baseUrl` (mirrors the review server's 2-line `.server.pid` convention)
  - `stopApp(projectRoot) -> { stopped: boolean, message }` — kills the process group (`process.kill(-pid)`), removes pidfile
  - `resolveBaseUrl(config, projectRoot) -> string|null` — running app pidfile's baseUrl if the pid is alive, else `config.base_url`
  - `cmdServe`, `cmdStop`, `cmdStatus` wired to these

- [ ] **Step 1: Write the failing test** — create `plugins/shipguard/cli/appserver-smoke-test.mjs`:

```js
#!/usr/bin/env node
// appserver-smoke-test.mjs — serve/stop lifecycle against a real tiny HTTP app
import { findFreePort, EXIT } from './shipguard.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'shipguard.mjs');
let fails = 0;
const assert = (c, l) => { if (c) console.log(`  PASS ${l}`); else { console.error(`  FAIL ${l}`); fails++; } };

// findFreePort returns a usable port
const port = await findFreePort();
assert(Number.isInteger(port) && port > 0 && port < 65536, 'findFreePort: sane port');

// Fixture project: app.start is a one-line node HTTP server honoring {port}
const tmp = mkdtempSync(join(tmpdir(), 'sg-serve-'));
mkdirSync(join(tmp, 'visual-tests'), { recursive: true });
const APP = `node -e "require('http').createServer((q,s)=>{s.end('<html>ok</html>')}).listen({port},'127.0.0.1')"`;
writeFileSync(join(tmp, 'visual-tests', '_config.yaml'),
`version: 2
app:
  start: "${APP.replace(/"/g, '\\"')}"
  healthcheck: "/"
  startup_timeout_ms: 15000
`);

// serve: exits 0, prints base_url, writes .app.pid
const out = execFileSync('node', [CLI, 'serve'], { cwd: tmp, encoding: 'utf8' });
assert(/base_url: http:\/\/127\.0\.0\.1:\d+/.test(out), 'serve: prints derived base_url');
const pidfile = join(tmp, 'visual-tests', '_results', '.app.pid');
assert(existsSync(pidfile), 'serve: pidfile written');
const [pid, appPort, baseUrl] = readFileSync(pidfile, 'utf8').trim().split('\n');
assert(Number(pid) > 0 && Number(appPort) > 0 && baseUrl.startsWith('http://127.0.0.1:'), 'serve: pidfile has pid/port/url');

// the served app actually answers
const res = await fetch(baseUrl);
assert(res.ok && (await res.text()).includes('ok'), 'serve: app reachable');

// status reports it
const st = execFileSync('node', [CLI, 'status'], { cwd: tmp, encoding: 'utf8' });
assert(st.includes('app server: running'), 'status: app running');

// stop: kills it, removes pidfile
execFileSync('node', [CLI, 'stop'], { cwd: tmp, encoding: 'utf8' });
assert(!existsSync(pidfile), 'stop: pidfile removed');
let dead = false;
try { await fetch(baseUrl, { signal: AbortSignal.timeout(1500) }); } catch { dead = true; }
assert(dead, 'stop: app no longer reachable');

// serve with a command that never opens the port -> exit 2 (infra), no zombie pidfile
const tmp2 = mkdtempSync(join(tmpdir(), 'sg-serve2-'));
mkdirSync(join(tmp2, 'visual-tests'), { recursive: true });
writeFileSync(join(tmp2, 'visual-tests', '_config.yaml'),
`version: 2
app:
  start: "node -e \\"setTimeout(()=>{}, 60000)\\""
  healthcheck: "/"
  startup_timeout_ms: 3000
`);
let code = 0;
try { execFileSync('node', [CLI, 'serve'], { cwd: tmp2, encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code = e.status; }
assert(code === EXIT.INFRA, 'serve: healthcheck timeout -> exit 2');
assert(!existsSync(join(tmp2, 'visual-tests', '_results', '.app.pid')), 'serve: failed start leaves no pidfile');

console.log(fails === 0 ? 'appserver-smoke-test: ALL PASS' : `appserver-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
```

- [ ] **Step 2: Run to verify failure** — `node plugins/shipguard/cli/appserver-smoke-test.mjs` → FAIL (`findFreePort` not exported).

- [ ] **Step 3: Implement in `shipguard.mjs`**

```js
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
```

Remove the corresponding stubs.

- [ ] **Step 4: Run to verify pass** — `node plugins/shipguard/cli/appserver-smoke-test.mjs` → `ALL PASS`. Also re-run `cli-smoke-test.mjs` (still ALL PASS).

- [ ] **Step 5: Commit**

```bash
git add plugins/shipguard/cli/
git commit -m "feat(cli): app-under-test lifecycle — serve/stop/status, free port, healthcheck, pidfile

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Static crawler — `crawl` subcommand + `crawl-results.json`

**Files:**
- Modify: `plugins/shipguard/cli/shipguard.mjs`
- Test: create `plugins/shipguard/cli/crawl-smoke-test.mjs`

**Interfaces:**
- Produces:
  - `extractAssets(html: string, pageUrl: string) -> Array<{ url, tag }>` — absolute same-origin URLs from `src=`, `href=`, `poster=`, `srcset=` on `img|script|link|video|audio|source|iframe|track|a`; skips `mailto:`, `tel:`, `javascript:`, `#…`, `data:`, and cross-origin
  - `crawl(baseUrl: string, opts?: { maxPages?: number }) -> Promise<{ pages, assets_checked, broken: Array<{url, status, found_on, tag}>, infra_error? }>` — BFS same-origin from `baseUrl`, follows `<a href>` to other local pages (default maxPages 200), fetch-checks every asset once (HEAD, fallback GET on 405/501), status `0` = network error
  - `cmdCrawl(args)` — writes `visual-tests/_results/crawl-results.json`: `{ schema_version: "1.0", timestamp, base_url, pages, assets_checked, broken[] }`; exit 0 clean / 1 broken assets found / 2 base_url unreachable / 3 config
  - Severity mapping (used by findings in Task 8): `tag === 'a'` → medium, everything else → high

- [ ] **Step 1: Write the failing test** — create `plugins/shipguard/cli/crawl-smoke-test.mjs`:

```js
#!/usr/bin/env node
// crawl-smoke-test.mjs — extractAssets pure tests + end-to-end crawl on a fixture site
import { extractAssets, crawl, EXIT } from './shipguard.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'shipguard.mjs');
let fails = 0;
const assert = (c, l) => { if (c) console.log(`  PASS ${l}`); else { console.error(`  FAIL ${l}`); fails++; } };

// ── extractAssets ──
const assets = extractAssets(`
  <img src="/img/ok.png"><img src="missing.png">
  <script src="app.js"></script>
  <link rel="stylesheet" href="style.css">
  <video poster="poster.jpg"><source src="clip.mp4"></video>
  <a href="page2.html">next</a>
  <a href="https://example.com/ext">ext</a>
  <a href="mailto:x@y.z">mail</a>
  <a href="#anchor">anchor</a>
`, 'http://127.0.0.1:9999/site/index.html');
const urls = assets.map((a) => a.url);
assert(urls.includes('http://127.0.0.1:9999/img/ok.png'), 'extract: root-relative src');
assert(urls.includes('http://127.0.0.1:9999/site/missing.png'), 'extract: relative src');
assert(urls.includes('http://127.0.0.1:9999/site/clip.mp4'), 'extract: <source src>');
assert(urls.includes('http://127.0.0.1:9999/site/page2.html'), 'extract: local <a href>');
assert(!urls.some((u) => u.includes('example.com')), 'extract: cross-origin skipped');
assert(!urls.some((u) => u.startsWith('mailto:')), 'extract: mailto skipped');
assert(assets.find((a) => a.url.endsWith('clip.mp4')).tag === 'source', 'extract: tag recorded');

// ── fixture site: index links page2; page2 has one broken img ──
const site = mkdtempSync(join(tmpdir(), 'sg-site-'));
writeFileSync(join(site, 'index.html'), '<html><a href="page2.html">p2</a><img src="ok.png"></html>');
writeFileSync(join(site, 'page2.html'), '<html><img src="ghost.png"></html>');
writeFileSync(join(site, 'ok.png'), 'x');
const server = http.createServer((req, res) => {
  const f = join(site, req.url === '/' ? 'index.html' : req.url.slice(1));
  try { res.end(readFileSync(f)); } catch { res.statusCode = 404; res.end('nope'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const result = await crawl(base);
assert(result.pages >= 2, 'crawl: followed local link to page2');
assert(result.broken.length === 1 && result.broken[0].url.endsWith('/ghost.png') && result.broken[0].status === 404,
  'crawl: broken img found with status 404');
assert(result.broken[0].found_on.endsWith('/page2.html'), 'crawl: found_on recorded');

// ── cmdCrawl subprocess: writes artifact, exits 1 on findings ──
const proj = mkdtempSync(join(tmpdir(), 'sg-crawlproj-'));
mkdirSync(join(proj, 'visual-tests'), { recursive: true });
writeFileSync(join(proj, 'visual-tests', '_config.yaml'), `base_url: "${base}"\n`);
let code = 0;
try { execFileSync('node', [CLI, 'crawl'], { cwd: proj, encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code = e.status; }
assert(code === EXIT.FINDINGS, 'cmdCrawl: broken asset -> exit 1');
const artifact = JSON.parse(readFileSync(join(proj, 'visual-tests', '_results', 'crawl-results.json'), 'utf8'));
assert(artifact.schema_version === '1.0' && artifact.broken.length === 1, 'cmdCrawl: artifact written');

// ── unreachable base_url -> exit 2 ──
const proj2 = mkdtempSync(join(tmpdir(), 'sg-crawlproj2-'));
mkdirSync(join(proj2, 'visual-tests'), { recursive: true });
writeFileSync(join(proj2, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:1"\n');
let code2 = 0;
try { execFileSync('node', [CLI, 'crawl'], { cwd: proj2, encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code2 = e.status; }
assert(code2 === EXIT.INFRA, 'cmdCrawl: unreachable base_url -> exit 2');

server.close();
console.log(fails === 0 ? 'crawl-smoke-test: ALL PASS' : `crawl-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
```

- [ ] **Step 2: Run to verify failure** — FAIL (`extractAssets` not exported).

- [ ] **Step 3: Implement in `shipguard.mjs`**

```js
// ── Static crawler (measured evidence: real HTTP checks, no LLM) ────────────
const ASSET_ATTR_RE = /<(img|script|link|video|audio|source|iframe|track|a)\b[^>]*?\s(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
const SRCSET_RE = /<(img|source)\b[^>]*?\ssrcset\s*=\s*["']([^"']+)["']/gi;

export function extractAssets(html, pageUrl) {
  const page = new URL(pageUrl);
  const out = [];
  const seen = new Set();
  const push = (rawUrl, tag) => {
    const v = rawUrl.trim();
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
  for (const m of html.matchAll(ASSET_ATTR_RE)) push(m[2], m[1].toLowerCase());
  for (const m of html.matchAll(SRCSET_RE)) {
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
```

Replace `cmdCrawl` (keep the config gate added in Task 3):

```js
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
```

- [ ] **Step 4: Run to verify pass** — all three CLI smoke tests → `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add plugins/shipguard/cli/
git commit -m "feat(cli): static crawler — measured link/asset HTTP checks, crawl-results.json, exit contract

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Browser layer + run.json builder (pure parts)

**Files:**
- Modify: `plugins/shipguard/cli/shipguard.mjs`
- Modify: `plugins/shipguard/cli/cli-smoke-test.mjs` (append tests)

**Interfaces:**
- Produces:
  - `tolerantJson(text: string) -> any|null` — `JSON.parse` direct; if the result is a string that itself looks like JSON (`{`/`[` first char), parse again; on failure try unescaping a shell-quoted JSON string; returns `null` if unparseable (never throws)
  - `normalizeConsole(text: string) -> Array<{level: 'error'|'warn', text: string}>` — parses `agent-browser console`/`errors` plain-text output line-wise; recognizes `[error]`, `error:`, `ERROR`, `pageerror`, `unhandledrejection` prefixes (case-insensitive); drops empty lines
  - `validateScreenshot(path: string) -> { ok: boolean, size: number, reason?: string }` — missing → `{ok:false, reason:'missing'}`, 0 bytes → `{ok:false, reason:'empty file'}`
  - `matchSnapshotRef(snapshotText: string, target: string) -> string|null` — finds `@eN` ref whose line contains `target` (case-insensitive); exact-text line wins over substring match; `null` if none
  - `buildRunJson({ scope, lanes }) -> object` — `{schema_version:'1.0', run_id:'run-<ts>', timestamp, scope, lanes}`; lane statuses restricted to `ran|skipped|not-applicable|error|needs-agent`, each non-`ran` lane requires a `reason`
  - `browser(cmdArgs: string[]) -> { ok, stdout, stderr, code }` — `execFileSync('agent-browser', …)` wrapper, never throws; `code: -1` + `ok:false` when the binary is missing

- [ ] **Step 1: Append failing tests to `cli-smoke-test.mjs`**

```js
// ── tolerantJson ──
import { tolerantJson, normalizeConsole, validateScreenshot, matchSnapshotRef, buildRunJson } from './shipguard.mjs';
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
import { writeFileSync as wf2 } from 'fs';
const shotDir = mkdtempSync(join(tmpdir(), 'sg-shot-'));
wf2(join(shotDir, 'good.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
wf2(join(shotDir, 'empty.png'), '');
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
```

- [ ] **Step 2: Run to verify failure** — FAIL (`tolerantJson` not exported).

- [ ] **Step 3: Implement in `shipguard.mjs`**

```js
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

// ── run.json (lane manifest — item 5 of the feedback) ────────────────────────
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
```

- [ ] **Step 4: Run to verify pass** — `node plugins/shipguard/cli/cli-smoke-test.mjs` → `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add plugins/shipguard/cli/
git commit -m "feat(cli): browser robustness layer (tolerant JSON, console normalization, screenshot bytes, snapshot refs) + run.json builder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Mechanical recette — `run` and `review` subcommands

**Files:**
- Modify: `plugins/shipguard/cli/shipguard.mjs`
- Modify: `plugins/shipguard/cli/cli-smoke-test.mjs` (append tests for pure parts + no-agent-browser path)

**Interfaces:**
- Produces:
  - `loadManifests(projectRoot, scope) -> Array<{ id, path, manifest }>` — walks `visual-tests/**/*.yaml` excluding `_`-prefixed dirs/files and `deprecated: true`; `scope === 'all'` keeps everything; otherwise keep when the manifest's relative path OR its first `open` step URL contains the scope string
  - `MECHANICAL_ACTIONS = ['open','click','fill','press','wait','assert_url','assert_text','screenshot','select','upload']`
  - `executeManifest(entry, ctx) -> testResult` — `{id, manifest, name, url, status: PASS|FAIL|ERROR, duration_ms, screenshot, failure_reason, browser_errors[], llm_steps_pending}` — runs mechanical steps sequentially via `browser()`; `llm-check`/`llm-wait` steps are counted in `llm_steps_pending`, never faked; per the `browser-errors` check, reads `agent-browser errors` + `agent-browser console` after steps and runs `agent-browser console --clear` between tests; per the `screenshots` check, always captures a final full-page screenshot and validates bytes
  - `cmdRun(args)` — pipeline: config → profile (`--profile`/`--scope`) → `--serve` (or app.start + dead base_url) → `local-assets` check via `crawl()` → manifests via `executeManifest` → write `visual-results.json` (existing schema + additive `browser_errors`, `llm_steps_pending`), `crawl-results.json`, `run.json`, `report.md` → build dashboard (`node visual-tests/build-review.mjs`, or the sibling `../skills/sg-visual-review/build-review.mjs` when running from the plugin checkout) → `--serve` keeps review server (`--serve` flag passthrough spawn detached) → exit code: 3 config, 2 infra (app/agent-browser), 1 any finding (visual FAIL/ERROR, browser error, broken asset), 0 clean. Always `agent-browser close` in a `finally`.
  - `cmdReview(args)` — resolves `build-review.mjs` (project copy first, plugin sibling fallback), spawns `node <path> [--serve] [--port=N]` inheriting stdio; exit 2 if not found

- [ ] **Step 1: Append failing tests to `cli-smoke-test.mjs`**

```js
// ── loadManifests: scope filtering ──
import { loadManifests, MECHANICAL_ACTIONS } from './shipguard.mjs';
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

// ── run without agent-browser on PATH -> exit 2 (infra), run.json declares it ──
let codeR = 0;
try {
  execFileSync('node', [CLI, 'run', '--scope=site-accessible', '--no-crawl'],
    { cwd: projR, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: '/usr/bin:/bin' } });
} catch (e) { codeR = e.status; }
assert(codeR === EXIT.INFRA, 'run: agent-browser missing -> exit 2');
const runJson = JSON.parse(rf(join(projR, 'visual-tests', '_results', 'run.json'), 'utf8'));
assert(runJson.lanes.visual.status === 'error' && runJson.lanes.visual.reason.includes('agent-browser'),
  'run: run.json declares visual lane error with reason');
assert(runJson.lanes.audit.status === 'not-applicable', 'run: audit lane declared not-applicable by CLI recette');
```

(Note: `/usr/bin:/bin` PATH keeps `node` reachable but hides globally-npm-installed `agent-browser`; if `agent-browser` lives in `/usr/bin` on this machine, point PATH at an empty temp dir plus the directory containing `node` instead — check with `command -v agent-browser` and adjust so the binary is NOT on the test PATH.)

- [ ] **Step 2: Run to verify failure** — FAIL (`loadManifests` not exported).

- [ ] **Step 3: Implement in `shipguard.mjs`**

```js
// ── Manifest loading (mechanical runner) ─────────────────────────────────────
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
      return { ok: true, llm: action === 'llm-check' || action === 'llm-wait' }; // unknown/llm: never fake
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
    if (!local.lastScreenshot) browser(['screenshot', file, '--full-page']);
    const v = validateScreenshot(file);
    if (v.ok) result.screenshot = `screenshots/${file.split(sep).pop()}`;
    else if (result.status === 'PASS') { result.status = 'ERROR'; result.failure_reason = `screenshot ${v.reason}`; }
  }
  result.duration_ms = Date.now() - t0;
  return result;
}
```

And `cmdRun` / `cmdReview`:

```js
function resolveBuildReview(projectRoot) {
  const project = join(projectRoot, 'visual-tests', 'build-review.mjs');
  if (existsSync(project)) return project;
  const sibling = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'sg-visual-review', 'build-review.mjs');
  return existsSync(sibling) ? sibling : null;
}

async function cmdRun(args) {
  const root = process.cwd();
  const { config, errors } = loadConfig(root);
  if (!config || errors.length) { errors.forEach((e) => console.error(`config: ${e}`)); return EXIT.CONFIG; }
  const profile = resolveProfile(config, args.flags.profile ?? null);
  if (profile.errors.length) { profile.errors.forEach((e) => console.error(`config: ${e}`)); return EXIT.CONFIG; }
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
  const writeRun = (extra = {}) => writeFileSync(join(resultsDir, 'run.json'),
    JSON.stringify({ ...buildRunJson({ scope: { type: args.flags.profile ? 'profile' : 'scope', value: args.flags.profile || scope }, lanes }), ...extra }, null, 2));

  let startedApp = false;
  let findings = 0;
  try {
    // 1. app lifecycle
    let baseUrl = resolveBaseUrl(config, root);
    const needServe = args.flags.serve || (config.app && config.app.start && !(await urlAlive(baseUrl)));
    if (needServe && config.app && config.app.start) {
      const r = await startApp(config, root);
      if (!r.ok) { console.error(`run: ${r.error}`); lanes.visual = { status: 'error', reason: `app server failed to start: ${r.error}` }; writeRun({ exit_code: EXIT.INFRA }); return EXIT.INFRA; }
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
    const manifests = loadManifests(root, scope);
    if (manifests.length === 0) {
      lanes.visual = { status: 'skipped', reason: `no manifests match scope "${scope}" — run /sg-visual-discover` };
    } else {
      const probe = browser(['--version']);
      if (!probe.ok) {
        lanes.visual = { status: 'error', reason: 'agent-browser not installed (npm i -g agent-browser)' };
        writeRun({ exit_code: EXIT.INFRA });
        console.error('run: agent-browser not installed');
        return EXIT.INFRA;
      }
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
        scope: { type: args.flags.profile ? 'profile' : 'scope', value: args.flags.profile || scope, selected_total: tests.length, full_suite_total: loadManifests(root, 'all').length },
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
      const buildArgs = [builder];
      try { execFileSync('node', buildArgs, { cwd: root, stdio: 'inherit' }); } catch { console.error('run: dashboard build failed (continuing — artifacts are written)'); }
      if (args.flags.serve) {
        const child = spawn('node', [builder, '--serve'], { cwd: root, detached: true, stdio: 'ignore' });
        child.unref();
        console.log('review server starting on http://127.0.0.1:8888 (stop with: shipguard stop --all)');
      }
    } else {
      console.log('note: build-review.mjs not found — dashboard skipped (copy it from the plugin: cp "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/build-review.mjs" visual-tests/)');
    }

    console.log(`run: ${findings} finding(s). exit ${findings ? EXIT.FINDINGS : EXIT.CLEAN}`);
    return findings ? EXIT.FINDINGS : EXIT.CLEAN;
  } finally {
    browser(['close']);
    if (startedApp && !args.flags.serve) stopApp(root);
  }
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

function cmdReview(args) {
  const builder = resolveBuildReview(process.cwd());
  if (!builder) { console.error('review: build-review.mjs not found in visual-tests/ or plugin'); return EXIT.INFRA; }
  const extra = [];
  if (args.flags.serve) extra.push('--serve');
  if (args.flags.port) extra.push(`--port=${args.flags.port}`);
  try { execFileSync('node', [builder, ...extra], { cwd: process.cwd(), stdio: 'inherit' }); return EXIT.CLEAN; }
  catch (e) { return e.status ?? EXIT.INFRA; }
}
```

Remove the remaining stubs (`cmdRun`, `cmdReview`).

- [ ] **Step 4: Run all three CLI smoke tests to verify pass**

```bash
node plugins/shipguard/cli/cli-smoke-test.mjs && node plugins/shipguard/cli/appserver-smoke-test.mjs && node plugins/shipguard/cli/crawl-smoke-test.mjs
```

Expected: three `ALL PASS` lines, exit 0.

- [ ] **Step 5: End-to-end sanity run (agent-browser present on this machine)**

Build a throwaway static project and run the full recette:

```bash
T=$(mktemp -d) && mkdir -p $T/docs && cat > $T/docs/index.html <<'EOF'
<html><body><h1>Recette fixture</h1><img src="ghost.png"></body></html>
EOF
cd $T && node /data/loic/ShipGuard/plugins/shipguard/cli/shipguard.mjs init
# edit visual-tests/_config.yaml: uncomment app block with root: docs, start python3 http.server; add profile
cat > $T/visual-tests/_config.yaml <<'EOF'
version: 2
screenshots_dir: "visual-tests/_results/screenshots"
report_path: "visual-tests/_results/report.md"
app:
  root: docs
  start: "python3 -m http.server {port} --bind 127.0.0.1"
  healthcheck: "/index.html"
profiles:
  smoke:
    scope: all
    checks: [page-load, local-assets, browser-errors, screenshots]
EOF
mkdir -p $T/visual-tests/pages && cat > $T/visual-tests/pages/index.yaml <<'EOF'
name: "Index"
steps:
  - action: open
    url: "{base_url}/index.html"
EOF
node /data/loic/ShipGuard/plugins/shipguard/cli/shipguard.mjs run --profile=smoke; echo "exit=$?"
```

Expected: `exit=1` (the ghost.png broken asset is a finding), `visual-tests/_results/` contains `run.json`, `crawl-results.json`, `visual-results.json`, `report.md`, a non-empty screenshot, and `review.html` is skipped with the copy hint (no build-review.mjs in the temp project). App server is stopped afterwards (check `shipguard status`).

- [ ] **Step 6: Commit**

```bash
git add plugins/shipguard/cli/
git commit -m "feat(cli): shipguard run/review — mechanical recette with profiles, app lifecycle, run.json, honest llm-pending handling

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Unified findings — `buildFindings()` in build-review.mjs + `findings.json`

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-review/build-review.mjs`
- Modify: `plugins/shipguard/skills/sg-visual-review/review-smoke-test.mjs`

**Interfaces:**
- Consumes: canonical results files (read-only, defensive) + `crawl-results.json` + `fix-manifest.json` + `run.json`
- Produces:
  - `visual-tests/_results/findings.json`: `{ schema_version: '1.0', generated, findings: [{ id: 'SG-001', title, severity, evidence: 'measured'|'reasoned'|'manual', source: 'audit'|'process'|'browser'|'crawler'|'human', route, file, line, detail, origin: {lane, id} }], summary: { total, by_severity, by_evidence, by_source } }`
  - Template placeholders replaced at build: `"__PLACEHOLDER_FINDINGS_DATA__"` (the findings object) and `"__PLACEHOLDER_RUN_DATA__"` (run.json content or `null`)
  - `data.laneAvailability = { findings: n, audit: bool, process: bool, visual: bool (any test has a non-STALE status), recorded: n }` inside `__PLACEHOLDER_VISUAL_DATA__` — build-time facts for the default-tab pick
- Evidence mapping (fixed, documented in code): audit bugs → `reasoned` (static analysis + LLM verification is still not a measurement); process units → `measured` if any action is measured else `reasoned`; visual FAIL/ERROR + browser_errors → `measured`; crawler broken → `measured`; fix-manifest annotations → `manual`

- [ ] **Step 1: Extend `review-smoke-test.mjs` with failing assertions**

Read the existing test first and follow its fixture pattern (it spawns `build-review.mjs` against a fixture tree). Add a fixture round with: an `audit-results.json` containing 1 critical bug, a `process-results.json` with 1 `behavior-changed` unit (one `measured` action), a `visual-results.json` with 1 FAIL test carrying `browser_errors: [{level:'error', text:'x'}]`, a `crawl-results.json` with 1 broken `img`, a `fix-manifest.json` with 1 annotated test, and a `run.json` with `lanes.process.status = 'not-applicable'`. Then assert:

```js
// after running build-review.mjs against the fixture:
const findings = JSON.parse(readFileSync(join(RESULTS, 'findings.json'), 'utf8'));
assert(findings.schema_version === '1.0', 'findings: schema_version');
assert(findings.findings.length === 5, 'findings: 5 findings from 5 sources');
assert(findings.findings[0].id === 'SG-001' && findings.findings[0].severity === 'critical', 'findings: severity-sorted, SG ids');
const bySource = Object.fromEntries(findings.findings.map(f => [f.source, f]));
assert(bySource.audit.evidence === 'reasoned', 'findings: audit -> reasoned');
assert(bySource.process.evidence === 'measured', 'findings: process w/ measured action -> measured');
assert(bySource.browser.evidence === 'measured', 'findings: visual -> measured');
assert(bySource.crawler.evidence === 'measured' && bySource.crawler.severity === 'high', 'findings: crawler -> measured/high');
assert(bySource.human.evidence === 'manual', 'findings: annotation -> manual');
const html = readFileSync(join(RESULTS, 'review.html'), 'utf8');
assert(!html.includes('__PLACEHOLDER_FINDINGS_DATA__'), 'template: findings placeholder replaced');
assert(!html.includes('__PLACEHOLDER_RUN_DATA__'), 'template: run placeholder replaced');
assert(html.includes('"laneAvailability"'), 'data: laneAvailability injected');

// config v2 parse safety: a config with app+profiles must not break base_url parsing
```

Also add the config-v2 safety fixture: write a `_config.yaml` containing the full v2 template (with `app:` and `profiles:` blocks) into the fixture, run the builder, assert it exits 0 and the page still renders (`review.html` exists, contains the injected data). This pins the known limitation of the builder's mini YAML parser (it may mangle the unused `profiles` key but must not corrupt `base_url`/`credentials`).

- [ ] **Step 2: Run to verify failure** — `node plugins/shipguard/skills/sg-visual-review/review-smoke-test.mjs` → FAIL (no findings.json).

- [ ] **Step 3: Implement in `build-review.mjs`**

Insert after the process-results loading block (after line ~1130, `// ── Collect process-check results …` block) — full code:

```js
// ── Unified findings (feedback item 6): one derived list, evidence-first ──
// The three canonical schemas stay untouched (CLAUDE.md contract); this is an
// additive projection. Evidence taxonomy: measured (a real observation),
// reasoned (a static/simulated prediction), manual (a human annotation).
const FINDINGS_PATH = join(RESULTS_DIR, 'findings.json');
const CRAWL_RESULTS_PATH = join(RESULTS_DIR, 'crawl-results.json');
const RUN_JSON_PATH = join(RESULTS_DIR, 'run.json');
const FIX_MANIFEST_PATH = join(RESULTS_DIR, 'fix-manifest.json');

function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function buildFindings({ audit, processResults, visual, crawlResults, fixManifest }) {
  const findings = [];
  for (const bug of (audit && Array.isArray(audit.bugs) ? audit.bugs : [])) {
    if (!bug || typeof bug !== 'object') continue;
    findings.push({
      title: bug.title || 'Audit finding',
      severity: SEV_RANK[bug.severity] !== undefined ? bug.severity : 'medium',
      evidence: 'reasoned', // static analysis (even verified) predicts; it does not observe
      source: 'audit',
      route: null,
      file: bug.file || null,
      line: Number.isFinite(bug.line) ? bug.line : null,
      detail: bug.description || '',
      origin: { lane: 'audit', id: bug.id || null },
    });
  }
  for (const unit of (processResults && Array.isArray(processResults.units) ? processResults.units : [])) {
    if (!unit || typeof unit !== 'object' || unit.verdict === 'unchanged') continue;
    const actions = Array.isArray(unit.actions) ? unit.actions : [];
    const measured = actions.some((a) => a && a.evidence === 'measured');
    const surprise = actions.some((a) => a && a.surprise);
    findings.push({
      title: `${unit.kind || 'unit'} ${unit.ref || unit.id || ''}: ${unit.verdict || 'changed'}`.trim(),
      severity: unit.verdict === 'new-error' || surprise ? 'high' : 'medium',
      evidence: measured ? 'measured' : 'reasoned',
      source: 'process',
      route: null,
      file: unit.file || null,
      line: null,
      detail: actions.map((a) => a && a.delta).filter(Boolean).join('; ') || (unit.verdict || ''),
      origin: { lane: 'process', id: unit.id || null },
    });
  }
  for (const t of (visual && Array.isArray(visual.tests) ? visual.tests : [])) {
    if (!t || typeof t !== 'object') continue;
    if (t.status === 'FAIL' || t.status === 'ERROR') {
      findings.push({
        title: `${t.name || t.id || 'visual test'}: ${t.status}`,
        severity: t.status === 'FAIL' ? 'high' : 'medium',
        evidence: 'measured',
        source: 'browser',
        route: t.url || null,
        file: null,
        line: null,
        detail: t.failure_reason || '',
        origin: { lane: 'visual', id: t.id || null },
      });
    }
    for (const err of (Array.isArray(t.browser_errors) ? t.browser_errors : [])) {
      if (!err || err.level !== 'error') continue;
      findings.push({
        title: 'Browser console error',
        severity: 'medium',
        evidence: 'measured',
        source: 'browser',
        route: t.url || null,
        file: null,
        line: null,
        detail: err.text || '',
        origin: { lane: 'visual', id: t.id || null },
      });
    }
  }
  for (const b of (crawlResults && Array.isArray(crawlResults.broken) ? crawlResults.broken : [])) {
    if (!b || typeof b !== 'object') continue;
    findings.push({
      title: `Missing local resource (${b.tag || 'asset'})`,
      severity: b.tag === 'a' ? 'medium' : 'high',
      evidence: 'measured',
      source: 'crawler',
      route: b.found_on || null,
      file: null,
      line: null,
      detail: `${b.url} → HTTP ${b.status}`,
      origin: { lane: 'crawl', id: b.url || null },
    });
  }
  for (const t of (fixManifest && Array.isArray(fixManifest.tests) ? fixManifest.tests : [])) {
    if (!t || !Array.isArray(t.annotations) || t.annotations.length === 0) continue;
    findings.push({
      title: `Human annotation on ${t.test || 'test'}`,
      severity: 'medium',
      evidence: 'manual',
      source: 'human',
      route: t.url || null,
      file: null,
      line: null,
      detail: `${t.annotations.length} annotated region(s) on ${t.screenshot || 'screenshot'}`,
      origin: { lane: 'human', id: t.test || null },
    });
  }
  findings.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
  findings.forEach((f, i) => { f.id = 'SG-' + String(i + 1).padStart(3, '0'); });
  const tally = (key) => findings.reduce((m, f) => { m[f[key]] = (m[f[key]] || 0) + 1; return m; }, {});
  return {
    schema_version: '1.0',
    generated: new Date().toISOString(),
    findings,
    summary: { total: findings.length, by_severity: tally('severity'), by_evidence: tally('evidence'), by_source: tally('source') },
  };
}

const auditForFindings = readJsonSafe(join(RESULTS_DIR, 'audit-results.json'));
const crawlResults = readJsonSafe(CRAWL_RESULTS_PATH);
const runData = readJsonSafe(RUN_JSON_PATH);
const fixManifestData = readJsonSafe(FIX_MANIFEST_PATH);
const visualForFindings = readJsonSafe(VISUAL_RESULTS_PATH);
const findingsData = buildFindings({
  audit: auditForFindings,
  processResults,
  visual: visualForFindings,
  crawlResults,
  fixManifest: fixManifestData,
});
writeFileSync(FINDINGS_PATH, JSON.stringify(findingsData, null, 2), 'utf8');
console.log(`  Findings: ${findingsData.summary.total} (${JSON.stringify(findingsData.summary.by_evidence)})`);
```

Then in the `data` object (line ~1050-1069), add one property:

```js
  laneAvailability: {
    findings: findingsData.summary.total,
    audit: !!auditForFindings,
    process: !!processResults,
    visual: tests.some((t) => t.status && t.status !== 'STALE'),
    recorded: 0, // patched below after recordedTests is built
  },
```

Since `findingsData` must exist before `data` is assembled but `processResults`/`visualForFindings` are read after — **reorder**: move the findings block (and the process-results loading block it depends on) so the sequence is: parse visual → load processResults → load audit/crawl/run/fix → buildFindings → assemble `data` → collect recordedTests → set `data.laneAvailability.recorded = recordedTests.length` just before the template replaces. Keep `writeFileSync(VISUAL_RESULTS_PATH, …)` where it is (findings read the *parsed* visual results object, not the rewritten file — pass `visualForFindings = readJsonSafe(VISUAL_RESULTS_PATH)` BEFORE the rewrite, i.e. use the already-parsed `visualResults` raw object: simplest correct approach is to call `readJsonSafe(VISUAL_RESULTS_PATH)` before line 1071's rewrite).

Finally add the two template replacements at the existing chain (line ~1142-1145):

```js
  .replace('"__PLACEHOLDER_FINDINGS_DATA__"', () => embedJson(findingsData))
  .replace('"__PLACEHOLDER_RUN_DATA__"', () => embedJson(runData))
```

- [ ] **Step 4: Run to verify pass** — `node plugins/shipguard/skills/sg-visual-review/review-smoke-test.mjs` → ALL PASS. Also run `node plugins/shipguard/skills/sg-visual-review/monitor-smoke-test.mjs` (must stay green).

- [ ] **Step 5: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-review/
git commit -m "feat(review): derived findings.json — unified evidence-first findings (measured/reasoned/manual) from all five sources

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Dashboard — Findings tab, lane chips, dynamic default tab

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-review/_review-template.html`
- Modify: `plugins/shipguard/skills/sg-visual-review/review-smoke-test.mjs` (assertions)

**Interfaces:**
- Consumes: `__PLACEHOLDER_FINDINGS_DATA__`, `__PLACEHOLDER_RUN_DATA__`, `data.laneAvailability` from Task 8
- Produces: `switchMainTab` handles `'findings'`; `renderFindingsTab()`; `renderLaneChips()`; default tab = first of `['findings','audit','visual','process','recorded']` with data (fallback `'visual'`)

- [ ] **Step 1: Add failing assertions to `review-smoke-test.mjs`**

```js
assert(html.includes('id="main-tab-findings"'), 'template: Findings tab button present');
assert(html.includes('renderFindingsTab'), 'template: findings renderer present');
assert(html.includes('DEFAULT_TAB_ORDER'), 'template: dynamic default tab logic present');
assert(html.includes('lane-chips'), 'template: lane chips container present');
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement in `_review-template.html`**

3a. **Tab bar** (line ~385) — insert the Findings button FIRST and remove `active` from the audit button (initial active is set by script):

```html
<div class="main-tab-bar">
  <button class="main-tab-btn" id="main-tab-findings" onclick="switchMainTab('findings')">Findings <span class="main-tab-badge" id="findings-tab-badge"></span></button>
  <button class="main-tab-btn" id="main-tab-audit" onclick="switchMainTab('audit')">Code Audit <span class="main-tab-badge" id="audit-tab-badge"></span></button>
  <button class="main-tab-btn" id="main-tab-visual" onclick="switchMainTab('visual')">Visual Tests</button>
  <button class="main-tab-btn" id="main-tab-process" onclick="switchMainTab('process')">Process <span class="main-tab-badge" id="process-tab-badge"></span></button>
  <button class="main-tab-btn" id="main-tab-recorded" onclick="switchMainTab('recorded')">Recorded Tests <span class="main-tab-badge" id="recorded-tab-badge"></span></button>
</div>
<div id="lane-chips" class="lane-chips"></div>
```

3b. **Findings view container** — right after the tab bar / lane chips, before `<div id="audit-view" class="visible">` (and remove `class="visible"` from `audit-view`, leaving `<div id="audit-view">` — visibility is script-driven):

```html
<!-- ════════════════ FINDINGS TAB (unified, evidence-first) ════════════════ -->
<div id="findings-view" style="display:none">
  <div class="findings-filters" id="findings-filters"></div>
  <table class="mc-table" id="findings-table" style="display:none">
    <thead><tr><th>ID</th><th>Severity</th><th>Evidence</th><th>Source</th><th>Title</th><th>Where</th></tr></thead>
    <tbody id="findings-tbody"></tbody>
  </table>
  <div id="findings-empty" class="mc-empty" style="display:none">
    <div class="mc-empty-icon">&#9989;</div>
    <p id="findings-empty-title">No findings.</p>
    <p id="findings-empty-detail" style="margin-top:8px"></p>
  </div>
</div>
```

3c. **CSS** — append to the template's `<style>` block:

```css
.lane-chips{display:flex;gap:8px;flex-wrap:wrap;padding:8px 24px 0}
.lane-chip{font-size:12px;border-radius:999px;padding:3px 10px;border:1px solid var(--border,#2b374c);color:var(--muted,#a6b2c2)}
.lane-chip.ran{border-color:#2ea043;color:#2ea043}
.lane-chip.error{border-color:#da3633;color:#da3633}
.lane-chip.needs-agent{border-color:#d29a22;color:#d29a22}
.evidence-badge{font-size:11px;font-weight:700;border-radius:4px;padding:2px 6px;text-transform:uppercase}
.evidence-measured{background:rgba(46,160,67,.15);color:#2ea043}
.evidence-reasoned{background:rgba(210,154,34,.15);color:#d29a22}
.evidence-manual{background:rgba(88,166,255,.15);color:#58a6ff}
```

3d. **Script** — add near the main-tab code (before `switchMainTab`):

```js
var FINDINGS_DATA = "__PLACEHOLDER_FINDINGS_DATA__";
var RUN_DATA = "__PLACEHOLDER_RUN_DATA__";
var DEFAULT_TAB_ORDER = ['findings', 'audit', 'visual', 'process', 'recorded'];

function laneAvailability() {
  try { return __VISUAL_DATA_REF__.laneAvailability || {}; } catch (e) { return {}; }
}
```

**Important template detail:** `__VISUAL_DATA__` is consumed inside an IIFE (line ~1696 `})(__VISUAL_DATA__);`). Expose it globally by changing that IIFE call to store a reference first. Find the IIFE opening (`(function (DATA) {` or equivalent — read the template to get the exact form) and add at its top: `window.__SG_DATA__ = DATA;`. Then `laneAvailability()` reads `(window.__SG_DATA__ || {}).laneAvailability || {}`. Do NOT duplicate the data blob.

```js
function tabHasData(tab) {
  var la = laneAvailability();
  if (tab === 'findings') return FINDINGS_DATA && FINDINGS_DATA.findings && FINDINGS_DATA.findings.length > 0;
  if (tab === 'audit') return !!la.audit;
  if (tab === 'visual') return !!la.visual;
  if (tab === 'process') return !!la.process;
  if (tab === 'recorded') return (la.recorded || 0) > 0;
  return false;
}

function laneReason(lane) {
  if (!RUN_DATA || !RUN_DATA.lanes || !RUN_DATA.lanes[lane]) return null;
  var l = RUN_DATA.lanes[lane];
  return l.status === 'ran' ? null : (l.status + (l.reason ? ' — ' + l.reason : ''));
}

function renderLaneChips() {
  var box = document.getElementById('lane-chips');
  if (!box || !RUN_DATA || !RUN_DATA.lanes) return;
  Object.keys(RUN_DATA.lanes).forEach(function (name) {
    var l = RUN_DATA.lanes[name];
    var chip = document.createElement('span');
    chip.className = 'lane-chip ' + (l.status === 'ran' ? 'ran' : l.status === 'error' ? 'error' : l.status === 'needs-agent' ? 'needs-agent' : '');
    chip.textContent = name + ': ' + l.status + (l.status !== 'ran' && l.reason ? ' (' + l.reason + ')' : '');
    box.appendChild(chip);
  });
}

function renderFindingsTab() {
  var badge = document.getElementById('findings-tab-badge');
  var table = document.getElementById('findings-table');
  var tbody = document.getElementById('findings-tbody');
  var empty = document.getElementById('findings-empty');
  var f = FINDINGS_DATA && Array.isArray(FINDINGS_DATA.findings) ? FINDINGS_DATA.findings : [];
  if (badge) badge.textContent = f.length ? String(f.length) : '';
  if (!f.length) {
    if (table) table.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      var anyRan = RUN_DATA && RUN_DATA.lanes && Object.keys(RUN_DATA.lanes).some(function (k) { return RUN_DATA.lanes[k].status === 'ran'; });
      document.getElementById('findings-empty-title').textContent = anyRan ? 'No findings — all executed lanes are clean.' : 'No findings data.';
      document.getElementById('findings-empty-detail').textContent = anyRan ? '' : 'Run "shipguard run" or /sg-ship to populate this view.';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  if (table) table.style.display = '';
  tbody.textContent = '';
  f.forEach(function (fd) {
    var tr = document.createElement('tr');
    [fd.id, fd.severity, null, fd.source, fd.title, fd.route || (fd.file ? fd.file + (fd.line ? ':' + fd.line : '') : '—')]
      .forEach(function (cell, i) {
        var td = document.createElement('td');
        if (i === 2) {
          var b = document.createElement('span');
          b.className = 'evidence-badge evidence-' + fd.evidence;
          b.textContent = fd.evidence;
          td.appendChild(b);
        } else td.textContent = cell == null ? '' : String(cell);
        tr.appendChild(td);
      });
    if (fd.detail) tr.title = fd.detail;
    tbody.appendChild(tr);
  });
}
```

3e. **`switchMainTab`** (line ~1699) — extend the list and wire findings:

```js
function switchMainTab(tab) {
  ['findings', 'audit', 'visual', 'process', 'recorded'].forEach(function(t) {
    var btn = document.getElementById('main-tab-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
    var view = document.getElementById(t + '-view');
    if (view) view.style.display = t === tab ? (t === 'visual' ? '' : 'block') : 'none';
  });
  if (tab === 'audit') loadAuditData();
  else stopAuditPoll();
  if (tab === 'process') renderProcessTab();
  if (tab === 'recorded') renderRecordedGrid();
  if (tab === 'findings') renderFindingsTab();
}
```

3f. **Auto-load IIFE** (line ~2501-2507) — replace with the dynamic default:

```js
// ── Auto-load on page open: first tab that actually has data ──
(function () {
  renderLaneChips();
  renderFindingsTab(); // badge always reflects count
  if (typeof renderProcessTab === 'function') renderProcessTab();
  var initial = null;
  for (var i = 0; i < DEFAULT_TAB_ORDER.length; i++) {
    if (tabHasData(DEFAULT_TAB_ORDER[i])) { initial = DEFAULT_TAB_ORDER[i]; break; }
  }
  switchMainTab(initial || 'visual');
})();
```

Check that `loadAuditData` is still invoked when audit is the chosen tab (it is — via `switchMainTab('audit')`). Also verify the `visual-view` initial CSS: it previously relied on `audit-view` having `class="visible"`; after this change all views start hidden and `switchMainTab` shows the right one. Grep the template for `#audit-view` / `.visible` CSS rules and adjust so `style.display` control wins (the switch already sets inline styles, which override classes).

3g. **Declared skip reasons in empty states** — in `showAuditEmpty` (line ~1814) and the process empty state (line ~549), prepend the run.json reason when present:

```js
// inside showAuditEmpty, before setting the default text:
var declared = laneReason('audit');
if (declared) {
  document.getElementById('mc-empty-title').textContent = 'Audit lane: ' + declared;
  document.getElementById('mc-empty-detail').textContent = 'Declared by the last run (run.json) — not missing data.';
  /* show mc-empty and return early */
}
```

Same pattern for the process tab empty state with `laneReason('process')`, and in the visual grid empty message with `laneReason('visual')`.

- [ ] **Step 4: Run to verify pass** — `review-smoke-test.mjs` + `monitor-smoke-test.mjs` → ALL PASS.

- [ ] **Step 5: Visual verification (agent-browser)**

```bash
cd /data/loic/ShipGuard && node plugins/shipguard/skills/sg-visual-review/build-review.mjs --serve --port=0
agent-browser open http://127.0.0.1:<actualPort>/review.html
agent-browser screenshot /data/loic/tmp/claude-1003/-data-loic/236cf905-c1f8-424b-99a2-bb2a07b6e907/scratchpad/findings-tab.png
agent-browser close
node plugins/shipguard/skills/sg-visual-review/build-review.mjs --stop
```

Read the screenshot: the Findings tab must be present; with the repo's own (empty) results the default tab must NOT be a blank Findings tab (no findings → falls through the order). Fix anything off before committing.

- [ ] **Step 6: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-review/
git commit -m "feat(review): Findings tab (evidence-first), lane-status chips from run.json, dynamic default tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Skill updates — sg-visual-run (lifecycle, screenshot bytes, browser_errors)

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-run/SKILL.md`
- Modify: `plugins/shipguard/skills/sg-visual-run/references/report-formats.md`

- [ ] **Step 1: Pre-flight step 4** (SKILL.md line 36) — replace with:

```markdown
4. Verify `{base_url}` is reachable: `agent-browser open {base_url}`, check no error.
   - **If unreachable and `_config.yaml` has an `app.start` block:** start the app via the ShipGuard CLI instead of aborting — `node visual-tests/shipguard.mjs serve` (copy it first if missing: `cp "$SHIPGUARD_PLUGIN_ROOT/cli/shipguard.mjs" visual-tests/`). Use the `base_url` it prints for the rest of the run. Remember that the CLI started it: run `node visual-tests/shipguard.mjs stop` in the final cleanup (only when the CLI started the app — never kill a server the user started themselves).
   - Exit-code semantics: `serve` exiting `2` is an **infrastructure error** (report it as such, distinct from any product finding) and `3` is a config error.
   - If unreachable and there is no `app.start`, run `agent-browser close` before aborting (cleanup invariant below).
```

- [ ] **Step 2: Screenshot byte validation** — in SKILL.md Step 2 (line ~103), after the existing MANDATORY paragraph, add:

```markdown
**Byte check before visual check:** immediately after every screenshot capture, verify the file is non-empty (`[ -s {file} ]` or `stat`). A missing or 0-byte screenshot = test `ERROR` with reason "screenshot missing/empty" — do not Read or visually judge an empty file.
```

- [ ] **Step 3: Browser-errors capture** — add a new section after "Step 3: Record result" (line ~107):

```markdown
### Step 4: Capture browser errors (per test)

After the test's steps, capture and normalize console state:

```
agent-browser errors      # uncaught exceptions, unhandled rejections
agent-browser console     # console entries; keep error/warn lines only
agent-browser console --clear   # reset for the next test
```

Record them on the test as `browser_errors: [{"level": "error"|"warn", "text": "..."}]` in `visual-results.json` (additive field). Any `error`-level entry on a test that otherwise passed → status `FAIL` with `failure_reason: "browser errors: N"`. These entries are **measured** evidence and feed the unified `findings.json`.
```

- [ ] **Step 4: report-formats.md** — in the `tests[]` schema section (lines ~42-81), add the two additive fields with one-line docs:

```markdown
- `browser_errors` (optional, additive): `[{level: "error"|"warn", text}]` — normalized console/pageerror entries captured after the test's steps. Measured evidence.
- `llm_steps_pending` (optional, additive): integer — number of `llm-check`/`llm-wait` steps a mechanical (CLI) run could not evaluate. `0` or absent after a full agent run.
```

- [ ] **Step 5: Verify anchors and commit**

```bash
grep -n "shipguard.mjs serve" plugins/shipguard/skills/sg-visual-run/SKILL.md
grep -n "browser_errors" plugins/shipguard/skills/sg-visual-run/references/report-formats.md
git add plugins/shipguard/skills/sg-visual-run/
git commit -m "docs(sg-visual-run): app lifecycle via shipguard serve, screenshot byte check, normalized browser_errors capture

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Skill updates — sg-ship (run.json + lifecycle), sg-visual-review(+stop), sg-visual-discover

**Files:**
- Modify: `plugins/shipguard/skills/sg-ship/SKILL.md`
- Modify: `plugins/shipguard/skills/sg-visual-review/SKILL.md`
- Modify: `plugins/shipguard/skills/sg-visual-review-stop/SKILL.md`
- Modify: `plugins/shipguard/skills/sg-visual-discover/references/static-html-discovery.md`

- [ ] **Step 1: sg-ship — run.json.** In Phase 0 (after step 2 "Detect applicable lanes", line ~48) add:

```markdown
2bis. **Write the lane manifest.** Create `visual-tests/_results/run.json` now and update it after every phase, so skipped work is *declared*, never silent:

```json
{
  "schema_version": "1.0",
  "run_id": "run-<timestamp>",
  "timestamp": "<iso>",
  "scope": {"type": "diff", "value": "<ref>"},
  "lanes": {
    "audit":   {"status": "ran", "results": "audit-results.json"},
    "process": {"status": "ran", "results": "process-results.json"},
    "visual":  {"status": "skipped", "reason": "no agent-browser"},
    "crawl":   {"status": "not-applicable", "reason": "no static site profile — crawl is a CLI recette lane"}
  }
}
```

Statuses: `ran` | `skipped` | `not-applicable` | `error` | `needs-agent` — every non-`ran` status MUST carry a `reason`. The dashboard renders these as lane chips and uses the declared reason in empty tabs.
```

In Phase 3 (line ~92), after the skip conditions, add: `When skipping, record it in run.json (status "skipped", the stated reason) — the spoken reason alone is not enough.`
In Phase 5 (line ~120-125) add one bullet: `- **Findings:** total from visual-tests/_results/findings.json with the evidence mix (measured/reasoned/manual) — the dashboard's Findings tab is the entry point.`
In the final checklist add: `- [ ] visual-tests/_results/run.json written and updated after each phase — every skipped/not-applicable lane declared with a reason`.

- [ ] **Step 2: sg-ship — app lifecycle.** In Phase 0 step 2 (lane detection, line ~48), append:

```markdown
   If the visual lane is applicable but `{base_url}` is down and `_config.yaml` declares `app.start`, start the app once for the whole pipeline: `node visual-tests/shipguard.mjs serve` (copy the CLI from `$SHIPGUARD_PLUGIN_ROOT/cli/shipguard.mjs` if missing). Stop it after Phase 5 with `node visual-tests/shipguard.mjs stop` — only if the CLI started it.
```

- [ ] **Step 3: sg-visual-review SKILL.md.** Document the two new artifacts and the tab behavior. After the existing output description add:

```markdown
## Findings tab & lane chips

The builder derives `visual-tests/_results/findings.json` — a unified, evidence-first list (`measured` | `reasoned` | `manual`) merging audit bugs, process deltas, visual failures, crawler breakage, and human annotations. The dashboard's **Findings** tab renders it and is the default tab when findings exist; otherwise the first tab with data opens (findings → audit → visual → process → recorded). `run.json` (written by `sg-ship` / `shipguard run`) drives per-lane status chips; a declared `skipped`/`not-applicable` lane shows its reason instead of a generic empty state. CLI equivalent: `node visual-tests/shipguard.mjs review [--serve]`.
```

- [ ] **Step 4: sg-visual-review-stop SKILL.md.** Add after the primary command: `CLI equivalent: node visual-tests/shipguard.mjs stop --all (stops the app-under-test server AND the review server).`

- [ ] **Step 5: static-html-discovery.md §1.2c** (line ~78-83) — replace the `build_command` proposal block with:

```markdown
If found, write BOTH the legacy `build_command` and the v2 `app:` block in `_config.yaml`:
```yaml
build_command: "<detected command>"  # auto-detected from {source}
app:
  type: static-site            # or spa/server per detection
  root: <dir containing the HTML files, when static>
  start: "<detected command, with the port flag replaced by {port} when the tool accepts one>"
  healthcheck: "/<first discovered page>"
```
For plain static sites with no detected server, default to `start: "python3 -m http.server {port} --bind 127.0.0.1"` with `root:` set to the HTML directory — this is what makes `shipguard serve` / `shipguard run` self-sufficient on a static delivery.
If nothing detected and the site is not static, leave `build_command: null` and omit `app:`.
```

- [ ] **Step 6: Verify + commit**

```bash
grep -n "run.json" plugins/shipguard/skills/sg-ship/SKILL.md | head
grep -n "app:" plugins/shipguard/skills/sg-visual-discover/references/static-html-discovery.md | head
git add plugins/shipguard/skills/sg-ship/ plugins/shipguard/skills/sg-visual-review/ plugins/shipguard/skills/sg-visual-review-stop/ plugins/shipguard/skills/sg-visual-discover/
git commit -m "docs(skills): run.json lane manifest in sg-ship, app lifecycle handoff, Findings tab docs, static app block auto-detect

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Config examples, docs, version bump

**Files:**
- Modify: `examples/_config.yaml`, `visual-tests/_config.yaml`
- Modify: `docs/architecture.md`, `docs/product-roadmap.md`, `README.md`, `plugins/shipguard/README.md`
- Modify: `plugins/shipguard/.claude-plugin/plugin.json`, `plugins/shipguard/.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`

- [ ] **Step 1: `examples/_config.yaml`** — append the commented v2 blocks from Task 3's `CONFIG_TEMPLATE` (the `app:` and `profiles:` sections, commented, with the same wording). Add `version: 2` at the top. Do the same minimal addition to `visual-tests/_config.yaml`.

- [ ] **Step 2: `docs/architecture.md`** — add a new section after the Skills Overview table:

```markdown
## shipguard CLI (deterministic layer)

`plugins/shipguard/cli/shipguard.mjs` — single-file, zero-dependency Node CLI, copied into the
target project like `build-review.mjs` (`cp "$SHIPGUARD_PLUGIN_ROOT/cli/shipguard.mjs" visual-tests/`).
It owns everything that does NOT need a model: app-under-test lifecycle (`serve`/`stop`: free port,
`app.start` with `{port}`, healthcheck poll, pidfile `.app.pid`), static link/asset crawling
(`crawl` → `crawl-results.json`, measured evidence), the mechanical recette (`run --profile=NAME`:
mechanical manifest steps via agent-browser, checks `page-load`/`local-assets`/`browser-errors`/`screenshots`,
artifacts in one pass), scaffolding (`init`: config v2 + .gitignore guard-rails), and dashboard
delegation (`review [--serve]`). LLM assertions (`llm-check`/`llm-wait`), the audit, and the process
lanes stay in the skills — a mechanical run reports them as `needs-agent` in `run.json`, never fakes them.

**Exit codes (stable):** `0` clean · `1` findings · `2` infrastructure error · `3` invalid configuration.
An unreachable app is infra (2), never a product finding (1).

**Artifacts (all under `visual-tests/_results/`, additive to the canonical three):**
- `run.json` — lane manifest: per-lane `ran|skipped|not-applicable|error|needs-agent` + reason. Written by `shipguard run` and `sg-ship`.
- `findings.json` — derived, unified, evidence-first findings (`measured|reasoned|manual` × source `audit|process|browser|crawler|human`), built by `build-review.mjs` from the five sources. The canonical per-lane schemas are unchanged.
- `crawl-results.json` — measured HTTP link/asset checks.
```

Also update the sg-visual-review section (tab list: Findings first, dynamic default) and the Data Flow diagram (add `shipguard crawl --> crawl-results.json --> findings.json` and `run.json --> lane chips`).

- [ ] **Step 3: `docs/product-roadmap.md`** — add under a new `## Shipped in 2.5.0` heading (after the 2.3.x–2.4.0 section):

```markdown
## Shipped in 2.5.0

*Source: second-round Codex static-recette feedback ("Retour ShipGuard", 2026-07) — first round was docs/scout-reports/2026-06-29-codex-static-recipe-improvements/.*

- **`shipguard` CLI (deterministic recette engine)** — init / serve / stop / crawl / run / review / status; single self-contained .mjs; stable exit codes 0 clean / 1 findings / 2 infra / 3 config
- **Config v2** — `app:` lifecycle block ({port} substitution, healthcheck) + named `profiles:` (scope + checks)
- **App-under-test lifecycle owned by the recette** — free-port allocation, healthcheck wait, clean teardown, pidfile; infra errors distinct from product findings
- **`run.json` lane manifest** — skipped/not-applicable lanes declared with reasons, rendered as dashboard chips
- **Unified `findings.json`** — evidence-first (`measured`/`reasoned`/`manual`) across audit/process/browser/crawler/human; canonical schemas untouched
- **Findings tab + dynamic default tab** — dashboard opens on the first tab with data; declared skip reasons replace generic empty states
- **Static-site mode completed** — measured link/asset crawler (`shipguard crawl`), auto `app:` block detection in discovery
- **Browser-output robustness** — tolerant JSON parsing, normalized console errors (`browser_errors[]`, additive), screenshot byte validation
- **Hygiene** — `shipguard init` seeds .gitignore guard-rails (`_results/`, `.DS_Store`); `_regressions.yaml` stays committed by default
```

- [ ] **Step 4: READMEs.** In the root `README.md` Status table, update Review Dashboard notes to mention the Findings tab, and add a row `| Recette CLI | 🟢 New in 2.5.0 | shipguard init/serve/run/review — deterministic, exit codes 0/1/2/3 |`. In `plugins/shipguard/README.md` add a "CLI quickstart (static site recette)" section:

````markdown
## CLI quickstart — static site recette

```bash
cp "$SHIPGUARD_PLUGIN_ROOT/cli/shipguard.mjs" visual-tests/   # once
node visual-tests/shipguard.mjs init                          # config v2 + .gitignore guard-rails
# declare in visual-tests/_config.yaml:
#   app:    start: "python3 -m http.server {port} --bind 127.0.0.1", root: docs, healthcheck: "/index.html"
#   profiles: site-accessible: { scope: "site-accessible", checks: [page-load, local-assets, browser-errors, screenshots] }
node visual-tests/shipguard.mjs run --profile=site-accessible --serve
# exit 0 = clean, 1 = findings (see review.html Findings tab), 2 = infra, 3 = config
node visual-tests/shipguard.mjs stop --all
```
````

- [ ] **Step 5: Version bump.** In all four manifests change `"version": "2.4.0"` → `"version": "2.5.0"` (check each file for the exact key location; marketplace manifests may nest it under the plugin entry). Verify:

```bash
grep -rn '"version"' plugins/shipguard/.claude-plugin/plugin.json plugins/shipguard/.codex-plugin/plugin.json .claude-plugin/marketplace.json .agents/plugins/marketplace.json
```

Expected: all show 2.5.0.

- [ ] **Step 6: Commit**

```bash
git add examples/_config.yaml visual-tests/_config.yaml docs/ README.md plugins/shipguard/README.md plugins/shipguard/.claude-plugin/ plugins/shipguard/.codex-plugin/ .claude-plugin/ .agents/
git commit -m "docs+chore: v2.5.0 — recette CLI docs, config v2 examples, roadmap, version bump in all 4 manifests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Full verification + external review + PR

**Files:** none new

- [ ] **Step 1: Full smoke suite**

```bash
cd /data/loic/ShipGuard
node plugins/shipguard/cli/cli-smoke-test.mjs && \
node plugins/shipguard/cli/appserver-smoke-test.mjs && \
node plugins/shipguard/cli/crawl-smoke-test.mjs && \
node plugins/shipguard/skills/sg-visual-review/review-smoke-test.mjs && \
node plugins/shipguard/skills/sg-visual-review/monitor-smoke-test.mjs && \
node plugins/shipguard/skills/sg-improve/improve-dry-run-smoke-test.mjs && \
node plugins/shipguard/skills/sg-improve/improve-rollback-smoke-test.mjs && \
node plugins/shipguard/skills/sg-visual-fix/visual-fix-dry-run-smoke-test.mjs && \
node plugins/shipguard/skills/sg-scout/offline-dry-run-smoke-test.mjs && echo "SUITE GREEN"
```

Expected: `SUITE GREEN`. Fix any red before proceeding.

- [ ] **Step 2: Re-run the Task 7 Step 5 end-to-end recette** (fresh temp dir) and additionally copy `build-review.mjs` into it so the dashboard builds; verify `review.html` opens on the **Findings** tab (crawler finding present) via agent-browser screenshot; verify `shipguard stop --all` leaves no processes (`shipguard status`).

- [ ] **Step 3: External review (validator ≠ generator).** Run the Codex review skill on the branch diff (`cloclo:codex-review` with the implementation scope = `git diff main...HEAD`). Triage every finding: fix real issues (new commits), rebut false positives explicitly. Re-run the smoke suite after fixes.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/recette-engine-v2.5
gh pr create --repo bacoco/ShipGuard --title "v2.5.0 — deterministic recette engine (CLI, config v2, unified findings, lane manifest)" --body "$(cat <<'EOF'
Implements the second-round static-recette feedback ("Retour ShipGuard") — all 11 items.

## What
- **shipguard CLI** (single-file, zero-dep): init / serve / stop / crawl / run / review / status — stable exit codes 0 clean / 1 findings / 2 infra / 3 config
- **Config v2**: app lifecycle block ({port}, healthcheck) + named recette profiles (scope + checks)
- **App-under-test lifecycle**: free port, healthcheck wait, pidfile, clean teardown; infra errors ≠ product findings
- **run.json lane manifest**: skipped / not-applicable lanes declared with reasons → dashboard chips
- **findings.json (derived)**: unified evidence-first findings (measured / reasoned / manual × audit / process / browser / crawler / human); canonical schemas untouched
- **Dashboard**: Findings tab, dynamic default tab (first tab with data), declared skip reasons in empty states
- **Static mode completed**: measured HTTP link/asset crawler; discovery writes the app: block
- **Robustness**: tolerant JSON, normalized browser_errors[] (additive), screenshot byte validation
- **Hygiene**: shipguard init seeds .gitignore guard-rails
- Skills updated: sg-visual-run (lifecycle handoff, byte check, browser_errors), sg-ship (run.json, app lifecycle), sg-visual-review(+stop), static discovery

## Held boundary
LLM assertions (llm-check/llm-wait), audit, and process lanes stay agent-driven — the CLI reports them as needs-agent, never fakes them. Model-independence applies to the deterministic layer only.

## Tests
3 new smoke tests (cli, appserver, crawl) + extended review-smoke-test; full suite green; e2e static recette verified with agent-browser.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Self-review the PR diff** (`gh pr diff`) for leftovers: no stray `console.log` debugging, no absolute local paths, no credentials, manifests consistent.

---

## Self-Review (done at plan time)

- **Spec coverage:** item 1 CLI → Tasks 2-7; item 2 config → 3, 12; item 3 scope → 3 (profiles) + 7 (`--scope`); item 4 lifecycle → 4, 10, 11; item 5 one-pass artifacts + declared N/A → 6, 7, 11; item 6 evidence findings → 8; item 7 static mode → 5, 11; item 8 browser robustness → 6, 10; item 9 hygiene → 3; item 10 dashboard → 9; item 11 exit codes → 2-7, 12 (docs). ✔
- **Known risks called out:** builder's mini-YAML parser vs `profiles:` blocks (pinned by the Task 8 config-v2 safety test); template IIFE data scoping (explicit `window.__SG_DATA__` step); PATH manipulation in the Task 7 no-agent-browser test (adjust per machine).
- **Type consistency:** `run.json` lane statuses identical in Tasks 6/7/9/11; `findings.json` field names identical in Tasks 8/9/12; exit codes identical everywhere. ✔
