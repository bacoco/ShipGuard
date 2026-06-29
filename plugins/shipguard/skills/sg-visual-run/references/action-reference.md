# Action reference — execution details

Detailed reference for each `action:` type in manifest steps. SKILL.md covers the minimum; this file covers behavior, edge cases, and rules.

## Table of contents

| Section | When to read |
|---------|--------------|
| [Variable interpolation](#variable-interpolation) | Writing a manifest with `{base_url}`, `{credentials.*}`, `{data.*}` |
| [Include resolution](#include-resolution) | Manifest uses `action: include` |
| [Mechanical actions](#mechanical-actions) | open / click / fill / press / upload / select / wait / assert_* / screenshot |
| [Screenshot validation](#screenshot-validation-mandatory) | Every screenshot MUST be validated — read this before skipping |
| [Hybrid actions (llm-*)](#hybrid-actions) | llm-wait, llm-check semantics |
| [llm-check reliability](#llm-check-reliability) | What llm-check can and cannot assert |
| [Result mapping](#result-mapping) | PASS / FAIL / STALE / ERROR / SKIPPED rules |

---

## Variable interpolation

Before executing a step, replace variables in all string fields:

- `{base_url}` → from `_config.yaml`
- `{credentials.username}`, `{credentials.password}` → from `_config.yaml`
- `{data.xxx}` → from the manifest's `data:` section

**Internal variables** (resolved by the skill, not from config):

- `{session_id}` → `visual-run-{timestamp}` (unique per execution)
- `{screenshots_dir}` → value of `screenshots_dir` in `_config.yaml`
- `{report_path}` → value of `report_path` in `_config.yaml`
- `{date}`, `{time}` → current date and time

---

## Include resolution

For `action: include`:

- `path:` — relative path to the shared manifest YAML (e.g., `_shared/login.yaml`)
- Read the referenced file (relative to `visual-tests/`)
- Inline its steps at the current position
- Max depth: 3 levels. Circular references: detect and reject with error.

---

## Mechanical actions

### `open`

```bash
agent-browser open <url>
agent-browser wait --load networkidle
```

After every `open`, run session expiry detection (see SKILL.md Execution Strategy).

### `click`

1. `agent-browser snapshot` → parse accessibility tree
2. Find element whose text/label/placeholder contains `target` string
3. Found: `agent-browser click <ref>`
4. Not found: `agent-browser find text "<target>" click`
5. Still not found: mark step `STALE`

### `fill`

1. `agent-browser snapshot` → find input by placeholder/label matching `target`
2. `agent-browser fill <ref> "<value>"`

### `press`

```bash
agent-browser press <key>
```

Supports modifiers: `Enter`, `Tab`, `Escape`, `Control+a`, `Meta+k`, `ArrowDown`.

### `upload`

- `file:` — path to the file to upload (e.g., `data-sample/test.pdf`)

1. `agent-browser snapshot` → find file input (includes hidden inputs)
2. `agent-browser upload <ref> <file_path>`

See `advanced-interactions.md` §5 for hidden input workarounds.

### `select`

1. `agent-browser snapshot` → find select element
2. `agent-browser select <ref> "<option>"`

Native `<select>` only. For Radix/Headless custom selects, use `click` on trigger + `click` on option.

### `wait`

```bash
sleep <duration_seconds>
```

Prefer semantic waits (`agent-browser wait "<selector>"`) where possible.

### `assert_url`

```bash
agent-browser get url
```

Compare current page URL path against `expected`. Full URLs and path-only values both accepted — path-only values match against the URL pathname. Mismatch → FAIL.

### `assert_text`

1. `agent-browser snapshot`
2. Search for `expected` text in the tree
3. Not found → FAIL

### `screenshot`

```bash
agent-browser screenshot --full {screenshots_dir}/<filename>
```

**MANDATORY**: read the screenshot with the Read tool and visually validate it. See Screenshot Validation below.

---

## Screenshot validation (MANDATORY)

**Every single screenshot taken during a test run MUST be validated.** Non-negotiable.

After every `agent-browser screenshot <path>`:

1. **Read the image** using the Read tool: `Read(file_path=<screenshot_path>)`
2. **Visually inspect** for:
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
   - Then proceed

**Applies to ALL screenshots** — explicit `screenshot`, `llm-check`, `llm-wait`, or any other screenshot.

### Anti-patterns (FORBIDDEN)

- Taking a screenshot and continuing without reading it
- Reading a screenshot that shows an error and marking the test as PASS
- Saying "screenshot taken" without describing what's in it
- Skipping validation because "it's probably fine"
- Treating an error in a screenshot as "partial pass" or "acceptable"

---

## Hybrid actions

### `llm-wait`

Poll with LLM evaluation until conditions are met or timeout:

> **Field note:** In `llm-wait` and `llm-check`, the output file field is `screenshot:` (the path to write the screenshot). In the standalone `screenshot` action, the same field is `filename:`.

```
loop every 3 seconds until timeout:
  1. agent-browser snapshot
  2. LLM evaluates: are ALL checkpoints satisfied?
     - Each checkpoint is a natural-language condition
     - LLM responds: checkpoint status (met / not yet / failed)
  3. If all met → PASS, take screenshot if specified
  4. If any definitively failed → FAIL
  5. If timeout → FAIL with "timeout waiting for conditions"
```

### `llm-check`

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

---

## llm-check reliability

### Reliable for

- Blank/white screens (no content rendered)
- Broken layouts (overlapping elements, missing sections, scrollbar issues)
- Missing images or broken image icons
- Error messages, toasts, modals with error text
- Page structure (sidebar present, header visible, correct number of tabs)

### NOT reliable for

- Business-correct data values (e.g., "total should be 42.50")
- Exact text matching (use `assert_text` instead)
- Color accuracy or subtle styling differences
- Dynamic content that changes between runs (timestamps, random IDs)
- Performance metrics (load time, animation smoothness)

**Rule of thumb:** Use `llm-check` for "does it look right?" and `assert_text`/`assert_url` for "is the exact value correct?"

---

## Result mapping

For each test: `PASS` / `FAIL` / `STALE` / `ERROR` / `SKIPPED`

| Status | Meaning |
|--------|---------|
| **PASS** | All steps completed, all assertions passed, all screenshots clean |
| **FAIL** | A `severity: critical` assertion failed or screenshot showed an error |
| **STALE** | An element selector could not be resolved (UI changed) |
| **ERROR** | agent-browser crashed or unrecoverable error |
| **SKIPPED** | Manifest is `deprecated: true` |
