---
name: sg-visual-review
description: Use after visual runs, code audits, or process checks when results need human review — builds and serves the interactive ShipGuard dashboard.
context: conversation
argument-hint: "[--port=N]"
---

# /sg-visual-review — Interactive Screenshot Review

Generate and serve the ShipGuard dashboard to review visual test screenshots, code audit findings, and process-check results, annotate problems, and export re-run / fix manifests.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-visual-review` | Build + start server + tell user to open the printed URL (default http://127.0.0.1:8888) |
| `/sg-visual-review --port=9000` | Same, on a custom port |

**Always:** build the review page, start the HTTP server, and give the user the URL the server actually prints. Supported flags: `--port=N` (default 8888) and `--host=H` (default 127.0.0.1). To stop the server: `/sg-visual-review-stop`.

## Prerequisites

- `/sg-visual-discover` has been run (manifests exist in `visual-tests/`)
- `/sg-visual-run` has been run at least once (screenshots + `visual-results.json` or legacy `report.md` exist in `visual-tests/_results/`)
- No external npm dependencies — the build script uses a built-in YAML parser

Sandbox note: `--serve`, `POST /save-manifest`, and monitor smoke tests need loopback port access. See [../../docs/sandbox.md](../../docs/sandbox.md).

## What It Does

### Step 1: Build the Review Page

Run the build script:

```bash
node visual-tests/build-review.mjs --serve
```

This script:
1. Reads all YAML test manifests from `visual-tests/`
2. Reads `visual-tests/_results/visual-results.json` for machine-readable status per test
3. Falls back to legacy `visual-tests/_results/report.md` if the JSON contract is missing or invalid
4. Reads `visual-tests/_regressions.yaml` for failure reasons
5. Matches screenshots from `visual-tests/_results/screenshots/`
6. Rewrites canonical `visual-tests/_results/visual-results.json` from the resolved statuses, preserving the producer's run `timestamp` and per-test `duration_ms` (build time is recorded separately as `generated_at`)
7. Reads `visual-tests/_results/process-results.json` (written by `/sg-process-check`) into the Process tab, if present
8. Generates a self-contained `visual-tests/_results/review.html` (inline CSS + JS, no dependencies)
9. While `/sg-code-audit` is running (or `audit-monitor.json` exists in `_results/`), live agent progress renders **inside the Code Audit tab** — a progress bar in Overview and per-agent pods in the Agents sub-tab. There is no separate Monitor tab.
10. If change-report specs exist, generates persona-aware HTML reports under `visual-tests/_results/persona-reports/`

`--serve` binds to `127.0.0.1` by default and refuses path traversal after decoding and resolving paths. Cross-origin POSTs to the server are rejected. LAN exposure requires an explicit host:

```bash
node visual-tests/build-review.mjs --serve --host=0.0.0.0
```

### Change Reports & Client Validation

The change-report schema and workflow are owned by `sg-change-report` — see that skill for the `report.json` format and when to create one. This builder consumes:

```text
visual-tests/_results/change-reports/<report-id>/report.json
visual-tests/_results/change-reports/<report-id>/screenshots/
```

and generates audience-specific decision pages (client, business, product, design, engineering, or custom) plus validation artifacts under:

```text
visual-tests/_results/persona-reports/<report-id>/index.html
visual-tests/_results/persona-reports/<report-id>/<audience>.html
visual-tests/_results/persona-reports/<report-id>/client-invite-email.md
visual-tests/_results/persona-reports/<report-id>/client-response-email.md
visual-tests/_results/persona-reports/<report-id>/proposal-trace.md|.json
```

Each audience page includes before/after evidence, `Accept / Adjust / Reject` decisions, local comments, and JSON export; the email + trace files support manual validation without an email provider. Full example spec: `skills/sg-visual-review/examples/change-report.json`.

Commit the change-report source and the generated persona report with the UI change. Do not commit `visual-tests/_results/review.html` or `visual-tests/_results/.server.pid`; those are local generated files.

### Step 2: Open in Browser

Open the URL printed by `--serve` (default `http://127.0.0.1:8888`):

```bash
open http://127.0.0.1:8888
# Or via agent-browser:
agent-browser open http://127.0.0.1:8888
```

The Code Audit tab, the live audit monitor, and the "Validate & Generate Report" button require the HTTP server. Opening `review.html` via `file://` only shows the data embedded at build time (Visual Tests, Process, Recorded Tests) and cannot save fix manifests.

### Step 3: Human Review

The review page provides:

**Visual Tests tab**
- All tests displayed as cards with screenshot thumbnails
- Color-coded badges: PASS (green), FAIL/ERROR (red), STALE (yellow), SKIPPED (muted)
- Priority badges (critical, high, medium, low)
- Sidebar with category filters
- Status filter bar (ALL / PASS / FAIL / ERROR / STALE / SKIPPED, only when present)
- Search by test name

**Code Audit tab**
- Shows bug cards from `audit-results.json` if present in `_results/`
- Shows a completed zero-bug audit as `0 bugs found`, not as missing data
- Sub-tabs: Overview, Bugs, Routes, Agents
- Bug filters: severity buttons (All / Critical / High / Medium / Low, with counts), a route chip (click a row in the Routes sub-tab to filter bugs by route; click the chip to clear it), and free-text search over title, file, id, and category
- Live monitor: while an audit runs, the Overview shows a progress bar (agents done, bugs found so far) and the Agents sub-tab shows per-agent pods (status, bugs found, duration), fed by `audit-monitor.json` and the `/api/monitor/*` endpoints

**Process tab**
- Renders `visual-tests/_results/process-results.json` written by `/sg-process-check` (embedded at build time — rebuild after a new process check)
- Summary chips (checks, behavior changes, new errors, surprises, reasoned vs measured evidence mix)
- Checks table: check name, before → after, verdict badge, reasoned/measured evidence tag, severity
- Impacted UI routes and impacted backend tables when present
- Friendly empty state when no process check has been run

**Recorded Tests tab**
- Cards for manifests captured with `/sg-record` from `visual-tests/manifests/` (step count, check count, recording date)
- Select tests to get a ready-to-copy `sg-visual-run --manifests ...` command

**Lightbox**
- Click any card to open full screenshot + test details
- Shows: test name, status, URL, description, steps to reproduce
- For FAIL tests: shows failure reason

**Annotation Pen**
- In lightbox, click "+ Add Note" (or double-click the screenshot) to annotate
- Click places a pin; drag draws a rectangle zone; each annotation gets a note + severity
- Annotations are stored per test and exported with re-run manifests
- Drawing an annotation auto-selects the test

**Multi-Select + Re-run**
- Click checkbox overlay on cards to select tests
- Floating action bar shows selection count
- "Re-run selected" → downloads JSON manifest with test IDs + annotations
- "Copy IDs" → copies test paths to clipboard
- Annotations are exported in the same normalized format as the fix manifest:

```json
{
  "action": "rerun",
  "timestamp": "2026-04-09T...",
  "tests": [
    {
      "test": "auth/login",
      "annotations": [
        { "x1": 0.2, "y1": 0.3, "x2": 0.8, "y2": 0.6, "note": "Button overlaps footer", "severity": "high" }
      ]
    }
  ]
}
```

**Validate & Generate Report workflow**
1. Select one or more failed tests (checkbox overlay on cards)
2. Optionally annotate each test with the pen tool to mark the problem area
3. Click "Validate & Generate Report" in the floating action bar
4. The page POSTs `fix-manifest.json` to the server via `POST /save-manifest` (top-level `action: "validate-and-fix"` + `timestamp`; per-test `redo_entirely` / `revert_to_before` / `improve_ui` booleans; annotations as `{x1,y1,x2,y2,note,severity}`)
5. The saved manifest is then consumed by `/sg-visual-fix` to implement fixes

### Step 4: Re-run Failed/Annotated Tests

Take the exported JSON and feed it back:

```bash
/sg-visual-run <paste test IDs>
```

Or use the test paths directly:

```bash
/sg-visual-run auth/login dashboard/home settings/profile
```

## Build Script Location

The build script and template are installed to the project:

| File | Purpose |
|------|---------|
| `visual-tests/build-review.mjs` | Node.js build script |
| `visual-tests/_review-template.html` | HTML template with inline CSS + JS |
| `visual-tests/review-smoke-test.mjs` | Isolated smoke test for review build/server/save-manifest/persona reports |
| `visual-tests/monitor-smoke-test.mjs` | Isolated smoke test for audit monitor endpoints |
| `visual-tests/_results/review.html` | Generated local review workspace (not committed) |
| `visual-tests/_results/change-reports/<report-id>/report.json` | Durable source report (committed with UI changes) |
| `visual-tests/_results/persona-reports/<report-id>/index.html` | Durable generated review report (committed when used for PR/client review) |
| `visual-tests/_results/persona-reports/` | Generated audience-specific reports |

## Setup

If the build script is not yet in the project:

```bash
# Copy from the installed ShipGuard plugin root.
# Resolve SHIPGUARD_PLUGIN_ROOT from this skill path:
# $SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/SKILL.md
cp "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/build-review.mjs" visual-tests/
cp "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/_review-template.html" visual-tests/
cp "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/review-smoke-test.mjs" visual-tests/
cp "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/monitor-smoke-test.mjs" visual-tests/

# Add npm script (optional)
# In package.json: "visual:review": "node visual-tests/build-review.mjs"
```

## Smoke Tests

Run these after installing or changing the review dashboard files:

```bash
node visual-tests/review-smoke-test.mjs --port=23101
node visual-tests/monitor-smoke-test.mjs --port=23102
```

Both scripts use temporary fixtures. They should not write into the project except for normal process output.

Options:
- `--port=<port>` uses a deterministic local port. The same value can be supplied with `SHIPGUARD_REVIEW_SMOKE_PORT`, `SHIPGUARD_MONITOR_SMOKE_PORT`, or `SHIPGUARD_SMOKE_PORT`.
- `--keep-tmp` keeps the fixture directory for inspection after the run.
- `--debug` keeps the fixture directory and prints server output on failure.

If a sandbox blocks local bind, the scripts fail with the fixture path, rerun command, server output tail, and a `listen EPERM` hint.

## Design

- Dark theme (slate-900 bg, copper accents)
- Responsive grid (4 columns desktop, 1 column mobile)
- No external dependencies — a single self-contained HTML file. Server-backed features (Code Audit tab, live monitor, Validate & Generate Report) require `--serve`; `file://` shows the build-time tabs only
- Keyboard shortcuts: Escape to close lightbox/clear selection
