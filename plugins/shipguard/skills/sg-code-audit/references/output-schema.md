# Output Schema Reference — Canonical Formats

Referenced from SKILL.md Phase 6 ("Aggregate + Report"). This file is the single canonical definition of every output format the audit produces. Stable final outputs are written to `results_dir` = `visual-tests/_results/`; in-flight agent artifacts are isolated in `run_dir` = `visual-tests/_results/runs/{run_id}/`. `.code-audit-results/` is a read-only legacy fallback. The skill never writes there and never aggregates by globbing either legacy or root-level artifacts.

## Per-zone output schema

Written by each zone agent to the unique relative path
`visual-tests/_results/runs/{run_id}/zone-{zone.id}-r{round}-{agent_id}.json` inside its own
worktree (see `references/agent-prompt.md` § "Output Format"), then copied to that exact path in the
orchestrator's `run_dir` by SKILL.md Phase 5:

```json
{
  "run_id": "audit-20260829T090000Z-8b57f33a",
  "base_sha": "8b57f33af55ef13d64657355c93c4fe636a22ca0",
  "zone_id": "z03",
  "agent_id": "r1-z03-a1",
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
      "fix_tier": "test-first",
      "fix_tier_reason": "Authorization behavior requires a failing regression test before editing",
      "fix_evidence": {
        "kind": "test-first",
        "test_path": "tests/test_documents.py::test_rejects_foreign_owner",
        "before": "pytest tests/test_documents.py::test_rejects_foreign_owner — failed",
        "after": "pytest tests/test_documents.py::test_rejects_foreign_owner — passed"
      },
      "negative_evidence": null,
      "fix_applied": true,
      "fix_commit": "abc1234",
      "confidence": "high",
      "verification_score": null,
      "verified": null
    }
  ]
}
```

Cross-zone flow tracers write the same identity-bearing shape to
`runs/{run_id}/cross-zone-r{round}-{agent_id}.json` with `"zone": "cross-zone"`, IDs
`r{n}-xz-NNN`, category `integration`, plus `caller_file`/`callee_file` fields and deterministic
flow evidence. They additionally carry `source_sha`, the exact post-merge HEAD they inspected; in
report-only mode it equals `base_sha` (see `references/verification.md` § "Step 2: Build flow tracer
prompt"). Every cross-zone bug also carries the required `flow_evidence` object shown there; its
recorded caller count must equal the deterministic matches before aggregation.

`fix_tier` is required on every finding and is exactly one of `mechanical`, `test-first`, or
`human-only`. `fix_evidence` is required and non-null for every applied fix. A negative assertion
uses this additional object:

```json
{
  "negative_evidence": {
    "claim": "missing-test",
    "complete": true,
    "scope": ["src/", "tests/"],
    "exclusions": [".git/", "node_modules/", "visual-tests/_results/"],
    "searches": [
      {
        "query": "rg -n -F '/documents' src tests",
        "mode": "literal",
        "matches": ["src/routes/documents.py:119"]
      }
    ],
    "inspected_files": ["src/routes/documents.py", "tests/test_documents.py"]
  }
}
```

## Aggregated output: audit-results.json (canonical)

Merge all zone results into a single aggregated file:

```json
{
  "run_id": "audit-20260829T090000Z-8b57f33a",
  "base_sha": "8b57f33af55ef13d64657355c93c4fe636a22ca0",
  "repo": "<repository name from git remote or directory name>",
  "timestamp": "<ISO 8601 timestamp, e.g. 2026-04-10T08:30:00Z>",
  "mode": "<quick|standard|deep|paranoid>",
  "prompt_hash": "<SHA256 hex of prompt template + activated checklists + learnings>",
  "rounds": <round_count>,
  "agent_count": <actual agents dispatched including re-splits>,
  "agents": [
    {
      "id": "z1",
      "label": "Zone 1",
      "status": "completed",
      "files_audited": 9,
      "bugs_found": 1,
      "duration_ms": 120000,
      "paths": ["scripts/*.sh", "README.md"]
    }
  ],
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
    "by_fix_tier": {
      "mechanical": <count>,
      "test-first": <count>,
      "human-only": <count>
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
    "risk_score": <0-100 diminishing-returns score>,
    "lifecycle": {"new": <count>, "persistent": <count>, "fixed": <count>, "not_rechecked": <count>, "compared_to": "<previous run timestamp, or null on first run>"}
  },
  "impacted_ui_routes": [
    {"route": "<url path>", "reason": "<bug title + file>", "severity": "<highest severity bug for this route>", "bug_count": <exact number of active bugs mapped to this route>}
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
  "unverified_bugs": [<bugs rejected by Phase 5.7 verification (score < 40) — kept for audit trail>],
  "accepted_bugs": [<bugs matching non-expired accepted-risks entries (Phase 6 Step 1.7) — excluded from summary and risk score>],
  "fixed_since_last_run": [<{file, title, severity} of comparable previous-run bugs not found this run (Phase 6 Step 1.6)>]
}
```

Notes:

- `prompt_hash`: SHA256 of the prompt template + activated checklists + learnings audit_hints. `sg-improve` reads this to detect prompt changes and flag baseline discontinuity.
- Each bug in the `bugs` array includes two additional fields from Phase 5.7:
  - `verification_score`: 0-100 integer (or `null` if not verified — medium/low severity)
  - `verified`: `true` (score >= 80), `"uncertain"` (40-79), or `null` (not checked)
- Each bug also carries `"lifecycle"`: `"new"` or `"persistent"` (Phase 6 Step 1.6), and `"acceptance_expired": true` when a matching accepted-risk entry has lapsed (Phase 6 Step 1.7).
- Each bug carries the required fix-safety fields `fix_tier`, `fix_tier_reason`, and
  `fix_evidence`. Report-only runs classify every finding but never apply a fix. Fix mode may apply
  `mechanical` findings directly and `test-first` findings only with recorded failing-before and
  passing-after evidence; `human-only` findings are never edited automatically.
- Negative assertions carry `negative_evidence`. Phase 5.7 validates that record for every severity
  before the finding may enter `bugs`.
- Cross-zone bugs carry `flow_evidence` with the searched symbol/route, scope, exclusions, searches,
  matching callers, caller count, and inspected files.
- Each UI-visible bug SHOULD also carry `"impacted_routes": ["<route>", ...]`. This is the exact route mapping used by the dashboard and by `/sg-visual-run --from-audit`. Do not make the dashboard infer route impact from file path strings, especially for `/`.
- When `scope_mode == "full"`: `"scope_info": {"mode": "full"}` — no other fields.
- When `scope_mode == "diff"`: include all `scope_info` fields above.

## Normalization maps (Phase 6 Step 1.5)

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

## Finding lifecycle (procedure and formats — Phase 6 Step 1.6)

Compare this run's findings against the previous audit so the report distinguishes what is genuinely new from what was already known, and shows what got fixed.

1. **Load previous run:** If `{results_dir}/audit-results.json` exists (the file this run is about to replace), read it now and store as `previous_run`. If it does not exist or fails to parse, set every current bug to `"lifecycle": "new"`, set `lifecycle_summary = {"new": <total>, "persistent": 0, "fixed": 0, "not_rechecked": 0, "compared_to": null}`, print `Lifecycle: no previous audit found — tracking starts with this run.`, and skip to Step 1.7.
2. **Build match keys:** Key each bug by `{file}::{title_normalized}` — the same normalization as the Step 1.5 dedup (title lowercased, whitespace collapsed). Line numbers are deliberately excluded (they shift between runs). Compare against the previous run's `bugs` array only (never its `unverified_bugs`).
3. **Comparability rule (scope guard):** A previous bug is *comparable* only if its file was audited this run:
   - Current `scope_mode == "full"` and no `focus_path` → all previous bugs are comparable
   - Current `scope_mode == "diff"` → comparable only if the previous bug's file is in `scope_files`
   - Current `focus_path` set → comparable only if the previous bug's file is under `focus_path`
4. **Tag lifecycle:**
   - Current bug whose key exists in the previous run → `"lifecycle": "persistent"`
   - Current bug whose key is absent from the previous run → `"lifecycle": "new"`
   - Previous bug that is comparable but absent from the current run → record `{file, title, severity}` in the `fixed_since_last_run` array. Do NOT inject it into the current `bugs` array — this run did not find it.
   - Previous bug that is NOT comparable (file out of scope this run) → count it in `not_rechecked` only. Never claim it fixed.
5. **Store:** `lifecycle_summary = {"new": N, "persistent": P, "fixed": F, "not_rechecked": K, "compared_to": "<previous_run.timestamp>"}` (stored as `summary.lifecycle`).

Print: `Lifecycle vs {previous timestamp}: {N} new, {P} persistent, {F} fixed since last run, {K} not re-checked (out of scope)`

## Accepted risks (procedure and file format — Phase 6 Step 1.7)

If `{repo_root}/.shipguard/accepted-risks.json` exists, read it. If it does not exist, set `accepted_bugs = []` and skip silently. Schema:

```json
{
  "accepted": [
    {
      "finding_key": "apps/api/auth.py::jwt token never expires",
      "reason": "legacy tokens until Q3 migration",
      "accepted_by": "loic",
      "expires": "2026-09-30"
    }
  ]
}
```

- `finding_key` format: `{file}::{title_normalized}` — exactly the lifecycle match key from Step 1.6 (title lowercased, whitespace collapsed). Users copy `file` and `title` from `audit-results.json`.
- For each current bug whose key matches an entry:
  - **Not expired** (`expires` is today or later, or no `expires` field): move the bug out of `bugs` into the `accepted_bugs` array. It keeps all its fields plus `"accepted_reason"` and `"accepted_expires"`. Accepted bugs are excluded from `summary` counts and from the risk score.
  - **Expired** (`expires` is in the past): keep the bug in `bugs`, add `"acceptance_expired": true`, and flag it in the terminal summary — the acceptance must be renewed or the bug fixed.
- Malformed file or entry (unparseable JSON, missing `finding_key`) → print a warning with the parse error and skip acceptance entirely for this run. Never silently drop findings.

Print: `Accepted risks: {A} findings moved to accepted{IF E > 0}, {E} acceptance(s) EXPIRED and resurfaced{END IF}`

## Skipped zones format (_skipped_zones.json)

Written to `{results_dir}/_skipped_zones.json` by SKILL.md Phase 5.5 Step 4 for zones that failed (context overflow, API overload after 3 retries, merge conflict, syntax error after merge); read and deleted by Phase 3 Step 0 on the next run:

```json
{
  "run_id": "audit-20260829T090000Z-8b57f33a",
  "base_sha": "8b57f33af55ef13d64657355c93c4fe636a22ca0",
  "skipped": [
    {"zone_id": "z01", "paths": ["src/hooks/"], "reason": "api_overload", "retries": 3, "date": "2026-04-14"},
    {"zone_id": "z03a", "paths": ["src/components/chat/"], "reason": "syntax_error_after_merge", "file": "chat-tab.tsx", "date": "2026-04-14"}
  ],
  "timestamp": "{ISO 8601}"
}
```

## Run-scoped dispatch record

The orchestrator persists `{run_dir}/dispatch.json` atomically after every state transition. This
record is the only source of artifact paths accepted by Phase 5 and Phase 6:

```json
{
  "run_id": "audit-20260829T090000Z-8b57f33a",
  "base_sha": "8b57f33af55ef13d64657355c93c4fe636a22ca0",
  "status": "running",
  "reset_at": null,
  "entries": [
    {
      "agent_id": "r1-z03-a1",
      "zone_id": "z03",
      "round": 1,
      "status": "completed",
      "artifact": "visual-tests/_results/runs/audit-20260829T090000Z-8b57f33a/zone-z03-r1-r1-z03-a1.json",
      "superseded_by": null
    }
  ],
  "accepted_artifacts": [
    "visual-tests/_results/runs/audit-20260829T090000Z-8b57f33a/zone-z03-r1-r1-z03-a1.json"
  ]
}
```

Allowed `status` values are `running`, `paused_quota`, and `completed`. A quota pause records the
provider's `reset_at` when known and leaves pending entries pending; it does not overwrite the
canonical audit. Resume is allowed only when repository HEAD still equals `base_sha`, and resumes
only pending entries after one successful minimal capacity probe. Superseded attempts remain in
the record for traceability but never enter `accepted_artifacts`. Aggregation reads this array
verbatim and rejects identity mismatches; broad result-file globs are forbidden.

## Terminal summary template (Phase 6 Step 5)

```
=== Code Audit Complete ===

Run: {run_id} | Base: {base_sha}
Mode: {mode} | Agents: {actual_count} | Rounds: {round_count}
Duration: {formatted_duration}

Bugs found: {total} ({verified_count} verified, {uncertain_count} uncertain, {rejected_count} rejected)
  Critical: {count}  High: {count}  Medium: {count}  Low: {count}
  Fix tiers: {mechanical} mechanical | {test_first} test-first | {human_only} human-only

{IF lifecycle_summary.compared_to is not null}
Lifecycle vs last audit ({compared_to}): {new} new | {persistent} persistent | {fixed} fixed | {not_rechecked} not re-checked
{END IF}
{IF accepted_bugs not empty OR expired acceptances exist}
Accepted risks: {A} excluded from counts{IF E > 0} — ⚠ {E} acceptance(s) EXPIRED, resurfaced in results{END IF}
{END IF}

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
  /sg-process-check --from-audit Dynamically check the impacted backend (behavior delta)
  /sg-visual-run --from-audit    Visually verify impacted routes
  /sg-visual-review              See the full dashboard with Code Audit tab
  (or /sg-ship to run all lanes + review in one command)
```

## Risk score model (Phase 6 Step 3.5)

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

Compute the score on the `bugs` array AFTER Phase 6 Step 1.7 — `accepted_bugs` and `unverified_bugs` do not contribute. The score reflects active findings only.

## Deriving impacted routes (Phase 6 Step 3 — framework strategies)

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

If no routes can be derived (no framework, no HTML files, no manifest matches), set `impacted_ui_routes` to an empty array `[]`.

## TOON compact format (Phase 6 Step 4.5)

Also write `audit-results.toon` alongside the JSON file. TOON (Token-Optimized Output Notation) is a compact format that reduces token cost by ~40% when results are fed back into LLM agents (e.g., for sg-improve analysis or cross-session comparison).

**Format specification:**

```
# audit-results.toon
# run:{run_id} base:{base_sha} repo:{repo} mode:{mode} ts:{timestamp} rounds:{rounds} agents:{agent_count}
# scope:{scope_mode} diff_files:{diff_files} total:{total_in_scope}
# summary: total={total_bugs} critical={critical} high={high} medium={medium} low={low}
# verified: checked={checked} confirmed={confirmed} uncertain={uncertain} rejected={rejected}
# bugs[{bug_count}]{id,severity,category,fix_tier,file,line,title,verified,score}:
r1-z01-001,high,logic-error,test-first,apps/uranus/src/components/foo.tsx,71,key={index} on reorderable list,true,95
r1-z01-002,medium,error-handling,mechanical,apps/api-synthesia/routes/chat.py,142,bare except swallows errors,uncertain,55
r1-z03-001,high,security,human-only,apps/uranus/src/lib/auth.ts,23,JWT secret in client bundle,true,98
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
