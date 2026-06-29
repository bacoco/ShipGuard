---
name: sg-change-report
description: Create durable ShipGuard before/after reports for UI-visible changes after visual runs, screenshots, frontend PRs, or stakeholder review.
context: conversation
argument-hint: "<report-id> [optional: summary or screenshot paths]"
---

# /sg-change-report - Durable Visual Change Report

Create the persistent before/after artifact that travels with a UI change. This skill turns visual test evidence into committed PR review material.

## Output Contract

Always create or update a source report folder:

```text
visual-tests/_results/change-reports/<report-id>/report.json
visual-tests/_results/change-reports/<report-id>/screenshots/
```

Then run the review builder to generate audience-specific HTML:

```bash
node visual-tests/build-review.mjs --serve --port=<free-port>
```

Generated reports are written to:

```text
visual-tests/_results/persona-reports/<report-id>/index.html
visual-tests/_results/persona-reports/<report-id>/<audience>.html
```

If a project already uses a simpler static convention, such as `change-reports/<report-id>/index.html`, preserve that convention too. The durable source of truth remains the change-report folder.

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

Add `client` and `validation` fields when the report will be sent outside the team. See `skills/sg-visual-review/examples/change-report.json` for a full example.

## Workflow

1. Run or reuse relevant visual evidence from `sg-visual-run`, `sg-visual-review`, or `sg-visual-fix`.
2. Choose a stable kebab-case `<report-id>` matching the feature, route, or PR scope.
3. Copy only review-relevant screenshots into `change-reports/<report-id>/screenshots/`.
4. Write `report.json` with before screenshots when available and after screenshots for the final state.
5. Run `node visual-tests/build-review.mjs --serve --port=<free-port>`.
6. Verify the generated report URL returns `200 OK`.
7. Stage the durable report artifacts with the UI change:

```bash
git add visual-tests/_results/change-reports/<report-id>
git add visual-tests/_results/persona-reports/<report-id> visual-tests/_results/persona-reports/index.html
```

If the project uses `change-reports/<report-id>/index.html` as the canonical rendered report, stage that folder as well.

## What Not To Commit

Do not commit transient local files:

```text
visual-tests/_results/review.html
visual-tests/_results/.server.pid
```

`review.html` is the interactive local workspace. `change-reports` and `persona-reports` are the durable PR artifacts.

## PR Text

Every UI PR that captures or reuses screenshots should include:

```markdown
ShipGuard Change Report:
- Source: `visual-tests/_results/change-reports/<report-id>/report.json`
- Review: `visual-tests/_results/persona-reports/<report-id>/index.html`
```

Mention if no before screenshot was available, and list the main routes/tests covered.
