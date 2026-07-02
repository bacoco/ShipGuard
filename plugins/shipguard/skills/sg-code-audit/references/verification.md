# Verification Reference — Post-Merge Checks, Cross-Zone Flows, and Finding Confidence

Referenced from SKILL.md Phase 5.5 ("Post-Merge Validation"), Phase 5.6 ("Cross-Zone Flow Validator"), and Phase 5.7 ("Finding Confidence Verification"). The when-to-run decision logic lives in SKILL.md; this file holds the full procedures, commands, and prompt templates.

## Post-merge validation commands (Phase 5.5)

Run against each file modified by the audit-fix merges (identified via the `merge_log` — SKILL.md Phase 5.5 Step 1).

### Syntax checks

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

### Targeted functional tests (deep/paranoid modes only)

**Python (pytest)** — try two candidate locations per modified source file:
```bash
for file in {modified_python_files}; do
  sibling_test="$(dirname "$file")/tests/test_$(basename "$file")"
  root_test="tests/test_$(basename "$file")"
  for candidate in "$sibling_test" "$root_test"; do
    if [ -f "$candidate" ]; then
      pytest "$candidate" --tb=short -q 2>&1 | tail -5
      break
    fi
  done
done
```

**TypeScript (if test runner configured):**
```bash
# Only if package.json has a "test" script
if grep -q '"test"' package.json 2>/dev/null; then
  npx jest --findRelatedTests {modified_ts_files} --passWithNoTests 2>&1 | tail -10
fi
```

Failure semantics (revert rules for syntax errors, no-revert rule for test failures) are in SKILL.md Phase 5.5.

## Cross-Zone Flow Validator (Phase 5.6)

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

Flow tracers run against the current working tree (no worktree), so `{results_dir}` here is the orchestrator's results directory (`visual-tests/_results/`).

````
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
````

### Step 3: Dispatch

Dispatch 1 flow tracer agent (or 2 if flow pairs > 20, splitting the list in half):

- **Tool:** Agent
- **prompt:** The filled flow tracer prompt
- **model:** a fast verification model (sonnet)
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

If `monitor_active`, POST agent-update for flow tracers with `zone_id: "cross-zone"` and `agent_id: "r{round}:cross-zone"`. See `references/monitor.md` § "POST payloads".

---

## Finding Confidence Verification (Phase 5.7)

Zone agents can hallucinate file paths, misquote code, or describe patterns that don't exist at the cited location. This phase catches those false positives before they pollute the final report. Verification uses fast verification agents (sonnet) and typically eliminates 15-30% of false positives.

### Step 1: Collect all findings

Gather all bugs from all zone JSONs collected in Phase 5 (including cross-zone results from Phase 5.6). Group by severity.

Count critical + high bugs. If the count is 0, skip this phase entirely.

### Step 1.5: Constitutional Pre-Validation (zero-LLM cost filter)

Before spending verification tokens, run cheap deterministic checks on each critical/high bug. These catch obvious hallucinations for free:

| Check | How | Action on failure |
|-------|-----|-------------------|
| **File exists** | `test -f {bug.file}` | Reject immediately (score=0, verified=false) |
| **Line in range** | `wc -l {bug.file}`, check `bug.line <= total_lines` | Reject (score=5, verified=false) |
| **Bug ID format** | Regex: `^r\d+-(z\w+\|xz)-\d{3}$` (accepts zone IDs like `z03a` and cross-zone IDs like `r1-xz-001`) | Fix the ID, don't reject |
| **Severity valid** | `bug.severity ∈ {critical, high, medium, low}` | Normalize, don't reject |
| **File in scope** | Check `bug.file` starts with one of the zone's declared paths | Flag as `out_of_scope: true`, still verify |
| **Title not empty** | `bug.title.length > 0` | Reject (score=0) |
| **Description not copy of title** | Jaccard similarity between title and description < 0.9 | Flag as `low_quality: true`, still verify but with suspicion |

**Execution:** Run these checks sequentially on all critical/high bugs using Bash/Read tools. No agents needed — pure file system checks.

**Outcome:**
- Bugs failing file-exists or line-in-range are immediately moved to `unverified_bugs` with `verification_score: 0` and `verified: false`. They skip verification entirely.
- Remaining bugs proceed to Step 2.

Print: `Constitutional pre-filter: {N} bugs checked, {R} rejected (file missing or line out of range), {P} passed to agent verification`

### Step 2: Dispatch verification agents

For each bug with severity `critical` or `high`, spawn a verification agent (a fast verification model — sonnet) with this prompt:

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
- Spawn verification agents in **batches of up to 10 per message** — the same 529-overload rationale as zone dispatch in SKILL.md Phase 4 (larger bursts make all agents request context simultaneously and trigger API overload)
- Use `model: sonnet` — NEVER use haiku (permanently banned)
- Do NOT use worktree isolation — agents only read files, never write
- **Cap:** Maximum 50 verification agents total per audit. If more than 50 critical/high bugs exist, verify only the first 50 (sorted: all critical first, then high, in zone order). Remaining critical/high bugs get `verification_score: null` (not verified, kept as-is).

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
- `verification_score`: the 0-100 score from the verification agent
- `verified`: `true`, `"uncertain"`, or `false`

**Medium and low severity bugs** are NOT verified (too many, too cheap to be worth it). They get: `verification_score: null, verified: null`.

### Step 4: Update summary counts

After filtering, recompute `summary.by_severity` and `summary.by_category` counts to reflect any downgrades and removals. Update `summary.total_bugs` to exclude unverified bugs.

### Step 5: Report

Print to the terminal:

```
Finding verification: {N} critical/high bugs checked
  Confirmed (≥80):  {count} — kept as-is
  Uncertain (40-79): {count} — severity downgraded
  Rejected (<40):   {count} — moved to unverified_bugs
  Skipped (cap):    {count} — not verified (over 50 cap)
```
