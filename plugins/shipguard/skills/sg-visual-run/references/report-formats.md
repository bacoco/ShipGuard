# Report formats reference

Templates for `_regressions.yaml`, `visual-results.json`, `report.md`, and final user summary.

---

## `_regressions.yaml` format

Canonical format (matches `examples/_regressions.yaml`): timestamps are ISO 8601; `screenshot` is the bare filename inside `{screenshots_dir}` (no directory prefix).

```yaml
# Auto-maintained by /sg-visual-run — do not edit manually
regressions:
  - test: dashboard/file-upload
    first_failed: "2026-03-22T14:30:00Z"
    last_failed: "2026-03-24T09:12:00Z"
    consecutive_passes: 0
    failure_reason: "Pipeline timeout after 90s"
    screenshot: "upload-pdf-fail.png"
```

### Add / update failures

For each test that FAILED, STALE, or ERROR:
- If already in regressions: update `last_failed` (ISO 8601 timestamp), `failure_reason`, reset `consecutive_passes: 0`
- If new failure: add entry with `first_failed:` set to the current ISO 8601 timestamp, `consecutive_passes: 0`
- STALE entries use `failure_reason: "Element not found: {target}"`
- ERROR entries use `failure_reason: "Browser crash / agent-browser error"`

### Track passes

For each test that PASSED and is in regressions:
- Increment `consecutive_passes`
- If `consecutive_passes >= 3` → **remove from regressions** (resolved)

---

## `visual-results.json` format

Write to `visual-tests/_results/visual-results.json` after every run (create the directory with `mkdir -p` if missing). **This is the authoritative schema** — SKILL.md and invocation-modes.md carry only stubs/pointers to this section. It is the machine contract consumed by `sg-visual-review`; `report.md` is only the human-readable rendering.

```json
{
  "schema_version": "1.0",
  "run_id": "visual-20260629-133000",
  "timestamp": "2026-06-29T13:30:00Z",
  "base_url": "http://127.0.0.1:8001",
  "scope": {
    "type": "from-audit",
    "source": "visual-tests/_results/audit-results.json",
    "selected_routes": ["/"],
    "selected_manifests": ["visual-tests/pages/root-index.yaml"],
    "uncovered_routes": [
      {"route": "/review.html", "status": "uncovered", "reason": "no_visual_manifest"},
      {"route": "/assets/report.zip", "status": "skipped", "reason": "non_html_asset"}
    ],
    "selected_total": 1,
    "full_suite_total": 28
  },
  "summary": {
    "total": 1,
    "pass": 1,
    "fail": 0,
    "error": 0,
    "stale": 0,
    "skipped": 0,
    "duration_ms": 36800
  },
  "tests": [
    {
      "id": "pages/root-index",
      "manifest": "visual-tests/pages/root-index.yaml",
      "name": "Home",
      "url": "/",
      "status": "PASS",
      "duration_ms": 1200,
      "screenshot": "screenshots/root-index.png",
      "failure_reason": null
    }
  ]
}
```

Allowed test statuses: `PASS`, `FAIL`, `ERROR`, `STALE`, `SKIPPED`. `SKIPPED` means *this layer reached no verdict about this manifest*: the mechanical `shipguard run` emits it for a manifest in which no mechanical step ran at all (every step is agent-owned — `llm-check`, `llm-wait`, `include`), because `PASS` would claim an evaluation that never happened. The pending work stays declared in `llm_steps_pending` and in the `needs-agent` lane of `run.json`. `summary.skipped` counts these. A `deprecated: true` manifest is **not** counted there and produces no test entry at all — it never enters the suite.

Additive optional per-test fields (producers may emit them; consumers must tolerate their absence):
- `browser_errors`: `[{"level": "error"|"warn", "text": "..."}]` — normalized console/pageerror entries captured after the test's steps. **Measured** evidence; feeds `findings.json`.
- `llm_steps_pending`: integer — number of steps a mechanical (`shipguard run`) execution could not evaluate because the agent lane owns them: `llm-check`, `llm-wait`, and `include`. `0` or absent after a full agent run; non-zero values are declared as a `needs-agent` lane in `run.json`.
- `manifest_error`: string — a step named an action that is in neither the mechanical set nor the agent-owned set (typically a typo, or an action from a newer grammar). The step never ran, so the test carries no verdict: its status is `ERROR` and this field says the fault is in the manifest, not in the browser and not in the product. Absent from every test whose actions are all declared.
- `screenshot_error`: string — the capture for this test was missing or 0 bytes. Emitted whatever the test's status, so a tooling failure is never swallowed by a product verdict that was reached first. Absent when the capture was valid.
- `console_capture_error`: string — the `agent-browser errors`/`console` bridge failed, so `browser_errors` is an empty *unobserved* list, not an observed absence of errors. Absent when the capture succeeded.

For union runs (two or more bridge flags), `scope.type` is `"union"` and `scope.source` lists every consumed file (see invocation-modes.md, Union Mode).

For scoped runs, `summary.total` is the selected run total. Preserve the global suite size in `scope.full_suite_total`, and preserve routes that were not executable as `scope.uncovered_routes` rather than dropping them from the machine contract.

`scope.uncovered_routes` also carries manifests that were declared on disk and could not be loaded — a manifest that does not parse, or that parses without a `steps` list. Those entries name the manifest file in `route` (e.g. `visual-tests/pages/login.yaml`), use `reason: "manifest_not_parseable"` or `"manifest_unreadable"`, and may carry an additive `detail` string. They are independent of the run's scope: a manifest that never parsed has no readable path-or-url pair to compare a scope against, so the loss is declared in every run. `scope.full_suite_total` counts them, because a count that silently omitted them would inherit exactly the blindness it exists to expose. A `deprecated: true` manifest is **not** among them: it is retired on purpose, so it is excluded from both counts and reported nowhere.

---

## Exit codes and the `run.json` lane contract

The CLI's exit code is the machine contract a CI consumes, and each code is an **instruction**, not a severity. The axis that separates `2` from `3` is whether re-running the same command unchanged could ever help.

| code | name | what it tells a human or a CI |
|---|---|---|
| `0` | clean | Nothing to look at. Every declared lane ran and found nothing. |
| `1` | findings | Look at your product: a declared assertion failed (`FAIL`), a declared selector no longer resolves on a healthy browser (`STALE`), or a local asset is broken. |
| `2` | infrastructure | Retry. The tooling failed, so this run's evidence cannot be trusted: the app would not start, `agent-browser` is missing or crashed, a capture or console bridge collected nothing, or the dashboard build crashed. |
| `3` | declaration | Fix a declared file. The run could not be assembled or completed as declared, and retrying it unchanged changes nothing: bad config, unknown profile or check, a valueless `--scope`, a manifest that does not parse, a step naming an unknown action, a scope that selects nothing, a crawl bounded below the site, or a run in which no lane evaluated anything. |

**Precedence when several are true at once: `2` > `3` > `1` > `0`.** Untrustworthy evidence outranks a wrong declaration, because a human who fixes only the declaration gets another untrustworthy run. An incomplete recette outranks its own findings, because a partial finding list must never be read as a complete one. *Incomplete is never clean*, and a broken tool never masquerades as a product finding.

`run.json` lanes carry `status` (one of `ran`, `skipped`, `not-applicable`, `error`, `needs-agent`) and, on any non-`ran` status, a required `reason`. Two additive optional lane fields drive the aggregation:

- `remedy`: `"infrastructure"` or `"declaration"` — **who can fix this lane**. A status says what happened; only `remedy` says whether a retry is worth anything. Present only on a lane that needs one, so a clean run declares no `remedy` anywhere. `"infrastructure"` maps to exit `2`, `"declaration"` to exit `3`.
- `truncated`: `{reason, max_pages, queued_unvisited}` on the crawl lane — present only when the page cap was reached with work still queued. It carries `remedy: "declaration"`: the fix is raising `crawl.max_pages` in `_config.yaml` or passing `--max-pages=N`, never a retry, which would stop at exactly the same page.

Two lane states are declared handoffs and deliberately do **not** move the exit code: `not-applicable` (the `audit` and `process` lanes, which the CLI recette never owns) and `needs-agent` (steps the agent layer owns). A layer honestly declaring that another layer must run is not an incomplete recette. What *is* caught is a run in which **no lane evaluated anything at all** — every individual skip may be legitimate, but their conjunction asserts nothing about the product, and that exits `3`.

The `review` lane is declared like any other: `ran` when the dashboard built, `error` with `remedy: "infrastructure"` when `build-review.mjs` crashed (which `shipguard review` already maps to exit `2`), `skipped` when no builder is present. `run.json` also carries `exit_code` on every path, including the success path.

---

## `report.md` template

Write to `{report_path}` (default: `visual-tests/_results/report.md`):

```markdown
# Visual Report — {date} {time}

> **Note:** These tests verify visual page loading and surface UI interactions.
> They do not replace unit tests, integration tests, or deterministic visual tests (pytest, Playwright).
> llm-check assertions are evaluated by the LLM with no external observer.

## Summary
- Tests: {total} run, {pass} pass, {fail} fail, {stale} stale, {error} error, {skipped} skipped
- Duration: {total_time}
- Regressions fixed: {count} (removed after 3 consecutive passes)
- New failures: {count}
- Generated tests: {count} (new manifests created during this run)

## Failures
### {test_path} — FAIL
- Step {n}: {action} "{description}"
- Expected: {criteria}
- Actual: {llm_explanation}
- Screenshot: {screenshot_path}

## Stale Tests
### {test_path} — STALE
- Step {n}: {action} target "{target}" — element not found
- Action: Run `/sg-visual-discover` to update selectors

## Generated Tests
- {test_path}: created to cover "{user_description}"

## Regressions Status
| Test | First failed | Last failed | Consecutive passes | Status |
|------|-------------|-------------|-------------------|--------|

## All Results
| Test | Status | Duration | Steps |
|------|--------|----------|-------|
```

---

## User summary (console output)

After the report is written, display to the user:

```
Visual run complete: {pass}/{total} passed, {fail} failed, {stale} stale
Report: visual-tests/_results/report.md
Screenshots: visual-tests/_results/screenshots/

{if failures}
Failures:
- {test_path}: {one-line reason}
{/if}

{if stale}
Stale tests (UI changed — run /sg-visual-discover):
- {test_path}
{/if}

{if generated}
New tests generated:
- {test_path}
{/if}
```
