# ShipGuard -- Architecture

## Philosophy

Code audit narrows the field. Visual audit confirms reality. Human review decides what matters. ShipGuard combines static code analysis with visual browser verification in a single workflow -- parallel AI agents find bugs in source code, then automated browser tests verify whether those bugs are visible to the user. The human reviewer sees both layers in one dashboard and decides which fixes ship.

## Skills Overview

ShipGuard is composed of 9 skills that form a pipeline from analysis to verification to repair, with self-improvement and macro recording.

| Skill | Purpose | Input | Output |
|-------|---------|-------|--------|
| `sg-code-audit` | Parallel AI codebase audit -- dispatches agents to find and fix bugs | Repo source code | `audit-results.json` (structured bug list) |
| `sg-visual-discover` | Scan codebase for routes, navigation, forms -- generate YAML test manifests | Repo source code | `visual-tests/**/*.yaml` manifest tree |
| `sg-visual-run` | Execute test manifests via agent-browser with hybrid assertions | YAML manifests | Screenshots + `report.md` + updated `_regressions.yaml` |
| `sg-visual-review` | Build interactive HTML dashboard from test results + audit results | Manifests + screenshots + audit JSON | `review.html` (self-contained) + `fix-manifest.json` |
| `sg-visual-fix` | Process human annotations -- trace to source, fix, capture before/after | `fix-manifest.json` | Code fixes + before/after screenshots |
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
sg-visual-run --> screenshots/ + report.md --> sg-visual-review (Visual Tests tab)

sg-visual-review --> fix-manifest.json --> sg-visual-fix

sg-visual-fix --> before/after screenshots --> sg-visual-review (updated comparison)

sg-code-audit --> POST /api/monitor/* --> monitor-data.json --> Monitor tab (polling)
```

The two entry points (`sg-code-audit` and `sg-visual-discover`) can run independently. `sg-visual-run --from-audit` bridges them by reading `audit-results.json` impacted routes and running matching visual tests. `sg-visual-review` merges both data sources into a single dashboard.

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
- **Model:** Sonnet (fast, cost-effective for audit work)
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
2. `visual-tests/_results/report.md` -- parses PASS/FAIL status per test
3. `visual-tests/_regressions.yaml` -- failure reasons and regression tracking
4. `visual-tests/_results/screenshots/` -- matched to tests by slug or manifest `screenshot` field
5. `visual-tests/_results/audit-results.json` -- code audit data (optional, enables Code Audit tab)
6. `visual-tests/_results/monitor-data.json` -- monitor state (optional, enables Monitor tab at runtime — fetched dynamically, not injected at build time)

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
- **Code Audit** -- Conditional on `data.audit` being non-null. Shows bug list from `audit-results.json` with severity and category breakdowns
- **Monitor** -- Live Gantt timeline of audit agent progress. Shows per-agent duration, token usage, estimated cost, and bugs found. Appears when `monitor-data.json` exists or an audit is in progress. Polls every 3s.

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
