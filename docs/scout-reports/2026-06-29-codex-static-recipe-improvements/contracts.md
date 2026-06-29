# Stable Data Contracts

Read this when changing `sg-visual-run`, `sg-code-audit`, or
`build-review.mjs` data exchange.

## P0.1 - Add Canonical `visual-results.json`

### Finding

`sg-visual-review` reconstructs visual test state by parsing
`visual-tests/_results/report.md`. Markdown is a human format, not a machine
contract. If the report is translated, reformatted, or enriched, the dashboard
can lose statuses and classify tests as `STALE`.

### Impact

- false dashboard state
- lower trust in review output
- strong coupling between report wording and HTML rendering
- fragile localization and runtime adapters

### Proposal

Write a canonical file after each `sg-visual-run`:

```json
{
  "schema_version": "1.0",
  "timestamp": "2026-06-29T13:30:00Z",
  "base_url": "http://127.0.0.1:8001",
  "summary": {
    "total": 28,
    "pass": 28,
    "fail": 0,
    "error": 0,
    "stale": 0,
    "skipped": 0,
    "duration_ms": 36800
  },
  "tests": [
    {
      "id": "pages/root-index",
      "manifest": "visual-tests/pages/root-index.yaml",
      "name": "Accueil",
      "url": "/",
      "status": "PASS",
      "duration_ms": 1200,
      "screenshot": "screenshots/root-index.png",
      "failure_reason": null
    }
  ]
}
```

`report.md` becomes a readable rendering only. `build-review.mjs` reads
`visual-results.json` first, then falls back to Markdown parsing for legacy
results.

### Acceptance Criteria

- Changing `report.md` wording or language does not change statuses in
  `review.html`.
- A `PASS` test remains `PASS` in the dashboard even if `report.md` is absent.
- The dashboard shows a clear message when `visual-results.json` is invalid.

## P0.2 - Normalize `impacted_ui_routes` And `impacted_routes`

### Finding

ShipGuard audit output exposes `impacted_ui_routes`, but some dashboard paths
read `impacted_routes`. A manual alias was needed for the Routes tab to display
results.

### Impact

- impacted routes can be invisible
- `sg-code-audit` -> `sg-visual-run --from-audit` is fragile
- users need to know two field names

### Proposal

Choose this canonical field:

```json
{
  "impacted_ui_routes": [
    {
      "route": "/dashboard",
      "reason": "Bug visible",
      "severity": "high"
    }
  ]
}
```

Normalize on load:

```js
const impactedRoutes = data.impacted_ui_routes || data.impacted_routes || [];
```

The builder may also rewrite `data.impacted_routes` only for compatibility.

### Acceptance Criteria

- An audit with only `impacted_ui_routes` feeds the Routes tab.
- A legacy audit with only `impacted_routes` still works.
- Docs and examples use one canonical name.
