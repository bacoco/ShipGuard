# e2e-agent-browser

Automated E2E testing skills for [Claude Code](https://claude.ai/code) using [agent-browser](https://github.com/nicobailey/agent-browser) (Playwright CLI).

Two skills that discover testable user journeys from your codebase and execute them with hybrid scripted + LLM assertions.

## The Problem

Manual E2E testing with agent-browser is slow, inconsistent, and forgets past failures. The LLM re-discovers the DOM at every run, misses critical test paths (e.g., uploading real documents instead of asking empty questions), and sometimes continues past visible errors in screenshots as if nothing happened.

## The Solution

| Skill | Command | Mission |
|-------|---------|---------|
| **e2e-discover** | `/e2e-discover` | Explore codebase, detect routes/pages/forms/features, generate YAML test manifests mirroring the UI navigation tree |
| **e2e-run** | `/e2e-run [natural language] [--regressions]` | Describe what to test in plain language, or run all. Finds tests, generates missing ones, executes with hybrid assertions, mandatory screenshot validation, regression tracking |

## Key Features

| Feature | Description |
|---------|-------------|
| **UI-mirrored test tree** | Tests follow the same structure as the app's navigation |
| **Hybrid execution** | Mechanical steps (click, fill, upload) run directly; qualitative checks ("are the right entities extracted?") are evaluated by the LLM |
| **Mandatory screenshot validation** | Every screenshot is read and visually inspected. Any visible error = immediate FAIL. Never skipped. |
| **Regression tracking** | Failed tests are replayed first, removed after 3 consecutive passes |
| **Natural language input** | Describe what to test in plain text — the skill finds, generates, and runs the right tests |
| **Dynamic test management** | Tests are auto-created, updated when UI changes, retired when features are removed |
| **Crash recovery** | Restarts browser on Playwright crash, aborts after 3 consecutive errors |
| **Test isolation** | Each test starts from base URL, no state carries over |
| **Generic** | Works on any web project (Next.js, React, Vue, Angular, etc.) |

## Installation

### 1. Install agent-browser (prerequisite)

```bash
npm install -g agent-browser
agent-browser install --with-deps
agent-browser --version
```

### 2. Install the plugin in Claude Code

```bash
# Add the marketplace
/plugin marketplace add bacoco/e2e-agent-browser

# Install the plugin
/plugin install e2e-agent-browser@e2e-agent-browser
```

That's it. `/e2e-discover` and `/e2e-run` are now available.

### Alternative: Manual install

```bash
git clone https://github.com/bacoco/e2e-agent-browser.git
cp -r e2e-agent-browser/plugins/e2e-agent-browser/skills/e2e-discover ~/.claude/skills/
cp -r e2e-agent-browser/plugins/e2e-agent-browser/skills/e2e-run ~/.claude/skills/
```

## Quick Start

```bash
# 1. Discover routes and generate test manifests
/e2e-discover

# 2. Run all tests
/e2e-run

# 3. Run only regressions (fast feedback after a fix)
/e2e-run --regressions

# 4. Describe what to test in natural language
/e2e-run teste l'upload de PDF et le pipeline
/e2e-run j'ai modifie le sidebar de Harmonia, verifie que ca marche
/e2e-run est-ce que le chat fonctionne avec un document ?
```

### Natural Language Mode

When you pass free text, the skill:
1. **Understands your intent** — parses what you changed or want to test
2. **Finds matching tests** — searches existing manifests by name, description, tags
3. **Checks git diff** — if you mention "j'ai modifie/change", maps changed files to impacted tests
4. **Generates missing tests** — if no test covers the described scope, creates one on the fly
5. **Cleans up stale tests** — if the UI changed and a test is broken, updates or replaces it
6. **Executes** — regressions first among matched tests, then the rest

## How It Works

### `/e2e-discover`

Explores your codebase to find:
- **Framework** — Next.js, React, Vue, Angular (auto-detected)
- **Routes** — app directory, router config, route registry
- **Navigation** — sidebar, menus, dashboard cards
- **Feature flags** — what's enabled/disabled
- **Interactive components** — forms, uploads, chat, modals
- **Test data** — fixtures, sample files, PDFs
- **Credentials** — from CLAUDE.md, .env.example, README

Generates a `e2e-tests/` directory mirroring your UI navigation:

```
e2e-tests/
  _config.yaml              # base URL, credentials, paths
  _regressions.yaml         # auto-maintained failure tracking
  _shared/
    login.yaml              # reusable login sequence
  auth/
    login.yaml
  dashboard/
    home.yaml
    file-hub.yaml
  notaire-chat/
    upload-pdf.yaml
    chat-with-doc.yaml
    entity-graph.yaml
  harmonia/
    modules.yaml
```

**Rules:**
- Never overwrites existing manifests
- Never deletes manifests (marks `deprecated: true`)
- Pre-fills test data when fixtures are found
- Asks the user if auto-detection fails

### `/e2e-run`

Executes YAML manifests with hybrid intelligence:

| Step Type | Execution | Example |
|-----------|-----------|---------|
| `open`, `click`, `fill`, `press` | Mechanical (agent-browser) | Navigate, interact |
| `upload`, `select` | Mechanical | File upload, dropdowns |
| `assert_url`, `assert_text` | Mechanical | Simple checks |
| `screenshot` | Mechanical + **mandatory LLM validation** | Capture and verify |
| `llm-wait` | Hybrid (LLM polls every 3s) | Wait for async pipeline |
| `llm-check` | LLM evaluation + screenshot | "Are the right entities displayed?" |

**Selector resolution:** Uses visible text, placeholder, and aria-labels — never DOM refs (which break on re-render).

### Dynamic Test Management

Tests are **living artifacts** — they are created, updated, and retired automatically:

| Situation | What happens |
|-----------|-------------|
| You describe something with no existing test | A new manifest is **generated** with real steps and assertions, saved to the tree |
| A test fails because the UI changed (STALE) | The test is **updated** with new selectors, or replaced if the feature was redesigned |
| A feature is removed | The manifest is marked `deprecated: true` and skipped |
| A test passes 3 times after failing | Removed from the regression list |

You never need to manually write or maintain YAML. The system handles it.

### Screenshot Validation (Mandatory)

**Every screenshot taken during a run is read by the LLM and visually inspected.** This is non-negotiable.

- Error messages, blank screens, broken layouts → **immediate FAIL**
- The LLM must describe what it sees and confirm it matches expectations
- Never skip, never treat errors as "partial pass"

### Regression Tracking

- Failed tests are automatically added to `_regressions.yaml`
- Regression tests always run **first** (newest failures first)
- After **3 consecutive passes**, a regression is removed (resolved)
- The file is auto-maintained — never edit manually

### Crash Recovery

If agent-browser crashes (Playwright timeout, process dies):
1. Close and reopen browser
2. Re-login if needed
3. Retry the failed step once
4. If retry fails → mark test `ERROR`, move to next
5. If 3 consecutive errors → abort entire run ("browser unstable")

### Test Isolation

Each test starts clean:
- Navigate to `{base_url}` before each manifest
- No state carries from previous tests
- Tests must be self-contained

## Manifest Format

```yaml
name: "Upload PDF and verify pipeline"
description: "Upload a notarial deed, verify OCR + entity extraction + indexing"
priority: high                    # high | medium | low
requires_auth: true               # auto-includes _shared/login.yaml
timeout: 120s
tags: [pipeline, upload]

data:
  pdf_file: "data-sample/deed.pdf"
  expected_entities: [seller, buyer, notary, price]

steps:
  - action: open
    url: "{base_url}/chat"

  - action: click
    target: "New conversation"

  - action: upload
    target: "file-input"
    file: "{data.pdf_file}"

  - action: llm-wait
    description: "Wait for processing pipeline to complete"
    timeout: 90s
    checkpoints:
      - "OCR completed"
      - "Entities detected (count > 0)"
      - "Indexing finished"
    screenshot: pipeline-done.png

  - action: llm-check
    description: "Verify extracted entities match document type"
    criteria: "Entities include: {data.expected_entities}"
    severity: critical

  - action: fill
    target: "Ask a question"
    value: "What is the sale price and who are the parties?"

  - action: press
    key: Enter

  - action: wait
    duration: 15s

  - action: llm-check
    description: "Response is grounded in the uploaded document"
    criteria: "Answer cites specific information from the PDF (names, amounts, dates), not generic"
    severity: critical
    screenshot: chat-response.png
```

### Actions Reference

| Action | Fields | Description |
|--------|--------|-------------|
| `open` | `url` | Navigate to URL |
| `click` | `target` | Click element by visible text |
| `fill` | `target`, `value` | Fill input by placeholder/label |
| `press` | `key` | Press keyboard key |
| `upload` | `target`, `file` | Upload file to input |
| `select` | `target`, `option` | Select dropdown option |
| `wait` | `duration` | Sleep (e.g., "5s", "15s") |
| `assert_url` | `expected` | Check current URL |
| `assert_text` | `expected` | Check text exists on page |
| `screenshot` | `filename` | Capture + mandatory LLM validation |
| `include` | `file` | Inline steps from another manifest (max depth 3) |
| `llm-wait` | `description`, `timeout`, `checkpoints`, `screenshot?` | Poll until conditions met |
| `llm-check` | `description`, `criteria`, `severity`, `screenshot?` | LLM evaluates page state |

### Variables

- `{base_url}` — from `_config.yaml`
- `{credentials.username}`, `{credentials.password}` — from `_config.yaml`
- `{data.xxx}` — from manifest `data:` section

### Test Statuses

| Status | Meaning |
|--------|---------|
| **PASS** | All steps completed, all assertions passed, all screenshots clean |
| **FAIL** | A `severity: critical` assertion failed or screenshot showed an error |
| **STALE** | Element selector not found (UI changed — run `/e2e-discover`) |
| **ERROR** | agent-browser crashed, unrecoverable |
| **SKIP** | Manifest is `deprecated: true` or filtered out |

## Report

After each run, a report is generated at `e2e-tests/_results/report.md`:

```markdown
# E2E Report — 2026-03-24 10:30

## Summary
- Tests: 12 run, 10 pass, 1 fail, 1 stale
- Duration: 4m 32s
- Regressions fixed: 1
- New failures: 1

## Failures
### harmonia/modules.yaml — FAIL
- Step 8: llm-check "Verify 11 modules in sidebar"
- Expected: 11 modules visible
- Actual: 10 modules (Veille juridique missing)
- Screenshot: _results/screenshots/harmonia-modules-fail.png

## Stale Tests
### dashboard/erp.yaml — STALE
- Step 3: click "Generate" — element not found
- Action: Run /e2e-discover to update selectors

## Regressions Status
| Test | First failed | Consecutive passes | Status |
|------|-------------|-------------------|--------|
| harmonia/modules | 2026-03-24 | 0 | Active |
```

## Project Structure

```
e2e-agent-browser/
  plugins/
    e2e-agent-browser/            # Claude Code plugin (marketplace format)
      README.md                   # plugin description
      LICENSE                     # MIT
      skills/
        e2e-discover/SKILL.md     # codebase exploration + manifest generation
        e2e-run/SKILL.md          # test execution + regressions + screenshot validation
  examples/
    _config.yaml                  # sample config
    _regressions.yaml             # empty regression file
    _shared/login.yaml            # sample login brick
    auth/login.yaml               # sample login test
    documents/upload-and-process.yaml   # sample upload + pipeline test
    chat/ask-about-document.yaml        # sample chat test
  docs/
    design-spec.md                # full design specification
  README.md                       # this file (marketplace README)
```

## License

MIT
