---
name: sg-visual-run
description: Use when UI changes need visual verification — after code, logic, or process lanes flag routes, after frontend edits, or on demand to run or re-run the project's visual test manifests.
context: conversation
argument-hint: "[tests to run or natural language description] [--from-audit] [--from-logic] [--from-process] [--regressions] [--all] [--diff=ref]"
---

# /sg-visual-run — Execute Visual Tests

Execute YAML test manifests using agent-browser (Playwright CLI). Hybrid execution: mechanical steps run directly, complex assertions delegate to LLM evaluation.

> **Model guidance:** This skill runs scripted steps (click, fill, screenshot) plus lightweight LLM assertions. A top-tier reasoning model provides no measurable quality gain here — prefer a fast, capable model to conserve quota.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-visual-run` | **Interactive** — asks what to test |
| `/sg-visual-run <text>` | Natural language — figures out what tests to run |
| `/sg-visual-run --from-audit` | Run tests for `impacted_ui_routes` from `visual-tests/_results/audit-results.json` |
| `/sg-visual-run --from-logic` | Run tests for `impacted_ui_routes` from `visual-tests/_results/logic-results.json` |
| `/sg-visual-run --from-process` | Run tests for `impacted_ui_routes` from `visual-tests/_results/process-results.json` |
| `/sg-visual-run --from-audit --from-logic --from-process` | **Union mode** — merge routes from every selected result file |
| `/sg-visual-run --diff=main` | Run tests impacted by changes since `main` |
| `/sg-visual-run --all` | Full suite (skip interactive menu) |
| `/sg-visual-run --regressions` | Re-run tests that failed last run |

**For full flag parsing rules, interactive/natural-language/audit flows, and route-to-manifest matching:** see [references/invocation-modes.md](references/invocation-modes.md).

## Pre-flight

Sandbox note: browser sockets, local network, and cache writes may require explicit permission in Codex/Claude. See [../../docs/sandbox.md](../../docs/sandbox.md).

1. Verify `agent-browser --version` is available
2. Load the CLI's own reference (`agent-browser skills get core --full`) as ground truth for command syntax when unsure.
3. Read `visual-tests/_config.yaml` — fail if missing (tell user to run `/sg-visual-discover`)
4. Verify `{base_url}` is reachable: `agent-browser open {base_url}`, check no error.
   - **If unreachable and `_config.yaml` has an `app.start` block:** start the app via the ShipGuard CLI instead of aborting — `node visual-tests/shipguard.mjs serve` (copy it first if missing: `cp "$SHIPGUARD_PLUGIN_ROOT/cli/shipguard.mjs" visual-tests/`). Use the `base_url` it prints for the rest of the run. Remember that the CLI started it: run `node visual-tests/shipguard.mjs stop` in the final cleanup — only when the CLI started the app, never kill a server the user started themselves.
   - Exit-code semantics: `serve` exiting `2` is an **infrastructure error** (report it as such, distinct from any product finding); `3` is a config error.
   - Trust boundary: `serve` executes `app.start` through a shell with your local privileges — same trust level as running the project's npm scripts. Only run it on a `_config.yaml` you trust.
   - If unreachable and there is no `app.start`, run `agent-browser close` before aborting (see cleanup invariant below).
5. Create `{screenshots_dir}` and `visual-tests/_results/` if missing (`mkdir -p`)
6. Read `visual-tests/_regressions.yaml` (create empty if missing)

## Build execution list

Scope-source precedence (bridge flags > `--diff` > natural language > `--regressions` > `--all`), multi-source union, the `deprecated: true` skip, and regressions-first ordering are defined once, authoritatively, in [references/invocation-modes.md — "Build Execution List — priority order"](references/invocation-modes.md). Follow that list; do not restate it here.

## Execution strategy

**All browser tests run sequentially** in a single browser session. One login, one browser, one agent.

> **Cleanup invariant (hard rule):** On ANY exit — success, failure, abort, or interrupt — run `agent-browser close` (and `agent-browser close --all` if named sessions were used). Ignore errors from close. This covers the 3-consecutive-ERROR abort path (Browser crash recovery below), pre-flight reachability failure, and mid-run interrupts.

> **CRITICAL: NEVER call multiple `agent-browser` commands in parallel Bash calls.** agent-browser uses a single Playwright daemon. Parallel calls cause navigations to race to the same page, producing wrong URLs and corrupted screenshots. Even separate Bash tool calls in the same message execute concurrently. Always chain browser commands sequentially.

Sequential execution with a single auth is also faster: no re-login overhead, no session conflicts, no retries.

### Session expiry detection

After EVERY `agent-browser open {url}`, verify navigation succeeded:

```
1. agent-browser get url
2. Compare actual vs expected URL
3. If actual != expected AND (actual == "/" OR contains "/login"):
   → Session expired. Re-login:
     a. Execute _shared/login.yaml steps
     b. Retry the original navigation
     c. If still wrong URL: mark test as ERROR
4. If actual matches expected: continue
```

Catches silent session expiry — the most common failure mode in long runs (>30 min). Without this check, tests screenshot the wrong page and mark PASS.

## Progress reporting

Print a progress line after each test completes:

```
[sg-visual-run] Test {current}/{total} — {test-name} ({PASS|FAIL|STALE|ERROR}) — ~{remaining} min remaining
```

Remaining time = `(elapsed_seconds / tests_completed) * tests_remaining / 60`. Update after each test.

## Execution loop

For each manifest:

### Step 0: Isolation

```bash
agent-browser open {base_url}
```

Every test starts from the base URL. No state carries over.

### Step 1: Auth

If `requires_auth: true`, execute `_shared/login.yaml` steps.

**Optimization:** After first successful login, session persists if ALL: (1) no login form in snapshot (no username/password inputs), (2) authenticated UI element visible (user menu, avatar, logout), (3) no redirect away from protected URL. Any check fails → re-login. If auth fails mid-run, re-login and retry once.

### Step 2: Execute steps

For each step in the manifest's `steps:` array, run the corresponding action. **For action semantics, variable interpolation, include resolution, screenshot validation rules, and hybrid `llm-*` actions:** see [references/action-reference.md](references/action-reference.md).

**Screenshot validation is MANDATORY — never skip.** Every screenshot must be read via the Read tool and visually inspected for errors before proceeding. A screenshot showing an error = test FAIL, regardless of other assertions. See action-reference.md for the full rule.

**Byte check before visual check:** immediately after every screenshot capture, verify the file is non-empty (`[ -s {file} ]`). A missing or 0-byte screenshot = test `ERROR` with reason "screenshot missing/empty" — do not Read or visually judge an empty file.

### Step 3: Record result

`PASS` / `FAIL` / `STALE` / `ERROR` / `SKIPPED` — mapping in action-reference.md.

### Step 4: Capture browser errors (per test)

After the test's steps, capture and normalize console state:

```
agent-browser errors            # uncaught exceptions, unhandled rejections
agent-browser console           # console entries; keep error/warn lines only
agent-browser console --clear   # reset for the next test
```

Record them on the test as `browser_errors: [{"level": "error"|"warn", "text": "..."}]` in `visual-results.json` (additive field). Any `error`-level entry on a test that otherwise passed → status `FAIL` with `failure_reason: "browser errors: N"`. These entries are **measured** evidence and feed the unified `findings.json` built by `/sg-visual-review`.

## Browser crash recovery

If any `agent-browser` command returns non-zero exit code or times out:

1. `agent-browser close` (ignore errors)
2. `agent-browser open {base_url}`
3. If `requires_auth`: re-login
4. Retry the failed step once
5. If retry fails → test `ERROR`, next test
6. If 3 consecutive `ERROR` across different tests → **abort entire run** with "Browser unstable — check agent-browser installation". Per the cleanup invariant, still run `agent-browser close` (ignore errors) before exiting.

## Update regressions

After all tests complete, update `visual-tests/_regressions.yaml`:

- FAIL / STALE / ERROR: update or add entry (`consecutive_passes: 0`)
- PASS for a test in regressions: increment `consecutive_passes`
- `consecutive_passes >= 3`: **remove from regressions** (resolved)

**Full YAML format:** see [references/report-formats.md](references/report-formats.md).

## Generate report

Write the canonical machine-readable result to `visual-tests/_results/visual-results.json` (create the directory with `mkdir -p` if missing). `report.md` is a human-readable rendering only and must not be the only status source.

Minimum JSON shape (stub — the authoritative full schema lives in [references/report-formats.md](references/report-formats.md)):

```json
{
  "schema_version": "1.0",
  "run_id": "visual-20260629-133000",
  "timestamp": "2026-06-29T13:30:00Z",
  "base_url": "http://127.0.0.1:8001",
  "scope": {"type": "from-audit", "selected_total": 1, "full_suite_total": 28},
  "summary": {"total": 1, "pass": 1, "fail": 0, "error": 0, "stale": 0, "skipped": 0, "duration_ms": 36800},
  "tests": [{"id": "pages/root-index", "url": "/", "status": "PASS", "screenshot": "screenshots/root-index.png", "failure_reason": null}]
}
```

For scoped runs, `summary.total` is the selected run total, not the full suite total. Preserve `scope.full_suite_total` separately so the dashboard does not reinterpret unselected manifests as `STALE`.

Then write report to `{report_path}` (default: `visual-tests/_results/report.md`) with sections: Summary, Failures, Stale Tests, Generated Tests, Regressions Status, All Results.

**Full template:** [references/report-formats.md](references/report-formats.md).

## Output

Display a concise summary: pass/total, failures (one line each), stale tests (with "run /sg-visual-discover" hint), generated tests. **Full format:** [references/report-formats.md](references/report-formats.md).

## agent-browser reference

### Basic commands (cover ~60% of tests)

| Command | Usage | Example |
|---------|-------|---------|
| `open <url>` | Navigate | `agent-browser open http://localhost:3000` |
| `snapshot` | Accessibility tree with refs | `agent-browser snapshot` |
| `click <ref>` | Click by ref | `agent-browser click @e12` |
| `fill <ref> <text>` | Clear and fill input | `agent-browser fill @e10 "alex"` |
| `upload <sel> <files>` | Upload file | `agent-browser upload "#file-input" ./test.md` |
| `eval <js>` | Run JS in page | `agent-browser eval 'document.querySelector("input").id'` |
| `screenshot <path>` | Viewport screenshot | `agent-browser screenshot /tmp/x.png` |
| `screenshot --full <path>` | Full-page screenshot | `agent-browser screenshot --full /tmp/x.png` |
| `wait <selector>` | Wait for element (single arg; also accepts ms, `--url`, `--load`, `--fn`, `--text`) | `agent-browser wait "#result"` |
| `find <locator> <value> [action]` | Find by locator type, optionally act | `agent-browser find text "Submit" click` |
| `get url` | Current URL | `agent-browser get url` |
| `close` | Close browser | `agent-browser close` |

### Advanced interactions

**When to read [references/advanced-interactions.md](references/advanced-interactions.md):** whenever a test involves drag-and-drop, hover/tooltips, keyboard shortcuts, forms (checkbox/radio/select), file upload, network mocking, state manipulation (cookies/storage/feature flags), responsive/dark-mode testing, multi-tab/OAuth, visual regression, console error detection, iframe/Shadow DOM, or auth optimization.

Tests that only use `click/fill/snapshot` miss ~80% of real UI bugs. The reference documents 20 patterns with framework-specific recipes (e.g., `@dnd-kit` requires `mouse move` + activation distance — `click` does not work).

## Final checklist

Before considering the run complete:

- [ ] Pre-flight passed (agent-browser, `_config.yaml`, `base_url` reachable)
- [ ] Browser opened (single session)
- [ ] Auth executed (if `requires_auth`)
- [ ] Every screenshot read and visually validated
- [ ] `_regressions.yaml` updated (failures added, 3 passes → removed)
- [ ] Report written to `{report_path}`
- [ ] Browser closed — `agent-browser close` ran (cleanup invariant: always, even on failure or abort; `close --all` if named sessions were used)
- [ ] Summary displayed (pass/fail/stale)
- [ ] If this run supports UI-visible code changes, invoke `sg-change-report` and commit the resulting `change-reports/<report-id>` and generated `persona-reports/<report-id>` artifacts with the PR
- [ ] Do not commit `visual-tests/_results/review.html` or `visual-tests/_results/.server.pid`
