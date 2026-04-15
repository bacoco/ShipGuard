---
name: sg-visual-run
description: Execute Visual test manifests using agent-browser with hybrid scripted+LLM assertions. Accepts natural language to describe what to test or what changed — the skill finds and runs the right tests, generating missing ones if needed. Trigger on "sg-visual-run", "visual run", "run visual tests", "test regressions", "run tests", "visual-run", "check if the app works", "I changed X check it still works".
context: conversation
argument-hint: "[tests to run or natural language description] [--from-audit] [--regressions] [--all] [--diff=ref]"
---

# /sg-visual-run — Execute Visual Tests

Execute YAML test manifests using agent-browser (Playwright CLI). Hybrid execution: mechanical steps run directly, complex assertions delegate to LLM evaluation.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-visual-run` | **Interactive** — asks user what to do |
| `/sg-visual-run <natural language>` | Describe what to test — the skill figures out the rest |
| `/sg-visual-run --from-audit` | Read `audit-results.json`, extract `impacted_ui_routes` (or legacy `impacted_routes`), find matching test manifests, run only those |
| `/sg-visual-run --diff=main` | Run tests for routes impacted by changes since `main` |
| `/sg-visual-run --all` | Force full suite (skip scope question) |
| `/sg-visual-run --regressions` | Re-run tests that failed on the last run (from `_regressions.yaml`) |

## Flag Parsing

Before entering any mode, check for scope override flags:

1. Check for `--all` flag. If present → run full suite and skip the interactive menu.
2. Check for `--diff=<ref>` flag. If present → use that ref for "only what changed" logic and skip the interactive menu.
3. If BOTH `--all` and `--diff` are present → error: `Cannot use --all and --diff together.`
4. Check for `--from-audit` flag. If present → read `impacted_ui_routes` (or legacy `impacted_routes`) from `audit-results.json` and build execution list from matching manifests. `--from-audit` takes priority over `--diff`: if both are present, `--from-audit` wins because it has its own scope from `audit-results.json`.
5. Check for `--regressions` flag. If present → read `_regressions.yaml` and run only those tests; skip the interactive menu.
6. If no scope flags are present → proceed to Interactive Mode or Natural Language Mode as before.

### Interactive Mode (no arguments)

When called without arguments, **ask the user** using AskUserQuestion:

**Question:** "What do you want to test?"

**Options:**
1. **Only what changed** — Run tests impacted by code changes since the detected base ref
2. **Only regressions** — Re-run previously failed tests
3. **Full suite** — Run all tests (takes ~40 min)
4. *(Other — user types what they want)*

If the user picks "Only what changed":

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
2. Run `git diff --name-only {base} HEAD` → modified files list.
3. If 0 files changed, ask: `No diff vs {base}. Use last commit?` and reuse the same last-commit / full-suite / different-base logic as `sg-code-audit`.
4. Map modified files to routes using the same framework-specific route detection described in `sg-code-audit` Phase 6 Step 3.
5. Match routes to YAML manifests (glob `visual-tests/**/*.yaml`, match the `url` field).
6. If no manifest matches a route, log `uncovered route: {route}`.
7. Include regressions from `_regressions.yaml` (always).
8. Print: `Running {N} tests for {R} impacted routes (diff vs {base}) + {reg} regressions`

If the user picks "Only regressions", read `_regressions.yaml` and run those tests.

If the user picks "Full suite", run everything.

**This question is only asked when no argument is provided.** If the user types `/sg-visual-run I fixed the chat`, skip the question and go straight to impact analysis.

### Natural Language Mode (when text is provided)

When you pass free text, the skill operates in **impact analysis mode**:

```bash
/sg-visual-run test the PDF upload and the pipeline
/sg-visual-run I changed the sidebar, check everything works
/sg-visual-run does the chat work with an attached document?
/sg-visual-run I changed Header.tsx and ChatView.tsx
```

**Flow:**

1. **Understand intent** — Parse the natural language to identify:
   - Pages/features/components mentioned
   - Whether it references recent code changes (check `git diff` if the user says "I changed", "I just modified", etc.)
   - The scope: a specific feature, a page, a whole section

2. **Find impacted tests** — Read all manifest YAML files (name, description, tags) and match against the user's intent:
   - Text mentions "upload" → match manifests about upload
   - Text mentions "dashboard" → match all dashboard/ manifests
   - Text mentions a file like "Header.tsx" → find which routes/components use it → match those manifests

3. **Generate missing tests** — If the described scope has no existing test:
   - Invoke `/sg-visual-discover` with a narrow scope on that area (e.g., `/sg-visual-discover --diff=HEAD~1`) to read the component, understand what it does, and produce a manifest skeleton
   - Generate a new manifest with real steps and assertions
   - **Tag the manifest** with `auto_generated: true`, `generated_by: visual-run`, `generated_date: "{date}"` in the frontmatter
   - Save it to the test tree
   - Then execute it
   - Auto-generated manifests are reported separately. After 3 consecutive passes, they are **automatically removed** (same rule as regressions in `_regressions.yaml`).
   - Track auto-generated manifests in `_results/.auto-generated-manifests.json` — schema: `[{"path": "...", "consecutive_passes": 0}]`. On cleanup, only remove manifests listed in this file.

4. **Execute** — Run matched + generated tests (regressions among them first)

**Examples:**

| Input | What happens |
|-------|-------------|
| `test the PDF upload` | Finds upload-pdf.yaml, runs it |
| `I changed the ingestion pipeline` | git diff → finds changed files → maps to ingestion tests → runs them |
| `check the dashboard loads` | Finds dashboard/home.yaml, runs it |
| `I added a button in the header` | Finds header-related tests, plus generates a new test for the header button if none exists |
| `does the settings page work?` | Finds settings tests, runs them |

### From-Audit Mode

When `--from-audit` is passed:

`--from-audit` overrides smart scope flags. If `--from-audit` and `--diff=<ref>` are both present, use `--from-audit`.

1. Read `audit-results.json` from the results directory: check `visual-tests/_results/audit-results.json` first, then `{repo_root}/audit-results.json`, then `.code-audit-results/audit-results.json`. Fail with a clear message if not found.
2. Extract `impacted_ui_routes` array (fall back to legacy `impacted_routes` if the new field is absent)
3. For each route, find matching YAML manifests using **pathname matching**:
   - Extract the pathname from `manifest.steps[0].url` by stripping `{base_url}` or any `http(s)://host:port` prefix. E.g., `{base_url}/chat` → `/chat`, `http://localhost:3000/dashboard` → `/dashboard`.
   - Compare the extracted pathname against `impacted_route.route` (which is always a bare path like `/dashboard`, `/chat`, `/dossier/:id`).
   - For parameterized routes (`:id`, `[id]`), match the path segments: `/dossier/:id` matches `/dossier/anything`.
   - A manifest matches if its extracted pathname starts with or equals the impacted route path.
4. If no manifest matches a route, log it as "uncovered route" (do NOT auto-generate — the user can run `/sg-visual-discover` separately to create manifests for new routes)
5. Run matched manifests (highest `impacted_route.severity` routes first; use manifest `priority` as secondary sort key)
6. Report: which routes were visually verified, which had no manifest (uncovered), and which code-audit findings were visually confirmed vs not reproduced

## Pre-flight

1. Verify `agent-browser --version` is available
2. Read `visual-tests/_config.yaml` — fail if missing (tell user to run `/sg-visual-discover`)
3. Verify `{base_url}` is reachable: `agent-browser open {base_url}`, check no error
4. Create `{screenshots_dir}` if missing
5. Read `visual-tests/_regressions.yaml` (create empty if missing)

## Build Execution List

Collect manifests to run:

1. **If `--from-audit`**: follow the From-Audit Mode flow — read `audit-results.json`, extract `impacted_ui_routes` (or legacy `impacted_routes`), match YAML manifests using pathname matching (strip `{base_url}` prefix from `manifest.steps[0].url`, compare pathname against `impacted_route.route`), order by `impacted_route.severity` (critical first; manifest `priority` as secondary sort key)
2. **If `--diff=<ref>` or the user picked "Only what changed"**: git diff → route detection → match manifests (see Interactive Mode above), then include regressions
3. **If natural language provided**: analyze intent, match manifests, generate missing ones
4. **If `--regressions`**: only from `_regressions.yaml`, ordered by `last_failed` descending
5. **If `--all` or the user picked "Full suite"**: all manifests, regressions first, then by priority `high` → `medium` → `low`
6. **Always skip** manifests with `deprecated: true`
7. **Regressions among matched tests always run first** (except in `--from-audit` mode, where severity order takes precedence)

## Execution Strategy

**All browser tests run sequentially** in a single browser session. One login, one browser, one agent.

> **CRITICAL: NEVER call multiple `agent-browser` commands in parallel Bash calls.** agent-browser uses a single Playwright daemon. Parallel calls cause all navigations to race to the same page, producing wrong URLs and corrupted screenshots. Even if you use separate Bash tool calls in the same message, they execute concurrently. Always chain browser commands sequentially: one navigation completes before the next begins.

Sequential execution with a single auth is also faster in practice: no re-login overhead, no session conflicts, no retries.

### Session Expiry Detection

After EVERY `agent-browser open {url}`, verify the navigation succeeded:

```
1. Run: agent-browser get url
2. Compare actual URL against expected URL
3. If actual_url != expected_url AND (actual_url == "/" OR actual_url contains "/login"):
   → Session expired. Re-login:
     a. Execute _shared/login.yaml steps
     b. Retry the original navigation
     c. If still wrong URL after retry: mark test as ERROR
4. If actual_url matches expected_url: continue normally
```

This catches silent session expiry — the most common failure mode in long runs (>30 minutes). The redirect happens without error, so without this check the test takes a screenshot of the wrong page and marks it PASS.

## Progress Reporting

During execution, print a progress line after each test completes:

```
[sg-visual-run] Test {current}/{total} — {test-name} ({PASS|FAIL|STALE|ERROR}) — ~{remaining} min remaining
```

Estimate remaining time: `(elapsed_seconds / tests_completed) * tests_remaining / 60`. Update after each test.

## llm-check Reliability Guide

`llm-check` assertions are evaluated by the LLM at runtime. They are **reliable** for:
- Blank/white screens (no content rendered)
- Broken layouts (overlapping elements, missing sections, scrollbar issues)
- Missing images or broken image icons
- Error messages, toasts, modals with error text
- Page structure (sidebar present, header visible, correct number of tabs)

They are **NOT reliable** for:
- Business-correct data values (e.g., "total should be 42.50")
- Exact text matching (use `assert_text` instead)
- Color accuracy or subtle styling differences
- Dynamic content that changes between runs (timestamps, random IDs)
- Performance metrics (load time, animation smoothness)

**Rule of thumb:** Use `llm-check` for "does it look right?" and `assert_text`/`assert_url` for "is the exact value correct?"

## Execution Loop

For each manifest assigned to this agent:

### Step 0: Test Isolation

```bash
agent-browser open {base_url}
```

Every test starts from the base URL. No state carries over from previous tests.

### Step 1: Auth

If `requires_auth: true`, execute `_shared/login.yaml` steps.

**Optimization:** After the first successful login, check if session persists by navigating to a protected page. The user is considered "still authenticated" when ALL of the following are true: (1) no login form is present in the snapshot (no username/password inputs), (2) an authenticated UI element is visible (user menu, avatar, or logout button), and (3) the browser did not redirect away from the requested protected URL. If any check fails, re-login. If auth fails mid-run, re-login and retry once.

### Step 2: Execute Steps

For each step in the manifest's `steps:` array:

#### Variable Interpolation

Before executing, replace variables in all string fields:
- `{base_url}` → from `_config.yaml`
- `{credentials.username}`, `{credentials.password}` → from `_config.yaml`
- `{data.xxx}` → from the manifest's `data:` section

**Internal variables** (resolved by the skill, not from config):
- `{session_id}` → `visual-run-{timestamp}` (unique per execution)
- `{screenshots_dir}` → value of `screenshots_dir` in `_config.yaml`
- `{report_path}` → value of `report_path` in `_config.yaml`
- `{date}`, `{time}` → current date and time

#### Include Resolution

For `action: include`:
- `path:` — relative path to the shared manifest YAML file (e.g., `_shared/login.yaml`)
- Read the referenced file (relative to `visual-tests/`)
- Inline its steps at the current position
- Max depth: 3 levels. Circular references: detect and reject with error.

#### Mechanical Actions

Execute directly via agent-browser CLI:

**`open`:**
```bash
agent-browser open <url>
agent-browser wait --load networkidle
```

**`click`:**
1. `agent-browser snapshot` → parse accessibility tree
2. Find element whose text/label/placeholder contains `target` string
3. If found: `agent-browser click <ref>`
4. If not found: `agent-browser find text "<target>" click`
5. If still not found: mark step `STALE`

**`fill`:**
1. `agent-browser snapshot` → find input by placeholder/label matching `target`
2. `agent-browser fill <ref> "<value>"`

**`press`:**
```bash
agent-browser press <key>
```

**`upload`:**
- `file:` — path to the file to upload (e.g., `data-sample/test.pdf`)
1. `agent-browser snapshot` → find file input
2. `agent-browser upload <ref> <file_path>`

**`select`:**
1. `agent-browser snapshot` → find select element
2. `agent-browser select <ref> "<option>"`

**`wait`:**
```bash
sleep <duration_seconds>
```

**`assert_url`:**
```bash
agent-browser get url
```
Compare the current page URL path against the expected value. Full URLs and path-only values are both accepted — path-only values match against the URL pathname. If mismatch: FAIL.

**`assert_text`:**
1. `agent-browser snapshot`
2. Search for `expected` text in the tree
3. If not found: FAIL

**`screenshot`:**
```bash
agent-browser screenshot --full {screenshots_dir}/<filename>
```
Then **MANDATORY**: read the screenshot with the Read tool and visually validate it. See Screenshot Validation below.

#### Screenshot Validation (MANDATORY — NEVER SKIP)

**Every single screenshot taken during a test run MUST be validated.** This is non-negotiable.

After every `agent-browser screenshot <path>`:

1. **Read the image** using the Read tool: `Read(file_path=<screenshot_path>)`
2. **Visually inspect** the screenshot for:
   - Error messages (toasts, alerts, modals with "error", "failed", "impossible", HTTP error codes)
   - Blank/white screens
   - Loading spinners that should have resolved
   - Broken layouts (overlapping elements, missing content)
   - Any state that does not match the expected outcome of the step
3. **If ANY error or anomaly is detected:**
   - Mark the step as **FAIL** immediately
   - Record the exact error visible in the screenshot
   - Do NOT continue the test as if nothing happened
   - Do NOT mark the test as PASS
4. **If the screenshot looks correct:**
   - Explicitly state what you see and why it matches expectations
   - Then proceed to the next step

**This applies to ALL screenshots** — whether from explicit `screenshot` actions, `llm-check` screenshots, `llm-wait` screenshots, or any other screenshot taken during execution.

**Anti-patterns (FORBIDDEN):**
- Taking a screenshot and continuing without reading it
- Reading a screenshot that shows an error and marking the test as PASS
- Saying "screenshot taken" without describing what's in it
- Skipping validation because "it's probably fine"
- Treating an error in a screenshot as "partial pass" or "acceptable"

#### Hybrid Actions

**`llm-wait`:**

Poll with LLM evaluation until conditions are met or timeout:

> **Field note:** In `llm-wait` and `llm-check`, the output file field is called `screenshot:` (the path to write the screenshot). In the standalone `screenshot` action, the same field is called `filename:`. Both refer to the output file path.

```
loop every 3 seconds until timeout:
  1. agent-browser snapshot
  2. LLM evaluates: are ALL checkpoints satisfied?
     - Each checkpoint is a natural-language condition
     - LLM responds: checkpoint status (met/not yet/failed)
  3. If all met → PASS, take screenshot if specified
  4. If any failed (not "not yet" but definitively failed) → FAIL
  5. If timeout → FAIL with "timeout waiting for conditions"
```

**`llm-check`:**

Single-shot LLM evaluation:

```
1. agent-browser snapshot (get accessibility tree text)
2. agent-browser screenshot --full {screenshots_dir}/<filename>  # field: screenshot:
3. Read the screenshot with Read tool — MANDATORY, see Screenshot Validation
4. LLM evaluates BOTH the snapshot text AND the visual screenshot against `criteria`
5. If the screenshot shows ANY error → FAIL regardless of criteria
6. LLM responds: PASS (criteria met, no errors visible) or FAIL (with reason)
7. If severity=critical and FAIL → test fails, move to next test
8. If severity=warning and FAIL → log warning, continue
```

### Step 3: Record Result

For each test: `PASS` / `FAIL` / `STALE` / `ERROR` / `SKIP`

- **PASS**: All steps completed, all assertions passed, all screenshots clean
- **FAIL**: A `severity: critical` assertion failed or screenshot showed an error
- **STALE**: An element selector could not be resolved (UI changed)
- **ERROR**: agent-browser crashed or unrecoverable error
- **SKIP**: Manifest is `deprecated: true`

## Browser Crash Recovery

If any `agent-browser` command returns non-zero exit code or times out:

1. Attempt: `agent-browser close` (ignore errors)
2. Attempt: `agent-browser open {base_url}`
3. If `requires_auth`: re-login
4. Retry the failed step once
5. If retry fails: mark test `ERROR`, move to next test
6. If 3 consecutive `ERROR` results across different tests: **abort entire run** with message "Browser unstable — check agent-browser installation"

## Update Regressions

After all tests complete, update `visual-tests/_regressions.yaml`:

### Add/Update Failures

For each test that FAILED, STALE, or ERROR:
- If already in regressions: update `last_failed`, `failure_reason`, reset `consecutive_passes: 0`
- If new failure: add entry with `first_failed: today`, `consecutive_passes: 0`
- STALE and ERROR tests are included with their corresponding `failure_reason` (e.g., "Element not found: {target}" for STALE, "Browser crash / agent-browser error" for ERROR)

### Track Passes

For each test that PASSED and is in regressions:
- Increment `consecutive_passes`
- If `consecutive_passes >= 3`: **remove from regressions** (resolved)

### Regressions File Format

```yaml
# Auto-maintained by /sg-visual-run — do not edit manually
regressions:
  - test: dashboard/file-upload
    first_failed: "2026-03-22"
    last_failed: "2026-03-24"
    consecutive_passes: 0
    failure_reason: "Pipeline timeout after 90s"
    screenshot: "_results/screenshots/upload-pdf-fail.png"
```

## Generate Report

Write to `{report_path}` (default: `visual-tests/_results/report.md`):

```markdown
# Visual Report — {date} {time}

> **Note:** These tests verify visual page loading and surface UI interactions.
> They do not replace unit tests, integration tests, or deterministic visual tests (pytest, Playwright).
> llm-check assertions are evaluated by the LLM with no external observer.

## Summary
- Tests: {total} run, {pass} pass, {fail} fail, {stale} stale, {error} error, {skip} skip
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

## Output

After the report is written, display a concise summary to the user:

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

## agent-browser Reference

### Basic commands (covers ~60% of tests)

| Command | Usage | Example |
|---------|-------|---------|
| `open <url>` | Navigate to URL | `agent-browser open http://localhost:3000` |
| `snapshot` | Accessibility tree with refs (for AI) | `agent-browser snapshot` |
| `click <ref>` | Click element by ref | `agent-browser click @e12` |
| `fill <ref> <text>` | Clear and fill input | `agent-browser fill @e10 "alex"` |
| `upload <sel> <files>` | Upload file to input | `agent-browser upload "#file-input" ./test.md` |
| `eval <js>` | Run JavaScript in page | `agent-browser eval 'document.querySelector("input").id'` |
| `screenshot <path>` | Take viewport screenshot | `agent-browser screenshot /tmp/capture.png` |
| `screenshot --full <path>` | Take full-page screenshot | `agent-browser screenshot --full /tmp/capture.png` |
| `wait <selector> [timeout]` | Wait for element to appear | `agent-browser wait "#result" 5000` |
| `find <text>` | Find element by visible text | `agent-browser find "Submit"` |
| `get url` | Get current URL | `agent-browser get url` |
| `close` | Close browser | `agent-browser close` |

### Advanced interactions — see [references/advanced-interactions.md](references/advanced-interactions.md)

`agent-browser` exposes much more than basic click/fill. Before writing a test with complex interactions, **read the advanced reference**. Key patterns covered:

- **Drag-and-drop** for `@dnd-kit` / `react-dnd` / `react-beautiful-dnd` (requires `mouse move` + activation distance — `click` does NOT work)
- **Hover, right-click, context menus** (for tooltips and submenus)
- **Keyboard shortcuts** (`press Meta+k`, `press Escape`, `press Control+a`)
- **Form-specific actions** (`check`/`uncheck`/`select` vs `click`)
- **Hidden file inputs** upload
- **Network mocking** (`network route --abort`/`--body` — test error states without backend down)
- **State manipulation** (`cookies`, `storage local`, Zustand reset, feature flag override)
- **Device/responsive/env** (`set viewport`, `set device`, `set media dark`, `set offline on`, `set geo`)
- **Visual regression** (`diff screenshot --baseline`)
- **Multi-tab workflows** (OAuth popups, `tab new|list|close`)
- **Console error detection** (`console` + `errors` — catches silent React/ErrorBoundary errors)
- **Video + trace recording** for flaky test debug
- **Semantic selectors** (`find role|label|testid` — stable vs `@eN` refs)
- **Iframe + Shadow DOM** traversal
- **Auth optimization** (`--session-name`, `--profile`, `--auto-connect`, `auth save/login`)
- **SPA pitfalls** (portals, debounced inputs, animations, client-side routing, Suspense)
- **Atomic batch** (`batch --bail`)
- **Annotated screenshots** (`--annotate` for vision LLMs)

**A test that only uses `click/fill/snapshot` without these tools misses ~80% of real UI bugs.** Always consult the advanced reference before adding a new test manifest.

## Final Checklist

Before considering the run complete, verify:

- [ ] Pre-flight passed (agent-browser, `_config.yaml`, `base_url` reachable)
- [ ] Browser opened (single session)
- [ ] Auth executed (if `requires_auth`)
- [ ] Every screenshot read and visually validated
- [ ] `_regressions.yaml` updated (failures added, 3 passes → removed)
- [ ] Report written to `{report_path}`
- [ ] Browser closed
- [ ] Summary displayed (pass/fail/stale)
