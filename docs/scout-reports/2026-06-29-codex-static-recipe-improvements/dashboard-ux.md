# Dashboard States And UX

Read this when changing Code Audit, Routes, or Agents tabs.

## P1.5 - Distinguish No Audit From Zero-Bug Audit

### Finding

A valid `audit-results.json` with `bugs: []` can render as `No audit data
found`.

### Impact

A good result is presented as missing data. That confuses:

- audit did not run
- audit failed
- audit ran and found nothing

### Proposal

Use separate states:

| State | Condition | UI |
|---|---|---|
| No audit file | 404 on `audit-results.json` | `Run /sg-code-audit` |
| Invalid audit | invalid JSON or incomplete schema | readable error |
| Zero bug | `summary.total_bugs === 0` or `bugs.length === 0` | `Audit complete, 0 bug found` |
| Bugs found | `bugs.length > 0` | current dashboard |

### Acceptance Criteria

- `bugs: []` displays a complete audit with 0 bugs.
- Code Audit tab does not show `No audit data found` when a valid file exists.

## P1.6 - Add Explicit `agents[]`

### Finding

The Agents tab infers agents from bug ID format. If IDs do not follow the
expected pattern, counters may exist but agent cards become unhelpful.

### Proposal

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

### Acceptance Criteria

- Agents tab does not depend on bug ID format.
- A 0-bug audit can still show agents and audited files.

## P1.7 - Fix Route Bug Counts

### Finding

The `/` route can match too broadly and count all bugs.

### Proposal

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

### Acceptance Criteria

- `/` does not count all bugs by default.
- Route counters stay consistent with the filtered Bugs table.
