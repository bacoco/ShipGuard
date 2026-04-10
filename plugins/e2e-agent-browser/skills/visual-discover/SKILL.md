---
name: visual-discover
description: Explore a web project's codebase to discover testable user journeys, then generate YAML test manifests mirroring the UI navigation tree. Use when setting up Visual tests for a new project, or after structural UI changes (new routes, removed pages, navigation updates). Trigger on "visual discover", "generate visual tests", "discover test routes", "update test manifests", "scan UI for tests".
context: fork
argument-hint: "[project-path]"
---

# /visual-discover — Discover & Generate Visual Test Manifests

Explore the codebase of any web application, detect all user-facing routes and interactions, and generate a YAML test manifest tree that mirrors the UI navigation structure.

## Prerequisites

Before running, verify:
1. `agent-browser --version` — must be installed
2. The project has a web frontend (check for package.json with a framework)
3. Identify the `visual-tests/` directory (create if missing)

## Phase 1: Detect Project Structure

Explore the codebase to identify:

### 1.1 Frontend Framework

Search for framework indicators in this order:
- `next.config.*` or `app/layout.tsx` → **Next.js (App Router)**
- `pages/_app.tsx` or `pages/index.tsx` → **Next.js (Pages Router)**
- `src/App.tsx` + `react-router` in package.json → **React Router**
- `src/router/index.ts` or `vue.config.*` → **Vue**
- `angular.json` → **Angular**
- Fallback: grep for route patterns (`<Route`, `path:`, `router.get`)

### 1.2 Static HTML Fallback

If NO framework is detected in Phase 1.1:

1. Scan the project root, `src/`, and `public/` directories for `*.html` files
2. Each `.html` file becomes a test manifest in a `pages/` category
3. Derive the URL from the file path with these rules:
   - Files inside `public/` → strip the `public/` prefix (e.g., `public/about.html` → `{base_url}/about.html`)
   - `index.html` at any level → map to the directory URL (e.g., `public/index.html` → `{base_url}/`, `public/help/index.html` → `{base_url}/help/`)
   - Other files → use the relative path as-is (e.g., `pages/contact.html` → `{base_url}/pages/contact.html`)
4. Screenshot names must be unique per page — derive from the relative URL path, slugified (e.g., `public/help/index.html` → `pages-help-index.png`, `about.html` → `pages-about.png`)
5. Generate a minimal manifest per page:

```yaml
name: "<filename without extension>"
description: "Auto-generated from static HTML file"
priority: medium
requires_auth: false
timeout: 30s
tags: [auto-generated, static-html]

steps:
  - action: open
    url: "{base_url}/<derived-url-path>"
  - action: llm-check
    description: "Page loads and renders content"
    criteria: "Page content is visible, no blank screen, no broken images or missing resources"
    severity: critical
    screenshot: "pages-<slugified-path>.png"
```

6. Log detection: "No framework detected — falling back to static HTML scan"
7. If no `.html` files found either, ask the user to specify the route source

### 1.3 Route Definitions

Based on the detected framework:

| Framework | Where to look |
|-----------|--------------|
| Next.js App Router | `app/**/page.tsx` — each directory = route |
| Next.js Pages | `pages/**/*.tsx` — file path = route |
| React Router | Router config files, `<Route path=...>` patterns |
| Vue Router | `router/index.ts`, `routes: [...]` |
| Angular | `*-routing.module.ts` |
| Generic | Grep for `path:`, `route:`, URL patterns in config |

Collect: route path, page component file, any associated layout.

### 1.4 Navigation Structure

Find navigation components that define the UI hierarchy:
- Search for files named `navigation.ts`, `nav-*.ts`, `sidebar-*.tsx`, `menu-*.tsx`
- Search for `dashboard-data.ts`, `route-registry.ts` or similar
- Look for arrays of navigation items with labels, paths, icons
- This defines the **test directory structure**

### 1.5 Feature Flags

Search for feature flag systems:
- `NEXT_PUBLIC_FEATURE_*`, `FEATURE_*` env vars
- `isFeatureEnabled()`, `featureFlag` patterns
- Record which features are flagged — tests for disabled features get `priority: low`

### 1.6 Interactive Components

For each route, scan the page component for:
- Forms (`<form`, `onSubmit`, input fields)
- Modals (`Dialog`, `Modal`, `Sheet`)
- File uploads (`<input type="file"`, `Upload`, `Dropzone`)
- Chat interfaces (`onSend`, `message`, chat input patterns)
- Data tables, lists with actions
- These become the **steps** in the manifest

### 1.7 Test Data

Search the project for usable test files:
- `test/fixtures/`, `data-sample/`, `__fixtures__/`
- `*.pdf`, `*.docx`, `*.csv` in data directories
- Seed scripts, sample data generators
- Record paths for use in manifest `data:` sections

### 1.8 Credentials

Look for dev credentials in:
- `CLAUDE.md`, `README.md` — search for "credentials", "login", "username", "password"
- `.env.example` — search for auth-related vars
- Test files — search for login helpers

## Phase 2: Generate Config

If `visual-tests/_config.yaml` does not exist, create it:

```yaml
# visual-tests/_config.yaml — Generated by /visual-discover
base_url: "<detected_url>"       # from dev server config, docker-compose, or README
credentials:
  username: "<detected>"
  password: "<detected>"
screenshots_dir: "visual-tests/_results/screenshots"
report_path: "visual-tests/_results/report.md"
agent_browser_path: "agent-browser"
```

If it already exists, do NOT overwrite.

## Phase 3: Generate Shared Bricks

### `_shared/login.yaml`

If authentication is detected, create (if not exists):

```yaml
name: "Login"
description: "Authenticate with dev credentials"
steps:
  - action: open
    url: "{base_url}"
  - action: click
    target: "<detected_login_button>"
  - action: fill
    target: "<detected_username_field>"
    value: "{credentials.username}"
  - action: fill
    target: "<detected_password_field>"
    value: "{credentials.password}"
  - action: click
    target: "<detected_submit_button>"
  - action: wait
    duration: 3s
  - action: assert_url
    expected: "<detected_post_login_url>"
```

Fill in the targets by reading the actual login component or by running `agent-browser open {base_url}` and doing a snapshot to identify the real labels.

## Phase 4: Generate Test Manifests

For each discovered route, organized by the navigation hierarchy:

### 4.1 Directory Structure

Mirror the navigation tree:
```
visual-tests/
  _config.yaml
  _regressions.yaml        # create empty if not exists
  _shared/
    login.yaml
  <nav-group>/
    <page>.yaml
    <sub-group>/
      <page>.yaml
```

### 4.2 Manifest Generation Rules

For each route:

1. **If a manifest already exists** → SKIP (never overwrite)
2. **If the route is new** → Create a manifest

**Skeleton manifest** (minimum viable test):
```yaml
name: "<Page Name>"
description: "Auto-generated — customize with real test steps"
priority: medium
requires_auth: true
timeout: 30s
tags: [auto-generated]

steps:
  - action: open
    url: "{base_url}<route_path>"

  - action: llm-check
    description: "Page loads correctly"
    criteria: "Page content is visible, no error messages, no blank screen"
    severity: critical
    screenshot: "<page-name>-load.png"
```

**Enhanced manifest** (when interactive components are detected):

If the page has forms, uploads, chat, etc., generate steps that exercise them:
- Forms → `fill` + `click` submit + `llm-check` result
- Uploads → `upload` + `llm-wait` for processing + `llm-check` result
- Chat → `fill` message + `press Enter` + `wait` + `llm-check` response
- Tables → `llm-check` "data is displayed, rows visible"

Pre-fill `data:` section with discovered test files when relevant.

### 4.3 Deprecated Handling

For each existing manifest whose route no longer exists in the codebase:
- Add `deprecated: true` to the manifest frontmatter
- Do NOT delete the file

## Phase 5: Output Summary

After generation, output:

```
## /visual-discover Summary

**Framework:** Next.js App Router (or "Static HTML fallback — no framework detected")
**Routes found:** 24
**Navigation groups:** 4

### Generated
- _config.yaml (new)
- _shared/login.yaml (new)
- auth/login.yaml (new)
- notaire-chat/upload-pdf.yaml (new)
- ...

### Skipped (already exist)
- dashboard/home.yaml
- ...

### Deprecated
- dashboard/old-feature.yaml (route removed)

### Test Data Found
- data-sample/clement acte.pdf
- data/notarial-corpus/acte_vente/ (15 PDFs)

Run `/visual-run` to execute tests.
Run `/visual-run --regressions` to run only known failures.
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
| `screenshot <path>` | Take screenshot | `agent-browser screenshot /tmp/capture.png` |
| get url | Get current URL | agent-browser get url |
| close | Close browser | agent-browser close |

## Key Rules

1. **NEVER overwrite existing manifests** — only create new ones
2. **NEVER delete manifests** — mark deprecated
3. **Always verify agent-browser is installed** before running
4. **Use real element labels** — do a snapshot of each page to find actual button/input text
5. **Pre-fill test data** when fixtures are found
6. **Ask the user** if framework or route detection fails

## Final Checklist

Before considering the discovery complete, verify:

- [ ] agent-browser installed and functional
- [ ] Framework detected (or generic fallback documented)
- [ ] At least one route collected
- [ ] `_config.yaml` created or existing one left untouched
- [ ] `_regressions.yaml` created (empty) if absent
- [ ] No existing manifest overwritten
- [ ] Summary displayed (generated / skipped / deprecated)
