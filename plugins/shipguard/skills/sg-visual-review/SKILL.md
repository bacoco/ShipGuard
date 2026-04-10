---
name: sg-visual-review
description: Generate an interactive HTML screenshot review page from Visual test results. Browse all test screenshots in a grid, filter by status/category, annotate problems with a pen tool, multi-select failed tests, and export re-run manifests. Trigger on "sg-visual-review", "visual review", "review screenshots", "show test results", "review visual", "visual-review", "show results", "test review".
context: conversation
argument-hint: "[optional: regenerate | open]"
---

# /sg-visual-review — Interactive Screenshot Review

Generate and open a self-contained HTML page to visually review all Visual test screenshots, annotate problems, and export re-run manifests.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-visual-review` | Build + start server + tell user to open http://localhost:8888 |

**Always:** Build the review page, start the HTTP server, and give the user the URL. No flags, no options. To stop: `/sg-visual-review-stop`.

## Prerequisites

- `/sg-visual-discover` has been run (manifests exist in `visual-tests/`)
- `/sg-visual-run` has been run at least once (screenshots + report exist in `visual-tests/_results/`)
- No external npm dependencies — the build script uses a built-in YAML parser

## What It Does

### Step 1: Build the Review Page

Run the build script:

```bash
node visual-tests/build-review.mjs --serve
```

This script:
1. Reads all YAML test manifests from `visual-tests/`
2. Reads `visual-tests/_results/report.md` for PASS/FAIL status per test
3. Reads `visual-tests/_regressions.yaml` for failure reasons
4. Matches screenshots from `visual-tests/_results/screenshots/`
5. Generates a self-contained `visual-tests/_results/review.html` (inline CSS + JS, no dependencies)
6. If `monitor-data.json` exists in `_results/`, a "Monitor" tab appears showing the Gantt timeline of the last audit

### Step 2: Open in Browser

```bash
open visual-tests/_results/review.html
# Or via agent-browser:
agent-browser open file://$(pwd)/visual-tests/_results/review.html
```

### Step 3: Human Review

The review page provides:

**Visual Tests tab**
- All tests displayed as cards with screenshot thumbnails
- Color-coded badges: PASS (green), FAIL (red), STALE (yellow)
- Priority badges (critical, high, medium, low)
- Sidebar with category filters
- Status filter bar (ALL / PASS / FAIL / STALE)
- Search by test name

**Code Audit tab**
- Shows bug cards from `audit-results.json` if present in `_results/`
- Filter by severity, category, fix status, and free-text search. CSV export available

**Monitor tab**
- Appears only when `monitor-data.json` exists in `_results/` or an audit is in progress
- Shows a Gantt timeline of the last audit run — per-agent duration, token usage, estimated cost, and bugs found per zone

**Lightbox**
- Click any card to open full screenshot + test details
- Shows: test name, status, URL, description, steps to reproduce
- For FAIL tests: shows failure reason

**Annotation Pen**
- In lightbox, click the pen icon to activate drawing mode
- Draw red rectangles on problem areas in the screenshot
- Annotations are stored per test and exported with re-run manifests
- Drawing an annotation auto-selects the test

**Multi-Select + Re-run**
- Click checkbox overlay on cards to select tests
- Floating action bar shows selection count
- "Re-run selected" → downloads JSON manifest with test IDs + annotations
- "Copy IDs" → copies test paths to clipboard
- JSON format:

```json
{
  "action": "rerun",
  "timestamp": "2026-04-09T...",
  "tests": [
    {
      "test": "auth/login",
      "annotations": [
        { "x1": 0.2, "y1": 0.3, "x2": 0.8, "y2": 0.6 }
      ]
    }
  ]
}
```

**Validate & Generate Report workflow**
1. Select one or more failed tests (checkbox overlay on cards)
2. Optionally annotate each test with the pen tool to mark the problem area
3. Click "Validate & Generate Report" in the floating action bar
4. The page POSTs `fix-manifest.json` to the server via `POST /save-manifest`
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
| `visual-tests/_results/review.html` | Generated output (not committed) |

## Setup

If the build script is not yet in the project:

```bash
# Copy from plugin
cp ~/.claude/plugins/shipguard/skills/sg-visual-review/build-review.mjs visual-tests/
cp ~/.claude/plugins/shipguard/skills/sg-visual-review/_review-template.html visual-tests/

# Add npm script (optional)
# In package.json: "visual:review": "node visual-tests/build-review.mjs"
```

## Design

- Dark theme (slate-900 bg, copper accents)
- Responsive grid (4 columns desktop, 1 column mobile)
- No external dependencies (works with file:// protocol)
- Keyboard shortcuts: Escape to close lightbox/clear selection
