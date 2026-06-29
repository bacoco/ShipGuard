---
name: sg-visual-review
description: Generate the interactive ShipGuard review dashboard from audit, process, and visual results.
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
7. If change-report specs exist, generates persona-aware HTML reports under `visual-tests/_results/persona-reports/`

### Durable Post-Development Change Reports

When UI work was performed or screenshots should be saved with a PR, invoke `sg-change-report`. It creates the durable source report under:

```text
visual-tests/_results/change-reports/<report-id>/report.json
visual-tests/_results/change-reports/<report-id>/screenshots/
```

Then this review builder generates audience-specific HTML under:

```text
visual-tests/_results/persona-reports/<report-id>/
```

Commit the change-report source and the generated persona report with the UI change. Do not commit `visual-tests/_results/review.html` or `visual-tests/_results/.server.pid`; those are local generated files.

### Client Validation Reports

Use this when the report must be validated by a client or by different recipients: client, product, design, engineering, executive, or any custom audience. The generated pages are decision surfaces: before/after evidence, plain rationale, `Accept / Adjust / Reject`, free-form comments, and JSON export.

Create a spec at:

```text
visual-tests/_results/change-reports/<report-id>/report.json
```

Put screenshots next to it, usually under:

```text
visual-tests/_results/change-reports/<report-id>/screenshots/
```

Then run:

```bash
node visual-tests/build-review.mjs --serve
```

ShipGuard generates:

```text
visual-tests/_results/persona-reports/index.html
visual-tests/_results/persona-reports/<report-id>/index.html
visual-tests/_results/persona-reports/<report-id>/<audience>.html
visual-tests/_results/persona-reports/<report-id>/client-invite-email.md
visual-tests/_results/persona-reports/<report-id>/client-response-email.md
visual-tests/_results/persona-reports/<report-id>/proposal-trace.md
visual-tests/_results/persona-reports/<report-id>/proposal-trace.json
```

Each audience page adapts the same evidence:
- `client` focuses on plain-language choices and validation.
- `business` focuses on outcome and residual risk.
- `product` focuses on priority, acceptance, route/test references.
- `design` focuses on UX rationale and before/after evidence.
- `engineering` focuses on files, tests, implementation boundaries.

Each generated page includes local comments, `Accept / Adjust / Reject` decisions, and JSON export. The email and trace artifacts support manual validation without an email provider: send `client-invite-email.md`, let the client reply from `client-response-email.md`, and archive `proposal-trace.*` with the returned decision. This is the reusable ShipGuard layer; project-specific apps should consume it instead of hand-building one-off reports.

Minimal `report.json` shape:

```json
{
  "id": "checkout-redesign",
  "title": "Checkout redesign",
  "summary": "Decision report for checkout UX changes.",
  "route": "/checkout",
  "client": {
    "name": "Client team",
    "contact": "client@example.com"
  },
  "validation": {
    "reference": "UX-2026-05-checkout-redesign",
    "review_url": "https://review.example.com/persona-reports/checkout-redesign/client.html",
    "reply_to": "delivery@example.com",
    "deadline": "2026-05-09"
  },
  "audiences": ["client", "product", "design", "engineering"],
  "changes": [
    {
      "id": "payment-summary",
      "title": "Payment summary is now persistent",
      "problem": "Users lost context while scrolling.",
      "decision": "Keep the summary visible during payment.",
      "impact": "Reduces uncertainty before confirmation.",
      "choices": ["Keep sticky", "Use collapsible", "Revert"],
      "tests": ["checkout/payment"],
      "files": ["src/components/checkout/payment-form.tsx"],
      "before": { "src": "screenshots/before.png", "caption": "Previous state" },
      "after": { "src": "screenshots/after.png", "caption": "New state" }
    }
  ]
}
```

Full example: `skills/sg-visual-review/examples/change-report.json`.

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

# Add npm script (optional)
# In package.json: "visual:review": "node visual-tests/build-review.mjs"
```

## Design

- Dark theme (slate-900 bg, copper accents)
- Responsive grid (4 columns desktop, 1 column mobile)
- No external dependencies (works with file:// protocol)
- Keyboard shortcuts: Escape to close lightbox/clear selection
