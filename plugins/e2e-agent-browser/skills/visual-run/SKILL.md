---
name: visual-run
description: Execute Visual test manifests using agent-browser with hybrid scripted+LLM assertions. Accepts natural language to describe what to test or what changed — the skill finds and runs the right tests, generating missing ones if needed. Trigger on "visual run", "run visual tests", "test regressions", "run tests", "visual-run", "check if the app works", "teste le chat", "j'ai modifie X verifie que ca marche".
context: conversation
argument-hint: "[tests to run or natural language description]"
---

# /visual-run — Execute Visual Tests

Execute YAML test manifests using agent-browser (Playwright CLI). Hybrid execution: mechanical steps run directly, complex assertions delegate to LLM evaluation.

## Invocations

| Command | Behavior |
|---------|----------|
| `/visual-run` | **Interactive** — asks user what to do |
| `/visual-run <natural language>` | Describe what to test — the skill figures out the rest |

### Interactive Mode (no arguments)

When called without arguments, **ask the user** using AskUserQuestion:

**Question:** "What do you want to test?"

**Options:**
1. **Only what changed** — Run tests impacted by code changes since last run (checks `git diff`)
2. **Only regressions** — Re-run previously failed tests
3. **Full suite** — Run all tests (takes ~40 min)
4. *(Other — user types what they want)*

If the user picks "Only what changed", check `git diff` to find modified files, map them to impacted test manifests, and run only those.

If the user picks "Only regressions", read `_regressions.yaml` and run those tests.

If the user picks "Full suite", run everything.

**This question is only asked when no argument is provided.** If the user types `/visual-run I fixed the chat`, skip the question and go straight to impact analysis.

### Natural Language Mode (when text is provided)

When you pass free text, the skill operates in **impact analysis mode**:

```bash
/visual-run teste l'upload de PDF et le pipeline
/visual-run j'ai modifie le sidebar de Harmonia, verifie que tout marche
/visual-run est-ce que le chat fonctionne avec un document attache ?
/visual-run j'ai change ArticleModal.tsx et notaire-chat-view.tsx
```

**Flow:**

1. **Understand intent** — Parse the natural language to identify:
   - Pages/features/components mentioned
   - Whether it references recent code changes (check `git diff` if the user says "j'ai modifie", "je viens de changer", etc.)
   - The scope: a specific feature, a page, a whole section

2. **Find impacted tests** — Read all manifest YAML files (name, description, tags) and match against the user's intent:
   - Text mentions "upload" → match manifests about upload
   - Text mentions "Harmonia" → match all harmonia/ manifests
   - Text mentions a file like "ArticleModal.tsx" → find which routes/components use it → match those manifests

3. **Generate missing tests** — If the described scope has no existing test:
   - Invoke `/visual-discover` with a narrow scope on that area (e.g., `/visual-discover --scope=<component-or-route> --depth=1`) to read the component, understand what it does, and produce a manifest skeleton
   - Generate a new manifest with real steps and assertions
   - **Tag the manifest** with `auto_generated: true`, `generated_by: visual-run`, `generated_date: "{date}"` in the frontmatter
   - Save it to the test tree
   - Then execute it
   - Auto-generated manifests are reported separately. After 3 consecutive passes, they are **automatically removed** (same rule as regressions in `_regressions.yaml`)

4. **Execute** — Run matched + generated tests (regressions among them first)

**Examples:**

| Input | What happens |
|-------|-------------|
| `teste l'upload de PDF` | Finds upload-pdf.yaml, runs it |
| `j'ai modifie le pipeline d'ingestion` | git diff → finds changed files → maps to ingestion tests → runs them |
| `verifie que le dashboard charge` | Finds dashboard/home.yaml, runs it |
| `j'ai ajoute un bouton dans le header du chat` | Finds notaire-chat tests, plus generates a new test for the header button if none exists |
| `est-ce que la veille juridique fonctionne ?` | Finds JorfWatch/legal tests, runs them |

## Pre-flight

1. Verify `agent-browser --version` is available
2. Read `visual-tests/_config.yaml` — fail if missing (tell user to run `/visual-discover`)
3. Verify `{base_url}` is reachable: `agent-browser open {base_url}`, check no error
4. Create `{screenshots_dir}` if missing
5. Read `visual-tests/_regressions.yaml` (create empty if missing)

## Build Execution List

Collect manifests to run:

1. **If natural language provided**: analyze intent, match manifests, generate missing ones
2. **If `--regressions`**: only from `_regressions.yaml`, ordered by `last_failed` descending
3. **If no arguments**: all manifests, regressions first, then by priority `high` → `medium` → `low`
4. **Always skip** manifests with `deprecated: true`
5. **Regressions among matched tests always run first**

## Execution Strategy

**All browser tests run sequentially** in a single browser session. One login, one browser, one agent.

agent-browser uses a single Playwright daemon. Multiple agents trying to control the browser simultaneously causes "Target page, context or browser has been closed" errors — even with `--session` flags. This is not a fixable configuration issue; it's how the daemon works.

Sequential execution with a single auth is also faster in practice: no re-login overhead, no session conflicts, no retries.

## Execution Loop

For each manifest assigned to this agent:

### Step 0: Test Isolation

```bash
agent-browser --session {session_id} open {base_url}
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
- `{session_id}` → `e2e-run-{timestamp}` (unique per execution)
- `{screenshots_dir}` → value of `screenshots_dir` in `_config.yaml`
- `{report_path}` → value of `report_path` in `_config.yaml`
- `{date}`, `{time}` → current date and time

#### Include Resolution

For `action: include`:
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
Compare with `expected`. If mismatch: FAIL.

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
2. agent-browser screenshot --full {screenshots_dir}/<filename>
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

For each test that FAILED:
- If already in regressions: update `last_failed`, `failure_reason`, reset `consecutive_passes: 0`
- If new failure: add entry with `first_failed: today`, `consecutive_passes: 0`

### Track Passes

For each test that PASSED and is in regressions:
- Increment `consecutive_passes`
- If `consecutive_passes >= 3`: **remove from regressions** (resolved)

### Regressions File Format

```yaml
# Auto-maintained by /visual-run — do not edit manually
regressions:
  - test: notaire-chat/upload-pdf
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
- Action: Run `/visual-discover` to update selectors

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
Stale tests (UI changed — run /visual-discover):
- {test_path}
{/if}

{if generated}
New tests generated:
- {test_path}
{/if}
```

## agent-browser Reference

| Command | Usage | Example |
|---------|-------|---------|
| `open <url>` | Navigate to URL | `agent-browser open http://localhost:3000` |
| `snapshot` | Accessibility tree with refs (for AI) | `agent-browser snapshot` |
| `click <ref>` | Click element by ref | `agent-browser click e12` |
| `fill <ref> <text>` | Clear and fill input | `agent-browser fill e10 "alex"` |
| `upload <sel> <files>` | Upload file to input | `agent-browser upload "#file-input" ./test.md` |
| `eval <js>` | Run JavaScript in page | `agent-browser eval 'document.querySelector("input").id'` |
| `screenshot <path>` | Take screenshot | `agent-browser screenshot --full /tmp/capture.png` |
| `get url` | Get current URL | `agent-browser get url` |
| `close` | Close browser | `agent-browser close` |

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
