# ShipGuard Smart Scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add git-diff-based smart scope to sg-code-audit, sg-visual-run, and sg-visual-discover so they operate on changed files instead of the full codebase.

**Architecture:** Each skill gets new flag parsing (`--all`, `--diff=<ref>`), a shared base detection algorithm, and scope-aware logic inserted before the existing pipeline. No shared code — each SKILL.md is self-contained. Communication via `scope_info` field in audit-results.json.

**Tech Stack:** Claude Code skills (SKILL.md markdown), git CLI, grep for import detection

**Spec:** `docs/specs/2026-04-10-smart-scope-design.md`

---

## File Structure

```
plugins/shipguard/skills/
  sg-code-audit/
    SKILL.md           ← MODIFY: add --all/--diff flags, base detection, import expansion,
                          sparse zone discovery, scope_info in audit-results.json
  sg-visual-run/
    SKILL.md           ← MODIFY: add --all/--diff flags, enhance "Only what changed"
                          with git diff + route detection
  sg-visual-discover/
    SKILL.md           ← MODIFY: add --all/--diff/--refresh-existing flags,
                          diff-scoped manifest generation
plugins/shipguard/
  README.md            ← MODIFY: document new flags
README.md              ← MODIFY: mention smart scope in the flow section
```

---

### Task 1: Add smart scope to sg-code-audit

**Files:**
- Modify: `plugins/shipguard/skills/sg-code-audit/SKILL.md`

- [ ] **Step 1: Update frontmatter argument-hint**

Change line 5 from:
```
argument-hint: "[quick|standard|deep|paranoid] [--focus=path] [--report-only]"
```
to:
```
argument-hint: "[quick|standard|deep|paranoid] [--focus=path] [--report-only] [--all] [--diff=ref]"
```

- [ ] **Step 2: Update invocations table**

Add 3 rows to the existing invocations table (after the last row):

```markdown
| `/sg-code-audit --diff=main` | Audit only files changed since `main` + their importers |
| `/sg-code-audit --all` | Force full codebase audit (skip scope question) |
| `/sg-code-audit quick --diff=feature-branch` | Combine mode with diff scope |
```

- [ ] **Step 3: Insert smart scope parsing in Phase 1**

After the existing step 3 (`--report-only` check) and before step 4 (mode table), insert new steps:

```markdown
4. Parse scope flags:
   - Check for `--all` flag. If present, set `scope_mode = "full"`.
   - Check for `--diff=<ref>` flag. If present, set `scope_mode = "diff"`, `scope_ref = <ref>`.
   - If BOTH `--all` and `--diff` are present: **error.** Print "Cannot use --all and --diff together." and stop.
   - If neither is present, set `scope_mode = "interactive"`.

5. If `scope_mode == "interactive"`:
   a. Detect base reference:
      ```bash
      current_branch=$(git rev-parse --abbrev-ref HEAD)
      if [ "$current_branch" != "main" ] && [ "$current_branch" != "master" ]; then
        # Feature branch — merge-base with main/master
        if git show-ref --verify --quiet refs/heads/main; then
          base=$(git merge-base HEAD main)
        elif git show-ref --verify --quiet refs/heads/master; then
          base=$(git merge-base HEAD master)
        else
          base="HEAD~1"
        fi
      else
        base="HEAD~1"
      fi
      ```
   b. Run `git diff --name-only {base}` to get changed files.
   c. If diff is NOT empty ({N} files changed):
      Ask user via AskUserQuestion:
      > "I detected {N} files changed since `{base}`. What scope?"
      > 1. **Only what changed** — {N} files + their importers
      > 2. **Full codebase** — everything
      > 3. **Different base** — specify a branch or commit
      If user picks 1 → set `scope_mode = "diff"`, `scope_ref = {base}`
      If user picks 2 → set `scope_mode = "full"`
      If user picks 3 → ask for ref, set `scope_mode = "diff"`, `scope_ref = <user input>`
   d. If diff IS empty (0 files):
      Get last commit: `git log --oneline -1`
      Ask user:
      > "No diff vs `{base}`. Audit the last commit `{sha}: {message}`?"
      > 1. **Last commit** — {N} files changed
      > 2. **Full codebase**
      > 3. **Different base**
      If user picks 1 → set `scope_mode = "diff"`, `scope_ref = "HEAD~1"`
      If user picks 2 → set `scope_mode = "full"`
      If user picks 3 → ask for ref

6. If `scope_mode == "diff"`:
   a. Get changed files: `git diff --name-only {scope_ref}` → store as `diff_files[]`
   b. Filter out binary files (images, fonts, compiled assets): keep only `*.py`, `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.go`, `*.rs`, `*.java`, `*.kt`, `*.yaml`, `*.yml`, `Dockerfile*`
   c. For each changed source file, find direct importers (1 level):
      ```bash
      grep -rl "from.*['\"].*{relative_path_without_ext}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" .
      grep -rl "require(.*{relative_path_without_ext}" --include="*.js" --include="*.ts" .
      ```
      Use the relative path (e.g. `hooks/use-dossier`) NOT just the filename stem to reduce false matches.
      Deduplicate results.
   d. Combine: `scope_files = diff_files + importer_files` (deduplicated)
   e. If `importer_files` count > 3x `diff_files` count:
      Warn user: "{N} files modified. Import expansion found {M} importers (noisy). Run on modified files only, or include importers?"
      If user picks "modified only" → `scope_files = diff_files`
   f. Print: "{diff_count} files modified + {importer_count} importers = {total} files to audit"
   g. Store `scope_files`, `diff_files`, `importer_files` for zone discovery.
```

Renumber the existing steps 4-7 to 7-10.

- [ ] **Step 4: Modify Phase 3 — zone discovery for sparse file list**

After the existing Phase 3 introduction ("Split the codebase into non-overlapping zones..."), insert a conditional:

```markdown
**If `scope_mode == "diff"`:**

Zone discovery operates on the `scope_files` list instead of the full repo. Since these files may be scattered across many directories, use a simplified zone strategy:

1. Group `scope_files` by their parent directory (first 2 path segments, e.g. `src/routes/` or `apps/api-synthesia/`)
2. Each group becomes a zone candidate
3. If a group has ≤30 files → 1 zone
4. If a group has >30 files → split by subdirectory (same rules as full mode)
5. Merge groups with <5 files into their nearest neighbor
6. Cap to `agent_count` (same merge/split logic as full mode)

Print: "Scoped zone discovery: {zone_count} zones from {file_count} files (diff mode)"

**If `scope_mode == "full"`:**

Use the existing zone discovery algorithm (unchanged).
```

- [ ] **Step 5: Add scope_info to audit-results.json schema**

In Phase 6, Step 2 (Build audit-results.json), add a new field to the JSON schema, right after `"agents":`:

```json
  "scope_info": {
    "mode": "diff",
    "base_ref": "main",
    "base_sha": "<full SHA of base>",
    "diff_files": 12,
    "importer_files": 16,
    "total_in_scope": 28
  },
```

Add the note:
```markdown
When `scope_mode == "full"`: `"scope_info": {"mode": "full"}` — no other fields.
When `scope_mode == "diff"`: include all fields above.
```

- [ ] **Step 6: Update the Phase 1 summary print**

Change step 10 (was step 7) print format to include scope:

```markdown
Print to user: `Code audit: {mode} mode ({agent_count} agents, {round_count} round(s)){", focus: " + focus_path if set}{", report-only" if not fix_mode}{", scope: diff vs " + scope_ref + " (" + total_in_scope + " files)" if scope_mode == "diff"}`
```

- [ ] **Step 7: Commit**

```bash
git add plugins/shipguard/skills/sg-code-audit/SKILL.md
git commit -m "feat: add smart scope (--all/--diff) to sg-code-audit"
```

---

### Task 2: Enhance sg-visual-run with smart scope

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-run/SKILL.md`

- [ ] **Step 1: Update frontmatter argument-hint**

Change line 5 from:
```
argument-hint: "[tests to run or natural language description]"
```
to:
```
argument-hint: "[tests to run or natural language description] [--all] [--diff=ref]"
```

- [ ] **Step 2: Update invocations table**

Add 2 rows:
```markdown
| `/sg-visual-run --diff=main` | Run tests for routes impacted by changes since `main` |
| `/sg-visual-run --all` | Force full suite (skip scope question) |
```

- [ ] **Step 3: Add flag parsing before Interactive Mode**

Insert a new section "## Flag Parsing" before the "### Interactive Mode" section:

```markdown
## Flag Parsing

Before entering any mode, check for scope override flags:

1. Check for `--all` flag. If present → run full suite, skip interactive menu.
2. Check for `--diff=<ref>` flag. If present → use that ref for "only what changed" logic, skip interactive menu.
3. If BOTH `--all` and `--diff` are present → error: "Cannot use --all and --diff together."
4. `--from-audit` takes priority over `--diff`: if both present, `--from-audit` wins (it has its own scope from audit-results.json).
5. If no scope flags → proceed to Interactive Mode or Natural Language Mode as before.
```

- [ ] **Step 4: Enhance "Only what changed" in Interactive Mode**

Replace the current "Only what changed" logic (lines ~32-33) with:

```markdown
If the user picks "Only what changed":
1. Detect base reference (same algorithm as sg-code-audit):
   ```bash
   current_branch=$(git rev-parse --abbrev-ref HEAD)
   if [ "$current_branch" != "main" ] && [ "$current_branch" != "master" ]; then
     base=$(git merge-base HEAD main || git merge-base HEAD master || echo "HEAD~1")
   else
     base="HEAD~1"
   fi
   ```
2. Run `git diff --name-only {base}` → modified files list
3. If 0 files changed: ask "No diff vs {base}. Use last commit?" (same logic as sg-code-audit)
4. Map modified files to routes (same framework-specific route detection as sg-code-audit Phase 6 Step 3)
5. Match routes to YAML manifests (glob `visual-tests/**/*.yaml`, match `url` field)
6. If no manifest matches a route → log "uncovered route: {route}"
7. Include regressions from `_regressions.yaml` (always)
8. Print: "Running {N} tests for {R} impacted routes (diff vs {base}) + {reg} regressions"
```

- [ ] **Step 5: Update Build Execution List**

Change the existing Build Execution List to add the diff mode as step 2:

```markdown
Collect manifests to run:

1. **If `--from-audit`**: follow the From-Audit Mode flow
2. **If `--diff=<ref>` or user picked "Only what changed"**: git diff → route detection → match manifests (see Enhanced "Only what changed" above)
3. **If natural language provided**: analyze intent, match manifests, generate missing ones
4. **If `--regressions`**: only from `_regressions.yaml`, ordered by `last_failed` descending
5. **If `--all` or user picked "Full suite"**: all manifests, regressions first, then by priority
6. **Always skip** manifests with `deprecated: true`
7. **Regressions among matched tests always run first** (except in `--from-audit` mode, where severity order takes precedence)
```

- [ ] **Step 6: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-run/SKILL.md
git commit -m "feat: add smart scope (--all/--diff) to sg-visual-run"
```

---

### Task 3: Add smart scope to sg-visual-discover

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-discover/SKILL.md`

- [ ] **Step 1: Update frontmatter argument-hint**

Change:
```
argument-hint: "[project-path]"
```
to:
```
argument-hint: "[project-path] [--all] [--diff=ref] [--refresh-existing]"
```

- [ ] **Step 2: Add invocations table**

The skill currently has no invocations table. Add one after the overview paragraph:

```markdown
## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-visual-discover` | **Interactive** — detect changes, ask scope |
| `/sg-visual-discover <path>` | Discover routes in specific project path |
| `/sg-visual-discover --diff=main` | Generate manifests only for routes impacted by changes since `main` |
| `/sg-visual-discover --all` | Discover all routes (skip scope question) |
| `/sg-visual-discover --refresh-existing` | In diff mode, also regenerate existing manifests for impacted routes |
```

- [ ] **Step 3: Add scope detection before Phase 1**

Insert a new section "## Scope Detection" before the existing "## Phase 1: Detect Project Structure":

```markdown
## Scope Detection

Before scanning the project, determine scope:

1. Check for `--all` flag → skip to Phase 1 with full scope.
2. Check for `--diff=<ref>` flag → use that ref.
3. If BOTH `--all` and `--diff` → error: "Cannot use --all and --diff together."
4. If neither flag:
   a. Detect base reference:
      ```bash
      current_branch=$(git rev-parse --abbrev-ref HEAD)
      if [ "$current_branch" != "main" ] && [ "$current_branch" != "master" ]; then
        base=$(git merge-base HEAD main || git merge-base HEAD master || echo "HEAD~1")
      else
        base="HEAD~1"
      fi
      ```
   b. Run `git diff --name-only {base}` → changed files
   c. If changes detected, map to routes (same route detection as sg-code-audit)
   d. Ask user:
      > "I detected {N} files changed since `{base}`, impacting {R} routes. What scope?"
      > 1. **Only impacted routes** — generate manifests for new routes only
      > 2. **Full app** — discover all routes
      > 3. **Different base**
   e. If no changes: offer last commit or full app (same as sg-code-audit)

5. Store `scope_mode` ("diff" or "full") and `impacted_routes[]` for Phase 4.
```

- [ ] **Step 4: Modify manifest generation rules**

In section 4.2 "Manifest Generation Rules", replace the existing rules with:

```markdown
For each discovered route:

1. **If `scope_mode == "diff"` AND route is NOT in `impacted_routes`** → SKIP (not impacted by changes)
2. **If a manifest already exists AND `--refresh-existing` is NOT set** → SKIP (never overwrite without explicit flag)
3. **If a manifest already exists AND `--refresh-existing` IS set** → REGENERATE (re-scan route components, overwrite manifest). Warn: "Refreshing {N} existing manifests."
4. **If no manifest exists** → CREATE new manifest

Report:
- `scope_mode == "diff"`: "Created {N} new manifests. Skipped {S} routes (manifests exist). {U} uncovered routes (no component match)."
- `scope_mode == "full"`: "Created {N} new manifests. Skipped {S} routes (manifests exist). {D} routes deprecated."
```

- [ ] **Step 5: Add `--diff` + `<project-path>` combination note**

In the Scope Detection section, add:

```markdown
**Flag combination:** `sg-visual-discover <project-path> --diff=<ref>`
Both apply: discover within project-path, but only generate manifests for routes impacted by the diff. The diff is still computed on the whole repo, but only routes within project-path are considered.
```

- [ ] **Step 6: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-discover/SKILL.md
git commit -m "feat: add smart scope (--all/--diff/--refresh-existing) to sg-visual-discover"
```

---

### Task 4: Update documentation

**Files:**
- Modify: `plugins/shipguard/README.md`
- Modify: `README.md` (root)

- [ ] **Step 1: Update plugin README — add Smart Scope section**

After the "sg-code-audit" section, add:

```markdown
### Smart Scope (all skills)

By default, skills detect what changed and propose a focused scope:

```
/sg-code-audit              # Asks: "12 files changed since main. Only what changed?"
/sg-visual-run              # Asks: "What do you want to test? Only what changed / Regressions / Full suite"
/sg-visual-discover         # Asks: "5 routes impacted. Generate manifests for new routes only?"
```

Override with flags:

| Flag | Effect |
|------|--------|
| `--all` | Force full scope (skip question) |
| `--diff=<ref>` | Use specific base reference |
| `--refresh-existing` | (discover only) Regenerate existing manifests |
```

- [ ] **Step 2: Update plugin README — add flags to each skill section**

In the sg-code-audit section, add `--all`, `--diff=<ref>` to the flags list.
In the sg-visual-run section, mention `--all`, `--diff=<ref>`.
In the sg-visual-discover section, mention `--all`, `--diff=<ref>`, `--refresh-existing`.

- [ ] **Step 3: Update root README — mention smart scope in the flow**

In the "The flow" section, update Step 1:

```markdown
### Step 1 -- Find the bugs

```
/sg-code-audit
```

ShipGuard detects what changed since your base branch and proposes a focused audit. Parallel agents scan the impacted files and their direct importers. Each bug is classified by severity and category. Fixes are applied automatically in isolated git worktrees.
```

- [ ] **Step 4: Commit**

```bash
git add plugins/shipguard/README.md README.md
git commit -m "docs: document smart scope flags in README"
```

---

### Task 5: End-to-end verification

**Files:**
- No files created — manual verification

- [ ] **Step 1: Verify sg-code-audit smart scope instructions**

Read `plugins/shipguard/skills/sg-code-audit/SKILL.md` end to end. Verify:
- `--all` and `--diff` flags are in argument-hint and invocations table
- Phase 1 has the full base detection algorithm with merge-base
- Import expansion uses relative paths (not filename stems)
- Noisy expansion fallback (>3x) is documented
- Sparse zone discovery for diff mode is documented
- `scope_info` field is in audit-results.json schema
- `--all` + `--diff` combination is explicitly rejected
- `--diff` + `--focus` combination is documented (both apply)
- `--diff` + `--from-audit` → from-audit wins (documented somewhere)

- [ ] **Step 2: Verify sg-visual-run smart scope instructions**

Read `plugins/shipguard/skills/sg-visual-run/SKILL.md` end to end. Verify:
- `--all` and `--diff` flags are in argument-hint and invocations table
- Flag parsing section exists before Interactive Mode
- "Only what changed" uses git diff + route detection (not just git diff for files)
- Regressions are always included
- Build Execution List has diff mode as step 2
- Interactive menu still has all 4 original options
- `--from-audit` takes priority over `--diff`

- [ ] **Step 3: Verify sg-visual-discover smart scope instructions**

Read `plugins/shipguard/skills/sg-visual-discover/SKILL.md` end to end. Verify:
- `--all`, `--diff`, `--refresh-existing` flags in argument-hint
- Invocations table exists
- Scope Detection section before Phase 1
- Manifest rules: skip existing by default, refresh only with --refresh-existing
- `<project-path>` + `--diff` combination documented
- Report format covers both diff and full modes

- [ ] **Step 4: Cross-reference check**

Grep all 3 SKILL.md files for consistency:
```bash
# Base detection algorithm should be identical in all 3
grep -n "merge-base" plugins/shipguard/skills/sg-*/SKILL.md

# Flag names should be consistent
grep -n "\\-\\-all\|\\-\\-diff\|\\-\\-refresh" plugins/shipguard/skills/sg-*/SKILL.md
```

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end verification"
```
