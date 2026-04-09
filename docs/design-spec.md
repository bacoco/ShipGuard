# E2E Testing Skill for Agent-Browser

**Date:** 2026-03-24
**Status:** Approved
**Repo:** Public GitHub repo (to be created: `agentic-visual-debugger`)

## Overview

Two Claude Code skills that automate end-to-end testing of any web application using agent-browser (Playwright CLI). The system discovers testable user journeys from the codebase, generates YAML test manifests mirroring the UI structure, executes them with hybrid scripted+LLM assertions, and maintains a regression list that learns from failures.

## Problem

Manual E2E testing via agent-browser is slow, inconsistent, and forgets past failures. The LLM re-discovers the DOM at every run, misses critical test paths (e.g., uploading real notarial PDFs instead of asking empty questions), and has no memory of what broke before.

## Solution

### Two Skills

| Skill | Command | Mission |
|-------|---------|---------|
| **e2e-discover** | `/e2e-discover` | Explore the codebase, detect routes/pages/forms/features, generate YAML test manifests mirroring the UI navigation tree |
| **e2e-run** | `/e2e-run [path] [--tag X] [--regressions]` | Execute manifests using agent-browser, run hybrid assertions, update regressions, generate report |

### Separation of Concerns

- **Discover** is LLM-heavy, runs rarely (after structural UI changes)
- **Run** is execution-heavy, runs often (after every build/deploy)
- Manifests are the contract between them — human-editable YAML

## Architecture

### Directory Structure (mirrors UI navigation)

```
e2e-tests/
  _config.yaml              # base_url, credentials, screenshot paths
  _regressions.yaml         # auto-maintained by /e2e-run
  _shared/
    login.yaml              # reusable login brick
    llm-wait.yaml      # reusable pipeline wait
  _results/
    report.md               # last run report
    screenshots/            # captured during tests
  auth/
    login.yaml
  <page-group>/
    <journey>.yaml
    <sub-page>/
      <journey>.yaml
```

The tree mirrors the app's navigation hierarchy. `/e2e-discover` generates this structure by reading the project's route definitions, navigation components, and feature flags.

### Config File

```yaml
# e2e-tests/_config.yaml
base_url: "http://localhost:6969"
credentials:
  username: "vlad"
  password: "loic"
screenshots_dir: "e2e-tests/_results/screenshots"
report_path: "e2e-tests/_results/report.md"
agent_browser_path: "agent-browser"    # or full path
```

## Manifest Format

```yaml
name: "Upload PDF et pipeline complet"
description: "Upload un acte notarie, verifie les 5 phases du pipeline"
priority: high                # high | medium | low
requires_auth: true           # auto-includes _shared/login.yaml
timeout: 120s
tags: [pipeline, ingestion, notarial]

data:
  pdf_file: "data-sample/clement acte.pdf"
  expected_entities: [vendeur, acquereur, notaire, prix, bien]

steps:
  - action: open
    url: "{base_url}/notaire-chat"

  - action: click
    target: "Nouvelle conversation"

  - action: upload
    target: "file-input"
    file: "{data.pdf_file}"

  - action: llm-wait
    description: "Attendre pipeline complet"
    timeout: 90s
    checkpoints:
      - "OCR en cours ou termine"
      - "Entites detectees (count > 0)"
      - "Sections synthetisees"
      - "Indexation RAPTOR terminee"
    screenshot: pipeline-complete.png

  - action: llm-check
    description: "Verifier entites d'acte de vente"
    criteria: "Les entites doivent inclure : {data.expected_entities}"
    severity: critical

  - action: fill
    target: "Posez votre question"
    value: "Quel est le prix de vente et qui sont les parties ?"

  - action: press
    key: Enter

  - action: wait
    duration: 15s

  - action: llm-check
    description: "Reponse pertinente par rapport au PDF uploade"
    criteria: "Cite le prix et nomme vendeur/acquereur du document, pas generique"
    severity: critical
    screenshot: chat-response.png
```

### Action Types

| Action | Execution | Description |
|--------|-----------|-------------|
| `open` | Mechanical | `agent-browser open <url>` |
| `click` | Mechanical | snapshot → find target by text → click ref |
| `fill` | Mechanical | snapshot → find input by text/placeholder → fill ref |
| `press` | Mechanical | `agent-browser press <key>` |
| `upload` | Mechanical | `agent-browser upload <ref> <file>` |
| `select` | Mechanical | `agent-browser select <ref> <option>` |
| `wait` | Mechanical | sleep for duration |
| `assert_url` | Mechanical | `agent-browser get url` → compare |
| `assert_text` | Mechanical | snapshot → search for text |
| `screenshot` | Mechanical | `agent-browser screenshot <path>` |
| `include` | Mechanical | inline steps from another manifest |
| `llm-wait` | Hybrid | LLM polls via snapshot every 3s, checks conditions |
| `llm-check` | LLM | snapshot → LLM evaluates against criteria |

### Selector Resolution

When a step specifies `target: "Nouvelle conversation"`:

1. `agent-browser snapshot` to get accessibility tree
2. Search for element whose text/label/placeholder contains the target string
3. Use the matched ref for the action
4. If not found: try `agent-browser find` by text, label, placeholder, title
5. If still not found: mark step as `STALE` with screenshot

Selectors use **visible text**, never refs (which change on every DOM mutation).

### Variable Interpolation

- `{base_url}` → from `_config.yaml`
- `{data.xxx}` → from manifest `data:` section
- `{credentials.username}` → from `_config.yaml`

## Skill 1: `/e2e-discover`

### Flow

```
1. Detect frontend framework (Next.js, React, Vue, Angular, etc.)
2. Find route definitions (app directory, router config, route registry)
3. Find navigation structure (sidebar, menus, dashboard components)
4. Find feature flags (what's enabled/disabled)
5. Find interactive components (forms, modals, uploads, chat inputs)
6. Find test data (PDF fixtures, sample files, seed data)
7. Find dev credentials (CLAUDE.md, .env.example, README)
8. Generate _config.yaml if not exists
9. Generate _shared/login.yaml if auth detected
10. For each discovered route:
    a. If manifest exists → skip (never overwrite)
    b. If route is new → create skeleton manifest
    c. If route was removed → mark existing manifest deprecated: true
11. Output summary of what was discovered and generated
```

### Skeleton Manifest (auto-generated)

```yaml
name: "File Hub"
description: "Auto-generated skeleton — customize with real test steps"
priority: medium
requires_auth: true
timeout: 30s
tags: [auto-generated]

steps:
  - action: open
    url: "{base_url}/dashboard/file-hub"

  - action: llm-check
    description: "Page loads without errors"
    criteria: "Page content is visible, no error messages"
    severity: critical
    screenshot: file-hub-load.png
```

### Rules

- **Never overwrite** existing manifests — only create new skeletons
- **Never delete** manifests — mark `deprecated: true` if route removed
- **Pre-fill test data** when fixtures/samples found in project
- **Detect auth** from login components, auth middleware, or documented credentials

## Skill 2: `/e2e-run`

### Invocations

| Command | Behavior |
|---------|----------|
| `/e2e-run` | Run all (regressions first, then by priority) |
| `/e2e-run notaire-chat/upload-pdf` | Run one specific test |
| `/e2e-run --tag pipeline` | Run all tests with tag |
| `/e2e-run --regressions` | Run only regression tests |

### Execution Flow

```
1. Read _config.yaml
2. Build execution list:
   a. _regressions.yaml first (ordered by last_failed desc)
   b. Then all manifests: priority high → medium → low
   c. Filter by path/tag if specified
3. Open browser: agent-browser open {base_url}
4. For each manifest:
   a. If requires_auth → execute _shared/login.yaml (skip if already logged in)
   b. For each step:
      - Mechanical → agent-browser command
      - llm-wait → loop: snapshot every 3s, LLM checks checkpoints
      - llm-check → snapshot, LLM evaluates criteria, PASS/FAIL/WARN
      - On FAIL (severity=critical) → screenshot, mark test FAIL, next test
      - On FAIL (severity=warning) → log, continue
      - On STALE (element not found) → screenshot, suggest /e2e-discover
   c. Record result: PASS / FAIL / STALE / SKIP
5. Update _regressions.yaml
6. Generate _results/report.md
7. Close browser
```

### Auth Optimization

Login is executed once. If the session is still valid (check by navigating to a protected page), skip re-login. If a test fails with an auth error mid-run, re-login and retry once.

## Regression System

### `_regressions.yaml`

```yaml
# Auto-maintained by /e2e-run — do not edit manually
regressions:
  - test: harmonia/modules
    first_failed: "2026-03-24"
    last_failed: "2026-03-24"
    consecutive_passes: 0
    failure_reason: "10 modules instead of 11 — Veille juridique missing"
    screenshot: "_results/screenshots/harmonia-modules-fail.png"
```

### Rules

- A test that **fails** is added (or updated: `last_failed`, `failure_reason`, `consecutive_passes: 0`)
- A test that **passes** increments `consecutive_passes`
- After **3 consecutive passes**, the test is **removed** (regression resolved)
- Regressions run **first**, ordered by `last_failed` descending (newest failures first)
- This file is **never manually edited** — fully automated

## Adaptation to UI Changes

| Scenario | During `/e2e-run` | During `/e2e-discover` |
|----------|-------------------|----------------------|
| Element not found | Mark `STALE`, suggest discover | Update target in manifest (with confirmation) |
| New route added | Not detected | Create skeleton manifest |
| Route removed | Test may fail | Mark manifest `deprecated: true` |
| DOM restructured | Tests may go STALE | Propose target updates |

Key principle: `/e2e-run` never modifies manifests. `/e2e-discover` proposes changes but doesn't overwrite without confirmation.

## Report Format

```markdown
# E2E Report — 2026-03-24 10:30

## Summary
- Tests: 12 run, 10 pass, 1 fail, 1 stale
- Duration: 4m 32s
- Regressions fixed: 1 (notaire-chat/entity-graph)
- New failures: 1 (harmonia/modules)

## Failures
### harmonia/modules.yaml — FAIL
- Step 8: llm-check "Verifier 11 modules dans sidebar"
- Expected: 11 modules visibles
- Actual: 10 modules (Veille juridique manquant)
- Screenshot: _results/screenshots/harmonia-modules-fail.png

## Stale Tests
### dashboard/erp-diagnostic.yaml — STALE
- Step 3: click "Generer diagnostic" — element not found
- Action: Run /e2e-discover to update selectors

## Regressions Status
| Test | First failed | Consecutive passes | Status |
|------|-------------|-------------------|--------|
| notaire-chat/upload-pdf | 2026-03-22 | 3 | Removed |
| harmonia/modules | 2026-03-24 | 0 | Active |

## All Results
| Test | Status | Duration |
|------|--------|----------|
| auth/login | PASS | 3s |
| notaire-chat/upload-pdf | PASS | 45s |
| notaire-chat/chat-with-doc | PASS | 22s |
| harmonia/modules | FAIL | 12s |
| dashboard/erp-diagnostic | STALE | 5s |
```

## Browser Crash Recovery

If `agent-browser` crashes (Playwright timeout, browser process dies, command returns non-zero):

1. Detect: any agent-browser command returning exit code != 0 or timeout
2. Attempt recovery: `agent-browser close` (ignore errors), then `agent-browser open {base_url}`
3. Re-login if `requires_auth: true`
4. Retry the failed step once
5. If retry fails: mark test as `ERROR` (distinct from FAIL), screenshot, move to next test
6. If 3 consecutive ERRORs across different tests: abort the entire run, report "browser unstable"

## Test Isolation

Each test starts from a clean navigation state:

- Before each manifest: `agent-browser open {base_url}` (reset to home)
- Tests must NOT depend on state created by previous tests
- If a test creates data (e.g., uploads a PDF), it should be self-contained
- Ordering within a run is by regression priority then manifest priority — never by dependency

## Include Guards

The `include` action has a max depth of 3 to prevent infinite recursion. If manifest A includes B which includes C which includes D, the 4th level is rejected with an error. Circular includes (A→B→A) are detected and rejected.

## Deprecated Manifests

Manifests with `deprecated: true` in their frontmatter:
- Are **skipped** during `/e2e-run` (reported as SKIP with reason "deprecated")
- Are listed in the report under a "Deprecated" section
- Can be manually removed or un-deprecated by the user
- `/e2e-discover` sets this flag when a route no longer exists in the codebase

## Generic Design (any project)

The skills are project-agnostic. `/e2e-discover` adapts to the project:

| Framework | Route detection | Navigation detection |
|-----------|----------------|---------------------|
| Next.js (App Router) | `app/` directory structure | layout.tsx, navigation.ts |
| Next.js (Pages) | `pages/` directory | _app.tsx, sidebar components |
| React Router | router config files | NavBar, Sidebar components |
| Vue Router | router/index.ts | navigation components |
| Angular | app-routing.module.ts | nav components |
| Generic | Grep for route patterns | Grep for nav/menu patterns |

The discover skill uses heuristics: it searches for common patterns and adapts. If it can't auto-detect, it asks the user to point to the route definitions.

## Prerequisites

- `agent-browser` installed and accessible (`agent-browser --version`)
- Application running and accessible at `base_url`
- For auth: valid credentials in `_config.yaml`

## Public Repository

**Repo name:** `agentic-visual-debugger`
**Contents:**
- `skills/e2e-discover/SKILL.md` — discover skill
- `skills/e2e-run/SKILL.md` — run skill
- `README.md` — installation, usage, examples
- `examples/` — sample manifests for a demo app
- `LICENSE` — MIT
