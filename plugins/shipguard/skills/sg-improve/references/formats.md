# sg-improve — Output Formats

Reference formats for `/sg-improve` outputs. SKILL.md points here; keep this file in sync with the update rules there.

`{project descriptor}` = a generic stack description (e.g., "a FastAPI project with a Celery queue"). The real repo name may appear only with explicit user consent — see the Phase 5 sanitization rules in SKILL.md.

---

## learnings.yaml — Schema (v2)

```yaml
# .shipguard/learnings.yaml
# Auto-maintained by /sg-improve. Read by /sg-code-audit at startup.
# Manual edits are preserved — the skill only appends/updates, never deletes.
schema_version: 2
last_updated: "2026-04-14T07:00:00Z"

zone_hints:
  # Directories where the default zone sizing caused overflow.
  # sg-code-audit reads these to cap files-per-zone during zone discovery.
  - path: "apps/uranus/src/hooks/"
    max_files: 80
    reason: "172 files overflowed Sonnet context (2026-04-13)"
    last_seen: "2026-04-14"
    occurrences: 1

infra_hints:
  # Service-specific knowledge that helps with rebuild timing,
  # post-audit verification, and Docker dependency ordering.
  - service: "api-synthesia"
    startup_time_seconds: 240
    note: "Needs (healthy) before uranus can start"
    last_seen: "2026-04-14"

audit_hints:
  # Codebase-specific bug patterns to prioritize.
  # Injected into agent prompts as additional checklist items.
  - pattern: ".first() without None guard"
    severity: critical
    note: "SQLAlchemy returns None silently. 5 crash sites in rag_tasks.py."
    first_seen: "2026-04-14"
    occurrences: 5

noise_filters:
  # Patterns that generate high volume, low value findings.
  # sg-code-audit batches these into a single summary entry.
  - pattern: "f-string in logger"
    action: "batch"
    reason: "13% of findings, all low severity"

success_patterns:
  # Things that worked well — do NOT change these in the skill.
  - pattern: "worktree isolation for agents"
    note: "Clean merges on 10/13 zones. Isolation prevents cross-agent conflicts."
  - pattern: "severity calibration examples in prompt"
    note: "Agents consistently rated severity correctly. Keep the examples table."

session_history:
  # Last 10 sessions. Older entries auto-pruned on update.
  - date: "2026-04-14"
    mode: "standard"
    prompt_hash: "9f2c4e8a…"  # sha256 from audit-results.json — used to detect baseline discontinuity
    files: 2574
    bugs_found: 79
    bugs_fixed: 77
    critical: 9
    overflow_rate: 0.23
    wall_clock_minutes: 90
```

When the `prompt_hash` of the current session differs from the previous session's hash, flag: "baseline discontinuity — audit prompt changed; treat count deltas across this boundary as non-comparable".

---

## GitHub Issue Format

The body must pass the Phase 5 sanitization rules (no code excerpts, no project file paths, no internal URLs/hostnames, no secrets, no project name without consent).

```markdown
## Session Insights — {project descriptor} ({date})

**Audit:** {mode} mode | {files} files | {zones} zones | {bugs} bugs ({critical} critical)
**Timing:** {minutes} min wall clock | {overflow_count} overflows | {retry_count} retries

### Improvements

#### 1. {Title}
**What happened:** {concrete description of the friction}
**Impact:** {time lost, bugs missed, or user confusion caused}
**Proposed fix:** {specific change to make in the skill prompt or code}
**Skill:** `sg-code-audit` | `sg-visual-run` | `sg-visual-review`

### What Worked Well
{Bullet list — these are signals to KEEP, not change}

### Summary
| # | Issue | Impact | Effort | Skill |
|---|-------|--------|--------|-------|

---
*Filed by `/sg-improve` from {project descriptor}*
```

Comment format when adding a data point to an existing open issue:

```markdown
### New data point ({project descriptor}, {date})
{details}
```

## Labels

Always add `improvement`. Then add skill-specific labels based on content:
- `sg-code-audit` — zone sizing, agent prompts, merge logic
- `sg-visual-run` — browser execution, auth, screenshots
- `sg-visual-review` — dashboard, report generation
- `dx` — developer experience, UX friction, confusing output
- `bug` — a skill instruction that produced incorrect behavior (not just suboptimal)

---

## mistakes.md Format

```markdown
# Mistakes not to repeat

## {Language}

### {Rule title}
\```{language}
# ❌ Bad pattern
bad_code_here()

# ✅ Good pattern
good_code_here()
\```
*{Where found, when, how many instances}*
```
