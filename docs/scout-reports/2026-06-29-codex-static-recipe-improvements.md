# ShipGuard Generic Improvements From Codex Static Recipe

Date: 2026-06-29

Context: ShipGuard recipe run in a static test repository from Codex, with the
plugin installed on both Codex and Claude. This note does not target the test
repository. It extracts generic improvements for ShipGuard itself.

## Executive Summary

ShipGuard works on the main chain:

- visual discovery
- manifest generation
- visual run with screenshots
- HTML dashboard
- report-only code audit
- persona reports
- recorder manifest path
- scout and improve in dry-run

The blocking points are not product direction. They are orchestration
robustness: exchange formats are too implicit, some paths depend on Markdown,
the local server is too permissive, sandboxed environments add friction, and
some destructive paths lack dry-run coverage.

Highest return improvements:

- introduce canonical JSON files between skills
- harden `build-review.mjs --serve`
- make dashboard states explicit
- add official smoke tests for review, monitor, recorder, and fix
- document Codex/Claude sandbox constraints

## P0 - Stable Data Contracts

### 1. Add Canonical `visual-results.json`

#### Finding

`sg-visual-review` reconstructs visual test state by parsing
`visual-tests/_results/report.md`. Markdown is a human format, not a machine
contract. If the report is translated, reformatted, or enriched, the dashboard
can lose statuses and classify tests as `STALE`.

#### Impact

- false dashboard state
- lower trust in review output
- strong coupling between report wording and HTML rendering
- fragile localization and runtime adapters

#### Proposal

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

#### Acceptance Criteria

- Changing `report.md` wording or language does not change statuses in
  `review.html`.
- A `PASS` test remains `PASS` in the dashboard even if `report.md` is absent.
- The dashboard shows a clear message when `visual-results.json` is invalid.

### 2. Normalize `impacted_ui_routes` and `impacted_routes`

#### Finding

ShipGuard audit output exposes `impacted_ui_routes`, but some dashboard paths
read `impacted_routes`. A manual alias was needed for the Routes tab to display
results.

#### Impact

- impacted routes can be invisible
- `sg-code-audit` -> `sg-visual-run --from-audit` is fragile
- users need to know two field names

#### Proposal

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

#### Acceptance Criteria

- An audit with only `impacted_ui_routes` feeds the Routes tab.
- A legacy audit with only `impacted_routes` still works.
- Docs and examples use one canonical name.

## P0 - Local Server Security

### 3. Bind the Review Server to `127.0.0.1`

#### Finding

`build-review.mjs --serve` uses `server.listen(PORT)` without an explicit host.
Depending on Node and environment, this can listen on an unspecified address.
Comments describe a localhost-only server, but code does not enforce it.

#### Impact

The server exposes:

- files under `_results/`
- `POST /save-manifest`
- monitor endpoints
- wildcard CORS

On an untrusted network, accidental LAN exposure increases attack surface.

#### Proposal

Default:

```js
const HOST = "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log(`Server: http://${HOST}:${PORT}`);
});
```

Add an explicit option:

```bash
node visual-tests/build-review.mjs --serve --host=0.0.0.0
```

Print a warning when `--host=0.0.0.0` is used.

#### Acceptance Criteria

- Default server listens on `127.0.0.1`.
- The log prints the real host.
- LAN exposure requires an explicit option.

### 4. Replace `startsWith` Path Traversal Guard

#### Finding

The file server uses logic like:

```js
if (!filePath.startsWith(RESULTS_DIR)) forbidden;
```

String prefix checks are fragile. A resolved sibling directory with the same
prefix can bypass intent.

#### Proposal

Use `resolve` and `relative`:

```js
import { resolve, relative, isAbsolute } from "path";

const root = resolve(RESULTS_DIR);
const target = resolve(root, requestedPath);
const rel = relative(root, target);

if (rel.startsWith("..") || isAbsolute(rel)) {
  res.writeHead(403);
  res.end("Forbidden");
  return;
}
```

#### Acceptance Criteria

- `../` is refused.
- Encoded paths are refused after decoding and resolution.
- A sibling directory such as `_results-old` is not served.

## P1 - Dashboard States And UX

### 5. Distinguish No Audit From Zero-Bug Audit

#### Finding

A valid `audit-results.json` with `bugs: []` can render as `No audit data
found`.

#### Impact

A good result is presented as missing data. That confuses:

- audit did not run
- audit failed
- audit ran and found nothing

#### Proposal

Use separate states:

| State | Condition | UI |
|---|---|---|
| No audit file | 404 on `audit-results.json` | `Run /sg-code-audit` |
| Invalid audit | invalid JSON or incomplete schema | readable error |
| Zero bug | `summary.total_bugs === 0` or `bugs.length === 0` | `Audit complete, 0 bug found` |
| Bugs found | `bugs.length > 0` | current dashboard |

#### Acceptance Criteria

- `bugs: []` displays a complete audit with 0 bugs.
- Code Audit tab does not show `No audit data found` when a valid file exists.

### 6. Add Explicit `agents[]`

#### Finding

The Agents tab infers agents from bug ID format. If IDs do not follow the
expected pattern, counters may exist but agent cards become unhelpful.

#### Proposal

Add this schema:

```json
{
  "agents": [
    {
      "id": "z1",
      "label": "Zone 1",
      "status": "completed",
      "files_audited": 9,
      "bugs_found": 1,
      "duration_ms": 120000,
      "paths": ["scripts/*.sh", "README.md"]
    }
  ]
}
```

#### Acceptance Criteria

- Agents tab does not depend on bug ID format.
- A 0-bug audit can still show agents and audited files.

### 7. Fix Route Bug Counts

#### Finding

The `/` route can match too broadly and count all bugs.

#### Proposal

Option A: accept `bug_count` directly in `impacted_ui_routes`.

```json
{
  "route": "/",
  "reason": "...",
  "severity": "high",
  "bug_count": 3
}
```

Option B: add explicit route mapping per bug.

```json
{
  "impacted_routes": ["/", "/settings"]
}
```

Avoid implicit string matching on filenames, especially for `/`.

#### Acceptance Criteria

- `/` does not count all bugs by default.
- Route counters stay consistent with the filtered Bugs table.

## P1 - Dry-Run Modes And Destructive-Path Recipe

### 8. Add `--dry-run` To `sg-visual-fix`

#### Finding

`sg-visual-fix` is valuable but destructive. It reads annotations, infers the
bug, edits code, rebuilds, and captures after-state evidence. It is hard to
test without accepting modifications.

#### Proposal

Add:

```bash
/sg-visual-fix --dry-run visual-tests/_results/fix-manifest.json
```

Behavior:

- read the manifest
- load screenshots
- describe annotated regions
- propose suspect files
- propose intended correction
- edit nothing
- write `visual-tests/_results/visual-fix-plan.md`

#### Acceptance Criteria

- Dry-run modifies no source files.
- Plan lists tests, screenshots, annotations, candidate files, and limits.
- Normal mode remains unchanged.

### 9. Add Official Interface Smoke Tests

#### Finding

Current validation relies on manual tests or ad hoc commands.

#### Proposal

Provide:

```bash
node visual-tests/review-smoke-test.mjs
```

It should verify:

- `review.html` generates
- `audit-results.json` loads
- `visual-results.json` or fallback loads
- Recorded Tests detects a manifest
- `POST /save-manifest` writes a file
- persona reports generate when `change-reports/*/report.json` exists

#### Acceptance Criteria

- Script exits `0` if the minimal interface works.
- Script output is short and actionable.

## P1 - Recorder

### 10. Avoid Unbounded `npx` Prechecks In `sg-record`

#### Finding

A precheck like `npx playwright --version` can hang or try network access,
especially outside a Node project.

#### Proposal

Safer order:

1. `node -e "import('playwright')"` from the project
2. local `node_modules/.bin/playwright`
3. global binary if available
4. otherwise show install instructions without blocking
5. bound each command with a timeout

#### Acceptance Criteria

- No unbounded `npx` command.
- Environment without Playwright fails fast with a clear message.

### 11. Make Recorder Bootstrap Strictly Sequential

#### Finding

Recorder file copies fail if they run before:

```bash
mkdir -p visual-tests/lib visual-tests/manifests
```

#### Proposal

The runbook must impose:

```bash
mkdir -p visual-tests/lib visual-tests/manifests
cp ...
cp ...
```

Explicitly avoid parallelization for these steps.

#### Acceptance Criteria

- Bootstrap from zero does not depend on shell-agent execution order.
- Re-running bootstrap is idempotent.

## P1 - Codex / Claude Sandbox Environments

### 12. Document Required Permissions

#### Finding

Several legitimate ShipGuard actions are blocked by default sandboxing:

| Action | Why | Workaround |
|---|---|---|
| `agent-browser` | local socket in home | allow it or configure socket under `/tmp` |
| `build-review --serve` | local port | allow local server, bind `127.0.0.1` |
| `curl POST localhost` | endpoint test | allow local network |
| `gh api` | scout needs GitHub | explicit network permission |
| `npx` | can require network | avoid or require explicit install |
| Python compile | pycache outside workspace | `PYTHONPYCACHEPREFIX=/tmp/...` |

#### Proposal

Add a `Sandbox / Codex / Claude` section in relevant skills.

#### Acceptance Criteria

- User knows which permissions to accept.
- Sandbox errors are recognized as such in runbooks.

## P2 - Monitoring

### 13. Add Monitor Endpoint Smoke Test

#### Finding

Monitor endpoints exist:

- `/api/monitor/audit-start`
- `/api/monitor/agent-update`
- `/api/monitor/status`
- `/api/monitor/audit-complete`

There is no simple end-to-end smoke test.

#### Proposal

Add:

```bash
node visual-tests/monitor-smoke-test.mjs
```

The script:

- starts or detects the server
- posts a fake audit
- posts two fake agents
- verifies `/status`
- posts completion
- verifies the dashboard can load state

#### Acceptance Criteria

- No external dependency.
- No writes outside `_results/audit-monitor.json`.
- Clear failure output.

## P2 - Scout And Improve

### 14. Formalize `sg-scout` Offline And Dry-Run Modes

#### Finding

`sg-scout` depends on GitHub and network access. In sandboxed environments this
often fails on the first run.

#### Proposal

Explicit modes:

```bash
/sg-scout --dry-run --topic=visual
/sg-scout --offline --from fixtures/scout-repos.json
```

Produce a local report even when GitHub is unavailable:

```text
visual-tests/_results/scout-report.md
```

#### Acceptance Criteria

- Dry-run never creates an issue.
- Network failure gives actionable output instead of an opaque stop.

### 15. Add A Real `sg-improve` Preview Mode

#### Finding

`sg-improve --dry-run` should show exactly what would be written.

#### Proposal

Either write preview files:

```text
.shipguard/preview/learnings.yaml
.shipguard/preview/mistakes.md
.shipguard/preview/upstream-proposals.md
```

Or, if zero write is preferred:

```text
visual-tests/_results/sg-improve-preview.md
```

#### Acceptance Criteria

- Dry-run details target files.
- Real mode snapshots before writing.
- Rollback can be tested on a fixture.

## Short Roadmap

### Sprint 1 - Dashboard Robustness

- `visual-results.json`
- normalized `impacted_ui_routes`
- zero-bug audit state
- bind review server to `127.0.0.1`
- path traversal guard with `resolve` / `relative`

### Sprint 2 - Testability

- `sg-visual-fix --dry-run`
- `review-smoke-test.mjs`
- `monitor-smoke-test.mjs`
- sequential recorder bootstrap
- prechecks without unbounded `npx`

### Sprint 3 - Agentic Workflow

- explicit `agents[]`
- reliable bug count per route
- formalized scout offline/dry-run modes
- improve preview / rollback fixture
- Codex / Claude sandbox docs

## Suggested Regression Tests

### Dashboard Without Markdown

Delete or rename `report.md`. Keep `visual-results.json`. Verify that Visual
Tests still displays statuses.

### Zero-Bug Audit

Use:

```json
{
  "summary": {
    "total_bugs": 0
  },
  "bugs": []
}
```

Verify that the UI displays `0 bug`, not `No audit data found`.

### Impacted Routes

Test all three cases:

- only `impacted_ui_routes`
- only `impacted_routes`
- both fields

### Server Security

Test:

- `GET /../secret.txt` -> `403`
- sibling directory with similar prefix -> `403`
- default host -> `127.0.0.1`

### Recorder Without Playwright

In a project without `node_modules`:

- precheck fails fast
- message explains what to install
- no command hangs

## Final Note

The recipe shows that ShipGuard is already useful as a validation cockpit. The
improvements above mainly make it robust outside its origin repository, across
different agents, localized reports, and sandboxed environments.
