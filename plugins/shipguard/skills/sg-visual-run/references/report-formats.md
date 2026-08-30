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

Allowed test statuses: `PASS`, `FAIL`, `ERROR`, `STALE`, `SKIPPED`.

Additive optional per-test fields (producers may emit them; consumers must tolerate their absence):
- `browser_errors`: `[{"level": "error"|"warn", "text": "..."}]` — normalized console/pageerror entries captured after the test's steps. **Measured** evidence; feeds `findings.json`.
- `llm_steps_pending`: integer — number of `llm-check`/`llm-wait` steps a mechanical (`shipguard run`) execution could not evaluate. `0` or absent after a full agent run; non-zero values are declared as a `needs-agent` lane in `run.json`.
- `screenshot_error`: string — the capture for this test was missing or 0 bytes. Emitted whatever the test's status, so a tooling failure is never swallowed by a product verdict that was reached first. Absent when the capture was valid.
- `console_capture_error`: string — the `agent-browser errors`/`console` bridge failed, so `browser_errors` is an empty *unobserved* list, not an observed absence of errors. Absent when the capture succeeded.

For union runs (two or more bridge flags), `scope.type` is `"union"` and `scope.source` lists every consumed file (see invocation-modes.md, Union Mode).

For scoped runs, `summary.total` is the selected run total. Preserve the global suite size in `scope.full_suite_total`, and preserve routes that were not executable as `scope.uncovered_routes` rather than dropping them from the machine contract.

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
