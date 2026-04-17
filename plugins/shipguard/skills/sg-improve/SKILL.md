---
name: sg-improve
description: Auto-improve ShipGuard from real session learnings. Run this after any /sg-code-audit, /sg-visual-run, or debugging session. Analyzes what worked, what broke, and what was slow — saves project-specific learnings locally (zone sizing, patterns, infra timing) and files generic improvements as GitHub issues. The local learnings feed back into the next audit run automatically. Trigger on "sg-improve", "improve shipguard", "ameliore shipguard", "shipguard feedback", "session insights", "retex", "retrospective", "what did we learn".
context: conversation
argument-hint: "[--local-only] [--github-only] [--dry-run] [--rollback]"
---

# /sg-improve — Self-Improving Feedback Loop

After an audit or visual-test session, this skill extracts what went well and what didn't, then feeds those insights back into ShipGuard so the next run is better. Think of it as a retrospective that writes its own action items.

> **Recommended model: Sonnet 4.6.** Log analysis + config updates + GitHub issue writing — mechanical retrospective work where Opus 4.7 provides no measurable quality gain. Use `/model sonnet` before invoking to save Opus weekly quota.

Two outputs:
1. **Local learnings** (`.shipguard/learnings.yaml`) — project-specific knowledge that the next `/sg-code-audit` reads automatically (zone size limits, codebase-specific patterns, infra timing)
2. **GitHub issue** (`bacoco/ShipGuard`) — generic improvements that benefit all ShipGuard users (better retry logic, missing validation steps, UX friction)

```
Session (audit, visual-run, debug)
  │
  ▼
/sg-improve
  │
  ├─► Phase 1: Collect structured data (audit-results.json, git log, regressions)
  ├─► Phase 2: Extract friction signals from data + conversation
  ├─► Phase 3: Classify each signal (project-specific vs generic)
  ├─► Phase 4: Write .shipguard/learnings.yaml (project memory)
  ├─► Phase 5: File GitHub issue (generic improvements)
  └─► Phase 6: Summary — what the next run will do differently
```

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-improve` | Full loop — local learnings + GitHub issue |
| `/sg-improve --local-only` | Save learnings locally, skip GitHub |
| `/sg-improve --github-only` | File GitHub issue only, skip local |
| `/sg-improve --dry-run` | Show what would be saved/filed, write nothing |
| `/sg-improve --rollback` | Revert to the previous snapshot (undo last sg-improve run) |
| `/sg-improve --history` | List all snapshots with dates and summary |

---

## Phase 0 — Snapshot (Safety Net)

Before touching ANY file, take a snapshot. This is the rollback point.

### What gets snapshotted

Every file that sg-improve might modify:

```
.shipguard/
  learnings.yaml      ← zone hints, audit hints, noise filters, session history
  mistakes.md         ← coding error journal
```

### How snapshots work

```bash
# Create snapshot directory
mkdir -p .shipguard/history/{timestamp}

# Copy current state
cp .shipguard/learnings.yaml .shipguard/history/{timestamp}/learnings.yaml 2>/dev/null
cp .shipguard/mistakes.md    .shipguard/history/{timestamp}/mistakes.md 2>/dev/null

# Write metadata
cat > .shipguard/history/{timestamp}/meta.yaml << EOF
timestamp: "{ISO 8601}"
trigger: "sg-improve"
mode: "{flags used}"
audit_bugs: {count from audit-results.json or "unknown"}
files_snapshotted:
  - learnings.yaml
  - mistakes.md
EOF
```

Use `{timestamp}` = `YYYYMMDD-HHMMSS` (e.g., `20260414-073000`).

### Retention

Keep the last **5 snapshots**. When creating the 6th, delete the oldest. The user can override with `--keep-all` to never prune.

### --rollback

When the user runs `/sg-improve --rollback`:

1. List snapshots: `ls -1t .shipguard/history/` (newest first)
2. Show the user the most recent snapshot with its metadata:
   ```
   Last sg-improve run: 2026-04-14 07:30:00
   Audit bugs at time: 79
   Files modified: learnings.yaml, mistakes.md
   Rollback? (oui/non)
   ```
3. If confirmed:
   ```bash
   cp .shipguard/history/{latest}/learnings.yaml .shipguard/learnings.yaml
   cp .shipguard/history/{latest}/mistakes.md    .shipguard/mistakes.md
   rm -rf .shipguard/history/{latest}
   ```
4. Print: `Rolled back to state before {timestamp}. The changes from that sg-improve run are undone.`

### --history

Show all snapshots:

```
ShipGuard improve history:

  #1  2026-04-14 07:30  79 bugs  learnings.yaml + mistakes.md  (latest)
  #2  2026-04-13 22:30  47 bugs  learnings.yaml
  #3  2026-04-12 15:00  23 bugs  learnings.yaml

  Rollback: /sg-improve --rollback
  Rollback to specific: /sg-improve --rollback=#2
```

### --rollback=#N

Rollback to a specific snapshot (not just the latest):

1. Find snapshot `#N` in the history
2. Restore its files
3. Delete all snapshots newer than `#N` (they're now invalid)
4. Print: `Rolled back to state #N ({date}). {M} newer snapshots removed.`

---

## Phase 1 — Collect Structured Data

Before scanning the conversation, gather the hard data. These files contain objective metrics that don't depend on parsing chat messages.

### Step 1: Find audit-results.json

Check these paths in order (first found wins):
1. `visual-tests/_results/audit-results.json`
2. `.code-audit-results/audit-results.json`
3. `audit-results.json` (repo root)

If found, read it and extract:
- `summary.total_bugs`, `summary.by_severity`, `summary.by_category`
- `summary.duration_ms`, `agents` count
- `scope_info.mode`, `scope_info.total_in_scope` (if diff mode)
- Count of `bugs` where `fix_applied: false` (deferred/unfixable)
- Count of `bugs` where `confidence: "low"` (uncertain findings)
- `verification.checked`, `verification.confirmed`, `verification.rejected` (if present — Phase 5.7 stats)
- Count of `unverified_bugs` (findings rejected by confidence verification)

**Prefer TOON:** If `audit-results.toon` exists alongside the JSON, use it for LLM analysis (Phase 2+) — it's ~40% fewer tokens. Use the JSON only for structured field extraction in this step.

If not found, log: "No audit-results.json — extracting from conversation only."

### Step 2: Read zone JSON files

Glob `visual-tests/_results/zone-*-r*.json` or `.code-audit-results/zone-*-r*.json`.

For each zone file, extract:
- `zone`, `files_audited`, `bugs` count
- Whether the zone ID contains `a`/`b` suffix (indicates a re-split happened)

### Step 3: Read regressions

If `visual-tests/_regressions.yaml` exists, count entries and note any with `consecutive_passes >= 2` (about to be auto-removed — a success signal).

### Step 4: Read git log

```bash
git log --oneline --since="12 hours ago" | grep -c "audit-r[0-9]"
```

Count audit-related commits. Check for any revert commits (signal of a bad fix).

### Step 5: Read existing learnings

If `.shipguard/learnings.yaml` exists, read it. The update in Phase 4 must merge with existing data, not overwrite.

---

## Phase 2 — Extract Friction Signals

Now combine the structured data with conversation context. For each signal type below, check both the data (Phase 1) and the conversation history.

### Error Signals

| Signal | How to detect | From |
|--------|--------------|------|
| Context overflow | Zone IDs with `a`/`b` suffix in zone JSONs, or "Prompt is too long" in conversation | Data + conversation |
| API overload | "529", "overloaded_error" in conversation | Conversation |
| Post-merge syntax error | "IndentationError", "SyntaxError", "NameError" after a worktree merge | Conversation |
| Browser collision | agent-browser returning `/` when a different URL was requested | Conversation |
| Session expiry | Re-login needed mid-session | Conversation |
| Docker failure | "unhealthy", "dependency failed" after rebuild | Conversation |
| Merge conflict | "git merge --abort" in conversation | Conversation |

### Performance Signals

| Signal | How to compute |
|--------|----------------|
| Overflow rate | (zones with a/b suffix) / (total original zones) |
| Retry count | Count "retry" or "retrying" or "attempt" mentions in conversation |
| Wall clock | `summary.duration_ms` from audit-results.json, or estimate from first/last audit commit timestamps |
| Agent waste | Count of zone JSONs with duplicate zone paths (two agents did the same work) |

### Quality Signals

| Signal | How to compute |
|--------|----------------|
| Noise ratio | `summary.by_severity.low` / `summary.total_bugs` |
| Top noise pattern | Most frequent `category` among `low` severity bugs |
| Deferred count | Count of `fix_applied: false` in bugs array |
| Post-audit regression | Any Docker/build failure AFTER audit commits (check conversation) |

### User Friction Signals

Scan the **user's messages** (not assistant messages) in the current conversation for correction and frustration patterns. These indicate that ShipGuard or Claude's behavior was wrong — even if no error was thrown.

| Signal | Regex patterns (case-insensitive) | Priority |
|--------|----------------------------------|----------|
| COMMAND_FAILURE | Tool use exit code != 0, stderr contains "error", "failed", "not found" | 100 |
| USER_CORRECTION | `I said`, `you didn't`, `that's wrong`, `no not`, `pas ça`, `non c'est`, `j'ai dit` | 80 |
| REPETITION | Same instruction given 2+ times (Jaccard similarity > 0.5 across last 10 user messages) | 60 |
| TONE_ESCALATION | 3+ uppercase words in a row, 2+ exclamation marks, `for the last time`, `encore une fois`, `STOP` | 40 |
| SKILL_OVERRIDE | User explicitly overrides a skill decision: `skip that`, `don't do`, `ignore`, `laisse tomber` | 75 |
| REDO_REQUEST | `refais`, `recommence`, `redo`, `try again`, `re-run`, `relance` | 70 |

**Detection rules:**
- Scan only **user messages**, never assistant messages
- A message can trigger multiple signals (e.g., correction + escalation)
- For REPETITION: compare each user message against the previous 10 using Jaccard word similarity. If 3+ pairs score > 0.5, emit one REPETITION signal with count
- For COMMAND_FAILURE: check tool results in the conversation, not user messages

**Output per signal:**
```yaml
- signal: "user_correction"
  count: 2
  details: "User said 'pas ça' after audit hint was applied incorrectly"
  priority: 80
  type: "friction"
  quote: "non c'est pas le bon fichier"  # exact user quote (truncated to 100 chars)
```

These signals feed into Phase 3 classification. A friction signal with priority >= 70 should generate either a local learning (if project-specific) or a GitHub issue (if generic to ShipGuard behavior).

### Success Signals

These matter just as much — they tell us what NOT to change.

| Signal | How to detect |
|--------|--------------|
| Clean merge rate | (total zones - merge conflicts) / total zones |
| Critical bug value | Count of `critical` + `high` severity bugs with `fix_applied: true` |
| Visual verification | Count of PASS results in visual-run report |
| Zero-retry zones | Zones that completed on first attempt |

For each signal, record:
```yaml
- signal: "context_overflow"
  count: 3
  details: "z01 (172 files), z02 (178 files), z04 (214 files)"
  impact: "Added ~10 min latency from re-splits and retries"
  type: "error"  # error | performance | quality | success
```

---

## Phase 3 — Classify

For each signal, decide where it belongs:

| Classification | Rule of thumb | Destination |
|----------------|--------------|-------------|
| **project-specific** | Mentions a file path, service name, port, or timing specific to this repo | `.shipguard/learnings.yaml` only |
| **generic** | Would help ANY repo using ShipGuard — a missing step, bad default, or design flaw in the skill | GitHub issue |
| **both** | A generic pattern that was observed through a project-specific symptom | Both |

When in doubt, classify as **both**. It's better to have a slightly noisy GitHub issue than to lose a generic insight.

---

## Phase 4 — Local Learnings

Write to `{repo_root}/.shipguard/learnings.yaml`. Create the `.shipguard/` directory if it doesn't exist.

### Schema (v2)

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
    files: 2574
    bugs_found: 79
    bugs_fixed: 77
    critical: 9
    overflow_rate: 0.23
    wall_clock_minutes: 90
```

### Update Rules

1. **Read first.** If the file exists, load it entirely before making changes.
2. **Merge, don't overwrite.** Match entries by `path` (zone_hints), `service` (infra_hints), `pattern` (audit/noise/success). If a match exists, update `last_seen`, increment `occurrences`, and update `note` if the new observation adds information.
3. **Append new entries** for signals not already present.
4. **Prune session_history** to the last 10 entries.
5. **Never delete** zone_hints, audit_hints, or success_patterns — the user prunes manually. If an old hint seems stale (last_seen > 90 days), add a `possibly_stale: true` flag instead of removing it.
6. **Preserve comments and manual edits.** Read the file as text, parse YAML, modify in memory, write back. If the file has comments that don't parse, preserve them as-is at the top.

---

## Phase 5 — GitHub Issue

### Pre-flight

1. Check `gh auth status` — if not authenticated, skip this phase with a message: "GitHub CLI not authenticated. Run `gh auth login` to enable issue filing. Local learnings saved."
2. Detect the repo: read `origin` remote URL from the ShipGuard plugin installation directory. Fallback: `bacoco/ShipGuard`.

### Deduplication

Before creating a new issue, check for existing ones:

```bash
gh issue list --repo bacoco/ShipGuard --state open --label improvement --limit 30 --json number,title,body
```

For each insight you want to file:
1. Extract keywords from the insight title (e.g., "context overflow", "retry backoff", "syntax validation")
2. Search existing issue titles and bodies for those keywords
3. **If a matching open issue exists:** add a comment with the new data point instead of creating a duplicate. Format: `### New data point ({repo_name}, {date})\n{details}`
4. **If no match:** create a new issue

This is important because multiple users running `/sg-improve` on different projects will generate similar insights. Commenting on existing issues builds evidence ("3 users hit this") rather than fragmenting it across duplicates.

### Issue Format

```markdown
## Session Insights — {repo_name} ({date})

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
*Filed by `/sg-improve` from {repo_name}*
```

### Labels

Always add `improvement`. Then add skill-specific labels based on content:
- `sg-code-audit` — zone sizing, agent prompts, merge logic
- `sg-visual-run` — browser execution, auth, screenshots
- `sg-visual-review` — dashboard, report generation
- `dx` — developer experience, UX friction, confusing output
- `bug` — a skill instruction that produced incorrect behavior (not just suboptimal)

---

## Phase 6 — Summary

Display a concise report:

```
/sg-improve complete

Local (.shipguard/learnings.yaml):
  + {N} zone hints (max_files constraints for next audit)
  + {M} audit hints (codebase-specific patterns to check)
  + {K} noise filters (low-value patterns to batch)
  + {S} success patterns (what to keep)
  Session #{H} recorded

GitHub:
  {IF new issue} Created bacoco/ShipGuard#{number} — "{title}"
  {IF commented} Updated bacoco/ShipGuard#{number} with new data point
  {IF skipped} Skipped (--local-only or gh not authenticated)

Next /sg-code-audit on this repo will:
  - Cap {path} zones at {max_files} files
  - Add {N} project-specific patterns to agent checklists
  - Batch {K} noise patterns into summary entries
```

---

## Edge Cases

### No audit-results.json found
The skill can still extract signals from conversation history (retries, errors, timing). Local learnings will be thinner but still useful. Log: "No audit artifacts found — using conversation context only."

### First run (no existing learnings.yaml)
Create the file from scratch. All signals become new entries. session_history starts with one entry.

### User ran /sg-improve twice in the same session
The second run should detect that session_history already has an entry for today. Update it rather than appending a duplicate.

### gh CLI not installed or not authenticated
Skip Phase 5 entirely. Print the issue body to the terminal so the user can file it manually if they want.

### The conversation is very long (>100K tokens)
Don't try to re-read the entire conversation. Focus on:
1. The structured data from Phase 1 (audit-results.json, zone JSONs)
2. The last 20 messages in the conversation (most recent friction)
3. Any messages containing error keywords (grep-style scan)

### No ShipGuard skills were used this session
If the conversation doesn't contain evidence of `/sg-code-audit`, `/sg-visual-run`, or `/sg-visual-review` usage, ask the user what they want to capture: "I don't see a ShipGuard session in this conversation. What would you like me to analyze?"

---

## Phase 4b — Mistakes File (Coding Memory)

In addition to `learnings.yaml` (machine-readable, audit-focused), maintain a **human-readable mistakes file** that Claude reads at every coding session — not just during audits.

Write to `{repo_root}/.shipguard/mistakes.md`. This file is referenced from the project's `CLAUDE.md` so that Claude Code loads it at session start.

### Format

```markdown
# Erreurs à ne pas répéter

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

### What goes in mistakes.md

Only **real bugs found in THIS project** — not generic best practices. Each entry must have:
1. A bad pattern (code that was actually written and caused a bug)
2. The fix (what it should have been)
3. Context (which files, how many instances, what broke)

### Update Rules

1. Read the existing file first — don't overwrite
2. For each `critical` or `high` severity bug from the audit:
   - Check if a similar pattern already exists in mistakes.md
   - If yes: update the instance count and add the new file to the context
   - If no: add a new entry under the appropriate language section
3. Don't add `low` severity bugs (too noisy for a coding reference)
4. Keep entries concise — one screen of code max per entry
5. Add a "last updated" date at the bottom

### How it's consumed

The project's `CLAUDE.md` should reference this file:
```markdown
## Erreurs Recurrentes
**Cahier d'erreurs complet : `.shipguard/mistakes.md`** — LIRE ce fichier au debut de chaque session.
```

This means every Claude Code session — not just audits — benefits from accumulated knowledge. When a developer asks Claude to write a new hook, Claude already knows "don't use `|| []` in Zustand selectors" because it read mistakes.md at session start.

---

## How sg-code-audit Consumes Learnings

For the feedback loop to work, `/sg-code-audit` must read `.shipguard/learnings.yaml` at startup. Here's the integration point (to be added to sg-code-audit Phase 3 — Discover Zones):

```
If {repo_root}/.shipguard/learnings.yaml exists:
  1. Read the file
  2. zone_hints: during zone splitting, if a directory matches a hint's path,
     cap that zone at hint.max_files (override the default 30/80 thresholds)
  3. audit_hints: append each pattern to the language-specific checklist
     in the agent prompt, with its severity and note
  4. noise_filters: for patterns with action "batch", add to the agent prompt:
     "For {pattern}: report ONE summary entry with total count, not individual bugs"
  5. success_patterns: no action needed — these are for /sg-improve's reference only
  6. Print: "Loaded {N} learnings from .shipguard/learnings.yaml"
```

This creates the reinforcement loop:
```
Audit 1: hooks overflow at 172 files → /sg-improve saves max_files: 80
Audit 2: sg-code-audit reads hint → splits hooks into 2 zones → no overflow ✓

Audit 1: .first() crashes found 5 times → /sg-improve saves audit_hint
Audit 2: agents see the pattern in their checklist → catch it on first scan ✓

Audit 1: f-string loggers = 13% of findings → /sg-improve saves noise_filter
Audit 2: agents batch into "42 f-string calls in 12 files" → cleaner report ✓
```

---

## Final Checklist

- [ ] **Snapshot taken BEFORE any modification** (Phase 0)
- [ ] audit-results.json read (if exists)
- [ ] Zone JSONs scanned for overflow indicators
- [ ] Git log checked for audit commits and reverts
- [ ] Conversation scanned for error/performance/quality/success signals
- [ ] Each signal classified (project-specific / generic / both)
- [ ] `.shipguard/learnings.yaml` created or merged (unless `--github-only`)
- [ ] `.shipguard/mistakes.md` updated with critical/high bug patterns (unless `--github-only`)
- [ ] Existing GitHub issues checked for duplicates (unless `--local-only`)
- [ ] GitHub issue created or existing issue commented (unless `--local-only`)
- [ ] Summary displayed with concrete "next run will..." predictions
