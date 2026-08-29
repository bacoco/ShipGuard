---
name: sg-improve
description: Use after an audit, visual run, or debugging session when learnings should be captured — records local hints and mistakes, and proposes sanitized improvement issues.
context: conversation
argument-hint: "[--local-only] [--github-only] [--dry-run] [--history] [--rollback[=#N]] [--keep-all]"
---

# /sg-improve — Self-Improving Feedback Loop

After an audit or visual-test session, extract what went well and what didn't, then feed those insights back into ShipGuard so the next run is better.

> **Recommended model: Sonnet 4.6.** Mechanical retrospective work — use `/model sonnet` to save Opus quota.

Two outputs:
1. **Local learnings** (`.shipguard/learnings.yaml`) — project-specific knowledge, read automatically by the next `/sg-code-audit`
2. **GitHub issue** (on `{target_repo}`, Phase 5) — generic improvements for all ShipGuard users

Phases: 0 snapshot · 1 collect data · 2 extract signals · 3 classify · 4 learnings + 4b mistakes · 5 GitHub (sanitized) · 6 summary.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-improve` | Full loop — local learnings + GitHub issue |
| `--local-only` | Save learnings locally, skip GitHub |
| `--github-only` | GitHub issue only; skip local writes AND snapshot creation (nothing local changes) |
| `--dry-run` | Preview exact target changes; no target-file or GitHub writes |
| `--rollback` | Revert to the previous snapshot (undo last run) |
| `--rollback=#N` | Revert to snapshot #N; consumes #N and all newer snapshots |
| `--history` | List all snapshots with dates and summary |
| `--keep-all` | Disable snapshot pruning (default keeps the last 5) |

Sandbox note: real mode writes `.shipguard/` and may call GitHub — use `--dry-run` first in restricted environments ([../../docs/sandbox.md](../../docs/sandbox.md)).

---

## Dry-run Preview

With `--dry-run`, run Phases 1-3 normally, then stop before snapshots, local writes, and GitHub writes. Write the preview to `visual-tests/_results/sg-improve-preview.md`, or to `.shipguard/preview/sg-improve-preview.md` if that directory does not exist. `.shipguard/preview/` is the **one exception** to "dry-run must not modify `.shipguard/`" — nothing else under `.shipguard/`, no GitHub issues, and no source files may be touched.

The preview must include: the target files that would be written; the exact YAML entries, mistakes.md sections, and GitHub issue/comment body; signals ignored and why; the snapshot path real mode would create.

Deterministic dry-run smoke test (also validates fixture schemas against the producer contracts; `--keep-tmp`/`--debug` to inspect):

```bash
node "$SHIPGUARD_PLUGIN_ROOT/skills/sg-improve/improve-dry-run-smoke-test.mjs"
```

---

## Phase 0 — Snapshot (Safety Net)

Before touching ANY file, take a snapshot — the rollback point. Skipped with `--github-only` (nothing local changes). Targets: `.shipguard/learnings.yaml` and `.shipguard/mistakes.md`.

```bash
mkdir -p .shipguard/history/{timestamp}

# Copy current state (only files that exist)
cp .shipguard/learnings.yaml .shipguard/history/{timestamp}/ 2>/dev/null
cp .shipguard/mistakes.md    .shipguard/history/{timestamp}/ 2>/dev/null

# Metadata — record per-file PRE-EXISTENCE, not a fixed list
cat > .shipguard/history/{timestamp}/meta.yaml << EOF
timestamp: "{ISO 8601}"
trigger: "sg-improve"
mode: "{flags used}"
audit_bugs: {count from audit-results.json or "unknown"}
files:
  learnings.yaml: {existed|absent}
  mistakes.md: {existed|absent}
github: []
EOF
```

`{timestamp}` = `YYYYMMDD-HHMMSS`. After Phase 5, append every created GitHub issue/comment URL to `github:` in this meta.yaml.

### Retention

Keep the last **5 snapshots**; when creating the 6th, delete the oldest. `--keep-all` disables pruning.

### --rollback

1. List snapshots: `ls -1t .shipguard/history/` (newest first).
2. Show the newest snapshot's metadata and ask: `Rollback? (yes/no)`
3. If confirmed, apply the per-file pre-states from `meta.yaml`: `existed` → restore from the snapshot copy; `absent` → **delete** the file (the run created it; rollback removes it). Then delete the consumed snapshot directory.
4. If `github:` has entries, print: `GitHub issue #N was NOT reverted — close it manually if needed.`
5. Print: `Rolled back to state before {timestamp}.`

### --rollback=#N

Restore from snapshot `#N` with the same per-file rules, then delete `#N` **and** all newer snapshots (`#N` is consumed like plain `--rollback`; newer pre-states no longer describe reality). Print the GitHub warning for every deleted snapshot listing URLs. Then: `Rolled back to state #N ({date}). {M} newer snapshots removed.`

### --history

```
  #1  2026-04-14 07:30  79 bugs  learnings.yaml + mistakes.md  (latest)
  #2  2026-04-13 22:30  47 bugs  learnings.yaml
  Rollback: /sg-improve --rollback     Specific: /sg-improve --rollback=#2
```

Deterministic rollback smoke test (covers restore-existing and first-run-delete cases):

```bash
node "$SHIPGUARD_PLUGIN_ROOT/skills/sg-improve/improve-rollback-smoke-test.mjs"
```

---

## Phase 1 — Collect Structured Data

Gather the hard data before scanning the conversation.

### Step 1: Find audit-results.json

Check these paths in order (first found wins):
1. `visual-tests/_results/audit-results.json`
2. `.code-audit-results/audit-results.json` (legacy fallback)
3. `audit-results.json` (repo root)

If found, extract:
- `run_id`, `base_sha` — use them to resolve the exact current dispatch inventory in Step 2
- `summary.total_bugs`, `summary.by_severity`, `summary.by_category`
- `summary.duration_ms`, `agent_count` (fallback `agents.length` for legacy reports — never a bare `agents`)
- `prompt_hash` — store it in this session's history entry (Phase 4)
- `scope_info.mode`, `scope_info.total_in_scope` (if diff mode)
- Bug counts: `fix_applied: false` (deferred), `confidence: "low"` (uncertain)
- `verification.checked`/`.confirmed`/`.rejected`; count of `unverified_bugs`

**Prefer TOON:** if `audit-results.toon` exists, use it for LLM analysis (Phase 2+, ~40% fewer tokens); use the JSON for field extraction here.

If not found, log: "No audit-results.json — extracting from conversation only."

### Step 2: Read zone JSON files

For a canonical result with `run_id`, read
`visual-tests/_results/runs/{audit.run_id}/dispatch.json`, require its `run_id` and `base_sha` to
match the canonical audit, and read only its `accepted_artifacts` paths. Revalidate each artifact's
identity against its dispatch entry. Never glob the shared results directory or another run. Per
accepted file, extract `zone`, `files_audited`, `bugs` count, and whether the zone ID has an `a`/`b`
suffix (a re-split happened).

If a current-format canonical result exists but its dispatch record is absent or mismatched, warn
and use the aggregate's `agents` data; do not fall back to stale zone files. Only for a legacy audit
without `run_id`, use the legacy fallback glob `.code-audit-results/zone-*-r*.json` and label the
signal source `legacy`.

### Step 3: Read regressions

If `visual-tests/_regressions.yaml` exists, count entries; note any with `consecutive_passes >= 2` (about to auto-remove — a success signal).

### Step 3b: Read visual results

If `visual-tests/_results/visual-results.json` exists, extract `summary.pass`, `summary.fail`, `summary.error`, `summary.stale` — these feed Phase 2's Success Signals.

### Step 4: Read git log

```bash
git log --oneline --since="12 hours ago" | grep -c "audit-r[0-9]"
```

Count audit commits; check for reverts (signal of a bad fix).

### Step 5: Read existing learnings

If `.shipguard/learnings.yaml` exists, read it — Phase 4 merges with existing data, never overwrites.

---

## Phase 2 — Extract Friction Signals

Combine Phase 1 data with conversation context — check both per signal type.

### Error Signals

| Signal | How to detect |
|--------|--------------|
| Context overflow | Zone IDs with `a`/`b` suffix, or "Prompt is too long" |
| API overload | "529", "overloaded_error" |
| Post-merge syntax error | "IndentationError"/"SyntaxError"/"NameError" after a worktree merge |
| Browser collision | agent-browser returning `/` instead of the requested URL |
| Session expiry | Re-login needed mid-session |
| Docker failure | "unhealthy", "dependency failed" after rebuild |
| Merge conflict | "git merge --abort" |

### Performance Signals

| Signal | How to compute |
|--------|----------------|
| Overflow rate | (zones with a/b suffix) / (total original zones) |
| Retry count | "retry"/"retrying"/"attempt" mentions in conversation |
| Wall clock | `summary.duration_ms`, or first-to-last audit commit timestamps |
| Agent waste | Zone JSONs with duplicate zone paths |

### Quality Signals

| Signal | How to compute |
|--------|----------------|
| Noise ratio | `summary.by_severity.low` / `summary.total_bugs` |
| Top noise pattern | Most frequent `category` among `low` severity bugs |
| Deferred count | `fix_applied: false` count in bugs array |
| Post-audit regression | Docker/build failure AFTER audit commits (conversation) |

### User Friction Signals

Scan the **user's messages** (never assistant messages) for correction and frustration patterns — wrong behavior even when no error was thrown.

| Signal | Patterns (case-insensitive) | Priority |
|--------|----------------------------|----------|
| COMMAND_FAILURE | Tool exit code != 0, stderr with "error", "failed", "not found" | 100 |
| USER_CORRECTION | `I said`, `you didn't`, `that's wrong`, `no not` | 80 |
| SKILL_OVERRIDE | `skip that`, `don't do`, `ignore` | 75 |
| REDO_REQUEST | `redo`, `try again`, `re-run` | 70 |
| REPETITION | Same instruction 2+ times (Jaccard > 0.5 over last 10 user messages) | 60 |
| TONE_ESCALATION | 3+ uppercase words in a row, 2+ exclamation marks, `STOP` | 40 |

A message can trigger multiple signals; COMMAND_FAILURE comes from tool results, not user messages. Priority >= 70 must produce a local learning (project-specific) or a GitHub insight (generic).

### Success Signals

These matter just as much — they tell us what NOT to change.

| Signal | How to detect |
|--------|--------------|
| Clean merge rate | (total zones - merge conflicts) / total zones |
| Critical bug value | `critical` + `high` bugs with `fix_applied: true` |
| Visual verification | `summary.pass` from visual-results.json (Step 3b) |
| Zero-retry zones | Zones completed on first attempt |

Record every signal as:

```yaml
- signal: "user_correction"
  count: 2
  details: "User corrected the applied audit hint twice"
  impact: "~10 min lost"
  type: "friction"          # error | performance | quality | success | friction
  priority: 80              # friction only
  quote: "no, wrong file"   # exact user quote ≤100 chars, friction only
```

---

## Phase 3 — Classify

| Classification | Rule of thumb | Destination |
|----------------|--------------|-------------|
| **project-specific** | Mentions a file path, service, port, or timing specific to this repo | `.shipguard/learnings.yaml` only |
| **generic** | Would help ANY repo using ShipGuard — missing step, bad default, design flaw | GitHub issue |
| **both** | Generic pattern observed through a project-specific symptom | Both (GitHub side sanitized per Phase 5) |

When in doubt, classify as **LOCAL ONLY** — a lost generic insight is recoverable; leaked project content is not.

---

## Phase 4 — Local Learnings

Write to `{repo_root}/.shipguard/learnings.yaml` (create `.shipguard/` if needed). Sections: `zone_hints`, `infra_hints`, `audit_hints`, `noise_filters`, `success_patterns`, `session_history`. Full v2 schema: see [references/formats.md](references/formats.md).

### Update Rules

1. **Read first.** Load the existing file entirely before changing it.
2. **Merge, don't overwrite.** Match by `path` (zone_hints), `service` (infra_hints), `pattern` (audit/noise/success). On match: update `last_seen`, increment `occurrences`, enrich `note`. Append entries for new signals.
3. **session_history:** prune to the last 10 entries. Each entry records the audit's `prompt_hash`. When the current hash differs from the previous session's, flag: "baseline discontinuity — audit prompt changed; treat count deltas across this boundary as non-comparable."
4. **Never delete** zone_hints, audit_hints, or success_patterns — the user prunes manually. Mark stale entries (`last_seen` > 90 days) with `possibly_stale: true` instead.
5. **Preserve comments and manual edits.** Parse the YAML, modify in memory, write back with comments intact.

---

## Phase 4b — Mistakes File (Coding Memory)

Alongside `learnings.yaml`, maintain a human-readable journal at `{repo_root}/.shipguard/mistakes.md`, read at every coding session. Header: `# Mistakes not to repeat`. Entry format: see [references/formats.md](references/formats.md).

Only **real bugs found in THIS project** — not generic best practices. Each entry: the bad pattern actually written, the fix, and context (files, instance count, what broke).

Update rules: read the existing file first — don't overwrite. For each `critical`/`high` audit bug: if a similar pattern exists, update instance count and context; otherwise add an entry under the language section. No `low` severity entries. One screen of code max per entry. Refresh the "last updated" date.

### CLAUDE.md wiring

The skill **suggests** the reference line below for the project's `CLAUDE.md` and **never edits CLAUDE.md itself** — show it to the user and let them add it, so every session (not just audits) benefits:

```markdown
## Recurring Mistakes
**Full mistakes journal: `.shipguard/mistakes.md`** — READ this file at the start of every session.
```

---

## Phase 5 — GitHub Issue

### Target repo

Define `{target_repo}` **once**: the `origin` remote of the ShipGuard **plugin installation directory** (never the project under test); fallback `bacoco/ShipGuard`. Sanity check: if the resolved name does not contain "ShipGuard"/"shipguard", warn and fall back to `bacoco/ShipGuard`. Use `{target_repo}` in every `gh` command below.

### Pre-flight

Check `gh auth status` — if not authenticated, skip this phase: "GitHub CLI not authenticated. Run `gh auth login` to enable issue filing. Local learnings saved."

### Sanitization (MANDATORY — the target repo is public)

Issue and comment bodies must contain:
- **NO code excerpts** from the project under test
- **NO file paths** from the project under test
- **NO internal URLs or hostnames**
- **NO secrets** (keys, tokens, credentials)
- **NOT the project name**, unless the user explicitly consents

Describe frictions generically — "a FastAPI project with a Celery queue", never repo names or paths.

**Confirmation gate:** in real mode, render the full body and ask the user before **every** `gh issue create` and `gh issue comment` (`--dry-run` already previews without filing).

### Deduplication and cardinality

**One session issue per run, maximum; individual insights matching an existing open issue become comments on it.**

```bash
gh issue list --repo {target_repo} --state open --label improvement --limit 30 --json number,title,body
```

For each insight: extract keywords from its title; if an open issue matches, add a comment with the new data point (builds cross-user evidence instead of duplicates). All remaining insights go into the single new session issue:

```bash
gh issue create --repo {target_repo} --title "{title}" --label improvement --body "{sanitized body}"
```

Issue body format, comment format, and label taxonomy: see [references/formats.md](references/formats.md).

Record every created issue/comment URL in the snapshot's `meta.yaml` `github:` list (Phase 0).

---

## Phase 6 — Summary

```
/sg-improve complete

Local (.shipguard/learnings.yaml):
  + {N} zone hints   + {M} audit hints   + {K} noise filters   + {S} success patterns
  Session #{H} recorded {— baseline discontinuity flagged, if prompt_hash changed}

GitHub:
  {Created {target_repo}#{number} — "{title}" | Commented on #{number} | Skipped (reason)}

Next /sg-code-audit will: cap {path} zones at {max_files} files,
add {N} patterns to agent checklists, batch {K} noise patterns.
```

---

## How sg-code-audit Consumes Learnings

sg-code-audit reads `.shipguard/learnings.yaml` at its Step 1.5 (zone_hints caps, audit_hints and noise_filters injected into agent prompts). See that skill.
The loop: a `max_files` hint saved today re-splits that zone on the next audit; a saved audit_hint lands in every agent's checklist.

---

## Edge Cases

- **No audit-results.json:** extract signals from conversation only; learnings will be thinner.
- **First run (no learnings.yaml):** create it from scratch; session_history starts with one entry.
- **/sg-improve twice in one session:** update today's session_history entry, don't append a duplicate.
- **gh CLI missing or unauthenticated:** skip Phase 5; print the sanitized issue body for manual filing.
- **Very long conversation (>100K tokens):** rely on Phase 1 data, the last 20 messages, and a grep-style scan for error keywords.
- **No ShipGuard skills used this session:** ask: "I don't see a ShipGuard session in this conversation. What would you like me to analyze?"

---

## Final Checklist

- [ ] Snapshot taken BEFORE any modification; per-file pre-existence in meta.yaml (skipped only with `--github-only`)
- [ ] audit-results.json (incl. `run_id`, `base_sha`, `prompt_hash`), visual-results.json, exact
      dispatch-inventory zone JSONs, and git log read where present
- [ ] Conversation scanned for error/performance/quality/friction/success signals
- [ ] Each signal classified (project-specific / generic / both; when in doubt → LOCAL ONLY)
- [ ] `.shipguard/learnings.yaml` merged; `prompt_hash` recorded; discontinuity flagged if changed (unless `--github-only`)
- [ ] `.shipguard/mistakes.md` updated with critical/high bug patterns (unless `--github-only`)
- [ ] GitHub bodies sanitized (no code, paths, hostnames, secrets, or project name without consent)
- [ ] User confirmed before every `gh issue create` / `gh issue comment` (unless `--local-only` or `--dry-run`)
- [ ] At most one new session issue; matching insights become comments; URLs recorded in meta.yaml
- [ ] Summary displayed with concrete "next run will..." predictions
