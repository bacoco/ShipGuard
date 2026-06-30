---
name: sg-record
description: Record browser interactions as replayable ShipGuard test manifests with agent-browser.
context: conversation
argument-hint: "<url> [--name <name>] [--storage <auth.json>] [--save-storage <path>] | --check"
---

# /sg-record — Macro Recorder

Record your browser interactions and convert them into replayable ShipGuard YAML test manifests. Like Excel's macro recorder, but for visual testing.

## Pipeline Position

```
sg-visual-discover (auto) ──┐
                             ├──► manifests/ ──► sg-visual-run ──► sg-visual-review ──► sg-visual-fix
sg-record (human)         ───┘
```

`sg-discover` scans code to auto-generate tests. `sg-record` captures what a **human** does manually. Both produce the same YAML format — zero changes to the rest of the pipeline.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-record http://localhost:6969` | Open recorder on the given URL |
| `/sg-record http://localhost:6969 --name login-flow` | Record with a preset manifest name |
| `/sg-record http://localhost:6969 --storage auth.json` | Skip login by loading saved auth state |
| `/sg-record http://localhost:6969 --save-storage auth.json` | Save auth state after recording (for reuse) |
| `/sg-record --check` | Check Playwright, Chromium, and headed browser launch prerequisites |

## How It Works

### 1. Launch

Run the recorder script:

```bash
node visual-tests/sg-record.mjs <url> [--name <name>] [--storage <auth.json>]
```

This opens a **Playwright Chromium** browser targeting the URL with a floating recording toolbar injected in the bottom-right corner.

### 2. Record

The user navigates the app normally. Every interaction is captured automatically:

| User action | Recorded as |
|-------------|-------------|
| Click a button/link | `action: click, target: "Button text"` |
| Fill an input field | `action: fill, target: "Field label", value: "typed text"` |
| Select a dropdown option | `action: select, target: "Label", value: "Option"` |
| Upload a file | `action: upload, file: "filename.pdf"` |
| Navigate to a new page | `action: open, url: "/new-page"` |

### 3. Toolbar Controls

The floating toolbar shows recorded steps in real-time:

| Control | What it does |
|---------|-------------|
| **Step list** | See every recorded action, scrollable |
| **Undo** | Remove the last step (repeatable) |
| **Delete (x)** | Remove a specific step without affecting others |
| **Pause / Resume** | Stop recording temporarily (navigate freely without capturing) |
| **Check** | Mark an element as an assertion (see below) |
| **Stop** | End recording, save manifest |
| **Minimize** | Collapse toolbar to a compact bar |

### 4. Check Mode (Assertions)

Click **Check** to enter assertion mode:
1. Toolbar border turns amber
2. Hover over elements to see what will be captured (amber highlight)
3. Click on the element you want to verify
4. The recorder captures its text content as an `assert_text` step
5. If the text is long (>80 chars), it becomes an `llm-check` instead (AI judges the assertion at replay time)
6. A screenshot is auto-captured at each check point
7. Check mode deactivates after one capture

### 5. Stop and Save

Click **Stop** in the toolbar:
1. If no `--name` was given, the recorder asks for a manifest name
2. Actions are converted to ShipGuard YAML format
3. Manifest saved to `visual-tests/manifests/recorded-<name>.yaml`
4. Terminal shows the command to replay: `sg-visual-run --manifests manifests/recorded-<name>.yaml`

## Output Format

The recorder produces standard ShipGuard YAML manifests:

```yaml
name: "login-flow"
description: "Recorded session — login-flow"
priority: medium
requires_auth: false
timeout: 60s
tags: [recorded]
source: recorded
recorded_at: "2026-04-11T14:30:00Z"

steps:
  - action: open
    url: "{base_url}/login"

  - action: fill
    target: "Nom d'utilisateur"
    value: "vlad"

  - action: fill
    target: "Mot de passe"
    value: "loic"

  - action: click
    target: "Se connecter"

  - action: assert_text
    expected: "Tableau de bord"
    screenshot: "login-flow-check-1.png"

  - action: screenshot
    path: "login-flow-check-1.png"
```

The `source: recorded` field distinguishes recorded manifests from auto-generated ones (`source: discovered`).

## Test Library in Review Page

Recorded manifests appear as cards in a dedicated **"Recorded Tests"** tab in the review page (`/sg-visual-review`):

- Each card shows: name, step summary, step count, check count, recording date
- Select one or multiple cards
- Click **"Run N tests"** to get the CLI command for `sg-visual-run`
- Results appear in the existing Visual Tests tab after execution

## Authentication

Playwright opens a fresh Chromium — the user is not logged in by default.

- **Without `--storage`**: Login manually during recording. Login steps become part of the manifest.
- **With `--storage auth.json`**: Load saved cookies/localStorage to skip login.
- **First time**: Use `--save-storage auth.json` to capture auth state after logging in. Reuse with `--storage auth.json` on subsequent recordings.

Sandbox note: Playwright/browser sockets and dependency installs may need explicit permission. See [../../docs/sandbox.md](../../docs/sandbox.md).

## Execution Steps for the Skill

When the user invokes `/sg-record`, follow ALL steps in order. Do NOT skip any step.

### Step 1: Parse arguments

Parse the URL from the user's input. If missing, ask: "What URL do you want to record on?"
Store any flags: `--name`, `--storage`, `--save-storage`.

### Step 2: Bootstrap — Install recorder files into the project

The recorder runtime files ship with this plugin. They must be copied to the target project's `visual-tests/` directory before first use.

**Determine the plugin skill directory.** This is the directory containing THIS SKILL.md file. It is shown in the "Base directory for this skill" header when the skill loads. Store it as `SKILL_DIR`.

**Check if recorder is already installed:**

```bash
test -f visual-tests/sg-record.mjs && echo "INSTALLED" || echo "NOT_INSTALLED"
```

**If NOT_INSTALLED**, copy all recorder files from the plugin:

```bash
# Keep these steps sequential. Do not parallelize: cp depends on mkdir.
mkdir -p visual-tests/lib visual-tests/manifests

# Copy from this skill's directory (SKILL_DIR)
cp "${SKILL_DIR}/sg-record.mjs" visual-tests/
cp "${SKILL_DIR}/lib/actions-to-yaml.mjs" visual-tests/lib/
cp "${SKILL_DIR}/lib/recorder-toolbar.js" visual-tests/lib/
cp "${SKILL_DIR}/lib/recorder-toolbar.css" visual-tests/lib/
cp "${SKILL_DIR}/lib/actions-to-yaml.test.mjs" visual-tests/lib/
cp "${SKILL_DIR}/lib/integration-test.mjs" visual-tests/lib/
```

**Also check the review page files** (needed for the Recorded Tests tab):

```bash
test -f visual-tests/build-review.mjs && echo "REVIEW_INSTALLED" || echo "REVIEW_NOT_INSTALLED"
```

If REVIEW_NOT_INSTALLED, copy from the sg-visual-review skill:

```bash
REVIEW_DIR="${SKILL_DIR}/../sg-visual-review"
cp "${REVIEW_DIR}/build-review.mjs" visual-tests/
cp "${REVIEW_DIR}/_review-template.html" visual-tests/
cp "${REVIEW_DIR}/review-smoke-test.mjs" visual-tests/
cp "${REVIEW_DIR}/monitor-smoke-test.mjs" visual-tests/
```

Print: `Recorder files installed to visual-tests/`

### Step 3: Check Playwright

```bash
node visual-tests/sg-record.mjs --check
```

Expected success output:

```text
PLAYWRIGHT_OK
CHROMIUM_OK
GUI_LAUNCH_OK
```

Do not use `npx playwright --version` as a precheck; outside a Node project it can hang or try the network. If the check fails, use its diagnostic. Common failures:
- `PLAYWRIGHT_MISSING`: install the Node package in the project. A Python or global `playwright` command is not enough because `sg-record.mjs` runs `await import('playwright')`.
- `CHROMIUM_MISSING`: run the browser install.
- `GUI_LAUNCH_FAILED`: grant browser/GUI launch permission or use an environment with headed Chromium support. The check uses a 15s launch timeout and retries once; increase it with `SHIPGUARD_RECORD_CHECK_TIMEOUT=30000` or `--check-timeout=30000` on slow first launches.

If Playwright is missing, tell the user:

```bash
npm install --save-dev playwright
npx playwright install chromium
```

If there is no `package.json`, include `npm init -y` before the install command. Stop after giving the install command; do not keep retrying networked installs.

### Step 4: Check target URL is reachable

```bash
curl -s -o /dev/null -w "%{http_code}" --max-time 5 <url>
```

If not 200, warn the user but continue (they may want to record on a page that requires auth).

### Step 5: Create config if missing

If `visual-tests/_config.yaml` does not exist, create a minimal one:

```bash
cat > visual-tests/_config.yaml << EOF
base_url: "<url_origin>"
EOF
```

Where `<url_origin>` is extracted from the user's URL (e.g., `http://localhost:3000` from `http://localhost:3000/dashboard`).

### Step 6: Launch the recorder

```bash
node visual-tests/sg-record.mjs <url> <flags>
```

Tell the user: "Browser is open. Navigate your app, click Check to mark verifications, click Stop when done."

### Step 7: Wait and report

Wait for the process to complete (the user clicks Stop in the browser toolbar).

Report: manifest path, step count, and the command to replay.

Offer: "Want to run these tests now with `/sg-visual-run`? Or see all recordings with `/sg-visual-review`?"

## File Structure (after bootstrap)

```
visual-tests/
  sg-record.mjs              # CLI entry point (copied from plugin)
  lib/
    recorder-toolbar.js       # Injected toolbar (copied from plugin)
    recorder-toolbar.css      # Toolbar styles (copied from plugin)
    actions-to-yaml.mjs       # Conversion: actions → YAML (copied from plugin)
    actions-to-yaml.test.mjs  # Unit tests (copied from plugin)
    integration-test.mjs      # Pipeline smoke test (copied from plugin)
  manifests/
    recorded-*.yaml           # Output from recordings (user-generated)
  build-review.mjs            # Review page builder (from sg-visual-review)
  _review-template.html       # Review page template (from sg-visual-review)
  review-smoke-test.mjs        # Review dashboard smoke test
  monitor-smoke-test.mjs       # Monitor endpoint smoke test
  _config.yaml                # Project config (base_url, credentials)
```
