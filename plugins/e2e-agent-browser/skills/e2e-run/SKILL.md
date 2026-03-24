---
name: e2e-run
description: Execute E2E test manifests using agent-browser with hybrid scripted+LLM assertions. Accepts natural language to describe what to test or what changed — the skill finds and runs the right tests, generating missing ones if needed. Trigger on "e2e run", "run e2e tests", "test regressions", "run tests", "e2e-run", "check if the app works", "teste le chat", "j'ai modifie X verifie que ca marche".
---

# /e2e-run — Execute E2E Tests

Execute YAML test manifests using agent-browser (Playwright CLI). Hybrid execution: mechanical steps run directly, complex assertions delegate to LLM evaluation.

## Invocations

| Command | Behavior |
|---------|----------|
| `/e2e-run` | Run ALL tests (regressions first, then by priority) |
| `/e2e-run --regressions` | Run only known regression tests |
| `/e2e-run <natural language>` | Describe what to test — the skill figures out the rest |

### Natural Language Mode (default when text is provided)

When you pass free text, the skill operates in **impact analysis mode**:

```bash
/e2e-run teste l'upload de PDF et le pipeline
/e2e-run j'ai modifie le sidebar de Harmonia, verifie que tout marche
/e2e-run est-ce que le chat fonctionne avec un document attache ?
/e2e-run j'ai change ArticleModal.tsx et notaire-chat-view.tsx
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
   - Run a targeted mini-discover on that area (read the component, understand what it does)
   - Generate a new manifest with real steps and assertions
   - Save it to the test tree
   - Then execute it

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
2. Read `e2e-tests/_config.yaml` — fail if missing (tell user to run `/e2e-discover`)
3. Verify `{base_url}` is reachable: `agent-browser open {base_url}`, check no error
4. Create `{screenshots_dir}` if missing
5. Read `e2e-tests/_regressions.yaml` (create empty if missing)

## Build Execution List

Collect manifests to run:

1. **If natural language provided**: analyze intent, match manifests, generate missing ones
2. **If `--regressions`**: only from `_regressions.yaml`, ordered by `last_failed` descending
3. **If no arguments**: all manifests, regressions first, then by priority `high` → `medium` → `low`
4. **Always skip** manifests with `deprecated: true`
5. **Regressions among matched tests always run first**

## Parallel Execution

When the execution list contains **3 or more tests**, dispatch them as parallel agents using the Agent tool. Each agent gets its own browser session via `--session`:

```
Agent 1 (--session e2e-1): auth tests + regressions
Agent 2 (--session e2e-2): upload/pipeline tests
Agent 3 (--session e2e-3): chat/tool tests
Agent 4 (--session e2e-4): navigation/dashboard tests
...
```

**Grouping strategy:**
1. Group tests by their top-level directory (e.g., all `auth/*` together, all `chat/*` together)
2. Each group becomes one parallel agent
3. Regressions are distributed into the group of their original test
4. Each agent runs its tests sequentially within the group
5. All agents run in background (`run_in_background: true`)
6. Wait for all agents to complete, then merge results into a single report

**Session isolation:** Each agent uses `agent-browser --session e2e-N` so browser state (cookies, tabs) doesn't leak between parallel agents.

**When to run sequentially:** If there are fewer than 3 tests, run them sequentially in a single browser session — the overhead of parallel dispatch isn't worth it.

## Execution Loop (per agent)

For each manifest assigned to this agent:

### Step 0: Test Isolation

```bash
agent-browser --session {session_id} open {base_url}
```

Every test starts from the base URL. No state carries over from previous tests.

### Step 1: Auth

If `requires_auth: true`, execute `_shared/login.yaml` steps.

**Optimization:** After the first successful login, check if session persists by navigating to a protected page. If still authenticated, skip login for subsequent tests. If auth fails mid-run, re-login and retry once.

### Step 2: Execute Steps

For each step in the manifest's `steps:` array:

#### Variable Interpolation

Before executing, replace variables in all string fields:
- `{base_url}` → from `_config.yaml`
- `{credentials.username}`, `{credentials.password}` → from `_config.yaml`
- `{data.xxx}` → from the manifest's `data:` section

#### Include Resolution

For `action: include`:
- Read the referenced file (relative to `e2e-tests/`)
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
agent-browser screenshot {screenshots_dir}/<filename>
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
2. agent-browser screenshot {screenshots_dir}/<filename>
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

After all tests complete, update `e2e-tests/_regressions.yaml`:

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
# Auto-maintained by /e2e-run — do not edit manually
regressions:
  - test: notaire-chat/upload-pdf
    first_failed: "2026-03-22"
    last_failed: "2026-03-24"
    consecutive_passes: 0
    failure_reason: "Pipeline timeout after 90s"
    screenshot: "_results/screenshots/upload-pdf-fail.png"
```

## Generate Report

Write to `{report_path}` (default: `e2e-tests/_results/report.md`):

```markdown
# E2E Report — {date} {time}

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
- Action: Run `/e2e-discover` to update selectors

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
E2E run complete: {pass}/{total} passed, {fail} failed, {stale} stale
Report: e2e-tests/_results/report.md
Screenshots: e2e-tests/_results/screenshots/

{if failures}
Failures:
- {test_path}: {one-line reason}
{/if}

{if stale}
Stale tests (UI changed — run /e2e-discover):
- {test_path}
{/if}

{if generated}
New tests generated:
- {test_path}
{/if}
```
