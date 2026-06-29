# Scout And Improve Preview Modes

Read this when changing `sg-scout`, `sg-improve`, issue filing, or local
learning writes.

## P2.14 - Formalize `sg-scout` Offline And Dry-Run Modes

### Finding

`sg-scout` depends on GitHub and network access. In sandboxed environments this
often fails on the first run.

### Proposal

Explicit modes:

```bash
/sg-scout --dry-run --topic=visual
/sg-scout --offline --from fixtures/scout-repos.json
```

Produce a local report even when GitHub is unavailable:

```text
visual-tests/_results/scout-report.md
```

### Acceptance Criteria

- Dry-run never creates an issue.
- Network failure gives actionable output instead of an opaque stop.

## P2.15 - Add A Real `sg-improve` Preview Mode

### Finding

`sg-improve --dry-run` should show exactly what would be written.

### Proposal

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

### Acceptance Criteria

- Dry-run details target files.
- Real mode snapshots before writing.
- Rollback can be tested on a fixture.
