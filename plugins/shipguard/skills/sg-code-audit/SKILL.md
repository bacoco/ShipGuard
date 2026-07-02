---
name: sg-code-audit
description: Use when code has changed and needs a bug audit before shipping — after a feature, before a PR, or on demand for any scoped path. Emits structured findings consumed by the ShipGuard pipeline.
context: conversation
argument-hint: "[quick|standard|deep|paranoid] [--focus=path] [--report-only] [--all] [--diff=ref] [--model=auto|sonnet|opus] [--monitor]"
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
| `/sg-code-audit --diff=main` | Audit only files changed since `main` + their importers |
| `/sg-code-audit --all` | Force full codebase audit (skip scope question) |
| `/sg-code-audit --model=opus` | Use opus for all rounds (maximum depth) |
| `/sg-code-audit --monitor` | Start/attach the real-time monitor dashboard without asking |
| `/sg-code-audit deep --model=opus --focus=src/ --report-only` | Flags combine freely (mode, model, focus, scope, report-only) |

**Diff scope covers committed changes only.** `--diff` uses the three-dot merge-base diff (`git diff {ref}...HEAD`), which sees committed work only — commit or stash uncommitted/staged changes before running in diff mode.

Sandbox note: report-only avoids source writes, but agent dispatch, Git worktrees, GitHub hooks, and local monitor POSTs may still need permissions. See [../../docs/sandbox.md](../../docs/sandbox.md).

## Reference files

| File | Contents |
|------|----------|
| `references/agent-prompt.md` | Zone-agent prompt template, severity calibration, category taxonomy, self-validation, round 2+ context blocks |
| `references/verification.md` | Post-merge validation commands, flow-tracer template, Phase 5.6/5.7 protocol, constitutional pre-filter |
| `references/output-schema.md` | Canonical output schemas, TOON format, normalization maps, lifecycle/accepted-risks procedures, risk score, route derivation, terminal summary |
| `references/monitor.md` | Phase 0 monitor setup, all monitor POST payloads |
| `references/checklists.md` | Round focus descriptions + language-specific checklists |

## AUDITABLE extensions (shared list)

One list drives Phase 2 stack detection, both Phase 3 zone-discovery `find` commands, and the Phase 1 diff filter:

`py, ts, tsx, js, jsx, go, rs, java, kt, html, css`

Infra files (`Dockerfile*`, `docker-compose*`, `*.yaml`, `*.yml`, `*.toml`, `Makefile`, CI configs) are additionally kept by the diff filter and always form the dedicated infra zone (Phase 3).

---

## Phase 0 — Monitor Setup

Detect or start the review server for real-time audit monitoring. Optional — if the user declines or the server can't start, the audit proceeds normally.

- `results_dir` is always `visual-tests/_results/` — run `mkdir -p visual-tests/_results` first.
- Check ports 8888/8889/8890 for an existing server whose `/health` response reports the same `results_dir`; attach if found.
- If none found: **default monitor OFF.** Start a server only if `--monitor` was passed, or if mode is `deep`/`paranoid` (estimated >15 min) and the user answers yes to "Monitor progress in a dashboard?".
- Store `monitor_active` (boolean) and `monitor_url` as working variables.

Load `references/monitor.md` § "Phase 0 — Monitor Setup" for the full health-check, bootstrap, and server-start procedure. All monitor POSTs in later phases use the payloads in `references/monitor.md` § "POST payloads".

---

## Phase 1 — Parse Arguments

Parse the user's input into working values: **mode**, **focus**, **fix_mode**, **model**, and **scope**.

1. Extract the first positional argument. Match against `quick`, `standard`, `deep`, `paranoid`. Default: `standard`.
2. Extract `--focus=<path>`. If present, store as `focus_path`. If not, scope is the entire repo.
3. Check for `--report-only`. If present, set `fix_mode = false`. Default: `fix_mode = true`. Also check for `--monitor` — it forces the Phase 0 monitor on without asking.
4. Check for `--model=<model>`. Values: `sonnet`, `opus`, `auto`. Default: `auto`.
   - `auto` (default): the balanced profile — audit agents run on the strongest available model (opus) in every round, and verification agents (Phase 5.7) run on a fast verification model (sonnet).
   - `sonnet`: audit agents use sonnet (fallback when the opus weekly quota is saturated).
   - `opus`: audit agents use opus — the explicit spelling of the `auto` audit profile.

   **NEVER use haiku.** Haiku is permanently banned for audit agents — it fails under load (529) and produces inferior results. If a user passes `--model=haiku`, print `haiku is banned for audits — using sonnet instead.` and proceed with sonnet.

   Regardless of model, always append the mandatory anti-self-censoring instruction to every agent prompt — verbatim text in `references/agent-prompt.md` § "Orchestrator notes (do NOT paste into the agent prompt)".
5. Parse scope flags:
   - `--all` → `scope_mode = "full"`. `--diff=<ref>` → `scope_mode = "diff"`, `scope_ref = <ref>`.
   - If BOTH are present: **error.** Print `Cannot use --all and --diff together.` and stop.
   - If neither is present, set `scope_mode = "interactive"`.

6. If `scope_mode == "interactive"`:
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
   b. Run `git diff --name-only {base}...HEAD` (three-dot — committed changes only) to get changed files.
   c. If `focus_path` is set, filter the changed files to that subtree before asking. `--diff` and `--focus` both apply.
   d. If the diff is NOT empty, ask the user: "I detected {N} files changed since `{base}`. What scope? 1. **Only what changed** — {N} files + importers (~{est} min) 2. **Full codebase** — {total_file_count} files (~{est} min) 3. **Different base**". Estimates: diff ≈ ceil(diff_files / 30) min; full ≈ ceil(total_files / 200) × round_count min. Pick 1 → `scope_mode = "diff"`, `scope_ref = {base}`; pick 2 → `"full"`; pick 3 → ask for a ref, then `"diff"` with that ref.
   e. If the diff IS empty, get the last commit (`git log --oneline -1`) and ask: "No diff vs `{base}`. Audit the last commit `{sha}: {message}`? 1. **Last commit** — {N} files 2. **Full codebase** 3. **Different base**". Pick 1 → `scope_mode = "diff"`, `scope_ref = "HEAD~1"`; pick 2 → `"full"`; pick 3 → ask for ref.

7. If `scope_mode == "diff"`:
   a. Get changed files: `git diff --name-only {scope_ref}...HEAD` → store as `diff_files[]`. This three-dot diff covers committed changes only; if `git status --porcelain` shows uncommitted or staged work, warn the user to commit or stash it first — it is invisible to the diff.
   b. If `focus_path` is set, filter `diff_files[]` to that subtree before import expansion.
   c. Filter out binary files (images, fonts, compiled assets). Keep only AUDITABLE extensions (shared list above) plus infra files (`*.yaml`, `*.yml`, `Dockerfile*`).
   d. For each changed source file, find direct importers (1 level):
      ```bash
      grep -rl "from.*['\"].*{relative_path_without_ext}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=venv --exclude-dir=.venv --exclude-dir=dist --exclude-dir=build .
      grep -rl "require(.*{relative_path_without_ext}" --include="*.js" --include="*.ts" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=venv --exclude-dir=.venv --exclude-dir=dist --exclude-dir=build .
      ```
      Use the relative path (e.g. `hooks/use-dossier`), not just the filename stem, to reduce false matches. Deduplicate results.
   e. Combine: `scope_files = diff_files + importer_files` (deduplicated).
   f. If `importer_files` count > 3x `diff_files` count, warn: `{N} files modified. Import expansion found {M} importers (noisy). Run on modified files only, or include importers?` If the user picks "modified only" → `scope_files = diff_files`.
   g. Print: `{diff_count} files modified + {importer_count} importers = {total} files to audit`
   h. Store `scope_files`, `diff_files`, and `importer_files` for zone discovery.

   **Focus-path filtering:** Apply `focus_path` filtering once, immediately after collecting `scope_files` (7b for diff scope, or at the start of Phase 3 Step 1 for full scope). Do not re-filter in later steps.

8. Look up mode parameters:

| Mode | Max Agents | Rounds | Description |
|------|-----------|--------|-------------|
| `quick` | 5 | 1 | Surface scan — known patterns, lint-like |
| `standard` | 10 | 1 | Standard audit — known patterns with broader coverage |
| `deep` | 15 | 2 | Surface + runtime behavior analysis |
| `paranoid` | 20 | 3 | Surface + behavior + edge cases and security |

   **Auto-adjust agent count:** the table gives maximums. Scale to file count: `agent_count = min(mode_max_agents, ceil(total_file_count / 7))` — a 34-file project in `standard` gets 5 agents, not 10. This prevents agents with 2-3 files each from producing shallow results.

9. Store working variables: `agent_count`, `round_count`, `focus_path`, `fix_mode`, `scope_mode`, `scope_ref`, `scope_files`, `diff_files`, `importer_files`.
10. Determine `results_dir`: **always** `visual-tests/_results/` at the repo root — run `mkdir -p visual-tests/_results` first. All zone JSON copies and the final `audit-results.json` go here. (`.code-audit-results/` is a legacy location some older runs used; consumers still read it as a fallback, but this skill never writes there.)
11. Print: `Code audit: {mode} mode ({agent_count} agents, {round_count} round(s)){", model: " + model_strategy}{", focus: " + focus_path if set}{", report-only" if not fix_mode}{", scope: diff vs " + scope_ref + " (" + total_in_scope + " files)" if scope_mode == "diff"}`
12. **Compute prompt hash:** after Phase 2 (when checklists are known), compute a SHA256 hash of the prompt template + activated checklists + learnings audit_hints. Store as `prompt_hash` and include in `audit-results.json`. `sg-improve` reads this to detect prompt changes and flag baseline discontinuity in `learnings.yaml` session_history.

---

## Phase 2 — Detect Stack

Scan the repository root (or `focus_path` if set) to identify languages and frameworks. Activate only the relevant checklists from `references/checklists.md`. The Glob checks below cover every AUDITABLE extension (shared list above):

1. **Python:** Glob `**/*.py` — if matches > 0 AND (`**/requirements.txt` OR `**/pyproject.toml` OR `**/setup.py`): activate Python checklist
2. **TypeScript:** Glob `**/*.ts` OR `**/*.tsx` — if matches > 0 AND `**/package.json`: activate TypeScript/React checklist
3. **Infra:** Glob `**/Dockerfile*` OR `**/docker-compose*`: activate Infrastructure checklist
4. **Next.js:** Glob `**/next.config.*`: activate Next.js checklist
5. **Go:** Glob `**/*.go`: activate Go checklist
6. **Rust:** Glob `**/*.rs`: activate Rust checklist
7. **JVM:** Glob `**/*.java` OR `**/*.kt`: activate JVM checklist
8. **HTML/CSS/JS (vanilla):** Glob `**/*.html`, `**/*.css`, `**/*.js`, `**/*.jsx` — if HTML matches > 0 AND none of the framework-specific indicators above (no `next.config.*`, no `package.json` with React/Vue/Angular, no `*.py` with Flask/FastAPI): activate HTML/CSS/JS checklist. Covers static sites, Hugo/Jekyll output, and vanilla JS projects.

After detection, read `CLAUDE.md` from the repository root if it exists; store its contents (truncated to 3000 characters) for injection into agent prompts. Store `detected_languages = ["python", "typescript", ...]` and the activated checklist text blocks.

Print: `Detected: {detected_languages joined by ", "}. CLAUDE.md: {"found" if exists else "not found"}.`

---

## Phase 3 — Discover Zones

Split the codebase into non-overlapping zones, one per agent. Zones must not share files — each source file belongs to exactly one zone.

**Step 0 — previously skipped zones:** if `{results_dir}/_skipped_zones.json` exists from a previous audit, read it, **prioritize** those zones (first in the dispatch queue) with `max_files` reduced 30% from the previous run (to avoid the same overflow), print `Found {N} zones skipped in previous audit — prioritizing them with smaller sizes`, then delete the file (it is recreated if zones fail again).

**If `scope_mode == "diff"`:** zone discovery operates on `scope_files` instead of the full repo. Simplified strategy:

1. Group `scope_files` by parent directory (first 2 path segments, e.g. `src/routes/`)
2. Each group becomes a zone candidate
3. Group <=30 files → 1 zone; >30 files → split by subdirectory (same rules as full mode)
4. Merge groups with <5 files into their nearest neighbor (longest common path prefix; if none shared, into the group with the fewest files)
5. Cap to `agent_count` (same merge/split logic as full mode)

Print: `Scoped zone discovery: {zone_count} zones from {file_count} files (diff mode)`

**If `scope_mode == "full"`:** use the directory-based algorithm below.

### Step 1: Count files per directory

Run with Bash (the `-name` list is exactly the AUDITABLE extension list):

```bash
find {repo_root_or_focus_path} \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.kt' -o -name '*.html' -o -name '*.css' \) -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/venv/*' -not -path '*/__pycache__/*' -not -path '*/.next/*' -not -path '*/dist/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn
```

This produces lines like `   42 ./src/routes`. **IMPORTANT:** use `sort` (not `sort -u`) before `uniq -c` so duplicate directory paths are counted correctly — with `sort -u` every count becomes 1.

### Step 1.5: Read learnings (if available)

If `{repo_root}/.shipguard/learnings.yaml` exists, read it: `zone_hints` (per-path `max_files` overrides), `audit_hints` (patterns to inject into agent prompts), `noise_filters` (patterns to batch in agent prompts). Print: `Loaded {N} zone hints, {M} audit hints, {K} noise filters from .shipguard/learnings.yaml`. If absent, skip silently.

### Step 2: Apply splitting rules

Use **token-weighted thresholds** instead of raw file counts: `file_weight = max(1, file_line_count / 50)`; `zone_weight = sum(file_weights)`. Approximate by sampling the first 5 files per directory with `wc -l`: `estimated_zone_weight = file_count × avg_weight`.

If a directory path matches a learnings zone_hint, use `hint.max_files` as the hard cap instead of these defaults:

- **estimated_weight <= 40** → 1 zone
- **estimated_weight 41-100** → split by immediate subdirectories; re-run the count on children (same AUDITABLE extension list, `find {dir} -maxdepth 2 \( ...same -name list... \) | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn`). Each child becomes a zone.
- **estimated_weight > 100** → split by sub-subdirectories (depth 3); each becomes a zone.
- **Infra files** → always 1 **mandatory dedicated zone**, even in `quick` mode. Collect `Dockerfile*`, `docker-compose*`, `*.yml`, `*.yaml`, `.env*`, `.env.example`, `Makefile`, `*.toml` (pyproject.toml, Cargo.toml), `*.cfg`, `.github/workflows/*`, `.gitlab-ci.yml` in the repo root, `infra/`, or `deploy/`. In `deep`/`paranoid` modes the infra zone gets its own R2 round focused on: env var consistency (referenced in code vs declared in compose), port mapping verification (code defaults vs compose ports), and healthcheck coverage.

### Step 3: Merge small zones

Any zone with fewer than 5 files merges into the nearest sibling zone (longest common path prefix).

### Step 4: Match zone count to agent count

- Zone count > `agent_count`: repeatedly merge the two smallest zones (by file count) until equal.
- Zone count < `agent_count`: repeatedly split the largest zone in two (by subdirectory boundary) until equal.
- **Flat directory fallback:** a zone with no subdirectories splits by alphabetical file list into two equal halves (handles flat `src/` or `lib/`).
- **Overshoot guard:** if a split would exceed `agent_count`, apply the merge step immediately after to bring the total back down.

### Step 5: Store zones

```json
[
  {"id": "z01", "paths": ["src/routes/", "src/middleware/"], "file_count": 28},
  {"id": "z02", "paths": ["src/hooks/", "src/stores/"], "file_count": 22},
  {"id": "z03", "paths": ["infra/"], "file_count": 12}
]
```

Print: `Discovered {zone_count} zones ({total_file_count} files total). Dispatching {agent_count} agents.`

---

## Phase 3.5 — Monitor: Initialize

Runs **once**, after zones are known and **before** the round loop begins. Must NOT be repeated on subsequent rounds — re-POSTing resets all monitor state.

If `monitor_active` is true, POST audit-start to seed all zone state on the monitor server. Payload and overflow-children notes: `references/monitor.md` § "audit-start (Phase 3.5)". If the POST fails, set `monitor_active = false` and continue silently.

---

## Phase 4 — Build Prompts + Dispatch Agents

The core execution phase. For each round (1 to `round_count`), build prompts and dispatch agents.

### Round descriptions

| Round | Focus | Description |
|-------|-------|-------------|
| R1 — Surface | Known patterns, lint-like | Silent exceptions, missing guards, dead code, type mismatches, missing cleanup |
| R2 — Depth | Runtime behavior | Race conditions, cross-service integration, auth gaps, resource leaks, SSR issues |
| R3 — Edge Cases | What R1+R2 missed | Logic errors, prompt injection, data corruption, null propagation, off-by-one, performance |

### Prompt template

Load `references/agent-prompt.md` § "Prompt template" and instantiate it per zone with the `{zone}`, `{round_number}`, `{base_sha}`, checklist, learnings, and fix-mode variables. Follow that file's "Orchestrator notes" — in particular: agents write their zone JSON to the **relative** path `visual-tests/_results/zone-{zone.id}-r{round_number}.json` inside their own worktree, and every prompt gets the mandatory anti-self-censoring instruction appended.

### Dispatch

For each zone, dispatch an agent:

- **Tool:** Agent
- **prompt:** the filled prompt template
- **isolation:** worktree
- **model:** per the `--model` flag (Phase 1 step 4): `auto`/`opus` → the strongest available model (opus) for all audit rounds; `sonnet` → sonnet. NEVER use haiku — it is permanently banned.
- **run_in_background:** true

**Staggered dispatch:** do not launch all agents in the same instant. Dispatch in **batches of up to 10 agents per message** to limit API burst load — this prevents 529 overload errors caused by too many agents requesting context simultaneously. The same batching rule applies to verification agents in Phase 5.7.

**Dispatch log:** maintain an in-memory dispatch log with one entry per dispatched agent: `{zone_id, agent_id, status, dispatched_at, retry}`. When a retry is dispatched, mark the original agent `superseded` (with reason). If multiple completions arrive for the same zone in Phase 5, use the result from the most recent agent_id (highest retry count) and discard earlier results.

**Note on worktrees:** the Agent tool with `isolation: worktree` automatically creates a temporary git worktree and branch. The branch name is returned in the agent's result as `branch` — record it in the dispatch log for the merge phase. Record `base_sha = git rev-parse HEAD` **once at dispatch time** and inject it into every agent prompt: each worktree agent verifies `git rev-parse HEAD` equals `{base_sha}` (and runs `git reset --hard {base_sha}` if not) before working, and the merge phase verifies branch ancestry from `base_sha`.

Print: `Round {round_number}: Dispatched {agent_count} agents (batches of {batch_size}). Waiting for completion...`

If `monitor_active`, POST agent-started after dispatching each agent — payload in `references/monitor.md` § "agent-started (Phase 4)".

---

## Phase 5 — Collect + Retry

As each background agent completes, process its result.

### Zone-JSON transport (authoritative rule)

Zone agents write their JSON to the **relative** path `visual-tests/_results/zone-{zone.id}-r{round_number}.json` inside their own worktree. The orchestrator **copies each zone JSON out of `{worktree_path}` into `{results_dir}` as soon as that agent completes — always BEFORE any merge and BEFORE any `git worktree remove`.** Worktree merges never deliver zone JSONs (untracked files do not merge); this copy is the only transport.

### On agent completion

1. Read the agent's output text.
2. **"Prompt is too long" / "context window":** the zone was too large. Split `zone.paths` into two roughly equal groups (by file count), create zones `{zone.id}a` and `{zone.id}b`, dispatch two new agents with the same template but narrower scope, and track them. **Single-path zone edge case:** split the individual files under that path in half alphabetically; if the zone has fewer than 3 files, mark it `failed` (cannot split further) and log `Zone {zone.id} too small to re-split ({N} files) — skipping.` Print: `Zone {zone.id} context overflow — re-splitting into {zone.id}a and {zone.id}b`
3. **Success:** the zone JSON is at `{worktree_path}/visual-tests/_results/zone-{zone.id}-r{round_number}.json` (`worktree_path` is returned in the agent result). **Copy it into `{results_dir}` now** (transport rule above). Validate it parses and has the required fields (`references/agent-prompt.md` § "Output Validation Contract"). If validation fails, retry the agent ONCE with this appended to the prompt: "Your previous output was malformed: {validation_error}. Rewrite the JSON file with correct format." Store the parsed results. Print: `Zone {zone.id} complete: {N} bugs found`
4. **API overload (529, "overloaded_error"):** retry with exponential backoff — 30s, then 60s, then 120s. After 3 retries, mark `failed` and add to `_skipped_zones.json` (Phase 5.5 Step 4). Print: `Zone {zone.id} API overload — retry {N}/3 in {delay}s`. Track retry count per zone in the dispatch log to avoid duplicate agent waste.
5. **Any other error:** log it, print `Zone {zone.id} failed: {error summary}`, add to `_skipped_zones.json` for the next run. Do NOT retry — move on.

If `monitor_active`, POST agent-update after processing each result (success / overflow / error) — payloads in `references/monitor.md` § "agent completion (Phase 5)".

**Track completion:** maintain counters `completed`, `pending`, `failed`. A re-split increments `pending` by 2 and decrements by 1 (net +1).

### When all agents for this round are complete

#### Prerequisite: Clean working tree check

Run `git status --porcelain`. If the output is NOT empty, **abort the merge phase** and warn:

```
WARNING: Uncommitted changes detected in the working tree.
Commit or stash your changes before merging audit fixes.
Skipping merge phase — audit results are still available in worktree branches.
```

Do NOT merge. Skip to Phase 6 using the zone JSONs already copied into `{results_dir}`.

#### Merge worktree branches (fix mode only)

If `fix_mode` is true AND the working tree is clean, for each completed zone with a worktree branch:

1. **Ancestry check:** verify the branch descends from the dispatch base — `git merge-base {base_sha} {agent.branch}` must print `{base_sha}`. If not, the worktree started from a stale base: skip the merge, log `Zone {zone.id}: stale base (expected {base_sha})`, add the zone to `skipped_merges`.
2. Run `git merge {agent.branch} --no-edit` (branch name from the dispatch log).
3. Check the exit code:
   - **Success (exit 0):** record the merge in a `merge_log`: `{zone_id, branch, merge_sha: $(git rev-parse HEAD)}`. Continue.
   - **Conflict:** run `git diff --name-only --diff-filter=U` to list conflicting files; log `Merge conflict in zone {zone.id}: {conflicting_files}`; run `git merge --abort`; add the zone to `skipped_merges`; continue to the next branch.

**IMPORTANT:** do NOT use `git checkout --theirs` or any auto-resolution strategy. A conflict means two zones touched the same file — a zone boundary error the user must resolve manually.

After all merges:

1. **Verify every completed zone's JSON was already copied into `{results_dir}`** (Phase 5 copies at completion — including zones in `skipped_merges`). If any is missing and its worktree still exists, copy it now, before cleanup.
2. Clean up worktrees: `git worktree remove {worktree_path} --force` — only after step 1 confirms the zone JSON is safe.
3. Clean up branches: `git branch -d {agent.branch}` for each merged branch, using the branch names returned by the Agent tool and recorded in the dispatch log (skip branches in `skipped_merges` — the user needs them). Do not glob for branch name patterns — only delete branches this run created.
4. If `skipped_merges` is not empty, report:
   ```
   Merge conflicts in {N} zones — manual resolution required:
   - Zone {id}: {conflicting files}
   These zone branches are preserved for manual merge.
   ```

---

## Phase 5.5 — Post-Merge Validation

After all worktree merges complete (or after the clean tree check if no merges happened), validate that the merged code is syntactically correct. Audit fixes can introduce regressions — bad indentation from merge, wrong imports from copy-paste, broken syntax from adjacent edits.

### Step 1: Identify modified files

Use the `merge_log` recorded in Phase 5 (one entry per successful merge). For each entry, run `git diff --name-only {merge_sha}^1 {merge_sha}`. The union of these lists is the set of files modified by audit fixes, and each file maps directly to the zone whose merge introduced it. Do NOT reconstruct this with `HEAD~N` arithmetic — skipped merges make the count wrong.

### Step 2: Run language-specific syntax checks

For each modified file, run the syntax checks in `references/verification.md` § "Post-merge validation commands (Phase 5.5)": Python `ast.parse` per file; `npx tsc --noEmit` once if `tsconfig.json` exists; `go build ./...` once if `go.mod` exists.

### Step 2.5: Targeted functional tests (optional)

In `deep` and `paranoid` modes only (skip in `quick`/`standard`), run targeted tests covering the modified zones — NOT the full suite. Commands in the same reference section: pytest with a two-candidate lookup per modified file (sibling `{dir}/tests/test_{basename}`, then repo-root `tests/test_{basename}`); `npx jest --findRelatedTests` if `package.json` has a test script.

If tests fail, do NOT revert — log the failure and set `"test_regression": true` on the affected zone's results. The fix may be correct while the test needs updating. Print: `Targeted tests: {N} test files run, {M} failures`

### Step 3: Handle failures

If ANY syntax check fails:

1. **Log:** `Post-merge syntax error: {file}:{line} — {error}`
2. **Revert** the offending merge using its recorded SHA from the `merge_log` (the file → zone mapping from Step 1 identifies which merge introduced the broken file): `git revert -m 1 {merge_sha} --no-edit`. Revert only that zone's merge commit — never neighboring merges.
3. **Mark** the zone `fix-reverted` in the results
4. **Add** it to `_skipped_zones.json` so the next audit retries it
5. **Continue** to Phase 6 — the other zones' fixes are still valid

Print:
```
Post-merge validation: {N} files checked, {M} errors found
  ⚠ {file}:{line} — {error_type}: {message}
  → Reverted merge for zone {zone_id}. Fix needs manual review.
```

If all checks pass: `Post-merge validation: {N} files checked — all clean ✓`

### Step 4: Write _skipped_zones.json

Persist failed zones (context overflow, API overload after 3 retries, merge conflict, syntax error after merge) to `{results_dir}/_skipped_zones.json` — format in `references/output-schema.md` § "Skipped zones format (_skipped_zones.json)". Phase 3 Step 0 prioritizes these zones on the next run and deletes the file after successful completion.

---

## Phase 5.6 — Cross-Zone Flow Validator

After zone agents and post-merge validation complete, dispatch 1-2 **flow tracer** agents to catch cross-zone integration bugs that isolated zone agents cannot see — they excel at per-file patterns but are blind to mismatches between a frontend caller and a backend callee in different zones.

**When to run:** always in `deep` and `paranoid` modes. Skip in `quick`. In `standard`, run only if the detected stack includes both frontend AND backend (e.g., TypeScript + Python).

Load `references/verification.md` § "Cross-Zone Flow Validator (Phase 5.6)" for the full procedure: Step 1 (identify critical flows via integration-boundary greps — skip the phase if fewer than 3 flow pairs), Step 2 (flow tracer prompt template), Step 3 (dispatch: fast verification model, read-only, no worktree), Step 4 (collect `{results_dir}/cross-zone-r{round_number}.json`).

If the flow tracer fails, log and continue — cross-zone validation is additive, not blocking.

---

## Phase 5.7 — Finding Confidence Verification

After all zone agents and cross-zone validation complete, independently verify that critical/high findings are real. **When to run:** always (skip only if there are 0 critical/high bugs). Verification typically eliminates 15-30% of false positives.

Load `references/verification.md` § "Finding Confidence Verification (Phase 5.7)" for the full protocol:
- Step 1.5 — constitutional pre-filter: free deterministic checks (file exists, line in range, ID format `^r\d+-(z\w+|xz)-\d{3}$`, severity valid, scope, title/description quality) before spending tokens.
- Step 2 — dispatch verification agents (fast verification model, batches of up to 10 per message, cap 50 total).
- Step 3 — score parsing and the keep / downgrade / reject table.
- Step 4 — recompute `summary` counts after filtering.
- Step 5 — terminal report format.

---

## Phase 6 — Aggregate + Report

### Step 1: Collect all zone JSON files

Read all zone JSON files from `{results_dir}`: `zone-{zone.id}-r{round_number}.json` for every zone and round, plus `cross-zone-r{round_number}.json`. All zone JSONs were copied out of their worktrees at agent completion (Phase 5, "Zone-JSON transport") — never rely on merges to deliver them.

### Step 1.5: Normalize + Deduplicate

Apply the **severity** and **category normalization maps** from `references/output-schema.md` § "Normalization maps (Phase 6 Step 1.5)" to every bug.

**Deduplication:** group bugs by `(file, title_normalized)` (title lowercased, whitespace collapsed). For duplicates: keep the highest severity, set `occurrence_count`, discard the rest.

Log: `Normalized {N} severity values, {M} category values, deduplicated {D} bugs.`

### Step 1.6: Finding Lifecycle (cross-run diff)

Compare this run's findings against the previous `audit-results.json`: tag each current bug `"lifecycle": "new"` or `"persistent"` by the `{file}::{title_normalized}` match key, record comparable previous bugs that disappeared in `fixed_since_last_run`, and count out-of-scope previous bugs as `not_rechecked` (never claim them fixed). A previous bug is comparable only if its file was audited this run (scope guard). Full procedure, first-run handling, and formats: `references/output-schema.md` § "Finding lifecycle (procedure and formats — Phase 6 Step 1.6)".

Print: `Lifecycle vs {previous timestamp}: {N} new, {P} persistent, {F} fixed since last run, {K} not re-checked (out of scope)`

### Step 1.7: Apply Accepted Risks

If `{repo_root}/.shipguard/accepted-risks.json` exists, move current bugs matching non-expired entries into `accepted_bugs` (excluded from `summary` counts and the risk score); bugs with expired acceptances stay in `bugs` flagged `"acceptance_expired": true` and are called out in the terminal summary. Malformed file or entry → warn with the parse error and skip acceptance entirely — never silently drop findings. Schema and matching rules: `references/output-schema.md` § "Accepted risks (procedure and file format — Phase 6 Step 1.7)".

Print: `Accepted risks: {A} findings moved to accepted{IF E > 0}, {E} acceptance(s) EXPIRED and resurfaced{END IF}`

### Step 2: Build audit-results.json

Merge all zone results into a single aggregated file following the **canonical schema** in `references/output-schema.md` § "Aggregated output: audit-results.json (canonical)". Key contract points:

- `prompt_hash` — `sg-improve` reads this to detect prompt changes and flag baseline discontinuity.
- `impacted_ui_routes: [{route, reason, severity, bug_count}]` and `impacted_backend: [{endpoint, reason, severity}]` — the bridge consumed by `/sg-visual-run --from-audit` and `/sg-process-check --from-audit`.
- `bugs`, `unverified_bugs`, `accepted_bugs`, `fixed_since_last_run` arrays; per-bug `verification_score`, `verified`, `lifecycle`, and (for UI bugs) `impacted_routes`.
- `scope_info`: all fields in diff mode, `{"mode": "full"}` otherwise.

### Step 3: Derive impacted routes

Split bug impacts into `impacted_ui_routes` (URL paths that `/sg-visual-run --from-audit` can test) and `impacted_backend` (API endpoints, services, infra with no visual test) — this prevents "uncovered route" noise for things that can't have visual tests.

Classify each bug's file: **frontend** (under `src/app/`, `src/pages/`, `src/components/`, `public/`) → `impacted_ui_routes`; **backend** (Python routes, services, Dockerfiles, config) → `impacted_backend`.

Map frontend files to routes using the framework-specific strategies in `references/output-schema.md` § "Deriving impacted routes (Phase 6 Step 3 — framework strategies)" (Next.js App/Pages Router, React Router, static HTML, generic fallback). Never hardcode project-specific paths.

Deduplicate routes: multiple bugs mapping to one route become one entry with the highest severity, a combined reason, and an exact `bug_count`; add the route to each mapped bug's `impacted_routes` array. Do not compute route bug counts with substring matching — `/` must not count every bug; counts come only from explicit route mapping. If no routes can be derived, set `impacted_ui_routes` to `[]`.

### Step 3.5: Compute risk score

Compute the 0-100 diminishing-returns `risk_score` using `references/output-schema.md` § "Risk score model (Phase 6 Step 3.5)" (severity base points with geometric decay, capped at 100). Compute it on the `bugs` array AFTER Step 1.7 — `accepted_bugs` and `unverified_bugs` do not contribute. Store as `summary.risk_score`.

### Step 4: Write results

**Archive the previous run first:** if `{results_dir}/audit-results.json` exists, copy it to `{results_dir}/history/audit-{previous timestamp, colons replaced by dashes}.json` (create `history/` if needed) before overwriting — this preserves the lifecycle chain.

Write `audit-results.json` to `{results_dir}` (`visual-tests/_results/`, determined in Phase 1 step 10 — the single source of truth for all output files).

### Step 4.5: Write TOON compact format

Also write `audit-results.toon` alongside the JSON, following `references/output-schema.md` § "TOON compact format (Phase 6 Step 4.5)". TOON is informational (~40% fewer tokens for LLM consumption); the JSON file remains canonical.

### Step 5: Print summary

Print the terminal summary using the exact template in `references/output-schema.md` § "Terminal summary template (Phase 6 Step 5)" — bugs by severity with verification counts, lifecycle line, accepted-risks line (flagging expired acceptances), top categories, files audited/modified, merge conflicts if any, both result paths, and next steps (`/sg-process-check --from-audit`, `/sg-visual-run --from-audit`, `/sg-visual-review`, or `/sg-ship` to run all lanes + review in one command).

If `monitor_active`, POST audit-complete — payload in `references/monitor.md` § "audit-complete (Phase 6)".

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
    8. Verify critical/high findings (Phase 5.7)
    9. Aggregate ALL rounds into a single audit-results.json (Phase 6)
    10. Write TOON compact format (Phase 6 Step 4.5)
    11. Print final summary
```

### Round-specific behavior

- **Round 1:** standard dispatch — agents see only the round focus + language checklists.
- **Round 2+:** agents receive an additional context block whose wording depends on `fix_mode` — verbatim text in `references/agent-prompt.md` § "Round 2+ context blocks".
- Each round uses a DIFFERENT focus and checklist from `references/checklists.md`: Round 1 = R1 (Surface), Round 2 = R2 (Depth), Round 3 = R3 (Edge Cases).

### Bug ID format

Bug IDs include the round number to avoid collisions across rounds: `r1-z03-001`, `r2-z03-001`, `r3-z03-001`, … Cross-zone findings use `r{n}-xz-NNN`. All bugs from all rounds are combined in the final `audit-results.json` bugs array.

---

## Final Checklist

Before reporting completion to the user, verify:

- [ ] Arguments parsed correctly (mode, focus, fix_mode, scope_mode)
- [ ] Stack detected (at least one language found)
- [ ] Zones discovered and assigned (no overlapping paths)
- [ ] All agents dispatched and completed (or failed with logged errors)
- [ ] Context overflows handled (zones re-split and relaunched)
- [ ] Zone JSONs copied out of every worktree BEFORE worktree removal or merge
- [ ] Working tree clean check performed before merge
- [ ] Branch ancestry verified from `base_sha` before each merge
- [ ] Merge conflicts handled safely (abort + log, not auto-resolve)
- [ ] Merge commits recorded in `merge_log` (per-merge bookkeeping, no HEAD~N arithmetic)
- [ ] All zone JSONs collected and valid
- [ ] `--all` + `--diff` rejected explicitly
- [ ] `--diff` + `--focus` documented and applied together
- [ ] Diff mode used three-dot `{ref}...HEAD` and warned about uncommitted work
- [ ] Diff mode import expansion uses relative paths and documents the noisy fallback
- [ ] audit-results.json written with correct schema (references/output-schema.md)
- [ ] `scope_info` included in audit-results.json
- [ ] impacted_ui_routes + impacted_backend derived using generic detection (no hardcoded paths)
- [ ] Lifecycle computed vs previous audit-results.json (or marked as first run)
- [ ] Accepted risks applied — expired acceptances resurfaced, never silently dropped
- [ ] Previous audit-results.json archived to history/ before overwrite
- [ ] Summary printed to terminal
- [ ] Next steps suggested (/sg-process-check --from-audit, /sg-visual-run --from-audit, /sg-visual-review, or /sg-ship)
