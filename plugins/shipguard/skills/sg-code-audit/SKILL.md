---
name: sg-code-audit
description: Parallel AI codebase audit — dispatches agents to find and fix bugs across the entire repo. Produces structured JSON results viewable in /sg-visual-review. Trigger on "sg-code-audit", "code audit", "audit codebase", "find bugs", "code-audit", "audit code", "static audit", "security audit", "ship guard".
context: conversation
argument-hint: "[quick|standard|deep|paranoid] [--focus=path] [--report-only] [--all] [--diff=ref] [--model=auto|haiku|sonnet|opus]"
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
| `/sg-code-audit --model=opus` | Use opus for all rounds (maximum depth) |
| `/sg-code-audit quick --diff=feature-branch` | Combine mode with diff scope |
| `/sg-code-audit deep --model=opus --focus=src/` | Combine model, mode, and focus |

---

## Phase 0 — Monitor Setup

Detect or start the review server for real-time audit monitoring. This is optional — if the user declines or the server can't start, the audit proceeds normally.

### Step 1: Check for existing server

Before making any health check calls, determine `results_dir` early:
- If `visual-tests/_results/` exists in the repo → preliminary `results_dir` = `visual-tests/_results/`
- Otherwise → preliminary `results_dir` = `.code-audit-results/`

Use this preliminary value to compare against health check responses below.

```bash
curl -s --max-time 2 http://localhost:8888/health
```

- **200 OK:** Parse the response JSON. Compare `results_dir` against the preliminary `results_dir` computed above.
  - If they match → set `monitor_active = true`, `monitor_url = "http://localhost:8888"`. Print: `Monitor: connected to existing server.`
  - If they differ → another project's server is running. Try ports 8889, 8890 with `--port=` (same health check + results_dir comparison). If none match, treat as "not running" and go to Step 2.
- **Connection refused / timeout:** Server not running. Go to Step 2.

### Step 2: Monitor decision

If no matching server found:

**Default: monitor OFF.** Most solo developers don't need a real-time dashboard for a 10-minute audit.

- If `--monitor` flag was passed → proceed to start the server (skip the question)
- If mode is `deep` or `paranoid` (estimated >15 min) → ask the user:
  > "This audit may take 15+ min. Monitor progress in a dashboard? (oui/non)"
- Otherwise → set `monitor_active = false`, skip silently

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
  2. Pick port: use 8888 if free. If 8888 is occupied by another project's server, try 8889 then 8890. Use the first port that either returns a matching `results_dir` or is not listening.
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
- **non:** Set `monitor_active = false`. Set `monitor_url = null`.

### Step 3: Store monitor state

Store `monitor_active` (boolean) and `monitor_url` (string) as working variables for subsequent phases.

---

## Phase 1 — Parse Arguments

Parse the user's input into four values: **mode**, **focus**, **fix_mode**, and **scope**.

1. Extract the first positional argument (after the command name). Match against `quick`, `standard`, `deep`, `paranoid`. Default: `standard`.
2. Extract `--focus=<path>` flag. If present, store the path. If not, scope is the entire repo.
3. Check for `--report-only` flag. If present, set `fix_mode = false`. Default: `fix_mode = true`.
3b. Check for `--model=<model>` flag. Values: `haiku`, `sonnet`, `opus`, `auto`. Default: `auto`.
   - `auto`: use haiku for R1 (bulk surface scan, cheap), sonnet for R2/R3 (deeper reasoning)
   - `haiku`: all rounds use haiku (fast, catches everything, more noise)
   - `sonnet`: all rounds use sonnet (balanced depth and cost)
   - `opus`: all rounds use opus (maximum depth, highest token cost — best for critical audits)
   
   **User override:** The `--model` flag lets users override the default model strategy for any audit. This is useful when:
   - A project requires maximum rigor: `--model=opus` uses opus for all rounds
   - Budget is tight: `--model=haiku` runs the full audit at minimal cost
   - The default auto strategy (haiku R1, sonnet R2+) can be overridden per-run without changing any config
   
   When using haiku for R1, add this instruction to the agent prompt:
   ```
   Report ALL instances of every pattern you find, regardless of how minor you think they are.
   The severity field exists for post-filtering — your job is to find, not to pre-filter.
   Do not self-censor bulk patterns like missing env guards, key={index}, or f-string loggers.
   ```
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
      > 1. **Only what changed** — {N} files + importers (~{estimated_time_diff} min)
      > 2. **Full codebase** — {total_file_count} files (~{estimated_time_full} min)
      > 3. **Different base** — specify a branch or commit
      >
      > Estimate times: diff mode ≈ ceil(diff_files / 30) minutes, full mode ≈ ceil(total_files / 200) × round_count minutes.
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

   **Focus-path filtering:** Apply `focus_path` filtering once, immediately after collecting `scope_files` in this step (6b for diff scope, or at the start of Step 1 for full scope). Do not re-filter in Phase 3 or later steps.

7. Look up mode parameters:

| Mode | Max Agents | Rounds | Description |
|------|-----------|--------|-------------|
| `quick` | 5 | 1 | Surface scan — known patterns, lint-like |
| `standard` | 10 | 1 | Standard audit — known patterns with broader coverage |
| `deep` | 15 | 2 | Surface + runtime behavior analysis |
| `paranoid` | 20 | 3 | Surface + behavior + edge cases and security |

**Auto-adjust agent count:** The table above gives the **maximum** agents per mode. The actual count is scaled to file count to avoid waste:

```
agent_count = min(mode_max_agents, ceil(total_file_count / 7))
```

A 34-file project in `standard` mode gets `min(10, ceil(34/7))` = **5** agents, not 10. A 200-file project gets the full 10. This prevents agents with 2-3 files each from producing shallow results.

8. Store these as working variables: `agent_count`, `round_count`, `focus_path`, `fix_mode`, `scope_mode`, `scope_ref`, `scope_files`, `diff_files`, `importer_files`.
9. Determine `results_dir`:
   - If `visual-tests/_results/` exists in the repo → use it (co-located with visual test results for `/sg-visual-review` handoff)
   - Otherwise → create `.code-audit-results/` at repo root and use it
   - Store as `results_dir` (absolute path). All zone JSON files and the final `audit-results.json` go here.
10. Print to user: `Code audit: {mode} mode ({agent_count} agents, {round_count} round(s)){", model: " + model_strategy}{", focus: " + focus_path if set}{", report-only" if not fix_mode}{", scope: diff vs " + scope_ref + " (" + total_in_scope + " files)" if scope_mode == "diff"}`
11. **Compute prompt hash:** After Phase 2 (when checklists are known), compute a SHA256 hash of the prompt template + activated checklists + learnings audit_hints. Store as `prompt_hash` and include in `audit-results.json`. This allows `sg-improve` to detect when the audit prompt changes and invalidate old baselines in `learnings.yaml` session_history.

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
8. **HTML/CSS/JS (vanilla):** Glob `**/*.html` — if matches > 0 AND none of the above framework-specific indicators (no `next.config.*`, no `package.json` with React/Vue/Angular, no `*.py` with Flask/FastAPI): activate HTML/CSS/JS checklist. This covers static sites, Hugo/Jekyll output, and vanilla JS projects.

After detection, read `CLAUDE.md` from the repository root if it exists. Store its contents (truncated to 3000 characters) for injection into agent prompts. If the file does not exist, skip this step.

Store the detected stack as a list: `detected_languages = ["python", "typescript", ...]`
Store the activated checklists as text blocks read from `references/checklists.md`.

Print to user: `Detected: {detected_languages joined by ", "}. CLAUDE.md: {"found" if exists else "not found"}.`

---

## Phase 3 — Discover Zones

Split the codebase into non-overlapping zones, one per agent. Zones must not share files — each source file belongs to exactly one zone.

### Step 0: Check for previously skipped zones

If `{results_dir}/_skipped_zones.json` exists from a previous audit:
1. Read the skipped zones list
2. These zones will be **prioritized** — they go first in the dispatch queue
3. For each skipped zone, reduce `max_files` by 30% from the previous run's count (to avoid the same overflow)
4. Print: `Found {N} zones skipped in previous audit — prioritizing them with smaller sizes`
5. Delete `_skipped_zones.json` (it will be recreated if zones fail again)

**If `scope_mode == "diff"`:**

Zone discovery operates on the `scope_files` list instead of the full repo. Since these files may be scattered across many directories, use a simplified zone strategy:

1. Group `scope_files` by their parent directory (first 2 path segments, for example `src/routes/` or `apps/api-synthesia/`)
2. Each group becomes a zone candidate
3. If a group has <=30 files → 1 zone
4. If a group has >30 files → split by subdirectory (same rules as full mode)
5. Merge groups with <5 files into their nearest neighbor (the group whose path shares the longest common prefix). If no path prefix is shared, merge into the group with the fewest files.
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

### Step 1.5: Read learnings (if available)

If `{repo_root}/.shipguard/learnings.yaml` exists, read it:
- `zone_hints`: for each hint, store `{path → max_files}` as override thresholds
- `audit_hints`: collect patterns to inject into agent prompts (Phase 4)
- `noise_filters`: collect patterns to batch in agent prompts (Phase 4)
- Print: `Loaded {N} zone hints, {M} audit hints, {K} noise filters from .shipguard/learnings.yaml`

If the file doesn't exist, skip silently.

### Step 2: Apply splitting rules

Process the directory list. Use **token-weighted thresholds** instead of raw file counts to account for file complexity:

```
For each directory, estimate zone weight:
  file_weight = max(1, file_line_count / 50)   # a 200-line file weighs 4, a 10-line file weighs 1
  zone_weight = sum(file_weight for each file)
  
  Approximate: sample the first 5 files in each directory with `wc -l` to estimate average weight.
  estimated_zone_weight = file_count * avg_weight
```

**If a directory path matches a learnings zone_hint**, use `hint.max_files` as the hard cap instead of the default thresholds below.

Default thresholds (when no learnings override):

- **Directory with estimated_weight <= 40** --> 1 zone
- **Directory with estimated_weight 41-100** --> split by immediate subdirectories. Re-run the count on children:
  ```bash
  find {dir} -maxdepth 2 \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.kt' \) | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn
  ```
  Each child directory becomes a separate zone.
- **Directory with estimated_weight > 100** --> split by sub-subdirectories (depth 3). Each sub-subdirectory becomes a zone.
- **Infra files** --> always 1 **mandatory dedicated zone**, even in `quick` mode. Collect files matching `Dockerfile*`, `docker-compose*`, `*.yml`, `*.yaml`, `.env*`, `.env.example`, `Makefile`, `*.toml` (pyproject.toml, Cargo.toml), `*.cfg`, `.github/workflows/*`, `.gitlab-ci.yml` in the repo root, `infra/`, or `deploy/` directories into a single zone. In `deep`/`paranoid` modes, the infra zone gets its own R2 round with a specialized focus: env var consistency (variables referenced in code vs declared in compose), port mapping verification (code defaults vs compose ports), and healthcheck coverage (services without healthchecks).

### Step 3: Merge small zones

Any zone with fewer than 5 files gets merged into the nearest sibling zone (the zone whose path shares the longest common prefix).

### Step 4: Match zone count to agent count

- If zone count > `agent_count`: merge the two smallest zones (by file count) repeatedly until zone count equals `agent_count`.
- If zone count < `agent_count`: split the largest zone (by file count) into two halves (by subdirectory boundary) repeatedly until zone count equals `agent_count`.
- **Flat directory fallback:** If a zone has no subdirectories (all files are in one directory), split by **alphabetical file list**: sort the files alphabetically, divide into two equal halves, create two zones. This handles flat `src/` or `lib/` directories that can't be split by subdirectory.
- **Overshoot guard:** If splitting a zone would produce more zones than `agent_count` (for example, a zone with many subdirectories), apply the merge step immediately after the split to bring the total back down to `agent_count`.

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

## Phase 3.5 — Monitor: Initialize

This step runs **once**, after zones are known and **before** the round loop begins. It must NOT be repeated on subsequent rounds.

If `monitor_active` is true:

POST audit-start to seed all zone state on the monitor server:

```
POST {monitor_url}/api/monitor/audit-start
Body: {"mode": "{mode}", "round_count": {round_count}, "agent_count": {agent_count},
       "zones": [{zone objects with zone_id, paths, file_count}],
       "scope_mode": "{scope_mode}", "scope_ref": "{scope_ref}",
       "timestamp": "{ISO 8601 now}"}
```

If the POST fails, set `monitor_active = false` and continue silently.

**Note on overflow children:** Re-split child zones are dynamically added to the monitor via `agent-update` with `status: started` (see Phase 5). The server creates new agent entries for unknown `agent_id`s automatically — no pre-registration is needed here.

Do NOT re-POST audit-start on round 2 or round 3 — it resets all monitor state.

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
You are auditing a codebase for bugs. Your primary scope is these paths: {zone.paths joined with " AND "}.
Do NOT modify files outside your scope. You MAY read files outside your scope to verify cross-module integration (caller/callee contracts, import chains, shared types).

{IF CLAUDE.md content exists}
## Project Rules (from CLAUDE.md — follow these strictly)

{CLAUDE.md content, truncated to 3000 chars}
{END IF}

## Round {round_number} Focus — {round_description}

{Round-specific checklist text from references/checklists.md for this round}

## Language-Specific Checks ({detected_languages joined with ", "})

{Activated language checklists from references/checklists.md — only the detected languages}

## Severity Definitions (STRICT — use only these 4 values, lowercase)

| Severity | When to use |
|----------|-------------|
| `critical` | Security bypass, data loss, crash on common path |
| `high` | Wrong behavior, race condition, resource leak on common path |
| `medium` | Edge case crash, missing validation, incorrect error handling |
| `low` | Dead code, style, minor performance, missing accessibility |

**WARNING:** Use only `critical`, `high`, `medium`, `low` (lowercase). Do NOT use `CRITICAL`, `HIGH`, `serious`, `warning`, `info`, or any other value.

**Calibration examples** (use these as reference points for consistent severity across agents):

| Example bug | Correct severity | Why |
|-------------|-----------------|-----|
| SQL injection via unsanitized user input | `critical` | Security bypass, data exfiltration |
| Unreplaced placeholder in production URL (`DOMAINE`) | `critical` | App points to wrong server, total breakage |
| Race condition on shared counter without lock | `high` | Wrong behavior under concurrent access |
| `except Exception: pass` hiding real errors | `high` | Silent failure masks production bugs |
| Missing `Array.isArray` guard on API response | `medium` | Edge case crash when backend returns non-array |
| Insufficient color contrast (4:1 instead of 4.5:1) | `low` | Accessibility issue, not a crash |
| Unused import left after refactor | `low` | Dead code, no runtime impact |
| Double semicolon in CSS | `low` | Style, no visual impact |
| `except Exception: ... logger.error(e)` with retry | `medium` (not `high`) | Exception IS logged — not silent |
| `httpx.get(url)` without explicit timeout | `low` (not `medium`) | httpx default timeout is 5s |
| Missing auth check in handler behind `@require_auth` decorator | not a bug | Auth already enforced by decorator |
| `if user.get("id"):` after `validate_token()` returns verified user | `low` (not `high`) | Token validation guarantees user exists |

## Severity Verification (REQUIRED for critical and high)

Before assigning `critical` or `high` severity, you MUST verify context:

1. **Security bugs (IDOR, XSS, injection):** Read the authentication/authorization middleware that runs before the vulnerable code. If the middleware already validates tokens, sanitizes input, or checks permissions, downgrade the severity. Report what the middleware does in the `description`.

2. **Missing timeout/resource bugs:** Check if the library has a built-in default. Common defaults:
   - `httpx` (Python): 5s default timeout
   - `requests` (Python): no default timeout (this IS a real bug)
   - `fetch` (JS): no default timeout (real bug)
   - `axios` (JS): no default timeout (real bug)
   If the library has a safe default, downgrade to `low`.

3. **Exception handling bugs (bare except, broad catch):** Check if the exception is:
   - Logged (logger.error, logging.exception, console.error) → downgrade to `medium`
   - Re-raised after logging → not a bug at all, skip it
   - Truly silenced (no logging, no re-raise) → keep as `high`

4. **Missing validation bugs:** Check if validation happens at a higher level (middleware, decorator, parent function). If the caller already validates, this is not a bug.

If you cannot verify context (file is outside your scope), add `"confidence": "low"` to the bug object and note "context not verified — severity may be overstated" in the description.

## Category Taxonomy (STRICT — do NOT invent new categories)

Use **exactly** one of these 16 values. No variations, no synonyms, no new categories:

| Category | Use for |
|----------|---------|
| `security` | Auth bypass, XSS, injection, secrets in code |
| `race-condition` | Concurrent access, TOCTOU, shared state |
| `silent-exception` | Swallowed errors, bare except, except-pass |
| `api-guard` | Missing null checks on API responses, unguarded indexing |
| `resource-leak` | Unclosed files/connections, missing cleanup |
| `type-mismatch` | Wrong types, implicit conversions, schema drift |
| `dead-code` | Unused imports, unreachable branches, obsolete functions |
| `infra` | Dockerfile, compose, CI/CD, env vars, build config |
| `ssr-hydration` | SSR/CSR mismatch, hydration errors, window/document in SSR |
| `input-validation` | Missing sanitization, unchecked user input |
| `error-handling` | Wrong error type, missing try/catch at boundaries |
| `performance` | N+1 queries, unnecessary re-renders, missing memoization |
| `accessibility` | Missing ARIA, contrast, keyboard navigation |
| `logic-error` | Off-by-one, wrong condition, incorrect algorithm |
| `integration` | Cross-zone payload mismatch, dead endpoint, auth propagation gap, proxy route mismatch |
| `other` | Only if none of the above fit — explain in subcategory |

**WARNING — HYPHENS ONLY:** Every category uses hyphens (`-`), never underscores (`_`). Common mistakes:
- ❌ `error_handling` → ✅ `error-handling`
- ❌ `silent_exception` → ✅ `silent-exception`  
- ❌ `input_validation` → ✅ `input-validation`
- ❌ `resource_leak` → ✅ `resource-leak`
- ❌ `dead_code` → ✅ `dead-code`
- ❌ `race_condition` → ✅ `race-condition`
- ❌ `type_mismatch` → ✅ `type-mismatch`
- ❌ `logic_error` → ✅ `logic-error`
- ❌ `ssr_hydration` → ✅ `ssr-hydration`
If you use a category NOT in the table (including underscore variants), the dashboard will break.

## Output Format

After auditing all files in your scope, write your findings to a JSON file at EXACTLY this path — do not use any other filename:

**{results_dir}/zone-{zone.id}-r{round_number}.json**

The aggregation phase depends on this exact naming convention. Using a different filename (e.g., adding descriptive suffixes) will cause your results to be lost.

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
      "fix_commit": "<commit hash if fix_applied is true, empty string otherwise>",
      "confidence": "<high if you verified interprocedural context, medium if you checked the immediate file, low if you could not verify context>",
      "verification_score": null,
      "verified": null
    }
  ]
}
```

**Note:** `verification_score` and `verified` are set to `null` in the zone output. They are populated later by Phase 5.7 (Finding Confidence Verification) during aggregation. Zone agents should NOT set these fields to any other value.

```
```

Increment the bug counter sequentially: r{round_number}-{zone.id}-001, r{round_number}-{zone.id}-002, etc.

## Output Validation Contract

The zone JSON MUST pass these checks. If any check fails, the agent should fix and rewrite:

1. **JSON parseable** — valid JSON syntax
2. **Required fields present** — `zone`, `round`, `bugs` (array)
3. **Each bug has required fields** — `id`, `severity`, `category`, `file`, `line`, `title`, `description`, `fix_applied`
4. **Severity is one of** — `critical`, `high`, `medium`, `low` (lowercase, no other values)
5. **Category is one of** — the 16 valid categories listed above (hyphens, no underscores)
6. **Bug ID format** — `r{round}-{zone_id}-{NNN}` (sequential)

If the collecting phase (Phase 5) receives a zone JSON that fails validation, retry the agent ONCE with this message appended to the prompt: "Your previous output was malformed: {validation_error}. Rewrite the JSON file with correct format."

## Self-Validation (REQUIRED before writing JSON)

Before writing your zone JSON file, re-read every `category` and `severity` value in your bugs array. Compare each one character-by-character against the tables above. Common LLM mistake: writing `error_handling` instead of `error-handling`, or `silent_exception` instead of `silent-exception`. All categories use **hyphens** (`-`), never underscores (`_`). Fix any mismatches before writing the file.

{IF fix_mode is true}
## Fix Mode: ON

Fix every bug you find using the Edit tool. After fixing all bugs in your scope, commit all fixes with:
```
git add <fixed files>
git commit -m "audit-r{round_number}({zone.id}): fix N bugs"
```
Set `"fix_applied": true` and `"fix_commit": "<actual commit hash>"` for each fixed bug.

If a bug cannot be safely fixed (risk of breaking behavior), set `"fix_applied": false` and explain why in the description.
{ELSE}
## Fix Mode: OFF (report only)

Do NOT modify any source files. Report all bugs with `"fix_applied": false` and `"fix_commit": ""`.
{END IF}

{IF round_number > 1}
## Previous Round Context

A previous audit round found bugs in these categories: {list of categories from round N-1 results}.

Your job in round {round_number}:
1. Verify that previously applied fixes are correct (check for regressions INTRODUCED by the fixes themselves — wrong indentation, copy-paste errors, broken imports)
2. Find DEEPER issues that the surface scan missed
3. **Re-check known patterns in YOUR zone** — previous fixes may have been incomplete or only applied to other zones. If you find an instance of a known pattern, report it even if the same pattern was found elsewhere.
{END IF}

{IF learnings_audit_hints exist}
## Project-Specific Patterns (from .shipguard/learnings.yaml)

These patterns have been found in previous audits of this specific codebase. Check for them explicitly:

{For each audit_hint:}
- **{pattern}** ({severity}) — {note}
{END FOR}
{END IF}

{IF learnings_noise_filters exist}
## Noise Reduction

For these patterns, report ONE summary entry with the total count instead of individual bugs:

{For each noise_filter with action "batch":}
- **{pattern}** — report as: "N instances of {pattern} across M files" with file list in description
{END FOR}
{END IF}

## Working Directory

{repo_root}

## Skeptical Heuristics (APPLY to every file you read)

- Do not trust naming — trace the actual runtime behavior.
- Do not trust a UI component unless its action handler exists and reaches a real endpoint.
- Do not trust a backend route unless its caller sends the expected payload shape.
- Do not trust a "duplicate check" unless it is truly side-effect free.
- Do not trust "supports X" unless the state machine actually reaches state X.
- If a function accepts a parameter, verify it actually uses it — not just declares it.
- If a config declares a feature, verify the feature is reachable at runtime.
- A passing build is NOT proof of functional correctness.

## Instructions

1. Read every source file in your scope using the Read tool
2. For each file, apply ALL checks: round focus + language-specific + application-level + skeptical heuristics
3. For critical flows, read files OUTSIDE your scope (read-only) to verify caller/callee contracts
4. Record every bug found in the JSON output
5. {IF fix_mode} Fix bugs using Edit, then commit {ELSE} Do NOT edit any files {END IF}
6. Write the JSON output file
7. Report completion with a one-line summary: "Zone {zone.id}: {N} bugs found, {M} fixed"
```

### Dispatch

For each zone, dispatch an agent:

- **Tool:** Agent
- **prompt:** The filled prompt template above
- **isolation:** worktree
- **model:** determined by `--model` flag and round number:
  - `auto` (default): `haiku` for R1, `sonnet` for R2/R3
  - `haiku`: always `haiku`
  - `sonnet`: always `sonnet`
  - `opus`: always `opus`
- **run_in_background:** true

**Staggered dispatch:** Do not launch all agents in the same instant. Dispatch in batches of 3-5 agents per message to reduce API burst load. This prevents 529 overload errors caused by 10+ agents all requesting context simultaneously.

**Dispatch log:** Maintain an in-memory dispatch log to track agent IDs per zone:

```json
[
  {"zone_id": "z01", "agent_id": "a1234", "status": "running", "dispatched_at": "...", "retry": 0},
  {"zone_id": "z01", "agent_id": "a1234", "status": "superseded", "reason": "retry after 529"},
  {"zone_id": "z01", "agent_id": "a5678", "status": "running", "dispatched_at": "...", "retry": 1}
]
```

When a retry is dispatched, mark the original agent as `superseded`. When collecting results in Phase 5, if multiple completions arrive for the same zone, use the result from the **most recent** agent_id (highest retry count). Discard earlier results.

**Note on worktrees:** The Agent tool with `isolation: worktree` automatically creates a temporary git worktree and branch. The branch name is returned in the agent's result as `branch`. Store it for the merge phase.

Print to user: `Round {round_number}: Dispatched {agent_count} agents (batches of {batch_size}). Waiting for completion...`

### Monitor: report agent starts

If `monitor_active` is true, after dispatching each agent (every round), POST agent-started:

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
   - **Single-path zone edge case:** If the zone has only one path entry, split by listing the individual files under that path and dividing the file list in half alphabetically. If the zone has fewer than 3 files total, mark it as `failed` (too large for context — cannot split further) and skip it. Log: `Zone {zone.id} too small to re-split ({N} files) — skipping.`
   - Print to user: `Zone {zone.id} context overflow — re-splitting into {zone.id}a and {zone.id}b`
3. **If the output indicates success:**
   - Read the zone JSON file from the agent's worktree path (returned in the agent result). The file is at `{worktree_path}/{results_dir_relative}/zone-{zone.id}-r{round_number}.json`.
   - Validate that the JSON parses correctly and has the required fields
   - Store the parsed results
   - Print to user: `Zone {zone.id} complete: {N} bugs found`
4. **If the output indicates an API overload (529, "overloaded_error"):**
   - This zone's agent hit API capacity limits. Retry with exponential backoff:
     - Retry 1: wait 30 seconds, then re-dispatch
     - Retry 2: wait 60 seconds
     - Retry 3: wait 120 seconds
   - After 3 retries, mark as `failed` and add to `_skipped_zones.json` (see below)
   - Print to user: `Zone {zone.id} API overload — retry {N}/3 in {delay}s`
   - Track retry count per zone to avoid duplicate agent waste (see dispatch log)
5. **If the output indicates any other error:**
   - Log the error
   - Print to user: `Zone {zone.id} failed: {error summary}`
   - Add to `_skipped_zones.json` for the next audit run to retry
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
         "estimated_cost_usd": {calculated from tokens — haiku: $0.25/$1.25, sonnet: $3/$15, opus: $15/$75 per 1M in/out},
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
   Also clean any stale worktree branches from previous runs: `git branch --list 'worktree-*' | xargs git branch -d 2>/dev/null`
4. If `skipped_merges` is not empty, report to user:
   ```
   Merge conflicts in {N} zones — manual resolution required:
   - Zone {id}: {conflicting files}
   ...
   These zone branches are preserved for manual merge.
   ```

---

## Phase 5.5 — Post-Merge Validation

After all worktree merges complete (or after the clean tree check if no merges happened), validate that the merged code is syntactically correct. Audit fixes can introduce regressions — bad indentation from merge, wrong imports from copy-paste, broken syntax from adjacent edits.

### Step 1: Identify modified files

```bash
git diff --name-only HEAD~{number_of_merged_zones} HEAD
```

This gives the list of files modified by the merge commits.

### Step 2: Run language-specific syntax checks

For each modified file:

**Python (.py):**
```bash
python3 -c "import ast; ast.parse(open('{file}').read()); print('OK')"
```

**TypeScript/JavaScript (.ts, .tsx, .js, .jsx):**
```bash
# Quick syntax check — only if tsconfig.json exists in repo
npx tsc --noEmit --pretty 2>&1 | head -20
```
Run once for the whole project (not per-file). If `tsconfig.json` doesn't exist, skip.

**Go (.go):**
```bash
go build ./... 2>&1 | head -10
```
Run once if `go.mod` exists. Skip otherwise.

### Step 3: Handle failures

If ANY syntax check fails:

1. **Log** the file path and error message: `Post-merge syntax error: {file}:{line} — {error}`
2. **Revert** the offending merge commit:
   ```bash
   git revert HEAD --no-edit   # if the last merge caused the error
   ```
   If multiple merges happened and you can identify which one caused the error (from the file path → zone mapping), revert only that merge.
3. **Mark** the zone as `fix-reverted` in the results
4. **Add** to `_skipped_zones.json` so the next audit retries this zone
5. **Continue** to Phase 6 — the other zones' fixes are still valid

Print to user:
```
Post-merge validation: {N} files checked, {M} errors found
  ⚠ {file}:{line} — {error_type}: {message}
  → Reverted merge for zone {zone_id}. Fix needs manual review.
```

If all checks pass: `Post-merge validation: {N} files checked — all clean ✓`

### Step 2.5: Targeted functional tests (optional)

After syntax validation, run targeted tests to verify the audit fixes didn't break runtime behavior. This is NOT a full test suite run — only tests that cover the modified zones.

**When to run:** In `deep` and `paranoid` modes. Skip in `quick` and `standard` modes.

**Python (pytest):**
```bash
# Find test files that correspond to modified source files
for file in {modified_python_files}; do
  test_file=$(echo "$file" | sed 's|/|/tests/test_|; s|\.py$|.py|')
  if [ -f "$test_file" ]; then
    pytest "$test_file" --tb=short -q 2>&1 | tail -5
  fi
done
```

**TypeScript (if test runner configured):**
```bash
# Only if package.json has a "test" script
if grep -q '"test"' package.json 2>/dev/null; then
  npx jest --findRelatedTests {modified_ts_files} --passWithNoTests 2>&1 | tail -10
fi
```

If tests fail, do NOT revert — log the failure and add a `"test_regression": true` flag to the affected zone's results. The fix itself may be correct while the test needs updating.

Print: `Targeted tests: {N} test files run, {M} failures`

### Step 4: Write _skipped_zones.json

For any zones that failed (context overflow, API overload after 3 retries, merge conflict, syntax error after merge), persist them for the next audit:

```json
{
  "skipped": [
    {"zone_id": "z01", "paths": ["src/hooks/"], "reason": "api_overload", "retries": 3, "date": "2026-04-14"},
    {"zone_id": "z03a", "paths": ["src/components/chat/"], "reason": "syntax_error_after_merge", "file": "chat-tab.tsx", "date": "2026-04-14"}
  ],
  "timestamp": "{ISO 8601}"
}
```

Write to `{results_dir}/_skipped_zones.json`. At the start of the next audit (Phase 3), if this file exists, prioritize these zones (smaller sizes, first in queue) and delete the file after successful completion.

---

## Phase 5.6 — Cross-Zone Flow Validator

After zone agents and post-merge validation complete, dispatch 1-2 **flow tracer** agents to catch cross-zone integration bugs that isolated zone agents cannot see. Zone agents work in isolation — they excel at finding per-file patterns but are blind to mismatches between a frontend caller and a backend callee that live in different zones.

**When to run:** Always in `deep` and `paranoid` modes. Skip in `quick` mode. In `standard` mode, run only if the detected stack includes both frontend AND backend (e.g., TypeScript + Python).

### Step 1: Identify critical flows

Scan the repo for integration boundaries using Grep:

```bash
# Backend route definitions
grep -rn "APIRouter\|@app\.\(get\|post\|put\|delete\|patch\)\|router\.\(get\|post\|put\|delete\|patch\)" --include="*.py" .
# Frontend API calls
grep -rn "fetch(\|axios\.\|apiClient\.\|useMutation\|useQuery" --include="*.ts" --include="*.tsx" .
# Store definitions
grep -rn "create(\|defineStore\|createContext\|useReducer" --include="*.ts" --include="*.tsx" .
# Next.js proxy rewrites
grep -rn "rewrites\|destination:" --include="*.mjs" --include="*.js" next.config.* 2>/dev/null
```

Group results into **flow pairs**: `(caller_file, callee_file)` where the caller imports or calls the callee across zone boundaries. Only include pairs where the two files belong to DIFFERENT zones from Phase 3.

If fewer than 3 flow pairs are found, skip this phase — the codebase is too small or monolithic for cross-zone bugs.

### Step 2: Build flow tracer prompt

```
You are a cross-zone integration validator. Your job is to trace flows that span multiple parts of the codebase and find bugs that file-by-file audits cannot see.

You have READ-ONLY access to the entire repository. Do NOT modify any files.

{IF CLAUDE.md content exists}
## Project Rules (from CLAUDE.md — follow these strictly)

{CLAUDE.md content, truncated to 3000 chars}
{END IF}

## Critical Flows to Trace

{List of flow pairs from Step 1, formatted as:
  - caller: src/hooks/use-dossier-api.ts:45 → callee: apps/api-synthesia/routes/dossier/dossier_routes.py:120
  - caller: src/lib/api-client.ts:78 → callee: apps/api-synthesia/routes/chat_routes.py:55
}

## What to Look For

1. **Payload mismatches:** Frontend sends field `document_id`, backend expects `doc_id` (different name, type, or structure)
2. **Dead endpoints:** Backend route exists but no frontend code calls it, or frontend calls an endpoint that doesn't exist
3. **Auth propagation gaps:** Frontend attaches token via header, backend reads from cookie (or vice versa)
4. **State machine disconnects:** UI declares workflow phases that backend never transitions to
5. **Duplicate processing:** Same user action triggers the same backend operation more than once
6. **Proxy route mismatches:** Next.js rewrite path doesn't match backend route path or port
7. **Error shape mismatches:** Frontend expects `{ error: string }`, backend returns `{ detail: string }`
8. **Feature flags declared but unreachable:** Config enables a feature, but the code path is gated by a different condition
9. **Response shape drift:** Backend returns `{ items: [...] }` but frontend reads `response.data` directly as array
10. **Missing error boundaries:** Frontend happy path works, but error/loading/empty states are unhandled

## Methodology

For each flow pair:
1. Read the caller file — what payload does it send? what response does it expect?
2. Read the callee file — what payload does it accept? what does it return?
3. Read any middleware/proxy between them (Next.js rewrites, auth decorators, API gateway)
4. Compare: do they agree on field names, types, required vs optional, error shapes?
5. If they disagree → record as bug

## Severity Definitions

| Severity | When to use |
|----------|-------------|
| `critical` | Payload mismatch that causes crash or data loss on common path |
| `high` | Auth gap, dead endpoint called on a primary flow, duplicate processing |
| `medium` | Error shape mismatch, missing empty state, secondary flow disconnect |
| `low` | Dead endpoint on unused/deprecated flow, minor response shape drift |

## Output Format

Write findings to: {results_dir}/cross-zone-r{round_number}.json

```json
{
  "zone": "cross-zone",
  "round": {round_number},
  "files_audited": <number of flow pairs traced>,
  "duration_ms": <approximate time>,
  "bugs": [
    {
      "id": "r{round_number}-xz-001",
      "severity": "high",
      "category": "integration",
      "subcategory": "payload-mismatch",
      "file": "<caller file>",
      "line": <caller line>,
      "title": "Frontend sends doc_id, backend expects document_id",
      "description": "...",
      "caller_file": "<file that initiates the call>",
      "callee_file": "<file that receives the call>",
      "fix_applied": false,
      "fix_commit": ""
    }
  ]
}
```

## Instructions

1. Read each flow pair identified above
2. For each pair, trace the full path: UI → state → request → proxy → backend → response
3. Record mismatches as bugs with severity based on impact
4. Write the JSON output file
5. Report: "Cross-zone: {N} integration bugs found across {M} flow pairs"
```

### Step 3: Dispatch

Dispatch 1 flow tracer agent (or 2 if flow pairs > 20, splitting the list in half):

- **Tool:** Agent
- **prompt:** The filled flow tracer prompt
- **model:** sonnet
- **run_in_background:** true

**Note:** Flow tracers do NOT use worktree isolation (they are read-only). They run against the current working tree.

### Step 4: Collect results

When the flow tracer completes:
1. Read `{results_dir}/cross-zone-r{round_number}.json`
2. Validate JSON schema (same rules as zone results)
3. Store bugs for aggregation in Phase 6 — these bugs use the special category `integration` which is valid only for cross-zone results
4. Print: `Cross-zone validation: {N} integration bugs found across {M} flow pairs`

If the flow tracer fails (context overflow, error), log and continue — cross-zone validation is additive, not blocking.

### Monitor update

If `monitor_active`, POST agent-update for flow tracers with `zone_id: "cross-zone"` and `agent_id: "r{round}:cross-zone"`.

---

## Phase 5.7 — Finding Confidence Verification

After all zone agents and cross-zone validation complete, independently verify that critical/high findings are real. Zone agents can hallucinate file paths, misquote code, or describe patterns that don't exist at the cited location. This phase catches those false positives before they pollute the final report.

**When to run:** Always. Verification uses Haiku agents (cheap, fast) and typically eliminates 15-30% of false positives.

### Step 1: Collect all findings

Gather all bugs from all zone JSONs collected in Phase 5 (including cross-zone results from Phase 5.6). Group by severity.

Count critical + high bugs. If the count is 0, skip this phase entirely.

### Step 1.5: Constitutional Pre-Validation (zero-LLM cost filter)

Before spending Haiku tokens, run cheap deterministic checks on each critical/high bug. These catch obvious hallucinations for free:

| Check | How | Action on failure |
|-------|-----|-------------------|
| **File exists** | `test -f {bug.file}` | Reject immediately (score=0, verified=false) |
| **Line in range** | `wc -l {bug.file}`, check `bug.line <= total_lines` | Reject (score=5, verified=false) |
| **Bug ID format** | Regex: `^r\d+-z\w+-\d{3}$` | Fix the ID, don't reject |
| **Severity valid** | `bug.severity ∈ {critical, high, medium, low}` | Normalize, don't reject |
| **File in scope** | Check `bug.file` starts with one of the zone's declared paths | Flag as `out_of_scope: true`, still verify |
| **Title not empty** | `bug.title.length > 0` | Reject (score=0) |
| **Description not copy of title** | Jaccard similarity between title and description < 0.9 | Flag as `low_quality: true`, still verify but with suspicion |

**Execution:** Run these checks sequentially on all critical/high bugs using Bash/Read tools. No agents needed — pure file system checks.

**Outcome:**
- Bugs failing file-exists or line-in-range are immediately moved to `unverified_bugs` with `verification_score: 0` and `verified: false`. They skip Haiku verification entirely.
- Remaining bugs proceed to Step 2.

Print: `Constitutional pre-filter: {N} bugs checked, {R} rejected (file missing or line out of range), {P} passed to Haiku verification`

### Step 2: Dispatch verification agents

For each bug with severity `critical` or `high`, spawn a **Haiku** agent with this prompt:

```
You are a code finding verifier. Check if this bug report accurately describes a real issue in the code.

BUG REPORT:
- ID: {bug.id}
- File: {bug.file}
- Line: {bug.line}
- Title: {bug.title}
- Description: {bug.description}
- Category: {bug.category}

INSTRUCTIONS:
1. Use the Read tool to read the file at {bug.file}, lines {bug.line - 20} to {bug.line + 20}
2. Check: does the code at that location actually have the problem described?
3. Verify these specific things:
   a. The file exists and has content at the cited line
   b. The code pattern described in the bug actually appears near that line
   c. The described impact is plausible given the surrounding code
4. Score the finding 0-100:
   - 0-20: FALSE POSITIVE — file/line doesn't exist, or code doesn't match description at all
   - 21-40: UNLIKELY — code exists but description is inaccurate, or issue is already guarded
   - 41-60: UNCERTAIN — pattern exists but impact unclear (dead path, handled upstream)
   - 61-80: LIKELY — pattern matches, appears real, but some context unclear
   - 81-100: CONFIRMED — code clearly exhibits the described problem

Reply with EXACTLY this format (two lines):
BUG_ID: {bug.id}
SCORE: {number 0-100}
```

**Dispatch rules:**
- Spawn ALL verification agents in a **single message** (maximizes parallelism)
- Use `model: haiku` — this is a read-only verification, doesn't need stronger models
- Do NOT use worktree isolation — agents only read files, never write
- **Cap:** Maximum 50 agents per dispatch batch. If more than 50 critical/high bugs exist, verify only the first 50 (sorted: all critical first, then high, in zone order). Remaining critical/high bugs get `verification_score: null` (not verified, kept as-is).

### Step 3: Collect scores and apply

As each verification agent completes, parse its output:

1. Find the line matching `^SCORE: (\d{1,3})$` — extract the number
2. If no matching line found, assign score `50` (neutral — don't penalize agent parsing issues)
3. Match the `BUG_ID` line to find which bug this score belongs to

**Apply scores to bugs:**

| Score Range | Action | `verified` field |
|-------------|--------|-----------------|
| 80-100 | **Keep as-is** — finding confirmed | `true` |
| 40-79 | **Downgrade severity** — `critical` → `high`, `high` → `medium`. Keep in results. | `"uncertain"` |
| 0-39 | **Move to unverified** — remove from main `bugs` array, add to `unverified_bugs` array | `false` |

Add these fields to each verified bug:
- `verification_score`: the 0-100 score from the Haiku agent
- `verified`: `true`, `"uncertain"`, or `false`

**Medium and low severity bugs** are NOT verified (too many, too cheap to be worth it). They get: `verification_score: null, verified: null`.

### Step 4: Update summary counts

After filtering, recompute `summary.by_severity` and `summary.by_category` counts to reflect any downgrades and removals. Update `summary.total_bugs` to exclude unverified bugs.

### Step 5: Report

Print to the terminal:

```
Finding verification: {N} critical/high bugs checked by Haiku
  Confirmed (≥80):  {count} — kept as-is
  Uncertain (40-79): {count} — severity downgraded
  Rejected (<40):   {count} — moved to unverified_bugs
  Skipped (cap):    {count} — not verified (over 50 cap)
```

---

## Phase 6 — Aggregate + Report

### Step 1: Collect all zone JSON files

Read all zone JSON files produced in this round:
- From successfully merged worktrees: `{results_dir}/zone-{zone.id}-r{round_number}.json`
- From worktrees that had merge conflicts: read directly from the worktree path before cleanup

### Step 1.5: Normalize + Deduplicate

Before aggregation, apply two corrections to each bug in each zone JSON:

**Severity normalization:** Map any non-standard severity to the nearest valid value:
- `CRITICAL`, `Critical` → `critical`
- `HIGH`, `High`, `serious` → `high`
- `MEDIUM`, `Medium`, `warning`, `moderate` → `medium`
- `LOW`, `Low`, `info`, `minor`, `trivial`, `style` → `low`
- anything else → `medium`

**Category normalization:** Map any non-standard category to the nearest valid value:
- `error_handling`, `error-handling` → `error-handling`
- `bare_except`, `except_pass`, `except-pass`, `swallowed-exception` → `silent-exception`
- `auth`, `auth-bypass`, `xss`, `injection`, `secrets` → `security`
- `null-check`, `null_check`, `missing-guard` → `api-guard`
- `unused`, `unused-code`, `unreachable` → `dead-code`
- `hydration`, `ssr`, `csr-mismatch` → `ssr-hydration`
- `validation`, `sanitization` → `input-validation`
- `leak`, `unclosed`, `memory-leak` → `resource-leak`
- `types`, `type_mismatch`, `schema` → `type-mismatch`
- `docker`, `ci`, `build`, `env` → `infra`
- `perf`, `n+1`, `re-render` → `performance`
- `a11y`, `aria`, `contrast` → `accessibility`
- `race`, `concurrency`, `toctou` → `race-condition`
- `off-by-one`, `wrong-condition`, `algorithm` → `logic-error`
- `cross-zone`, `payload-mismatch`, `dead-endpoint`, `contract-mismatch` → `integration`
- anything else not in the 16 valid categories → `other`

**Deduplication:** Group bugs by `(file, title_normalized)` where `title_normalized` is the title lowercased with whitespace collapsed. If multiple bugs have the same file+title:
- Keep the one with the highest severity
- Set `occurrence_count` to the number of duplicates found
- Discard the rest

Log: `Normalized {N} severity values, {M} category values, deduplicated {D} bugs.`

### Step 2: Build audit-results.json

Merge all zone results into a single aggregated file:

```json
{
  "repo": "<repository name from git remote or directory name>",
  "timestamp": "<ISO 8601 timestamp, e.g. 2026-04-10T08:30:00Z>",
  "mode": "<quick|standard|deep|paranoid>",
  "prompt_hash": "<SHA256 hex of prompt template + activated checklists + learnings>",
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
      "integration": <count>,
      "other": <count>
    },
    "files_audited": <sum of files_audited across all zones>,
    "files_modified": <count of unique files with fix_applied: true>,
    "duration_ms": <total wall-clock time from Phase 1 start to Phase 6>,
    "risk_score": <0-100 diminishing-returns score>
  },
  "impacted_ui_routes": [
    {"route": "<url path>", "reason": "<bug title + file>", "severity": "<highest severity bug for this route>"}
  ],
  "impacted_backend": [
    {"endpoint": "<API path or service name>", "reason": "<bug title + file>", "severity": "<severity>"}
  ],
  "verification": {
    "checked": <number of critical/high bugs verified>,
    "confirmed": <count with score >= 80>,
    "uncertain": <count with score 40-79>,
    "rejected": <count with score < 40>,
    "skipped": <count not verified due to cap>
  },
  "bugs": [<all verified + uncertain bugs from all zones and rounds>],
  "unverified_bugs": [<bugs rejected by Phase 5.7 verification (score < 40) — kept for audit trail>]
}
```

Each bug in the `bugs` array includes two additional fields from Phase 5.7:
- `verification_score`: 0-100 integer (or `null` if not verified — medium/low severity)
- `verified`: `true` (score >= 80), `"uncertain"` (40-79), or `null` (not checked)

When `scope_mode == "full"`: `"scope_info": {"mode": "full"}` — no other fields.
When `scope_mode == "diff"`: include all fields above.

### Step 3: Derive impacted routes

Split bug impacts into two arrays: `impacted_ui_routes` (URL paths that `/sg-visual-run --from-audit` can test) and `impacted_backend` (API endpoints, services, infra that have no visual test). This prevents "uncovered route" noise for things that can't have visual tests.

For each bug, first classify: is the file a **frontend** file (under `src/app/`, `src/pages/`, `src/components/`, `public/`) or a **backend** file (Python routes, services, Dockerfiles, config)? Frontend bugs go to `impacted_ui_routes`, backend bugs go to `impacted_backend`.

For frontend bugs, map the file path to the most likely UI route. Use framework-specific detection (based on what was detected in Phase 2):

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

4. **Static HTML fallback:** If no JS framework is detected:
   - Glob `*.html` in `src/`, `public/`, and the repo root
   - Each HTML file becomes a route: `index.html` → `/`, `about.html` → `/about.html`, `public/help/index.html` → `/help/`
   - Map bugs to routes by checking if the bug's file path is referenced (via `<script src>` or `<link href>`) in any HTML file
   - If a bug is in an HTML file directly, the route is the file's derived URL

5. **Generic fallback:**
   - Extract the parent directory name from the bug's file path
   - If visual test manifests exist (`visual-tests/**/*.yaml`), match the directory name against manifest `url` fields
   - If no match, use the directory name as a best-guess route: `src/components/dashboard/` maps to `/dashboard`

**Do NOT hardcode any project-specific paths.** All route detection must be generic and work on any repository.

Deduplicate routes: if multiple bugs map to the same route, keep one entry with the highest severity and a combined reason.

If no routes can be derived (no framework, no HTML files, no manifest matches), set `impacted_ui_routes` to an empty array `[]`.

### Step 3.5: Compute risk score (diminishing-returns model)

Compute a single 0-100 `risk_score` for the audit. This score represents overall codebase risk, not just a count of findings. It uses geometric weighting so that many low-severity findings don't inflate the score past the impact of the worst single finding.

**Algorithm:**

1. Assign base points per severity:
   - `critical` = 25 points
   - `high` = 15 points
   - `medium` = 5 points
   - `low` = 1 point

2. Sort all bugs by base points descending (highest severity first).

3. Apply geometric decay: the Nth finding contributes `base_points × 0.5^(N-1)`:
   - 1st finding: 100% of its base points
   - 2nd finding: 50%
   - 3rd finding: 25%
   - 4th finding: 12.5%
   - ...and so on

4. Sum all weighted points. Cap at 100.

**Example:**
- 1 critical + 3 high + 10 medium:
  - 25×1.0 + 15×0.5 + 15×0.25 + 15×0.125 + 5×0.0625 + ... ≈ 38.4
- 1 critical alone: 25.0
- 50 lows: 1×1.0 + 1×0.5 + 1×0.25 + ... ≈ 2.0 (many trivial findings barely move the score)

**Interpretation:**
- 0-15: Low risk — mostly clean
- 16-35: Moderate risk — some real issues
- 36-60: High risk — significant bugs found
- 61-100: Critical risk — severe issues present

Store as `summary.risk_score` in audit-results.json (integer, 0-100).

### Step 4: Write results

Write `audit-results.json` to `{results_dir}`. The `results_dir` was determined in Phase 1 and is the single source of truth for all output files.

### Step 4.5: Write TOON compact format

Also write `audit-results.toon` alongside the JSON file. TOON (Token-Optimized Output Notation) is a compact format that reduces token cost by ~40% when results are fed back into LLM agents (e.g., for sg-improve analysis or cross-session comparison).

**Format specification:**

```
# audit-results.toon
# repo:{repo} mode:{mode} ts:{timestamp} rounds:{rounds} agents:{agents}
# scope:{scope_mode} diff_files:{diff_files} total:{total_in_scope}
# summary: total={total_bugs} critical={critical} high={high} medium={medium} low={low}
# verified: checked={checked} confirmed={confirmed} uncertain={uncertain} rejected={rejected}
# bugs[{bug_count}]{id,severity,category,file,line,title,verified,score}:
r1-z01-001,high,logic-error,apps/uranus/src/components/foo.tsx,71,key={index} on reorderable list,true,95
r1-z01-002,medium,error-handling,apps/api-synthesia/routes/chat.py,142,bare except swallows errors,uncertain,55
r1-z03-001,high,security,apps/uranus/src/lib/auth.ts,23,JWT secret in client bundle,true,98
...
```

**Rules:**
- Header lines start with `#` — contain metadata as key:value pairs
- The `# bugs[N]{fields}:` line declares the column order (header-once pattern)
- One bug per line after the header, CSV-formatted (commas, no spaces around commas)
- Fields with commas in their values are quoted: `"title, with comma"`
- `verified` column: `true`, `uncertain`, `null` (not checked), or `false` (in unverified section)
- `score` column: 0-100 integer or `null`
- If `unverified_bugs` is non-empty, add a second section:
  ```
  # unverified[{count}]{id,severity,category,file,line,title,score}:
  r1-z02-005,high,logic-error,apps/foo/bar.py,30,False positive finding,12
  ```

The TOON file is informational — the JSON file remains the canonical source. TOON is for feeding into LLM context where token efficiency matters.

### Step 5: Print summary

Print a summary table to the terminal:

```
=== Code Audit Complete ===

Mode: {mode} | Agents: {actual_count} | Rounds: {round_count}
Duration: {formatted_duration}

Bugs found: {total} ({verified_count} verified, {uncertain_count} uncertain, {rejected_count} rejected)
  Critical: {count}  High: {count}  Medium: {count}  Low: {count}

Top categories:
  {category}: {count}
  {category}: {count}
  {category}: {count}

Files audited: {count}
Files modified: {count}{IF not fix_mode} (report-only mode){END IF}

{IF skipped_merges exist}
Merge conflicts (manual resolution required): {count} zones
{END IF}

Results: {path to audit-results.json}
         {path to audit-results.toon} (compact, ~40% fewer tokens)

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
    7. If round_number < round_count (more rounds remain):
       - Run: git status --porcelain
       - If the output is NOT empty (uncommitted changes or leftover merge artifacts):
         commit or stash all changes before proceeding.
         Print: "Working tree not clean between rounds — committing/stashing before round {round_number + 1}."
       - Only then continue to the next round.

After all rounds:
    7. Verify critical/high findings with Haiku agents (Phase 5.7)
    8. Aggregate ALL rounds into a single audit-results.json (Phase 6)
    9. Write TOON compact format (Phase 6 Step 4.5)
    10. Print final summary
```

### Round-specific behavior

- **Round 1:** Standard dispatch. Agents see only the round focus + language checklists.
- **Round 2+:** Agents receive an additional context block. The wording depends on `fix_mode`:
  - If `fix_mode` is true:
    ```
    A previous audit round already found and fixed bugs. Your job:
    1. Verify previously applied fixes are correct (check for regressions)
    2. Find DEEPER issues the surface scan missed
    3. Do NOT re-report bugs already found — focus on NEW findings
    ```
  - If `fix_mode` is false (report-only mode):
    ```
    A previous audit round already found bugs (not fixed — report-only mode). Your job:
    1. Verify previously found bugs are still present (no regressions from external changes)
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
    "by_category": {"security": 5, "race-condition": 8, "silent-exception": 12, "api-guard": 6, "resource-leak": 0, "type-mismatch": 0, "dead-code": 2, "infra": 4, "ssr-hydration": 0, "input-validation": 0, "error-handling": 3, "performance": 0, "accessibility": 0, "logic-error": 1, "integration": 2, "other": 9},
    "files_audited": 187,
    "files_modified": 34,
    "duration_ms": 612000
  },
  "impacted_ui_routes": [
    {"route": "/dashboard", "reason": "Zustand store bug in dashboard-store.ts", "severity": "high"}
  ],
  "impacted_backend": [
    {"endpoint": "POST /dossier/{id}/analyze", "reason": "Missing ownership check in dossier_routes.py", "severity": "critical"}
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
- [ ] impacted_ui_routes + impacted_backend derived using generic detection (no hardcoded paths)
- [ ] Summary printed to terminal
- [ ] Next steps suggested (/sg-visual-run --from-audit, /sg-visual-review)
