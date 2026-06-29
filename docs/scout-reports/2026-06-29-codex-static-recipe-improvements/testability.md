# Dry-Run Modes And Smoke Tests

Read this when adding official recipe coverage or touching destructive paths.

## P1.8 - Add `--dry-run` To `sg-visual-fix`

### Finding

`sg-visual-fix` is valuable but destructive. It reads annotations, infers the
bug, edits code, rebuilds, and captures after-state evidence. It is hard to
test without accepting modifications.

### Proposal

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

### Acceptance Criteria

- Dry-run modifies no source files.
- Plan lists tests, screenshots, annotations, candidate files, and limits.
- Normal mode remains unchanged.

## P1.9 - Add Official Interface Smoke Tests

### Finding

Current validation relies on manual tests or ad hoc commands.

### Proposal

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

### Acceptance Criteria

- Script exits `0` if the minimal interface works.
- Script output is short and actionable.

## P2.13 - Add Monitor Endpoint Smoke Test

### Finding

Monitor endpoints exist:

- `/api/monitor/audit-start`
- `/api/monitor/agent-update`
- `/api/monitor/status`
- `/api/monitor/audit-complete`

There is no simple end-to-end smoke test.

### Proposal

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

### Acceptance Criteria

- No external dependency.
- No writes outside `_results/audit-monitor.json`.
- Clear failure output.
