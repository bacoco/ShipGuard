# Invocation modes — detailed reference

## Flag parsing order

Before entering any mode, check scope override flags:

1. Check `--all`. If present → full suite, skip interactive menu.
2. Check `--diff=<ref>`. If present → use that ref for "only what changed" logic, skip menu.
3. If BOTH `--all` and `--diff` present → error: `Cannot use --all and --diff together.`
4. Check `--from-audit`. If present → read `impacted_ui_routes` (or legacy `impacted_routes`) from `audit-results.json`. `--from-audit` wins over `--diff` if both present.
5. Check `--from-process`. If present → read `impacted_ui_routes` from `process-results.json`. `--from-process` wins over `--diff` and loses to `--from-audit` if both bridge flags are present.
6. Check `--regressions`. If present → read `_regressions.yaml`, run only those tests, skip menu.
7. No scope flags → Interactive Mode or Natural Language Mode.

---

## Interactive Mode (no arguments)

Ask the user via AskUserQuestion:

**Question:** "What do you want to test?"

**Options:**
1. **Only what changed** — tests impacted by code changes since detected base ref
2. **Only regressions** — re-run previously failed tests
3. **Full suite** — all tests (~40 min)
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
   - Tag with `auto_generated: true`, `generated_by: visual-run`, `generated_date: "{date}"` in frontmatter.
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

Overrides smart scope flags. If `--from-audit` and `--diff=<ref>` are both present, `--from-audit` wins.

### Flow

1. Read `audit-results.json`:
   - Check `visual-tests/_results/audit-results.json` first
   - Then `{repo_root}/audit-results.json`
   - Then `.code-audit-results/audit-results.json`
   - Fail with clear message if not found.
2. Extract `impacted_ui_routes` array (fall back to legacy `impacted_routes` if absent).
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

The resulting `visual-results.json` must preserve bridge scope:

```json
{
  "scope": {
    "type": "from-audit",
    "source": "visual-tests/_results/audit-results.json",
    "selected_routes": ["/"],
    "selected_manifests": ["visual-tests/pages/root-index.yaml"],
    "uncovered_routes": [
      {"route": "/review.html", "status": "uncovered", "reason": "no_visual_manifest"}
    ],
    "selected_total": 1,
    "full_suite_total": 28
  }
}
```

`summary.total` is the selected run total. Do not rewrite unselected manifests as `STALE` during review rebuild.

---

## From-Process Mode (`--from-process`)

Same matching and reporting rules as `--from-audit`, but read `impacted_ui_routes` from:

1. `visual-tests/_results/process-results.json`
2. `{repo_root}/process-results.json`
3. `.process-check-results/process-results.json`

Use `scope.type: "from-process"` and `scope.source` pointing to the consumed file.

---

## Build Execution List — priority order

Priority order when building the final execution list:

1. **`--from-audit`** → severity-ordered list from `impacted_ui_routes`
2. **`--from-process`** → visual confirmation list from `process-results.json`
3. **`--diff=<ref>` or "Only what changed"** → diff-based route detection + regressions
4. **Natural language** → intent analysis + generate missing tests
5. **`--regressions`** → from `_regressions.yaml`, ordered by `last_failed` descending
6. **`--all` or "Full suite"** → all manifests, regressions first, then by priority `high` → `medium` → `low`

**Always skip** manifests with `deprecated: true`.
**Regressions among matched tests always run first** (except in `--from-audit` mode, where severity order takes precedence).
