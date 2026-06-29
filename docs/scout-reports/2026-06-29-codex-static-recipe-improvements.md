# ShipGuard Codex Static Recipe Improvements

Date: 2026-06-29

This is the progressive-disclosure entry point for the Codex static-repository
recipe feedback. Keep this file short. Read only the detail file that matches
the work being planned.

## Signal

ShipGuard already works as a validation cockpit across the main flow:

- visual discovery
- manifest generation
- screenshot run
- HTML dashboard
- report-only code audit
- persona reports
- recorder manifest path
- scout and improve dry-runs

The weak points are orchestration robustness, not product direction:

- contracts between skills rely too much on implicit formats
- dashboard state can depend on Markdown wording
- the local review server needs stricter defaults
- destructive paths need dry-run recipe coverage
- sandboxed Codex/Claude environments need explicit runbook guidance

## Read Order

| Need | Read |
|---|---|
| Dashboard data contracts | [contracts.md](2026-06-29-codex-static-recipe-improvements/contracts.md) |
| Local server hardening | [server-security.md](2026-06-29-codex-static-recipe-improvements/server-security.md) |
| Dashboard UX states | [dashboard-ux.md](2026-06-29-codex-static-recipe-improvements/dashboard-ux.md) |
| Dry-run and smoke-test roadmap | [testability.md](2026-06-29-codex-static-recipe-improvements/testability.md) |
| Recorder and sandbox notes | [runtime-environments.md](2026-06-29-codex-static-recipe-improvements/runtime-environments.md) |
| Scout and improve preview modes | [scout-improve.md](2026-06-29-codex-static-recipe-improvements/scout-improve.md) |

## Short Roadmap

### Sprint 1 - Dashboard Robustness

- add canonical `visual-results.json`
- normalize `impacted_ui_routes`
- distinguish zero-bug audit from missing audit
- bind review server to `127.0.0.1`
- replace string-prefix path guards with `resolve` / `relative`

### Sprint 2 - Testability

- add `sg-visual-fix --dry-run`
- add `review-smoke-test.mjs`
- add `monitor-smoke-test.mjs`
- make recorder bootstrap strictly sequential
- remove unbounded `npx` prechecks

### Sprint 3 - Agentic Workflow

- add explicit `agents[]` audit metadata
- make route bug counts explicit
- formalize scout offline/dry-run modes
- add improve preview / rollback fixture
- document Codex / Claude sandbox permissions

## Non-Regression Tests To Keep

- Dashboard without Markdown: `visual-results.json` alone keeps visual statuses.
- Zero-bug audit: valid `bugs: []` renders as complete, not missing.
- Impacted routes: `impacted_ui_routes` and legacy `impacted_routes` both load.
- Server security: traversal and prefix-sibling paths return `403`.
- Recorder without Playwright: precheck fails fast with install instructions.

## Rule For Future Additions

Do not add long runbooks to this index. Add a short row in **Read Order** and
put details in a sibling file under
`docs/scout-reports/2026-06-29-codex-static-recipe-improvements/`.
