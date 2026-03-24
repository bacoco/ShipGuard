# e2e-agent-browser

**A Claude Code plugin that turns agent-browser into a self-maintaining E2E test suite.**

You already use [agent-browser](https://github.com/vercel/agent-browser) to automate your browser. This plugin adds a testing layer on top: test discovery, persistent test catalog, regression tracking, natural language execution, and visual validation.

## What this plugin adds

| Capability | What it means |
|-----------|---------------|
| **Auto-discovery** | Scans your codebase once, generates a test for every route and interactive feature |
| **Persistent catalog** | Tests are stored as YAML manifests — they survive across sessions and grow with your app |
| **Regression tracking** | Failed tests are replayed first next run, auto-removed after 3 consecutive passes |
| **Natural language** | Describe what to test instead of specifying which manifest to run |
| **Impact analysis** | Say "I changed X" — the plugin checks git diff and runs impacted tests |
| **Auto-generation** | Describe a feature with no test — the plugin creates one, saves it, runs it |
| **Self-repair** | UI changed? The plugin detects stale selectors and updates them |
| **Visual validation** | Every screenshot is read by the AI — visible errors are never ignored |
| **Smart execution** | Browser tests run sequentially (one login, no conflicts); API tests run in parallel |

---

## Examples

### Set up tests for your entire app

```bash
/e2e-discover
```

Reads your routes, navigation, components, feature flags, test data, credentials. Outputs:

```
e2e-tests/
  auth/login.yaml
  dashboard/home.yaml
  dashboard/file-hub.yaml
  chat/upload-pdf.yaml
  chat/ask-question.yaml
  chat/entity-graph.yaml
  settings/profile.yaml
  ...
```

You wrote zero YAML. Run `/e2e-discover` again after major UI changes — new routes get new tests, removed routes get deprecated.

### Run everything before a deploy

```bash
/e2e-run
```

All tests execute. Regressions run first. Every screenshot is validated. Full report at the end.

### Check only what you just broke

```bash
/e2e-run --regressions
```

Re-runs only the tests that failed last time. 30 seconds instead of 5 minutes.

### Describe what you changed

```bash
/e2e-run I refactored the upload pipeline
```

The plugin checks `git diff`, finds which tests cover the changed files, runs those. If your change touches code with no test, it generates one.

### Describe what you want to verify

```bash
/e2e-run does the chat work when I upload a PDF and ask a question about it?
```

Finds matching tests. If none exist, generates one: upload PDF → wait for processing → ask question → verify answer is grounded in the document. Saves it for next time.

### Verify a specific feature

```bash
/e2e-run check that the sidebar shows all 11 modules
```

Finds the relevant test, runs it, takes a screenshot, reads it, confirms 11 modules are visible — or fails with exactly which one is missing.

### Test something you just built

```bash
/e2e-run I just added a legal watch widget with 3 tabs in the chat panel
```

No test exists → reads the component → creates a test (open panel, verify 3 tabs, verify data loads, close panel) → saves it → runs it. Next time you run `/e2e-run`, this test is part of the suite.

---

## How tests work

### YAML manifests

```yaml
name: "Upload PDF and verify pipeline"
priority: high
requires_auth: true
timeout: 120s

data:
  pdf_file: "data-sample/contract.pdf"
  expected_entities: [seller, buyer, notary, price]

steps:
  - action: open
    url: "{base_url}/documents"

  - action: click
    target: "Upload"

  - action: upload
    target: "file-input"
    file: "{data.pdf_file}"

  - action: llm-wait
    timeout: 90s
    checkpoints:
      - "OCR finished"
      - "Entities detected"
      - "Indexing complete"

  - action: llm-check
    criteria: "Entities include: {data.expected_entities}"
    severity: critical
    screenshot: entities.png
```

Selectors use **visible text** (`"Upload"`, `"file-input"`), not refs or CSS selectors. When a button is renamed, the plugin detects it and updates the manifest.

### Actions

| Action | Execution |
|--------|-----------|
| `open`, `click`, `fill`, `press`, `upload`, `select` | agent-browser direct |
| `wait`, `assert_url`, `assert_text` | agent-browser direct |
| `screenshot` | agent-browser + **mandatory AI visual check** |
| `include` | Inline steps from another manifest |
| `llm-wait` | AI polls every 3s until conditions met |
| `llm-check` | AI evaluates page state against your criteria |

### Regression tracking

```yaml
# _regressions.yaml — auto-maintained, never edit manually
regressions:
  - test: chat/upload-pdf
    first_failed: "2026-03-22"
    consecutive_passes: 0
    failure_reason: "Pipeline timeout after 90s"
```

Failed → added. 3 passes in a row → removed. Regressions always run first.

### Screenshot validation

Every screenshot captured during a run is **read by the AI and inspected**. Error toast visible? Blank page? Spinner stuck? → **FAIL**. Not "warning", not "partial pass". FAIL.

---

## Installation

```bash
# 1. agent-browser (if not already installed)
npm install -g agent-browser
agent-browser install --with-deps

# 2. The plugin
/plugin marketplace add bacoco/e2e-agent-browser
/plugin install e2e-agent-browser@e2e-agent-browser
```

Or manually:

```bash
git clone https://github.com/bacoco/e2e-agent-browser.git
cp -r e2e-agent-browser/plugins/e2e-agent-browser/skills/e2e-discover ~/.claude/skills/
cp -r e2e-agent-browser/plugins/e2e-agent-browser/skills/e2e-run ~/.claude/skills/
```

## Supported frameworks

Next.js, React, Vue, Angular — any framework with detectable routes. Adapts automatically.

## License

MIT
