# ShipGuard -- Architecture

## Philosophy

Code audit narrows the field. Visual audit confirms reality. Human review decides what matters. ShipGuard combines static code analysis with visual browser verification in a single workflow -- parallel AI agents find bugs in source code, then automated browser tests verify whether those bugs are visible to the user. The human reviewer sees both layers in one dashboard and decides which fixes ship.

## Skills Overview

ShipGuard is composed of 12 skills that form a pipeline from analysis to verification to repair, with self-improvement, macro recording, and durable change reports. `sg-ship` orchestrates the three discovery lanes end to end.

| Skill | Purpose | Input | Output |
|-------|---------|-------|--------|
| `sg-ship` | One-command orchestrator -- runs code audit -> process check -> visual -> review on the diff. Thin sequencer over the lanes; no new analysis | Repo + git diff | Unified review across all three signals |
| `sg-code-audit` | Parallel AI codebase audit -- dispatches agents to find and fix bugs | Repo source code | `audit-results.json` (structured bug list) |
| `sg-process-check` | Diff-driven behavior simulation at the PROCESS level -- traces changed units before/after (reasoning by default, optional real execution), observe-not-fix | Git diff (+ optional running code) | `process-results.json` + `process-report.md` |
| `sg-visual-discover` | Scan codebase for routes, navigation, forms -- generate YAML test manifests | Repo source code | `visual-tests/**/*.yaml` manifest tree |
| `sg-visual-run` | Execute test manifests via agent-browser with hybrid assertions | YAML manifests | Screenshots + `visual-results.json` (canonical) + `report.md` (human summary) + updated `_regressions.yaml` |
| `sg-visual-review` | Build interactive HTML dashboard from test results + audit results | Manifests + screenshots + audit JSON | `review.html` (self-contained) + `fix-manifest.json` |
| `sg-visual-fix` | Process human annotations -- trace to source, fix, capture before/after | `fix-manifest.json` | Code fixes + before/after screenshots |
| `sg-change-report` | Save before/after UI evidence as durable, committable change reports (PR / client / persona views) | Visual run results + screenshots | `change-reports/<report-id>/` (+ `persona-reports/` HTML via `sg-visual-review`) |
| `sg-visual-review-stop` | Stop the review HTTP server | PID file | Server terminated |
| `sg-record` | Record browser interactions as replayable YAML test manifests | User browser session | `visual-tests/manifests/recorded-*.yaml` |
| `sg-improve` | Analyze audit false positives/negatives, refine checklists and prompts | `audit-results.json` + user feedback | Updated `learnings.yaml` + checklist patches |
| `sg-scout` | Research emerging bug patterns and techniques from external sources | Research query | `techniques-library.md` updates |

## Data Flow

```
sg-code-audit --> audit-results.json --> sg-visual-run --from-audit
                                     --> sg-visual-review (Code Audit tab)

sg-visual-discover --> visual-tests/**/*.yaml (manifest tree)
                                              |
                                              v
sg-visual-run --> screenshots/ + visual-results.json + report.md --> sg-visual-review (Visual Tests tab)

sg-visual-review --> human annotations --> fix-manifest.json --> sg-visual-fix
                                       --> sg-change-report --> change-reports/<id>/ --> persona-reports/<id>/ (HTML)

sg-visual-fix --> before/after screenshots --> sg-visual-review (updated comparison)
                                          --> sg-change-report (durable before/after evidence)

sg-code-audit --> POST /api/monitor/* --> monitor-data.json --> Monitor view inside the Code Audit tab (polling)

git diff --> sg-process-check --> process-results.json + process-report.md --> sg-visual-review (Process tab)
                                                       |
sg-code-audit --> impacted_backend[] --> sg-process-check --from-audit
sg-process-check --> impacted_ui_routes[] --> sg-visual-run --from-process (visual confirm)
```

All result files live in `visual-tests/_results/` (created if missing): `audit-results.json`, `process-results.json`, `visual-results.json`, `report.md`, `fix-manifest.json`, `change-reports/`, `persona-reports/`. `visual-results.json` is the canonical machine-readable run output; `report.md` is its human-readable summary. Legacy `.code-audit-results/` and `.process-check-results/` directories are still read as fallbacks (read-only compat) but are no longer written.

The entry points (`sg-code-audit`, `sg-visual-discover`, and `sg-process-check`) can run independently. `sg-visual-run --from-audit` bridges static→visual by reading `audit-results.json` impacted routes. `sg-process-check` adds the static→dynamic bridge: it reads `audit-results.json`'s `impacted_backend[]` (`--from-audit`) to dynamically exercise flagged endpoints, and emits `impacted_ui_routes[]` so the visual lane can confirm the user-facing effect of a behavior change. `sg-visual-review` merges all data sources into a single dashboard. `sg-ship` is the optional one-command orchestrator that runs all three lanes in order over a single resolved scope and opens that dashboard — it only sequences the lanes via these bridges; it adds no analysis of its own.

---

## sg-ship Architecture

The orchestrator. It runs ShipGuard's three discovery lanes in order and opens one review — a **thin sequencer**, not a new analyzer.

- **Resolves scope once.** The diff (working tree, `--diff`, or `--all`) is resolved a single time and threaded into every lane so they all look at the same change.
- **Sequences via existing bridges.** `sg-code-audit` → `sg-process-check --from-audit` → `sg-visual-run --from-audit --from-process` → `sg-visual-review`. The handoff is the result files each lane already writes (`audit-results.json`, `process-results.json`); `sg-ship` adds no schema or logic.
- **Order matters.** Audit runs first because it produces `impacted_backend[]` / `impacted_ui_routes[]`, which the process and visual lanes consume.
- **Degrades gracefully.** Lanes with nothing to do are skipped and logged (no backend → process-check reasons on functions only; no UI / no agent-browser / `--no-visual` → visual skipped). A failing lane doesn't abort the others.
- **Decides nothing.** It consolidates a cross-lane summary and hands the human the dashboard; fixing stays with `sg-visual-fix` / `sg-code-audit`. Flags (`quick|standard|deep|paranoid`, `--all`, `--diff=ref`, `--focus=path`, `--no-visual`, `--report-only|--fix`, `--mode=reason|hybrid|execute`) are passed through to the relevant lane. The audit lane defaults to report-only; `--fix` opts into fix mode. The resolved `--diff` is passed explicitly to every lane, and the visual lane is invoked with `--from-audit --from-process`, which union their impacted routes.

---

## sg-code-audit Architecture

Parallel AI codebase audit. Dispatches isolated agents to non-overlapping file zones, each agent reviews its zone, finds bugs, optionally fixes them, and writes structured JSON.

### Modes

| Mode | Agents | Rounds | Description |
|------|--------|--------|-------------|
| `quick` | 5 | 1 | Surface scan -- known patterns, lint-like |
| `standard` | 10 | 1 | Standard audit -- known patterns with broader coverage |
| `deep` | 15 | 2 | Surface + runtime behavior analysis |
| `paranoid` | 20 | 3 | Surface + behavior + edge cases and security |

Flags: `--focus=path/` restricts scope. `--report-only` disables fixing.

### Zone Discovery Algorithm

Zones split the codebase into non-overlapping file sets, one per agent.

1. **Find** -- Collect all source files (`.py`, `.ts`, `.tsx`, `.go`, `.rs`, `.java`, `.kt`), excluding `node_modules`, `.git`, `venv`, `__pycache__`, `.next`, `dist`.
2. **Sort + count** -- `sort | uniq -c | sort -rn` to get file count per directory. Uses `sort` (not `sort -u`) before `uniq -c` so counts reflect actual file counts.
3. **Split** -- Directories with <=30 files become 1 zone. 31-80 files split by immediate subdirectories. 80+ files split by sub-subdirectories (depth 3). Infra files (`Dockerfile*`, `docker-compose*`, `*.yml`, `*.yaml`) always get a dedicated zone.
4. **Merge** -- Zones with <5 files merge into the nearest sibling (longest common path prefix).
5. **Cap** -- If zone count exceeds agent count, merge the two smallest zones repeatedly. If zone count is below agent count, split the largest zone into two halves.

### Multi-Round Strategy

| Round | Focus | Description |
|-------|-------|-------------|
| R1 -- Surface | Known patterns, lint-like | Silent exceptions, missing guards, dead code, type mismatches, missing cleanup |
| R2 -- Depth | Runtime behavior | Race conditions, cross-service integration, auth gaps, resource leaks, SSR issues |
| R3 -- Edge Cases | What R1+R2 missed | Logic errors, prompt injection, data corruption, null propagation, off-by-one, performance |

Rounds execute sequentially. Each round after R1 receives context about what previous rounds found, with instructions to not re-report fixed bugs and to check for regressions introduced by prior fixes.

### Agent Dispatch

Each zone gets one agent dispatched with:
- **Isolation:** Git worktree (non-overlapping file scope enforced by zone boundaries)
- **Execution:** Background (`run_in_background: true`)
- **Model:** opus dispatch / sonnet verification (`--model=auto`, the default); `--model=sonnet|opus` overrides the dispatch model, haiku is refused
- **Prompt:** Zone scope + CLAUDE.md context (truncated to 3000 chars) + round-specific checklist + language-specific checklist + severity definitions + category taxonomy + output format

If an agent hits a context overflow ("Prompt is too long"), the zone is automatically re-split into two halves and two new agents are dispatched.

### Merge Strategy

After all agents in a round complete:

1. **Clean tree check** -- `git status --porcelain`. If uncommitted changes exist, abort the merge phase entirely and warn the user.
2. **Merge each worktree branch** -- `git merge {branch} --no-edit`. On success, continue. On conflict, `git merge --abort`, log the conflicting files, skip this zone, preserve the branch for manual resolution.
3. **No auto-resolution** -- Conflicts mean two zones touched the same file, which indicates a zone boundary error. Never use `--theirs` or any auto-resolution.
4. **Cleanup** -- Remove worktree directories and delete merged branches. Conflicting branches are preserved.

### Severity Definitions

| Severity | When to use |
|----------|-------------|
| `critical` | Security bypass, data loss, crash on common path |
| `high` | Wrong behavior, race condition, resource leak on common path |
| `medium` | Edge case crash, missing validation, incorrect error handling |
| `low` | Dead code, style, minor performance, missing accessibility |

### Category Taxonomy

16 categories, exactly one per bug: `security`, `race-condition`, `silent-exception`, `api-guard`, `resource-leak`, `type-mismatch`, `dead-code`, `infra`, `ssr-hydration`, `input-validation`, `error-handling`, `performance`, `accessibility`, `logic-error`, `integration`, `other`.

### JSON Schemas

#### Per-zone output (written by each agent)

```json
{
  "zone": "src/routes/",
  "round": 1,
  "files_audited": 23,
  "duration_ms": 245000,
  "bugs": [
    {
      "id": "r1-z03-001",
      "severity": "critical",
      "category": "security",
      "subcategory": "auth-bypass",
      "file": "src/routes/documents.py",
      "line": 119,
      "title": "Missing ownership check",
      "description": "Any authenticated user can access any document by guessing the document ID. The route handler checks authentication but not authorization -- no ownership verification.",
      "fix_applied": true,
      "fix_commit": "abc1234"
    }
  ]
}
```

Bug IDs encode round and zone: `r{round}-{zone_id}-{sequence}`. This avoids collisions across rounds.

#### Aggregated output (audit-results.json)

```json
{
  "repo": "my-project",
  "timestamp": "2026-04-10T08:30:00Z",
  "mode": "standard",
  "rounds": 1,
  "agents": 10,
  "summary": {
    "total_bugs": 47,
    "by_severity": {
      "critical": 3,
      "high": 12,
      "medium": 22,
      "low": 10
    },
    "by_category": {
      "security": 5,
      "race-condition": 8,
      "silent-exception": 12,
      "api-guard": 6,
      "resource-leak": 0,
      "type-mismatch": 0,
      "dead-code": 0,
      "infra": 4,
      "ssr-hydration": 0,
      "input-validation": 0,
      "error-handling": 0,
      "performance": 0,
      "accessibility": 0,
      "logic-error": 0,
      "integration": 0,
      "other": 12
    },
    "files_audited": 187,
    "files_modified": 34,
    "duration_ms": 612000
  },
  "impacted_ui_routes": [
    {
      "route": "/dashboard",
      "reason": "Zustand store bug in dashboard-store.ts",
      "severity": "high"
    }
  ],
  "impacted_backend": [
    {
      "endpoint": "POST /dossier/{id}/analyze",
      "reason": "Missing ownership check in dossier_routes.py",
      "severity": "critical"
    }
  ],
  "bugs": []
}
```

The `impacted_routes` array is derived by mapping each bug's file path to UI routes using framework-specific detection (Next.js App Router directory structure, Pages Router file paths, React Router config, or generic directory-name fallback).

---

## sg-process-check Architecture

The backend twin of `sg-visual-run`. Where the visual lane drives the browser to confirm a change in the UI, `sg-process-check` **simulates the running process** to show how a change affects its **behavior** — no browser. It occupies the missing quadrant of ShipGuard's design space:

| | Reads (static) | Runs / simulates (dynamic) |
|---|---|---|
| **Code level** | `sg-code-audit` | **`sg-process-check`** |
| **UI level** | `sg-visual-discover` | `sg-visual-run` |

### Principles

- **Diff-scoped.** The unit of work is the diff of the module being worked on (working tree, `--diff=<ref>`, or `--from-audit`), never the whole repo. Breadth is `sg-code-audit`'s job.
- **Reasoning by default — runs the code "in its head".** The default `reason` mode needs no running stack: it reads the diff and the touched code paths and **traces representative inputs through old vs new code by reasoning**, predicting the behavioral delta. This is why it works on a 5-container app — the floor mode requires zero infra. Real execution is an opt-in escalation (`hybrid`/`execute`), not a prerequisite.
- **Reasoned ≠ measured (honesty rule).** A simulated trace is a prediction, not a measurement. Every observation carries an `evidence` tag (`reasoned` with confidence + assumptions, or `measured`). When a measured result contradicts the reasoned one, the measurement wins and the unit is flagged `surprise`. Predictions never masquerade as observations.
- **Before/after oracle.** The previous version of the code is the reference (reasoned from the diff, or — in `execute` mode — a git worktree pinned at the base commit with `reset --hard`). The question is "did observable behavior change, and was that intended?" — not absolute correctness. This is the behavior-level twin of `sg-visual-fix`'s before/after screenshots.
- **Observe, never fix.** Simulates/runs and reports; zero source edits. Remediation stays with `sg-code-audit` / `sg-visual-fix`.

### Modes (fidelity spectrum)

| Mode | What | Infra |
|------|------|-------|
| `reason` *(default)* | Trace inputs through old vs new code by reasoning; predict the delta. All `reasoned`. | none |
| `hybrid` | Reason about the whole, really execute the **cheap** parts (importable function, already-running endpoint) to anchor. Mixed. | minimal |
| `execute` | Literal before/after via a pinned baseline worktree. All `measured`. | full (opt-in) |

`hybrid`/`execute` **auto-degrade to `reason`** per unit that can't be run cheaply — they never boot a multi-container stack unless explicitly asked and feasible.

### Pipeline

1. **Scope** — resolve the diff; record `base_ref` / `head_ref`.
2. **Map** — changed files → executable units (`endpoint`, `function`, `pipeline-stage`); rename/comment-only changes are skipped and logged.
3. **Model & inputs** — read the touched code paths; pick a small seeded input sample per unit (default 3) from repo fixtures, OpenAPI examples, or type hints. Modest sampling, not exhaustive fuzzing.
4. **Simulate before vs after** (`reason`) — trace each input through old + new code; predict outcome / output / effects / cost; tag `reasoned` with confidence + assumptions.
5. **Anchor** (`hybrid`/`execute`) — really run the cheap units (function harness, live endpoint, pinned baseline worktree); replace with `measured` records; reconcile, flagging contradictions as `surprise`; clean up.
6. **Diff & classify** — per action: `identical` / `output-changed` / `now-errors` / `now-recovers` / `cost-changed` / `latency-changed`; per unit verdict `unchanged` / `behavior-changed` / `new-error`. No intent verdict — the human judges.
7. **Report** — `process-results.json` (mirrors `audit-results.json`) + `process-report.md` (reasoned vs measured separated); clean up any worktree.

### Seams (how a unit is run when anchoring)

- **API**: drive endpoints from `/openapi.json` against an already-running service (or a single-container `build_command`); `execute` boots a pinned baseline on an alternate port.
- **Function** (in-process): ephemeral harness imports the module and calls the unit directly. No network, fastest, easiest to anchor.
- **Pipeline-stage**: call the stage entrypoint (RAPTOR indexer, ColBERT searcher, Celery task) with a fixture.

### Output (`process-results.json`)

- `mode` + `summary` — units checked, behavior changes, new errors, surprises, `evidence_mix` (reasoned vs measured), verdict breakdown
- `units[]` — kind, ref, file, verdict, and per-action before/after observation records (seed, input, `evidence`, `confidence`, `assumptions`, outcome, output, effects, delta, `surprise`)
- `impacted_backend[]` — endpoints/services touched (consumed by `--from-audit` correlation)
- `impacted_ui_routes[]` — routes whose UX a behavior change may affect (handed to `sg-visual-run --from-process`)
- `skipped[]` / `uncovered[]` — populated honestly; a prediction is not coverage, so what was not (or could not be) traced is stated explicitly

---

## sg-visual-run Architecture

Executes YAML test manifests using agent-browser (Playwright CLI). Mechanical steps run directly; complex assertions delegate to LLM evaluation.

### YAML Manifest Format

```yaml
name: "Upload PDF and full pipeline"
description: "Upload a notarial deed, verify 5 pipeline phases"
priority: high
requires_auth: true
timeout: 120s
tags: [pipeline, ingestion]

data:
  pdf_file: "data-sample/acte.pdf"
  expected_entities: [vendeur, acquereur, notaire, prix, bien]

steps:
  - action: open
    url: "{base_url}/notaire-chat"

  - action: click
    target: "Nouvelle conversation"

  - action: upload
    target: "file-input"
    file: "{data.pdf_file}"

  - action: llm-wait
    description: "Wait for pipeline completion"
    timeout: 90s
    checkpoints:
      - "OCR in progress or complete"
      - "Entities detected (count > 0)"
    screenshot: pipeline-complete.png

  - action: llm-check
    description: "Verify sale deed entities"
    criteria: "Entities include: {data.expected_entities}"
    severity: critical
    screenshot: entities-check.png
```

Variables: `{base_url}` and `{credentials.*}` from `_config.yaml`, `{data.*}` from the manifest's `data:` section.

### Action Types

| Action | Type | Description |
|--------|------|-------------|
| `open` | Mechanical | Navigate to URL via `agent-browser open` |
| `click` | Mechanical | Snapshot accessibility tree, find target by visible text, click ref |
| `fill` | Mechanical | Find input by placeholder/label, fill value |
| `press` | Mechanical | Send key press |
| `upload` | Mechanical | Upload file to input |
| `select` | Mechanical | Select option from dropdown |
| `wait` | Mechanical | Sleep for duration |
| `assert_url` | Mechanical | Compare current URL |
| `assert_text` | Mechanical | Search snapshot for text |
| `screenshot` | Mechanical | Capture screenshot |
| `include` | Mechanical | Inline steps from another manifest (max depth 3) |
| `llm-wait` | Hybrid | Poll every 3s, LLM checks conditions against snapshot until met or timeout |
| `llm-check` | LLM | Single-shot LLM evaluation of screenshot + snapshot against criteria |

### Execution Strategy

All tests run **sequentially in a single browser session**. One login, one browser, one agent.

agent-browser uses a single Playwright daemon. Multiple agents controlling the browser simultaneously causes "Target page, context or browser has been closed" errors. This is a daemon architecture constraint, not a configuration issue. Sequential execution with a single auth session is also faster in practice: no re-login overhead, no session conflicts, no retries.

Each test starts from `base_url` (no state from previous tests). Auth is executed once and reused -- the session is verified by checking for login form absence + authenticated UI presence + no redirect away from protected URL. If auth fails mid-run, re-login and retry once.

### Hybrid Assertions

**Scripted steps** resolve targets by searching the accessibility tree for matching visible text, labels, or placeholders. Selectors never reference CSS classes or DOM structure -- when a button's class changes, the test still works because it targets visible text.

**LLM evaluation** (`llm-check`, `llm-wait`) takes a screenshot and asks the LLM to evaluate it against natural language criteria. Every screenshot taken during a run is read and visually validated -- a screenshot showing an error is never marked PASS.

### Natural Language Mode

When invoked with free text (e.g., `/sg-visual-run I changed the sidebar`):

1. **Intent analysis** -- Parse the text to identify pages, features, components, or file references. Check `git diff` if the user says "I changed" or "I just modified".
2. **Manifest matching** -- Read all manifest YAML files (name, description, tags, URL) and match against the intent.
3. **Test generation** -- If the described scope has no existing test, invoke `sg-visual-discover` with narrow scope to generate a manifest, tag it `auto_generated: true`, execute it. Auto-generated manifests are removed after 3 consecutive passes.
4. **Execute** -- Run matched + generated tests, regressions first.

### From-Audit Mode

When invoked with `--from-audit`:

1. Read `audit-results.json` from the results directory
2. Extract `impacted_routes` array
3. Match routes to YAML manifests by URL path
4. Run matched manifests ordered by severity (critical first)
5. Report which audit findings were visually confirmed vs not reproduced

### Regression System

`_regressions.yaml` is auto-maintained:
- A test that **fails** is added (or updated with `consecutive_passes: 0`)
- A test that **passes** increments `consecutive_passes`
- After **3 consecutive passes**, the entry is removed (regression resolved)
- Regressions always run **first**, ordered by `last_failed` descending

### Browser Crash Recovery

1. Detect: any `agent-browser` command returning non-zero or timeout
2. Attempt recovery: `agent-browser close`, then `agent-browser open {base_url}`
3. Re-login if needed, retry failed step once
4. If retry fails: mark test `ERROR`, move to next test
5. If 3 consecutive `ERROR` across different tests: abort entire run ("browser unstable")

---

## sg-visual-review Architecture

Generates a self-contained HTML dashboard from test results, audit data, and screenshots. Provides annotation tools for human review.

### Build Pipeline

`build-review.mjs` is a zero-dependency Node.js script. It reads local files at build time and produces a static HTML artifact.

**Inputs:**
1. All YAML test manifests from `visual-tests/` (walks category directories, skips `_`-prefixed and `deprecated` manifests)
2. `visual-tests/_results/visual-results.json` -- canonical machine-readable run output (PASS/FAIL per test); `report.md` is parsed as the human-readable summary fallback
3. `visual-tests/_regressions.yaml` -- failure reasons and regression tracking
4. `visual-tests/_results/screenshots/` -- matched to tests by slug or manifest `screenshot` field
5. `visual-tests/_results/audit-results.json` -- code audit data (optional, enables Code Audit tab)
6. `visual-tests/_results/process-results.json` -- process-check data (optional, enables Process tab)
7. `visual-tests/_results/monitor-data.json` -- monitor state (optional, enables the Monitor view inside the Code Audit tab at runtime — fetched dynamically, not injected at build time)

**Processing:**
1. Parse config (`_config.yaml`)
2. Parse report status map (matches test slugs to PASS/FAIL/STALE)
3. Parse regressions (maps test IDs to failure reasons)
4. Walk test directories, build entries with metadata, screenshot paths, status
5. Merge status from report into test entries
6. Load audit results JSON if present
7. Assemble data object with summary stats, category list, tests array, audit data

**Output:**
1. Read `_review-template.html` (static HTML with inline CSS + JS)
2. Replace the `"__PLACEHOLDER_VISUAL_DATA__"` string with `JSON.stringify(data)`
3. Write `visual-tests/_results/review.html`
4. Generate thumbnails (macOS `sips -Z 400`, Linux `convert -resize 400x>`, fallback `cp`)

### Tab System

- **Visual Tests** (default) -- Grid of test cards with screenshots, status badges, filters
- **Code Audit** -- Conditional on `data.audit` being non-null. Shows bug list from `audit-results.json` with severity and category breakdowns. The live Monitor renders inside this tab: a Gantt timeline of audit agent progress with per-agent duration, token usage, estimated cost, and bugs found. It appears when `monitor-data.json` exists or an audit is in progress, and polls every 3s.
- **Process** -- Conditional on `process-results.json`. Shows the before/after behavior table from `sg-process-check` (verdicts, reasoned vs measured evidence, surprises)
- **Recorded Tests** -- Test library of manifests captured with `sg-record`; select tests and get the ready-to-copy run command

### Annotation System

In the lightbox view:
- **Canvas drawing** -- Red rectangles drawn on screenshot to mark problem areas
- **Pen tool** -- Click pen icon to activate drawing mode
- **Annotations stored per test** -- Coordinates as percentage-based (x1/y1/x2/y2)
- **fix-manifest.json generation** -- "Validate & Generate Report" exports a JSON file with test IDs and their annotations:

```json
{
  "action": "validate-and-fix",
  "tests": [
    {
      "test": "auth/login",
      "url": "http://localhost:3000/login",
      "screenshot": "screenshots/login-load.png",
      "annotations": [
        { "x1": 0.2, "y1": 0.3, "x2": 0.8, "y2": 0.6 }
      ],
      "steps": []
    }
  ]
}
```

This manifest is consumed by `sg-visual-fix`.

### Server

`build-review.mjs --serve` starts a Node.js HTTP server (default port 8888):
- Serves `review.html` and static assets from `_results/`
- `POST /save-manifest` endpoint saves `fix-manifest.json` (5 MB limit)
- Path traversal protection: resolves paths relative to `_results/`, rejects `..` or absolute paths
- PID file at `_results/.server.pid` for clean shutdown via `--stop`
- `--port=N` overrides default port

---

## sg-visual-discover Architecture

Scans the codebase to detect all user-facing routes and interactions, then generates a YAML test manifest tree mirroring the UI navigation structure.

### Route Detection Strategy

Framework detection in priority order:

| Indicator | Framework |
|-----------|-----------|
| `next.config.*` or `app/layout.tsx` | Next.js (App Router) |
| `pages/_app.tsx` or `pages/index.tsx` | Next.js (Pages Router) |
| `src/App.tsx` + `react-router` in package.json | React Router |
| `src/router/index.ts` or `vue.config.*` | Vue |
| `angular.json` | Angular |
| `*.html` files in root/src/public | Static HTML fallback |
| Grep for `<Route`, `path:`, `router.get` | Generic fallback |

Route collection per framework: Next.js App Router reads `app/**/page.tsx` directory structure. Pages Router reads `pages/**/*.tsx` file paths. React Router greps for `<Route path=...>`. Vue reads `router/index.ts`. Angular reads routing modules.

### Additional Detection

- **Navigation structure** -- Files named `navigation.ts`, `sidebar-*.tsx`, `dashboard-data.ts` that define UI hierarchy. This sets the test directory structure.
- **Feature flags** -- `NEXT_PUBLIC_FEATURE_*`, `FEATURE_*`, `isFeatureEnabled()`. Disabled features get `priority: low`.
- **Interactive components** -- Forms, modals, file uploads, chat interfaces, data tables. These become test steps.
- **Test data** -- Fixtures in `test/fixtures/`, `data-sample/`, `__fixtures__/`. Pre-filled into manifest `data:` sections.
- **Credentials** -- From `CLAUDE.md`, `README.md`, `.env.example`.

### Manifest Generation

The output tree mirrors the navigation hierarchy:

```
visual-tests/
  _config.yaml
  _regressions.yaml
  _shared/
    login.yaml
  <nav-group>/
    <page>.yaml
    <sub-group>/
      <page>.yaml
```

Rules:
- **Never overwrite** existing manifests -- only create new skeletons
- **Never delete** manifests -- mark `deprecated: true` if route removed
- **Pre-fill test data** when fixtures found in the project
- Skeleton manifests include `open` + `llm-check` ("page loads correctly"). Enhanced manifests add steps for detected interactive components (forms, uploads, chat).

---

## sg-visual-fix Architecture

Processes human annotations from `sg-visual-review` to fix the underlying code issues.

### Flow

1. **Load** `fix-manifest.json` -- contains test IDs, screenshot paths, and annotation coordinates
2. **Read** the "before" screenshot, focus on annotated regions (x1/y1 to x2/y2 as percentages)
3. **Trace** the visual issue to source code: URL to page component, component to rendered region, region to root cause
4. **Fix** the code (minimal change)
5. **Rebuild** using `build_command` from `_config.yaml` (or ask user if not set)
6. **Capture** "after" screenshot by re-running the test steps
7. **Compare** -- before/after screenshots are detected by `build-review.mjs` when pairs exist (`{slug}-before.png` and `{slug}-after.png`)
8. **Regenerate** review page with comparison data

---

## sg-visual-review-stop

Stops the review HTTP server by reading the PID file (`_results/.server.pid`) and sending a kill signal.

```bash
node visual-tests/build-review.mjs --stop
```
