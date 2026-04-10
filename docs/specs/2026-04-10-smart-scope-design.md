# ShipGuard Smart Scope — Design Spec

**Date:** 2026-04-10
**Status:** Approved

## Overview

Add unified "smart scope" to the 3 main ShipGuard skills: `sg-code-audit`, `sg-visual-run`, `sg-visual-discover`. When invoked without arguments, each skill auto-detects what changed (via git diff), proposes the scope to the user, and operates on just the impacted files/routes instead of the full codebase.

## Motivation

Every audit, test run, and discovery scan currently operates on the entire codebase. For a typical PR touching 5 files out of 300, this wastes ~95% of tokens and time. Smart scope makes ShipGuard viable for CI/CD integration and daily developer workflow.

## Behavior

### Scope Detection

When any of the 3 skills is invoked **without `--all` or `--diff=<ref>`**, it:

1. **Detects the base reference automatically** (see algorithm below)

2. **Runs `git diff --name-only {base}` to get modified files**

3. **Proposes the scope** to the user (per-skill — see below)

### Base Detection Algorithm

One rule, no ambiguity:

```
function detectBase():
  current_branch = git rev-parse --abbrev-ref HEAD

  if current_branch != "main" AND current_branch != "master":
    # Feature branch — use merge-base with main/master
    if branch "main" exists:
      return $(git merge-base HEAD main)
    elif branch "master" exists:
      return $(git merge-base HEAD master)
    else:
      return "HEAD~1"  # no main/master, fallback

  else:
    # On main/master — last commit
    return "HEAD~1"
```

`--diff=<ref>` overrides everything. No other detection logic.

**If the diff is empty** (0 files changed vs base):
> "No diff vs `{base}`. Audit the last commit `{sha}: {message}`?"
>
> 1. **Last commit** — {N} files changed
> 2. **Full codebase**
> 3. **Different base** — specify a branch or commit

Note: "No diff vs {base}" is correct wording — the branch may have commits but they were already merged. "No uncommitted changes" would be wrong on a clean branch with commits.

### Flags (Override)

All 3 skills accept the same flags:

| Flag | Behavior |
|------|----------|
| (no flag) | Interactive — auto-detect + ask user |
| `--all` | Skip the question, run on full codebase |
| `--diff=<ref>` | Skip the question, use specified base reference |

### Flag Combination Rules

| Combination | Result |
|-------------|--------|
| `--all` alone | Full codebase |
| `--diff=<ref>` alone | Diff against ref |
| `--all` + `--diff=<ref>` | **Invalid.** Error: "Cannot use --all and --diff together." |
| `--diff=<ref>` + `--from-audit` | **--from-audit wins.** Smart scope is ignored when --from-audit is present (it has its own scope from audit-results.json). |
| `--diff=<ref>` + `--focus=path/` | **Both apply.** Diff files are filtered to only those within focus path. |
| `--all` + `--focus=path/` | Full codebase filtered to focus path (existing behavior). |
| `sg-visual-discover <project-path>` + `--diff=<ref>` | Discover within project-path, but only generate manifests for routes impacted by the diff. |
| `--diff=<ref>` + `--regressions` | Diff-scoped tests + regressions (regressions always included). |

### Import Graph Expansion (1 Level) — sg-code-audit only

For `sg-code-audit` in diff mode, the scope is not just the modified files — it includes their **direct importers** (files that import a modified file). This catches bugs in callers that may break due to the change.

Detection method:
```bash
# For each modified file, find who imports it
# Use the full relative path (not just filename stem) to avoid over-matching
grep -rl "from.*['\"].*{relative_path_without_ext}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" .
grep -rl "require(.*{relative_path_without_ext}" --include="*.js" --include="*.ts" .
```

**Important: best-effort, not exact.** This grep approach:
- Uses the relative path (e.g. `hooks/use-dossier`) not just the filename stem (`use-dossier`) to reduce false matches
- Will still over-match on common names (`index`, `utils`, `types`) — deduplicate results
- Does NOT resolve TypeScript path aliases or webpack resolve aliases
- If the expansion produces more than 3x the original file count, warn the user and offer "modified files only" as fallback

The expanded file list is reported to the user:
> "12 files modified + 16 importers = 28 files to audit"

If expansion is too noisy:
> "12 files modified. Import expansion found 85 importers (noisy). Run on modified files only, or include importers?"

## Per-Skill Behavior

### sg-code-audit

1. Parse `--all` / `--diff=<ref>` flags (reject if both present)
2. If neither present → run scope detection + ask user:
   > "I detected {N} files changed since `{base}`. What scope?"
   >
   > 1. **Only what changed** — {N} files + their importers (~{M} files total)
   > 2. **Full codebase** — everything
   > 3. **Different base** — specify a branch or commit
3. If "only what changed" → git diff + import expansion → file list
4. **Zone discovery on sparse file list:** the scoped files may span many directories. Instead of the normal directory-based zone discovery, group files by their nearest common parent directory. If all scoped files fit in one zone (≤30 files), use a single agent. Otherwise, apply the normal split rules on the parent directories that contain scoped files.
5. Agent prompt includes: "These files were recently modified: {list}. Their direct importers are also included. Pay special attention to changes that may have introduced bugs."
6. `audit-results.json` includes scope info (see schema below)

### sg-visual-run

Smart scope **enhances** the existing interactive menu, not replaces it.

Current interactive menu (no arguments):
> "What do you want to test?"
> 1. Only what changed
> 2. Only regressions
> 3. Full suite
> 4. (Other)

Smart scope changes: when the user picks **"Only what changed"**, the skill now runs the git diff + route detection logic instead of just checking `git diff` for modified files. The rest of the menu stays identical.

Detailed flow:
1. Parse `--all` / `--diff=<ref>` flags
2. If `--all` → full suite, skip menu
3. If `--diff=<ref>` → use that ref for "only what changed" logic, skip menu
4. If no flags AND no other arguments → show the existing 4-option menu
5. If user picks "Only what changed":
   a. Detect base ref (auto or from --diff)
   b. Git diff → modified files → route detection → match to YAML manifests
   c. Include regressions from `_regressions.yaml` (always)
   d. If no manifest matches a changed route → log "uncovered route: {route}"
6. Existing modes (natural language, --from-audit, --regressions) work unchanged

### sg-visual-discover

1. Parse `--all` / `--diff=<ref>` flags
2. If neither present → run scope detection + ask user:
   > "I detected {N} files changed since `{base}`, impacting {R} routes. What scope?"
   >
   > 1. **Only impacted routes** — generate manifests for {R} new routes
   > 2. **Full app** — discover all routes
   > 3. **Different base**
3. If "only impacted routes" → git diff → route detection → identify impacted routes
4. **Skip existing manifests.** If a route already has a manifest, do NOT update or overwrite it. Only generate manifests for routes that have NO existing manifest.
5. If the user wants to refresh existing manifests, they must use `--refresh-existing` explicitly.
6. Report: "Created 2 new manifests. Skipped 3 routes (manifests already exist). 0 uncovered routes."

The `--refresh-existing` flag:
- Only applies in diff mode (not full discovery)
- Re-scans the route's components and regenerates the manifest
- Existing manifest is overwritten (but recoverable via git)
- Warn: "This will overwrite {N} existing manifests. Continue?"

## Output Schema Changes

### audit-results.json — new `scope_info` object

```json
{
  "scope_info": {
    "mode": "diff",
    "base_ref": "main",
    "base_sha": "abc1234",
    "diff_files": 12,
    "importer_files": 16,
    "total_in_scope": 28
  },
  ...existing fields unchanged...
}
```

When scope is full: `"scope_info": {"mode": "full"}`. No other fields.

This avoids collision with the existing `summary.files_modified` field (which means "files the audit fixed", not "files in the diff").

## Edge Cases

1. **Binary files in diff** — skip them (images, fonts, compiled assets)
2. **Deleted files in diff** — include their importers (callers may break)
3. **Renamed files** — treat as modified (new path) + deleted (old path)
4. **Merge commits** — merge-base handles this correctly (that's why we use merge-base, not direct diff)
5. **Uncommitted changes** — included via `git diff HEAD` (staged + unstaged)
6. **No git repo** — skip smart scope, fall back to full codebase with warning
7. **Huge diff (100+ files)** — still propose "only what changed" but warn: "Large diff (142 files). Consider --all for a full audit."
8. **Import expansion too noisy (>3x file count)** — offer fallback to modified files only

## What This Does NOT Change

- Existing `--focus=path/` flag works unchanged (manual scope override)
- `--from-audit` mode works unchanged (reads audit-results.json, ignores --diff)
- `--report-only` works unchanged
- Mode selection (quick/standard/deep/paranoid) works unchanged
- The scope question is asked ONCE at the beginning, not per-round in multi-round mode
- sg-visual-run's 4-option interactive menu is preserved — smart scope enhances "only what changed", not replaces the menu

## Out of Scope

- AST-based import resolution (v2)
- Multi-level import expansion (only 1 level in v1)
- TypeScript path alias resolution
- Automatic CI/CD integration (separate feature)
- Confidence scores on findings (separate feature)
