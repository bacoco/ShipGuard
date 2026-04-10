---
name: sg-code-audit
description: Parallel AI codebase audit — dispatches agents to find and fix bugs across the entire repo. Produces structured JSON results viewable in /sg-visual-review. Trigger on "sg-code-audit", "code audit", "audit codebase", "find bugs", "code-audit", "audit code", "static audit", "security audit", "ship guard".
context: conversation
argument-hint: "[quick|standard|deep|paranoid] [--focus=path] [--report-only] [--all] [--diff=ref]"
---

# /sg-code-audit — Parallel Codebase Audit

Dispatch parallel AI agents to audit every file in your repo. Each agent reviews a non-overlapping zone, finds bugs, fixes them, and produces structured JSON. Results appear in the `/sg-visual-review` dashboard under a "Code Audit" tab.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-code-audit` | **Standard** mode — 10 agents, 1 round, fix bugs |
| `/sg-code-audit quick` | 5 agents, 1 round, surface scan only |
| `/sg-code-audit deep` | 15 agents, 2 rounds (surface + depth) |
| `/sg-code-audit paranoid` | 20 agents, 3 rounds (surface + depth + edge cases) |
| `/sg-code-audit --focus=path/` | Restrict audit scope to a directory |
| `/sg-code-audit --report-only` | Find bugs but do NOT fix them |
| `/sg-code-audit deep --focus=src/ --report-only` | Combine flags freely |
| `/sg-code-audit --diff=main` | Audit only files changed since `main` + their importers |
| `/sg-code-audit --all` | Force full codebase audit (skip scope question) |
| `/sg-code-audit quick --diff=feature-branch` | Combine mode with diff scope |

---

## Phase 0 — Monitor Setup

Detect or start the review server for real-time audit monitoring. This is optional — if the user declines or the server can't start, the audit proceeds normally.

### Step 1: Check for existing server

```bash
curl -s --max-time 2 http://localhost:8888/health
```

- **200 OK:** Parse the response JSON. Compare `results_dir` against the current project's `results_dir`.
  - If they match → set `monitor_active = true`, `monitor_url = "http://localhost:8888"`. Print: `Monitor: connected to existing server.`
  - If they differ → another project's server is running. Try ports 8889, 8890 with `--port=` (same health check + results_dir comparison). If none match, treat as "not running" and pick the first free port for Step 2.
- **Connection refused / timeout:** Server not running. Go to Step 2.

### Step 2: Ask user

If no matching server found:

> "Voulez-vous suivre l'avancement de l'audit en temps réel dans un tableau de bord ? (oui/non)"

- **oui:**
  1. Check if `visual-tests/build-review.mjs` exists. If not, bootstrap from the plugin directory:
     ```bash
     mkdir -p visual-tests/_results/screenshots
     if [ -f ~/.claude/plugins/shipguard/skills/sg-visual-review/build-review.mjs ]; then
       cp ~/.claude/plugins/shipguard/skills/sg-visual-review/build-review.mjs visual-tests/
       cp ~/.claude/plugins/shipguard/skills/sg-visual-review/_review-template.html visual-tests/
     else
       echo "Plugin files not found — skipping bootstrap"
     fi
     ```
     Also create a minimal `visual-tests/_config.yaml` if it doesn't exist (required by the build script):
     ```bash
     cat > visual-tests/_config.yaml << 'EOF'
     base_url: http://localhost:3000
     EOF
     ```
  2. Pick port: use 8888 if free, otherwise the first free port found in Step 1.
  3. Start server:
     ```bash
     node visual-tests/build-review.mjs --serve --port={port}
     ```
  4. Wait for health check (retry 3x, 1s apart):
     ```bash
     curl -s --max-time 2 http://localhost:{port}/health
     ```
  5. If healthy → `monitor_active = true`, `monitor_url = "http://localhost:{port}"`. Print: `Monitor: server started at http://localhost:{port}`
  6. If not → `monitor_active = false`. Print: `Monitor: server failed to start — proceeding without monitoring.`
- **non:** Set `monitor_active = false`.

### Step 3: Store monitor state

Store `monitor_active` (boolean) and `monitor_url` (string) as working variables for subsequent phases.

---

## Phase 1 — Parse Arguments

Parse the user's input into four values: **mode**, **focus**, **fix_mode**, and **scope**.

1. Extract the first positional argument (after the command name). Match against `quick`, `standard`, `deep`, `paranoid`. Default: `standard`.
2. Extract `--focus=<path>` flag. If present, store the path. If not, scope is the entire repo.
3. Check for `--report-only` flag. If present, set `fix_mode = false`. Default: `fix_mode = true`.
4. Parse scope flags:
   - Check for `--all` flag. If present, set `scope_mode = "full"`.
   - Check for `--diff=<ref>` flag. If present, set `scope_mode = "diff"` and `scope_ref = <ref>`.
   - If BOTH `--all` and `--diff` are present: **error.** Print `Cannot use --all and --diff together.` and stop.
   - If neither is present, set `scope_mode = "interactive"`.

5. If `scope_mode == "interactive"`:
   a. Detect base reference:
      ```bash
      current_branch=$(git rev-parse --abbrev-ref HEAD)
      if [ "$current_branch" != "main" ] && [ "$current_branch" != "master" ]; then
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
   b. Run `git diff --name-only {base} HEAD` to get changed files.
   c. If `focus_path` is set, filter the changed files to that subtree before asking the question. `--diff=<ref>` and `--focus=<path>` both apply.
   d. If diff is NOT empty ({N} files changed), ask the user:
      > "I detected {N} files changed since `{base}`. What scope?"
      >
      > 1. **Only what changed** — {N} files + their importers
      > 2. **Full codebase** — everything
      > 3. **Different base** — specify a branch or commit
      >
      > If the user picks 1 → set `scope_mode = "diff"` and `scope_ref = {base}`
      > If the user picks 2 → set `scope_mode = "full"`
      > If the user picks 3 → ask for ref, then set `scope_mode = "diff"` and `scope_ref = <user input>`
   e. If diff IS empty (0 files), get the last commit with `git log --oneline -1` and ask:
      > "No diff vs `{base}`. Audit the last commit `{sha}: {message}`?"
      >
      > 1. **Last commit** — {N} files changed
      > 2. **Full codebase**
      > 3. **Different base**
      >
      > If the user picks 1 → set `scope_mode = "diff"` and `scope_ref = "HEAD~1"`
      > If the user picks 2 → set `scope_mode = "full"`
      > If the user picks 3 → ask for ref

6. If `scope_mode == "diff"`:
   a. Get changed files: `git diff --name-only {scope_ref} HEAD` → store as `diff_files[]`
   b. If `focus_path` is set, filter `diff_files[]` to that subtree before import expansion. `--diff=<ref>` and `--focus=<path>` both apply.
   c. Filter out binary files (images, fonts, compiled assets). Keep only `*.py`, `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.go`, `*.rs`, `*.java`, `*.kt`, `*.yaml`, `*.yml`, `Dockerfile*`.
   d. For each changed source file, find direct importers (1 level):
      ```bash
      grep -rl "from.*['\"].*{relative_path_without_ext}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" .
      grep -rl "require(.*{relative_path_without_ext}" --include="*.js" --include="*.ts" .
      ```
      Use the relative path (for example `hooks/use-dossier`) not just the filename stem to reduce false matches. Deduplicate results.
   e. Combine: `scope_files = diff_files + importer_files` (deduplicated)
   f. If `importer_files` count > 3x `diff_files` count:
      Warn the user: `{N} files modified. Import expansion found {M} importers (noisy). Run on modified files only, or include importers?`
      If the user picks "modified only" → set `scope_files = diff_files`
   g. Print: `{diff_count} files modified + {importer_count} importers = {total} files to audit`
   h. Store `scope_files`, `diff_files`, and `importer_files` for zone discovery.

7. Look up mode parameters:

| Mode | Agents | Rounds | Description |
|------|--------|--------|-------------|
| `quick` | 5 | 1 | Surface scan — known patterns, lint-like |
| `standard` | 10 | 1 | Standard audit — known patterns with broader coverage |
| `deep` | 15 | 2 | Surface + runtime behavior analysis |
| `paranoid` | 20 | 3 | Surface + behavior + edge cases and security |

8. Store these as working variables: `agent_count`, `round_count`, `focus_path`, `fix_mode`, `scope_mode`, `scope_ref`, `scope_files`, `diff_files`, `importer_files`.
9. Determine `results_dir`:
   - If `visual-tests/_results/` exists in the repo → use it (co-located with visual test results for `/sg-visual-review` handoff)
   - Otherwise → create `.code-audit-results/` at repo root and use it
   - Store as `results_dir` (absolute path). All zone JSON files and the final `audit-results.json` go here.
10. Print to user: `Code audit: {mode} mode ({agent_count} agents, {round_count} round(s)){", focus: " + focus_path if set}{", report-only" if not fix_mode}{", scope: diff vs " + scope_ref + " (" + total_in_scope + " files)" if scope_mode == "diff"}`

---

## Phase 2 — Detect Stack

Scan the repository root (or `focus_path` if set) to identify which languages and frameworks are present. Activate only the relevant checklists.

Run the following Glob checks. For each match, activate the corresponding checklist from `references/checklists.md` (relative to this skill's directory):

1. **Python:** Glob `**/*.py` — if matches > 0 AND (Glob `**/requirements.txt` OR `**/pyproject.toml` OR `**/setup.py`): activate Python checklist
2. **TypeScript:** Glob `**/*.ts` OR `**/*.tsx` — if matches > 0 AND Glob `**/package.json`: activate TypeScript/React checklist
3. **Infra:** Glob `**/Dockerfile*` OR `**/docker-compose*`: activate Infrastructure checklist
4. **Next.js:** Glob `**/next.config.*`: activate Next.js checklist
5. **Go:** Glob `**/*.go`: activate Go checklist
6. **Rust:** Glob `**/*.rs`: activate Rust checklist
7. **JVM:** Glob `**/*.java` OR `**/*.kt`: activate JVM checklist

After detection, read `CLAUDE.md` from the repository root if it exists. Store its contents (truncated to 3000 characters) for injection into agent prompts. If the file does not exist, skip this step.

Store the detected stack as a list: `detected_languages = ["python", "typescript", ...]`
Store the activated checklists as text blocks read from `references/checklists.md`.

Print to user: `Detected: {detected_languages joined by ", "}. CLAUDE.md: {"found" if exists else "not found"}.`

---

## Phase 3 — Discover Zones

Split the codebase into non-overlapping zones, one per agent. Zones must not share files — each source file belongs to exactly one zone.

**If `scope_mode == "diff"`:**

Zone discovery operates on the `scope_files` list instead of the full repo. Since these files may be scattered across many directories, use a simplified zone strategy:

1. Group `scope_files` by their parent directory (first 2 path segments, for example `src/routes/` or `apps/api-synthesia/`)
2. Each group becomes a zone candidate
3. If a group has <=30 files → 1 zone
4. If a group has >30 files → split by subdirectory (same rules as full mode)
5. Merge groups with <5 files into their nearest neighbor
6. Cap to `agent_count` (same merge/split logic as full mode)

Print: `Scoped zone discovery: {zone_count} zones from {file_count} files (diff mode)`

**If `scope_mode == "full"`:**

Use the existing directory-based algorithm below (unchanged).

### Step 1: Count files per directory

Run with Bash:

```bash
find {repo_root_or_focus_path} \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.kt' \) -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/venv/*' -not -path '*/__pycache__/*' -not -path '*/.next/*' -not -path '*/dist/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn
```

This produces lines like `   42 ./src/routes` — directory path with file count.

**IMPORTANT:** Use `sort` (not `sort -u`) before `uniq -c` so that duplicate directory paths from different files are counted correctly. With `sort -u`, each directory appears only once, making every count 1.

### Step 2: Apply splitting rules

Process the directory list:

- **Directory with <= 30 files** --> 1 zone (assign the whole directory)
- **Directory with 31-80 files** --> split by its immediate subdirectories. Re-run the count on children:
  ```bash
  find {dir} -maxdepth 2 \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.kt' \) | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn
  ```
  Each child directory becomes a separate zone.
- **Directory with 80+ files** --> split by sub-subdirectories (depth 3). Each sub-subdirectory becomes a zone.
- **Infra files** --> always 1 dedicated zone. Collect files matching `Dockerfile*`, `docker-compose*`, `*.yml`, and `*.yaml` in the repo root or `infra/` directory into a single zone.

### Step 3: Merge small zones

Any zone with fewer than 5 files gets merged into the nearest sibling zone (the zone whose path shares the longest common prefix).

### Step 4: Match zone count to agent count

- If zone count > `agent_count`: merge the two smallest zones (by file count) repeatedly until zone count equals `agent_count`.
- If zone count < `agent_count`: split the largest zone (by file count) into two halves (by subdirectory boundary) repeatedly until zone count equals `agent_count`.

### Step 5: Store zones

Store the final zones as an array:

```json
[
  {"id": "z01", "paths": ["src/routes/", "src/middleware/"], "file_count": 28},
  {"id": "z02", "paths": ["src/hooks/", "src/stores/"], "file_count": 22},
  {"id": "z03", "paths": ["infra/"], "file_count": 12}
]
```

Print to user: `Discovered {zone_count} zones ({total_file_count} files total). Dispatching {agent_count} agents.`

---

## Phase 4 — Build Prompts + Dispatch Agents

This is the core execution phase. For each round (1 to `round_count`), build prompts and dispatch agents.

### Round descriptions

| Round | Focus | Description |
|-------|-------|-------------|
| R1 — Surface | Known patterns, lint-like | Silent exceptions, missing guards, dead code, type mismatches, missing cleanup |
| R2 — Depth | Runtime behavior | Race conditions, cross-service integration, auth gaps, resource leaks, SSR issues |
| R3 — Edge Cases | What R1+R2 missed | Logic errors, prompt injection, data corruption, null propagation, off-by-one, performance |

### Prompt template

For each zone, build this prompt. Replace all `{...}` placeholders with actual values:

```
You are auditing a codebase for bugs. Your scope is ONLY these paths: {zone.paths joined with " AND "}.
Do NOT read or modify files outside your scope.

{IF CLAUDE.md content exists}
## Project Rules (from CLAUDE.md — follow these strictly)

{CLAUDE.md content, truncated to 3000 chars}
{END IF}

## Round {round_number} Focus — {round_description}

{Round-specific checklist text from references/checklists.md for this round}

## Language-Specific Checks ({detected_languages joined with ", "})

{Activated language checklists from references/checklists.md — only the detected languages}

## Severity Definitions

| Severity | When to use |
|----------|-------------|
| `critical` | Security bypass, data loss, crash on common path |
| `high` | Wrong behavior, race condition, resource leak on common path |
| `medium` | Edge case crash, missing validation, incorrect error handling |
| `low` | Dead code, style, minor performance, missing accessibility |

## Category Taxonomy

Use exactly one of: `security`, `race-condition`, `silent-exception`, `api-guard`, `resource-leak`, `type-mismatch`, `dead-code`, `infra`, `ssr-hydration`, `input-validation`, `error-handling`, `performance`, `accessibility`, `logic-error`, `other`

## Output Format

After auditing all files in your scope, write your findings to a JSON file at: {results_dir}/zone-{zone.id}-r{round_number}.json

The JSON MUST follow this exact schema:

```json
{
  "zone": "{zone.paths[0]}",
  "round": {round_number},
  "files_audited": <number of files you actually read>,
  "duration_ms": <approximate time in milliseconds>,
  "bugs": [
    {
      "id": "r{round_number}-{zone.id}-001",
      "severity": "critical|high|medium|low",
      "category": "<from taxonomy above>",
      "subcategory": "<specific pattern, e.g. auth-bypass, except-pass>",
      "file": "<relative file path>",
      "line": <line number>,
      "title": "<short title, max 80 chars>",
      "description": "<detailed explanation of the bug and its impact>",
      "fix_applied": <true if you fixed it, false otherwise>,
      "fix_commit": "<commit hash if fix_applied is true, empty string otherwise>"
    }
  ]
}
```

Increment the bug counter sequentially: r{round_number}-{zone.id}-001, r{round_number}-{zone.id}-002, etc.

{IF fix_mode is true}
## Fix Mode: ON

Fix every bug you find using the Edit tool. After fixing all bugs in your scope, commit all fixes with:
```
git add <fixed files>
git commit -m "audit-r{round_number}({zone_slug}): fix N bugs"
```
Set `"fix_applied": true` and `"fix_commit": "<actual commit hash>"` for each fixed bug.

If a bug cannot be safely fixed (risk of breaking behavior), set `"fix_applied": false` and explain why in the description.
{ELSE}
## Fix Mode: OFF (report only)

Do NOT modify any source files. Report all bugs with `"fix_applied": false` and `"fix_commit": ""`.
{END IF}

{IF round_number > 1}
## Previous Round Context

A previous audit round already found and fixed bugs. Your job in round {round_number}:
1. Verify that previously applied fixes are correct (check for regressions introduced by fixes)
2. Find DEEPER issues that the surface scan missed
3. Do NOT re-report bugs that were already found and fixed — focus on NEW findings
{END IF}

## Working Directory

{repo_root}

## Instructions

1. Read every source file in your scope using the Read tool
2. For each file, apply the round focus checks AND the language-specific checks
3. Record every bug found in the JSON output
4. {IF fix_mode} Fix bugs using Edit, then commit {ELSE} Do NOT edit any files {END IF}
5. Write the JSON output file
6. Report completion with a one-line summary: "Zone {zone.id}: {N} bugs found, {M} fixed"
```

### Dispatch

For each zone, dispatch an agent:

- **Tool:** Agent
- **prompt:** The filled prompt template above
- **isolation:** worktree
- **model:** sonnet (fast, cost-effective for audit work)
- **run_in_background:** true

Store all dispatched agent handles for tracking.

**Note on worktrees:** The Agent tool with `isolation: worktree` automatically creates a temporary git worktree and branch. The branch name is returned in the agent's result as `branch`. Store it for the merge phase.

Print to user: `Round {round_number}: Dispatched {agent_count} agents. Waiting for completion...`

### Monitor: report audit start + agent starts

If `monitor_active` is true:

1. **Once before the round loop** (after Phase 3 zones are known, before the first Phase 4 iteration), POST audit-start. Do NOT re-post on subsequent rounds (deep/paranoid mode) — `audit-start` resets all state.
   ```
   POST {monitor_url}/api/monitor/audit-start
   Body: {"mode": "{mode}", "round_count": {round_count}, "agent_count": {agent_count},
          "zones": [{zone objects with zone_id, paths, file_count}],
          "scope_mode": "{scope_mode}", "scope_ref": "{scope_ref}",
          "timestamp": "{ISO 8601 now}"}
   ```
   If the POST fails, set `monitor_active = false` and continue silently.

2. After dispatching each agent (every round), POST agent-started:
   ```
   POST {monitor_url}/api/monitor/agent-update
   Body: {"agent_id": "r{round}:{zone_id}", "zone_id": "{zone_id}", "status": "started",
          "round": {round}, "started_at": "{ISO 8601 now}"}
   ```

---

## Phase 5 — Collect + Retry

As each background agent completes, process its result.

### On agent completion

1. Read the agent's output text.
2. **If the output contains "Prompt is too long" or "context window":**
   - The zone was too large. Split it in half:
     - Divide `zone.paths` into two roughly equal groups (by file count)
     - Create two new zone objects with IDs `{zone.id}a` and `{zone.id}b`
     - Dispatch two new agents with the same prompt template but narrower scope
     - Track the new agents
   - Print to user: `Zone {zone.id} context overflow — re-splitting into {zone.id}a and {zone.id}b`
3. **If the output indicates success:**
   - Read the zone JSON file from the agent's worktree path (returned in the agent result). The file is at `{worktree_path}/{results_dir_relative}/zone-{zone.id}-r{round_number}.json`.
   - Validate that the JSON parses correctly and has the required fields
   - Store the parsed results
   - Print to user: `Zone {zone.id} complete: {N} bugs found`
4. **If the output indicates an error (not context overflow):**
   - Log the error
   - Print to user: `Zone {zone.id} failed: {error summary}`
   - Do NOT retry — move on

### Monitor: report agent completion

If `monitor_active` is true, after processing each agent's result:

- **Success:** POST agent-update with completion data:
  ```
  POST {monitor_url}/api/monitor/agent-update
  Body: {"agent_id": "r{round}:{zone_id}", "zone_id": "{zone_id}", "status": "completed",
         "round": {round}, "started_at": "{original}", "ended_at": "{ISO 8601 now}",
         "duration_ms": {from agent result footer or elapsed time},
         "tokens": {"total": {total_tokens}, "input": {input_tokens}, "output": {output_tokens}},
         "estimated_cost_usd": {calculated from tokens — sonnet: $3/$15 per 1M in/out},
         "tool_uses": {from agent result footer}, "bugs_found": {from zone JSON},
         "files_audited": {from zone JSON}}
  ```
  Extract `total_tokens`, `tool_uses`, and `duration_ms` from the Agent tool's result footer. If input/output split is unavailable, estimate 60/40 ratio from total.

  **Note:** Cost estimation uses the model specified in the agent dispatch (default: sonnet). If a different model is used, adjust the pricing table accordingly.

- **Context overflow:** POST overflow + started for children:
  ```
  POST {monitor_url}/api/monitor/agent-update
  Body: {"agent_id": "r{round}:{zone_id}", "status": "overflow",
         "error": "context overflow — re-splitting", "overflow_into": ["{child_id_a}", "{child_id_b}"]}
  POST {monitor_url}/api/monitor/agent-update
  Body: {"agent_id": "r{round}:{child_id_a}", "zone_id": "{child_id_a}", "status": "started", ...}
  POST {monitor_url}/api/monitor/agent-update
  Body: {"agent_id": "r{round}:{child_id_b}", "zone_id": "{child_id_b}", "status": "started", ...}
  ```

- **Error:** POST agent-update with `status: "failed"` and `error: "{error message}"`.

All monitor POSTs are wrapped in try/catch. If any POST fails, set `monitor_active = false` — never crash the audit for monitoring.

### Track completion

Maintain counters: `completed`, `pending`, `failed`.
When a re-split happens, increment `pending` by 2 and decrement by 1 (net +1).

### When all agents for this round are complete

#### Prerequisite: Clean working tree check

Run:
```bash
git status --porcelain
```

If the output is NOT empty (there are uncommitted changes), **abort the merge phase** and warn the user:

```
WARNING: Uncommitted changes detected in the working tree.
Commit or stash your changes before merging audit fixes.
Skipping merge phase — audit results are still available in worktree branches.
```

Do NOT proceed to merging. Skip to Phase 6 (Aggregate + Report) using only the JSON results collected from worktrees.

#### Merge worktree branches (fix mode only)

If `fix_mode` is true AND working tree is clean:

For each completed zone that has a worktree branch:

1. Run: `git merge {agent.branch} --no-edit` (where `agent.branch` is the branch name returned by the Agent tool in step 4)
2. Check the exit code:
   - **Success (exit 0):** Merge completed. Continue to next branch.
   - **Conflict (exit non-zero):**
     a. Run `git diff --name-only --diff-filter=U` to get the list of conflicting files
     b. Log: `Merge conflict in zone {zone.id}: {conflicting_files}`
     c. Run `git merge --abort` to cleanly abort this merge
     d. Add this zone to the `skipped_merges` list
     e. Continue to the next branch

**IMPORTANT:** Do NOT use `git checkout --theirs` or any auto-resolution strategy. Conflicts mean two zones touched the same file, which should not happen with proper zone splitting. A conflict indicates a zone boundary error — the user must resolve it manually.

After all merges:

1. **First, collect ALL zone JSONs from ALL worktrees** (including zones in `skipped_merges` whose worktrees were not merged). Read and store each zone JSON before any cleanup.
2. Clean up worktrees: `git worktree remove {worktree_path} --force` for each worktree
3. Clean up branches: `git branch -d {agent.branch}` for each merged branch (skip branches in `skipped_merges` — the user needs them)
4. If `skipped_merges` is not empty, report to user:
   ```
   Merge conflicts in {N} zones — manual resolution required:
   - Zone {id}: {conflicting files}
   ...
   These zone branches are preserved for manual merge.
   ```

---

## Phase 6 — Aggregate + Report

### Step 1: Collect all zone JSON files

Read all zone JSON files produced in this round:
- From successfully merged worktrees: `{results_dir}/zone-{zone.id}-r{round_number}.json`
- From worktrees that had merge conflicts: read directly from the worktree path before cleanup

### Step 2: Build audit-results.json

Merge all zone results into a single aggregated file:

```json
{
  "repo": "<repository name from git remote or directory name>",
  "timestamp": "<ISO 8601 timestamp, e.g. 2026-04-10T08:30:00Z>",
  "mode": "<quick|standard|deep|paranoid>",
  "rounds": <round_count>,
  "agents": <actual agents dispatched including re-splits>,
  "scope_info": {
    "mode": "diff",
    "base_ref": "main",
    "base_sha": "<full SHA of base>",
    "diff_files": 12,
    "importer_files": 16,
    "total_in_scope": 28
  },
  "summary": {
    "total_bugs": <sum of all bugs across all zones and rounds>,
    "by_severity": {
      "critical": <count>,
      "high": <count>,
      "medium": <count>,
      "low": <count>
    },
    "by_category": {
      "security": <count>,
      "race-condition": <count>,
      "silent-exception": <count>,
      "api-guard": <count>,
      "resource-leak": <count>,
      "type-mismatch": <count>,
      "dead-code": <count>,
      "infra": <count>,
      "ssr-hydration": <count>,
      "input-validation": <count>,
      "error-handling": <count>,
      "performance": <count>,
      "accessibility": <count>,
      "logic-error": <count>,
      "other": <count>
    },
    "files_audited": <sum of files_audited across all zones>,
    "files_modified": <count of unique files with fix_applied: true>,
    "duration_ms": <total wall-clock time from Phase 1 start to Phase 6>
  },
  "impacted_routes": [
    {"route": "<url path>", "reason": "<bug title + file>", "severity": "<highest severity bug for this route>"}
  ],
  "bugs": [<all bugs from all zones and rounds, combined into one array>]
}
```

When `scope_mode == "full"`: `"scope_info": {"mode": "full"}` — no other fields.
When `scope_mode == "diff"`: include all fields above.

### Step 3: Derive impacted_routes

For each bug, map its file path to the most likely UI route. Use framework-specific detection (based on what was detected in Phase 2):

1. **Next.js App Router:** If the repo has `app/` directory structure:
   - Glob `**/app/**/page.tsx` and `**/app/**/page.ts`
   - For each page file, derive the route: `app/dashboard/page.tsx` becomes `/dashboard`, `app/dossier/[id]/page.tsx` becomes `/dossier/:id`
   - If the bug file is inside an `app/` route directory, map to that route
   - If the bug file is a shared component/hook, Grep for which page files import it, map to those routes

2. **Next.js Pages Router:** If the repo has `pages/` directory:
   - Glob `**/pages/**/*.tsx` and `**/pages/**/*.ts`
   - Derive routes: `pages/dashboard.tsx` becomes `/dashboard`
   - Same import-tracing logic as above

3. **React Router:** If the repo uses React Router:
   - Grep for `<Route path=` or `path:` in router config files
   - Map component file paths to their declared routes

4. **Generic fallback:**
   - Extract the parent directory name from the bug's file path
   - If visual test manifests exist (`visual-tests/**/*.yaml`), match the directory name against manifest `url` fields
   - If no match, use the directory name as a best-guess route: `src/components/dashboard/` maps to `/dashboard`

**Do NOT hardcode any project-specific paths.** All route detection must be generic and work on any repository.

Deduplicate routes: if multiple bugs map to the same route, keep one entry with the highest severity and a combined reason.

If no web framework is detected (no Next.js, React Router, etc.), set `impacted_routes` to an empty array `[]`.

### Step 4: Write results

Write `audit-results.json` to `{results_dir}`. The `results_dir` was determined in Phase 1 and is the single source of truth for all output files.

### Step 5: Print summary

Print a summary table to the terminal:

```
=== Code Audit Complete ===

Mode: {mode} | Agents: {actual_count} | Rounds: {round_count}
Duration: {formatted_duration}

Bugs found: {total}
  Critical: {count}  High: {count}  Medium: {count}  Low: {count}

Top categories:
  {category}: {count}
  {category}: {count}
  {category}: {count}

Files audited: {count}
Files modified: {count}

{IF skipped_merges exist}
Merge conflicts (manual resolution required): {count} zones
{END IF}

Results: {path to audit-results.json}

Next steps:
  /sg-visual-run --from-audit    Visually verify impacted routes
  /sg-visual-review              See the full dashboard with Code Audit tab
```

### Monitor: report audit complete

If `monitor_active` is true:

```
POST {monitor_url}/api/monitor/audit-complete
Body: {"status": "completed", "timestamp": "{ISO 8601 now}"}
```

Print: `Monitor: audit complete — view results at {monitor_url}`

---

## Multi-Round Execution

If `round_count > 1` (deep or paranoid mode), the audit runs in sequential rounds:

### Round loop

```
for round_number in 1..round_count:
    1. Build prompts with round-specific focus (R1, R2, or R3 from references/checklists.md)
    2. Dispatch agents (Phase 4)
    3. Collect results + retry overflows (Phase 5)
    4. Merge worktree branches if fix_mode (Phase 5)
    5. Store this round's results
    6. Print: "Round {round_number} complete: {N} bugs found, {M} fixed"

After all rounds:
    7. Aggregate ALL rounds into a single audit-results.json (Phase 6)
    8. Print final summary
```

### Round-specific behavior

- **Round 1:** Standard dispatch. Agents see only the round focus + language checklists.
- **Round 2+:** Agents receive an additional context block:
  ```
  A previous audit round already found and fixed bugs. Your job:
  1. Verify previously applied fixes are correct (check for regressions)
  2. Find DEEPER issues the surface scan missed
  3. Do NOT re-report bugs already found — focus on NEW findings
  ```
- Each round uses a DIFFERENT focus and checklist from `references/checklists.md`:
  - Round 1 = R1 (Surface)
  - Round 2 = R2 (Depth)
  - Round 3 = R3 (Edge Cases)

### Bug ID format

Bug IDs include the round number to avoid collisions across rounds:
- Round 1: `r1-z03-001`, `r1-z03-002`, ...
- Round 2: `r2-z03-001`, `r2-z03-002`, ...
- Round 3: `r3-z03-001`, `r3-z03-002`, ...

All bugs from all rounds are combined in the final `audit-results.json` bugs array.

---

## Reference: JSON Schemas

### Per-zone output (written by each agent)

```json
{
  "zone": "src/routes/",
  "round": 1,
  "files_audited": 23,
  "duration_ms": 245000,
  "bugs": [
    {
      "id": "r1-z03-001",
      "severity": "critical",
      "category": "security",
      "subcategory": "auth-bypass",
      "file": "src/routes/documents.py",
      "line": 119,
      "title": "Missing ownership check",
      "description": "Any authenticated user can access any document by guessing the document ID. The route handler checks authentication but not authorization — no ownership verification.",
      "fix_applied": true,
      "fix_commit": "abc1234"
    }
  ]
}
```

### Aggregated output (audit-results.json)

```json
{
  "repo": "my-project",
  "timestamp": "2026-04-10T08:30:00Z",
  "mode": "standard",
  "rounds": 1,
  "agents": 10,
  "scope_info": {
    "mode": "diff",
    "base_ref": "main",
    "base_sha": "abc1234def5678",
    "diff_files": 12,
    "importer_files": 16,
    "total_in_scope": 28
  },
  "summary": {
    "total_bugs": 47,
    "by_severity": {"critical": 3, "high": 12, "medium": 22, "low": 10},
    "by_category": {"security": 5, "race-condition": 8, "silent-exception": 12, "api-guard": 6, "infra": 4, "other": 12},
    "files_audited": 187,
    "files_modified": 34,
    "duration_ms": 612000
  },
  "impacted_routes": [
    {"route": "/dashboard", "reason": "Zustand store bug in dashboard-store.ts", "severity": "high"}
  ],
  "bugs": [
    {
      "id": "r1-z03-001",
      "severity": "critical",
      "category": "security",
      "subcategory": "auth-bypass",
      "file": "src/routes/documents.py",
      "line": 119,
      "title": "Missing ownership check",
      "description": "Any authenticated user can access any document by guessing the document ID.",
      "fix_applied": true,
      "fix_commit": "abc1234"
    }
  ]
}
```

---

## Final Checklist

Before reporting completion to the user, verify:

- [ ] Arguments parsed correctly (mode, focus, fix_mode, scope_mode)
- [ ] Stack detected (at least one language found)
- [ ] Zones discovered and assigned (no overlapping paths)
- [ ] All agents dispatched and completed (or failed with logged errors)
- [ ] Context overflows handled (zones re-split and relaunched)
- [ ] Working tree clean check performed before merge
- [ ] Merge conflicts handled safely (abort + log, not auto-resolve)
- [ ] All zone JSONs collected and valid
- [ ] `--all` + `--diff` rejected explicitly
- [ ] `--diff` + `--focus` documented and applied together
- [ ] Diff mode import expansion uses relative paths and documents the noisy fallback
- [ ] audit-results.json written with correct schema
- [ ] `scope_info` included in audit-results.json
- [ ] impacted_routes derived using generic detection (no hardcoded paths)
- [ ] Summary printed to terminal
- [ ] Next steps suggested (/sg-visual-run --from-audit, /sg-visual-review)
