# Zone Agent Prompt — Template and Rules

Referenced from SKILL.md Phase 4 ("Build Prompts + Dispatch Agents"). Load this file and instantiate the template below by replacing every `{...}` placeholder with actual values.

## Orchestrator notes (do NOT paste into the agent prompt)

- Always append this instruction verbatim to every agent prompt, regardless of model:

  ```
  Report ALL instances of every pattern you find, regardless of how minor you think they are.
  The severity field exists for post-filtering — your job is to find, not to pre-filter.
  Do not self-censor bulk patterns like missing env guards, key={index}, or f-string loggers.
  ```

- The template instructs the agent to write its zone JSON to the RELATIVE run-scoped path
  `visual-tests/_results/runs/{run_id}/zone-{zone.id}-r{round_number}-{agent_id}.json` inside its
  own worktree. The orchestrator copies and identity-validates that file at completion. Never point
  agents at an absolute path outside their worktree.
- `{base_sha}` is the repository HEAD recorded once at dispatch time (SKILL.md Phase 4, "Note on worktrees").
- Retry handling for malformed zone JSON is the orchestrator's job and lives in SKILL.md Phase 5 ("On agent completion") — it is intentionally NOT part of this template.
- In multi-round mode, rounds 2+ additionally receive the applicable context block from § "Round 2+ context blocks" at the end of this file.

## Prompt template

````
You are auditing a codebase for bugs. Your primary scope is these paths: {zone.paths joined with " AND "}.
Do NOT modify files outside your scope. You MAY read files outside your scope to verify cross-module integration (caller/callee contracts, import chains, shared types).

Audit identity: run_id={run_id}, base_sha={base_sha}, zone_id={zone.id}, round={round_number}, agent_id={agent_id}.

## Worktree Base Verification (do this FIRST)

You are working in a dedicated git worktree created from base commit {base_sha}.
Before reading any source file, run `git rev-parse HEAD` and compare it to {base_sha}.
If they differ, run `git reset --hard {base_sha}` so you audit exactly the code that was dispatched.

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

## Negative Claims Require Positive Proof Of The Search

For any claim that something is absent — including `missing-construct`, `missing-test`,
`unchecked-exit`, `dead-endpoint`, or `unreachable-feature` — search the complete relevant file or
repository scope before reporting it. Inspect every plausible match. Test-coverage claims must
search project-declared and conventional test roots for the symbol, route, method/path pair, status
code, and error condition, then read relevant matches.

Such a finding MUST carry a non-null `negative_evidence` object with the searched scope, literal or
explicitly marked regex queries, every match, exclusions, and inspected files. If the search cannot be completed, do not present absence
as fact: set confidence low and leave `negative_evidence.complete = false`; aggregation will move it
out of headline results. If a relevant rejection-path test exists, do not report the path as
untested. If only a happy-path test exists, name only the specific missing branch.

For shell scripts, read the complete file, determine whether it is executed or sourced, and inspect
the shebang before applying dialect rules. Recognize combined safety forms such as
`set -euo pipefail`. A bare simple command under active errexit normally propagates failure, but
errexit has exceptions in conditions, lists, and pipelines. Output capture followed by deliberate
status/content branching may intentionally handle nonzero status; trace it before recommending a
blanket safety flag.

## Fix Safety Tier (REQUIRED for every finding)

Assign one conservative tier and a concrete reason:

- `mechanical`: narrowly local, behavior-preserving, and deterministically verifiable.
- `test-first`: changes behavior; requires a characterization or regression test that fails before
  the fix and passes after it in the same zone commit.
- `human-only`: ambiguous requirement, public contract, migration, authorization/security policy,
  destructive or financial behavior, or any fix whose local safety is not established. This is the
  fallback when uncertain and is never auto-edited.

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
Categories not in the table (including underscore variants) group poorly in the dashboard — normalize them to the taxonomy above before writing your JSON.

## Output Format

After auditing all files in your scope, write your findings to a JSON file at EXACTLY this path, **relative to the root of your own worktree** — do not use any other filename and do not write outside your worktree:

**visual-tests/_results/runs/{run_id}/zone-{zone.id}-r{round_number}-{agent_id}.json**

Run `mkdir -p visual-tests/_results/runs/{run_id}` first. The orchestrator collects this exact file
from your worktree after you finish. Do not add a suffix or write a root-level zone file.

The JSON MUST follow this exact schema:

```json
{
  "run_id": "{run_id}",
  "base_sha": "{base_sha}",
  "zone_id": "{zone.id}",
  "agent_id": "{agent_id}",
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
      "fix_tier": "mechanical|test-first|human-only",
      "fix_tier_reason": "<why this tier is safe and sufficient>",
      "fix_applied": <true if you fixed it, false otherwise>,
      "fix_commit": "<commit hash if fix_applied is true, empty string otherwise>",
      "fix_evidence": <null when not fixed, or {"kind":"mechanical","check":"...","result":"passed"}, or {"kind":"test-first","test_path":"...","before":"failed","after":"passed"}>,
      "negative_evidence": <null, or {"claim":"missing-construct|missing-test|unchecked-exit|dead-endpoint|unreachable-feature","complete":true,"scope":["src/","tests/"],"exclusions":[".git/","node_modules/","visual-tests/_results/"],"searches":[{"query":"...","mode":"literal|regex","matches":["path:line"]}],"inspected_files":["..."]}>,
      "confidence": "<high if you verified interprocedural context, medium if you checked the immediate file, low if you could not verify context>",
      "verification_score": null,
      "verified": null
    }
  ]
}
```

**Note:** `verification_score` and `verified` are set to `null` in the zone output. They are populated later during aggregation by the orchestrator's verification phase. Zone agents should NOT set these fields to any other value.

Increment the bug counter sequentially: r{round_number}-{zone.id}-001, r{round_number}-{zone.id}-002, etc.

## Output Validation Contract

The zone JSON MUST pass these checks. If any check fails, fix and rewrite the file before reporting completion:

1. **JSON parseable** — valid JSON syntax
2. **Required identity fields present and exact** — `run_id`, `base_sha`, `zone_id`, `agent_id`,
   `zone`, `round`, `bugs` (array)
3. **Each bug has required fields** — `id`, `severity`, `category`, `file`, `line`, `title`,
   `description`, `fix_tier`, `fix_tier_reason`, `fix_applied`, `fix_evidence`, `negative_evidence`
4. **Severity is one of** — `critical`, `high`, `medium`, `low` (lowercase, no other values)
5. **Category is one of** — the 16 valid categories listed above (hyphens, no underscores)
6. **Bug ID format** — `r{round}-{zone_id}-{NNN}` (sequential)
7. **Fix tier valid** — `mechanical`, `test-first`, or `human-only`; non-empty reason; every applied
   fix has non-null evidence appropriate to its tier
8. **Negative evidence complete when required** — every absence subcategory above has a complete
   search record; all other findings may use `null`

## Self-Validation (REQUIRED before writing JSON)

Before writing your zone JSON file, re-read every `category` and `severity` value in your bugs array. Compare each one character-by-character against the tables above. Common LLM mistake: writing `error_handling` instead of `error-handling`, or `silent_exception` instead of `silent-exception`. All categories use **hyphens** (`-`), never underscores (`_`). Fix any mismatches before writing the file.

{IF fix_mode is true}
## Fix Mode: ON

Apply fixes only according to their tier:

- `mechanical`: edit, then run the smallest deterministic check covering the change.
- `test-first`: add and run the characterization/regression test against the original behavior;
  record `before: failed`, apply the fix, rerun once, and record `after: passed`. If either proof is
  missing, do not fix.
- `human-only`: never edit.

Commit only successfully verified mechanical and test-first fixes with:
```
git add <fixed files>
git commit -m "audit-r{round_number}({zone.id}): fix N bugs"
```
Do NOT add the zone JSON (`visual-tests/_results/`) to the commit — the orchestrator collects it separately.
Set `"fix_applied": true`, the actual `fix_commit`, and required `fix_evidence` for each fixed bug.
All human-only or unproven test-first findings remain `fix_applied: false`.
{ELSE}
## Fix Mode: OFF (report only)

Do NOT modify any source files or create source commits. Still classify every finding. Report all
bugs with `"fix_applied": false`, `"fix_commit": ""`, and `"fix_evidence": null`.
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
````

## Round 2+ context blocks

In multi-round mode (SKILL.md "Multi-Round Execution"), rounds 2 and 3 append one of these context blocks to the agent prompt. The wording depends on `fix_mode`:

If `fix_mode` is true:

```
A previous audit round already found and fixed bugs. Your job:
1. Verify previously applied fixes are correct (check for regressions)
2. Find DEEPER issues the surface scan missed
3. Do NOT re-report bugs already found — focus on NEW findings
```

If `fix_mode` is false (report-only mode):

```
A previous audit round already found bugs (not fixed — report-only mode). Your job:
1. Verify previously found bugs are still present (no regressions from external changes)
2. Find DEEPER issues the surface scan missed
3. Do NOT re-report bugs already found — focus on NEW findings
```
