---
name: sg-visual-run
description: Execute Visual test manifests using agent-browser with hybrid scripted+LLM assertions. Accepts natural language to describe what to test or what changed — the skill finds and runs the right tests, generating missing ones if needed. Trigger on "sg-visual-run", "visual run", "run visual tests", "test regressions", "run tests", "visual-run", "check if the app works", "I changed X check it still works".
context: conversation
argument-hint: "[tests to run or natural language description] [--from-audit] [--regressions] [--all] [--diff=ref]"
---

# /sg-visual-run — Execute Visual Tests

Execute YAML test manifests using agent-browser (Playwright CLI). Hybrid execution: mechanical steps run directly, complex assertions delegate to LLM evaluation.

> **Recommended model: Sonnet 4.6.** This skill runs scripted steps (click, fill, screenshot) + lightweight LLM assertions. Opus 4.7 provides no measurable quality gain here. Use `/model sonnet` before invoking to save Opus weekly quota.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-visual-run` | **Interactive** — asks what to test |
| `/sg-visual-run <text>` | Natural language — figures out what tests to run |
| `/sg-visual-run --from-audit` | Run tests for `impacted_ui_routes` from `audit-results.json` |
| `/sg-visual-run --diff=main` | Run tests impacted by changes since `main` |
| `/sg-visual-run --all` | Full suite (skip interactive menu) |
| `/sg-visual-run --regressions` | Re-run tests that failed last run |

**For full flag parsing rules, interactive/natural-language/audit flows, and route-to-manifest matching:** see [references/invocation-modes.md](references/invocation-modes.md).

## Pre-flight

1. Verify `agent-browser --version` is available
2. Read `visual-tests/_config.yaml` — fail if missing (tell user to run `/sg-visual-discover`)
3. Verify `{base_url}` is reachable: `agent-browser open {base_url}`, check no error
4. Create `{screenshots_dir}` if missing
5. Read `visual-tests/_regressions.yaml` (create empty if missing)

## Build execution list

Priority order:

1. **`--from-audit`** → severity-ordered list from `impacted_ui_routes` (see invocation-modes.md)
2. **`--diff` or "Only what changed"** → diff-based routes + regressions
3. **Natural language** → intent analysis + generate missing tests
4. **`--regressions`** → from `_regressions.yaml`, ordered by `last_failed` desc
5. **`--all` or "Full suite"** → all manifests, regressions first, then priority `high`→`medium`→`low`

**Always skip** manifests with `deprecated: true`. **Regressions among matched tests always run first** (except `--from-audit`, where severity wins).

## Execution strategy

**All browser tests run sequentially** in a single browser session. One login, one browser, one agent.

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

### Step 3: Record result

`PASS` / `FAIL` / `STALE` / `ERROR` / `SKIP` — mapping in action-reference.md.

## Browser crash recovery

If any `agent-browser` command returns non-zero exit code or times out:

1. `agent-browser close` (ignore errors)
2. `agent-browser open {base_url}`
3. If `requires_auth`: re-login
4. Retry the failed step once
5. If retry fails → test `ERROR`, next test
6. If 3 consecutive `ERROR` across different tests → **abort entire run** with "Browser unstable — check agent-browser installation"

## Update regressions

After all tests complete, update `visual-tests/_regressions.yaml`:

- FAIL / STALE / ERROR: update or add entry (`consecutive_passes: 0`)
- PASS for a test in regressions: increment `consecutive_passes`
- `consecutive_passes >= 3`: **remove from regressions** (resolved)

**Full YAML format:** see [references/report-formats.md](references/report-formats.md).

## Generate report

Write report to `{report_path}` (default: `visual-tests/_results/report.md`) with sections: Summary, Failures, Stale Tests, Generated Tests, Regressions Status, All Results.

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
| `wait <selector> [timeout]` | Wait for element | `agent-browser wait "#result" 5000` |
| `find <text>` | Find by visible text | `agent-browser find "Submit"` |
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
- [ ] Browser closed
- [ ] Summary displayed (pass/fail/stale)
