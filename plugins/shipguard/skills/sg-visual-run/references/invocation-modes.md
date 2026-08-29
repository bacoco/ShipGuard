# Invocation modes — detailed reference

## Flag parsing

Recognized scope flags:

- `--all` → full suite, skip interactive menu.
- `--diff=<ref>` → "only what changed" logic against that ref, skip menu.
- `--from-audit` → read `impacted_ui_routes` (or legacy `impacted_routes`) from audit results (see From-Audit Mode).
- `--from-logic` → read `impacted_ui_routes` from logic-audit results (see From-Logic Mode).
- `--from-process` → read `impacted_ui_routes` from process-check results (see From-Process Mode).
- any two or more bridge flags together → **Union Mode** (see below).
- `--regressions` → read `_regressions.yaml`, run only those tests, skip menu.
- Free text, no flags → Natural Language Mode.
- Nothing → Interactive Mode.

Validation: if BOTH `--all` and `--diff` are present → error: `Cannot use --all and --diff together.`

**Precedence when multiple scope sources are present is defined once — and only there — in [Build Execution List — priority order](#build-execution-list--priority-order) at the end of this file.**

---

## Interactive Mode (no arguments)

Ask the user via AskUserQuestion:

**Question:** "What do you want to test?"

**Options:**
1. **Only what changed** — tests impacted by code changes since detected base ref
2. **Only regressions** — re-run previously failed tests
3. **Full suite** — all tests (duration depends on suite size)
4. *(Other — user types what they want)*

### "Only what changed" flow

1. Detect base reference (same algorithm as `sg-code-audit`):
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
2. `git diff --name-only {base} HEAD` → modified files list.
3. If 0 files changed, ask: `No diff vs {base}. Use last commit?` (reuse `sg-code-audit` last-commit / full-suite / different-base logic).
4. Map modified files to routes (same framework-specific detection as `sg-code-audit` Phase 6 Step 3).
5. Match routes to YAML manifests (glob `visual-tests/**/*.yaml`, match `url` field).
6. If no manifest matches a route, log `uncovered route: {route}`.
7. Always include regressions from `_regressions.yaml`.
8. Print: `Running {N} tests for {R} impacted routes (diff vs {base}) + {reg} regressions`

### "Only regressions" flow

Read `_regressions.yaml` and run those tests.

### "Full suite" flow

Run everything.

**The interactive question is only asked when no argument is provided.** If the user types `/sg-visual-run I fixed the chat`, skip the question and go to impact analysis.

---

## Natural Language Mode (free text argument)

```bash
/sg-visual-run test the PDF upload and the pipeline
/sg-visual-run I changed the sidebar, check everything works
/sg-visual-run does the chat work with an attached document?
/sg-visual-run I changed Header.tsx and ChatView.tsx
```

### Flow

1. **Understand intent** — parse the natural language:
   - Pages/features/components mentioned
   - Recent code changes referenced (check `git diff` if user says "I changed", "I just modified", etc.)
   - Scope: specific feature, page, or whole section

2. **Find impacted tests** — read all manifest YAML (name, description, tags) and match against intent:
   - "upload" → manifests about upload
   - "dashboard" → all `dashboard/` manifests
   - File like "Header.tsx" → routes/components using it → match those manifests

3. **Generate missing tests** — if the described scope has no existing test:
   - Invoke `/sg-visual-discover --diff=HEAD~1` (narrow scope) to read the component and produce a manifest skeleton.
   - Generate a new manifest with real steps and assertions.
   - Tag with `auto_generated: true`, `generated_by: visual-run`, `generated_date: "{date}"` as top-level manifest keys.
   - Save to the test tree.
   - Execute it.
   - Report auto-generated manifests separately. After 3 consecutive passes, **auto-remove** (same rule as regressions).
   - Track in `_results/.auto-generated-manifests.json` (schema: `[{"path": "...", "consecutive_passes": 0}]`). On cleanup, only remove manifests listed in this file.

4. **Execute** — run matched + generated tests (regressions first).

### Examples

| Input | Behavior |
|-------|----------|
| `test the PDF upload` | Finds `upload-pdf.yaml`, runs it |
| `I changed the ingestion pipeline` | git diff → maps changed files to ingestion tests → runs |
| `check the dashboard loads` | Finds `dashboard/home.yaml`, runs |
| `I added a button in the header` | Finds header tests + generates a new one for the button |
| `does the settings page work?` | Finds settings tests, runs |

---

## From-Audit Mode (`--from-audit`)

Precedence vs other scope flags: see [Build Execution List — priority order](#build-execution-list--priority-order).

### Flow

1. Read `audit-results.json`:
   - Check `visual-tests/_results/audit-results.json` first (the location producers always write, `mkdir -p`)
   - Then legacy `.code-audit-results/audit-results.json`
   - Fail with clear message if not found.
2. Extract the `impacted_ui_routes` array. Each entry has the shape `{"route": "/dashboard", "reason": "...", "severity": "high", "bug_count": 2}` — `severity` ∈ `critical | high | medium | low`; `bug_count` is audit-only. Fall back to legacy `impacted_routes` (bare route strings, no severity) if `impacted_ui_routes` is absent; order legacy entries by manifest `priority` only.
3. For each route, find matching manifests via **pathname matching**:
   - Extract pathname from `manifest.steps[0].url` by stripping `{base_url}` or any `http(s)://host:port` prefix.
     - `{base_url}/chat` → `/chat`
     - `http://localhost:3000/dashboard` → `/dashboard`
   - Compare extracted pathname against `impacted_route.route` (always a bare path like `/dashboard`, `/chat`, `/dossier/:id`).
   - Parameterized routes (`:id`, `[id]`): match path segments (`/dossier/:id` matches `/dossier/anything`).
   - A manifest matches if its extracted pathname starts with or equals the impacted route path.
   - **Special case:** `/` matches only the root page manifest. It must not prefix-match the whole suite.
   - Non-HTML assets are not visual page tests; record them as skipped, for example `{ "route": "/assets/file.zip", "status": "skipped", "reason": "non_html_asset" }`.
4. If no manifest matches a route, log and persist `uncovered route` (do NOT auto-generate — user can run `/sg-visual-discover` separately), for example `{ "route": "/review.html", "status": "uncovered", "reason": "no_visual_manifest" }`.
5. Run matched manifests, highest `impacted_route.severity` first; manifest `priority` as secondary sort.
6. Report: routes visually verified, uncovered routes, code-audit findings visually confirmed vs not reproduced.

The resulting `visual-results.json` must preserve bridge scope: `scope.type` (`"from-audit"`), `scope.source` (the consumed file), `selected_routes`, `selected_manifests`, `uncovered_routes`, `selected_total`, `full_suite_total`. The authoritative schema is in [report-formats.md](report-formats.md).

`summary.total` is the selected run total. Do not rewrite unselected manifests as `STALE` during review rebuild.

---

## From-Process Mode (`--from-process`)

Same matching and reporting rules as `--from-audit`, but read `impacted_ui_routes` from:

1. `visual-tests/_results/process-results.json` (the location producers always write, `mkdir -p`)
2. Legacy `.process-check-results/process-results.json`

Entries have the shape `{"route": "/dashboard", "reason": "...", "severity": "high"}` (`severity` ∈ `critical | high | medium | low`; no `bug_count` — that field is audit-only).

Use `scope.type: "from-process"` and `scope.source` pointing to the consumed file.

---

## From-Logic Mode (`--from-logic`)

Use the same matching, severity ordering, uncovered-route handling, and reporting rules as
`--from-audit`, but read `impacted_ui_routes` from:

1. `visual-tests/_results/logic-results.json`
2. `logic-results.json` at repository root

Entries have the shape `{"route": "/dashboard", "reason": "...", "severity": "high"}`.
Use `scope.type: "from-logic"` and `scope.source` pointing to the consumed file.

---

## Union Mode (two or more bridge flags)

When two or more of `--from-audit`, `--from-logic`, and `--from-process` are passed:

1. Read every selected results file, using each mode's search order above. If a selected file is not found, fail with a clear message naming it — do not silently drop a requested source.
2. Take the **union** of all selected `impacted_ui_routes` arrays.
3. **Dedupe by `route`**: when sources list the same route, keep the entry with the highest severity (`critical` > `high` > `medium` > `low`). Preserve `bug_count` from the audit entry when present.
4. **Order severity-first**; tie-break equal severities by manifest `priority` (`high` > `medium` > `low`).
5. Matching, uncovered-route handling, and reporting follow the From-Audit rules.
6. In `visual-results.json`, use `scope.type: "union"` and set `scope.source` to every consumed file joined with ` + `.

---

## Build Execution List — priority order

**This is the single authoritative statement of scope precedence** (SKILL.md and the Flag parsing section above defer to it). When multiple scope sources are present, the highest entry in this list wins — bridge flags (`--from-audit`, `--from-logic`, `--from-process`, union) win over `--diff` AND over `--all`:

1. **Two or more bridge flags (Union Mode)** → merged, severity-ordered list (dedupe by route, highest severity kept; tie-break by manifest `priority`)
2. **One bridge flag** → severity-ordered list from that lane's `impacted_ui_routes`
3. **`--diff=<ref>` or "Only what changed"** → diff-based route detection + regressions
4. **Natural language** → intent analysis + generate missing tests
5. **`--regressions`** → from `_regressions.yaml`, ordered by `last_failed` descending
6. **`--all` or "Full suite"** → all manifests, regressions first, then by priority `high` → `medium` → `low`

**Always skip** manifests with `deprecated: true` (top-level key).
**Regressions among matched tests always run first** (except in bridge modes, where severity order takes precedence).
