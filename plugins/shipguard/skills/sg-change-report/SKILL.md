---
name: sg-change-report
description: Use after visual runs, screenshot capture, frontend PRs, or before stakeholder review — creates the durable ShipGuard before/after report for UI-visible changes.
context: conversation
argument-hint: "<report-id> [optional: summary or screenshot paths]"
---

# /sg-change-report - Durable Visual Change Report

Create the persistent before/after artifact that travels with a UI change. This skill turns visual test evidence into committed PR review material.

## Arguments

- `<report-id>` — stable kebab-case id matching the feature, route, or PR scope.
- Optional **summary text** — seeds `report.json.summary` (workflow step 4).
- Optional **screenshot paths** — copied into `visual-tests/_results/change-reports/<report-id>/screenshots/` and referenced as before/after `src` values in `report.json` (workflow steps 3-4).

## Output Contract

Always create or update a source report folder:

```text
visual-tests/_results/change-reports/<report-id>/report.json
visual-tests/_results/change-reports/<report-id>/screenshots/
```

Then run the review builder to generate audience-specific HTML:

```bash
node visual-tests/build-review.mjs
```

(`--serve --port=<free-port>` is optional, for browsing the result locally; stop the server afterwards with `/sg-visual-review-stop`.)

Generated artifacts, written under `visual-tests/_results/persona-reports/<report-id>/`:

| Artifact | Purpose | Committed? |
|---|---|---|
| `index.html` | audience picker for the report | yes |
| `<audience>.html` | one page per audience (e.g. `client.html`, `engineering.html`) | yes |
| `client-invite-email.md` | ready-to-send invite for external reviewers | yes |
| `client-response-email.md` | reply template for collected feedback | yes |
| `proposal-trace.md` / `proposal-trace.json` | trace of the proposals and decisions behind the change | yes |

The builder also refreshes the top-level `visual-tests/_results/persona-reports/index.html` (committed) and the transient `visual-tests/_results/review.html` and `.server.pid` (never committed — see below).

The canonical schema is `normalizeChangeReport()` in `visual-tests/build-review.mjs`: every field is optional with a default (`status` defaults to `draft`). `report.json` is the durable source of truth; persona-reports are its rendered views.

## Required `report.json`

Use this minimum shape:

```json
{
  "id": "checkout-redesign",
  "title": "Checkout redesign",
  "summary": "Before/after report for the checkout UX change.",
  "route": "/checkout",
  "status": "ready-for-review",
  "audiences": ["client", "product", "design", "engineering"],
  "changes": [
    {
      "id": "payment-summary",
      "title": "Payment summary is now persistent",
      "problem": "Users lost context while scrolling.",
      "decision": "Keep the summary visible during payment.",
      "impact": "Reduces uncertainty before confirmation.",
      "risk": "Mobile height still needs a small-device check.",
      "tests": ["checkout/payment"],
      "files": ["src/components/checkout/payment-form.tsx"],
      "before": {
        "src": "screenshots/payment-summary-before.png",
        "caption": "Previous state"
      },
      "after": {
        "src": "screenshots/payment-summary-after.png",
        "caption": "New state"
      }
    }
  ]
}
```

Add `client` and `validation` fields when the report will be sent outside the team. See `$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/examples/change-report.json` for a full example.

> SHIPGUARD_PLUGIN_ROOT = the plugin root directory, resolved as two levels up from this skill's SKILL.md (or `$CLAUDE_PLUGIN_ROOT` when the harness sets it).

## Workflow

1. Run or reuse relevant visual evidence from `sg-visual-run`, `sg-visual-review`, or `sg-visual-fix`.
2. Choose a stable kebab-case `<report-id>` matching the feature, route, or PR scope.
3. Copy only review-relevant screenshots into `visual-tests/_results/change-reports/<report-id>/screenshots/`. Screenshot paths passed as arguments are copied here and referenced as before/after `src` values in `report.json`.
4. Write `report.json` with before screenshots when available and after screenshots for the final state. A summary passed as an argument seeds `report.json.summary`.
5. Bootstrap check: if `visual-tests/build-review.mjs` or `visual-tests/_review-template.html` is missing in the project, copy them from `$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/`.
6. Run `node visual-tests/build-review.mjs`. Add `--serve --port=<free-port>` only to browse the result; stop the server afterwards with `/sg-visual-review-stop`.
7. Verify deterministically (no server needed): `visual-tests/_results/persona-reports/<report-id>/index.html` exists and at least one `visual-tests/_results/persona-reports/<report-id>/<audience>.html` exists.
8. Stage the durable report artifacts with the UI change:

```bash
git add visual-tests/_results/change-reports/<report-id>
git add visual-tests/_results/persona-reports/<report-id> visual-tests/_results/persona-reports/index.html
```

Gitignore caveat: host projects often ignore `_results/`. If `git status` does not show the report files after staging, use `git add -f` on the two folders above, or adjust the ignore rule (e.g. add `!visual-tests/_results/change-reports/` and `!visual-tests/_results/persona-reports/`).

## What Not To Commit

Do not commit transient local files:

```text
visual-tests/_results/review.html
visual-tests/_results/.server.pid
```

`review.html` is the interactive local workspace. `change-reports` and `persona-reports` are the durable PR artifacts and are committed.

## PR Text

Every UI PR that captures or reuses screenshots should include:

```markdown
ShipGuard Change Report:
- Source: `visual-tests/_results/change-reports/<report-id>/report.json`
- Review: `visual-tests/_results/persona-reports/<report-id>/index.html`
```

Mention if no before screenshot was available, and list the main routes/tests covered.
