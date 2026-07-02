---
name: sg-visual-discover
description: Use when a project needs visual test manifests created or refreshed — before the first visual run, after UI routes change, or when sg-visual-run reports uncovered routes.
context: conversation
argument-hint: "[project-path] [--all] [--diff=ref] [--refresh-existing]"
---

# /sg-visual-discover — Discover & Generate Visual Test Manifests

Explore the codebase of any web application, detect all user-facing routes and interactions, and generate a YAML test manifest tree that mirrors the UI navigation structure.

> **Recommended model: Sonnet 4.6.** This skill crawls routes + generates YAML manifests — mechanical work where Opus 4.7 provides no measurable quality gain. Use `/model sonnet` before invoking to save Opus weekly quota.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-visual-discover` | **Interactive** — detect changes, ask scope |
| `/sg-visual-discover <path>` | Discover routes in specific project path |
| `/sg-visual-discover --diff=main` | Generate manifests only for routes impacted by changes since `main` |
| `/sg-visual-discover --all` | Discover all routes (skip scope question) |
| `/sg-visual-discover --refresh-existing` | Diff mode against the detected base, plus regenerate refresh-eligible manifests for impacted routes |
| `/sg-visual-discover --all --refresh-existing` | Full discovery AND refresh every refresh-eligible existing manifest |

## Scope Detection

Before scanning the project, determine scope:

1. Check for `--all` flag → skip to Phase 1 with full scope.
2. Check for `--diff=<ref>` flag → use that ref.
3. If BOTH `--all` and `--diff` → error: `Cannot use --all and --diff together.`
4. If neither flag:
   a. Detect the base reference using the same base-resolution algorithm as `sg-code-audit` and `sg-visual-run` (merge-base with `main`/`master` when on a feature branch, else `HEAD~1`).
   b. Run `git diff --name-only {base}...HEAD` → changed files.
   c. If changes detected, map to routes using the same generic route detection described in `sg-code-audit`.
   d. Ask user:
      > "I detected {N} files changed since `{base}`, impacting {R} routes. What scope?"
      >
      > 1. **Only impacted routes** — generate manifests for new routes only
      > 2. **Full app** — discover all routes
      > 3. **Different base**
   e. If no changes detected, offer same fallback as sg-code-audit: last commit, full app, or different base.
5. Store `scope_mode` ("diff" or "full") and `impacted_routes[]` for Phase 4.

**Flag combination:** `/sg-visual-discover <project-path> --diff=<ref>`
Both apply: discover within project-path, but only generate manifests for routes impacted by the diff. The diff is computed on the whole repo, but only routes within project-path are considered.

**`--refresh-existing` scope:**
- **Standalone `--refresh-existing`** implies diff mode against the detected base: create manifests for impacted routes that lack one, AND regenerate refresh-eligible existing manifests for impacted routes.
- **Combined with `--all`**: full discovery AND refresh — discover every route, create missing manifests, and regenerate every refresh-eligible existing manifest.
- In both cases, manifests without the auto-generated marker are never touched (see Phase 4.2).

## Prerequisites

Before running, verify:
1. `agent-browser --version` — must be installed
2. The project serves HTML (framework app, static files, or server-rendered)
3. Identify the `visual-tests/` directory (create if missing)
4. `base_url` reachable (optional, improves selector accuracy — see Key Rules)

## Phase 1: Detect Project Structure

Explore the codebase to identify:

### 1.1 Frontend Framework

Search for framework indicators in this order:
- `next.config.*`, `app/layout.tsx`, or `src/app/layout.tsx` → **Next.js (App Router)** — the `src/app/` variant is as common as root `app/`
- `pages/_app.tsx` or `pages/index.tsx` → **Next.js (Pages Router)**
- `src/App.tsx` or `src/App.jsx` + `react-router`/`react-router-dom` in package.json → **React Router**
- `vite.config.*` → **Vite app** — inspect `src/main.*` to find the actual router (React Router, Vue Router, plain SPA)
- `src/router/index.ts` or `vue.config.*` → **Vue**
- `angular.json` → **Angular**
- Fallback: grep for route patterns (`<Route`, `path:`, `router.get`, `createBrowserRouter`)

### 1.2 No Framework Detected — Fallback Discovery

If no framework is detected in 1.1, follow `references/static-html-discovery.md`: static `.html` file scan (§1.2), SPA tab detection (§1.2b), and dev-server / `base_url` auto-detection (§1.2c). Log: `No framework detected — falling back to static HTML scan`. If the reference procedure finds no `.html` files either, ask the user to specify the route source.

### 1.3 Route Definitions

Based on the detected framework:

| Framework | Where to look |
|-----------|--------------|
| Next.js App Router | `app/**/page.tsx` or `src/app/**/page.tsx` — each directory = route; route groups `(group)` do NOT contribute a URL segment; parallel routes `@slot` are slots, not standalone routes |
| Next.js Pages | `pages/**/*.tsx` — file path = route |
| React Router | Router config files, `<Route path=...>` patterns; for v6.4+ also `createBrowserRouter([...])` / `createRoutesFromElements` route objects |
| Vue Router | `router/index.ts`, `routes: [...]` |
| Angular | `*-routing.module.ts` |
| Generic | Grep for `path:`, `route:`, URL patterns in config |

Collect: route path, page component file, any associated layout.

**Dynamic route segments** (`[id]`, `[slug]`, `:id`): a parameterized route needs a concrete value before it can be tested. In order of preference:
1. Source a real value from Phase 1.7 test data into the manifest `data:` section — e.g. `data: { id: "..." }` and `url: "{base_url}/dossier/{data.id}"`.
2. Otherwise generate steps that navigate from the parent list page (open the list route, click the first row/item).
3. If neither is possible, still emit the manifest with a top-level `todo: "needs a fixture id"` key and report the route as unmapped.

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
# visual-tests/_config.yaml — Generated by /sg-visual-discover
base_url: "<detected_url>"       # derived — see rule below
credentials:
  username: "<detected>"
  password: "<detected>"
screenshots_dir: "visual-tests/_results/screenshots"
report_path: "visual-tests/_results/report.md"
# agent_browser_path: "agent-browser"   # uncomment only to override the binary on PATH
build_command: null              # set to rebuild command (e.g. "docker compose up -d --build frontend") or leave null if no rebuild needed
```

**Deriving `base_url`:** extract host and port from the detected dev command — dev script flags (`next dev -p 3001` → `http://localhost:3001`), docker-compose published ports (`"8051:3000"` → `http://localhost:8051`), or the framework default port when nothing explicit is set (Next.js/CRA 3000, Vite 5173, Angular 4200, Vue CLI 8080, Flask 5000, uvicorn/FastAPI 8000). Host is `localhost` unless the command or README says otherwise. Full detection algorithm: `references/static-html-discovery.md` §1.2c.

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

Fill in the targets by reading the actual login component or — if `base_url` is reachable — by running `agent-browser open {base_url}` and doing a snapshot to identify the real labels.

## Phase 4: Generate Test Manifests

For each discovered route, organized by the navigation hierarchy:

### 4.1 Directory Structure

Mirror the navigation tree:
```
visual-tests/
  _config.yaml
  _regressions.yaml        # create with the canonical stub if not exists
  _shared/
    login.yaml
  <nav-group>/
    <page>.yaml
    <sub-group>/
      <page>.yaml
```

If `_regressions.yaml` does not exist, create it with exactly this stub:

```yaml
# Auto-maintained by /sg-visual-run — do not edit manually
regressions: []
```

### 4.2 Manifest Generation Rules

**Refresh eligibility (the auto-generated marker):** a manifest is *refresh-eligible* only if it still carries the `auto-generated` tag in `tags:` AND top-level `generated_by: sg-visual-discover`. A manifest missing either marker is hand-edited or hand-written and is NEVER overwritten — report it as `skipped (hand-maintained)`.

For each route:

1. **If `scope_mode == "diff"` AND route is NOT in `impacted_routes`** → SKIP (not impacted by changes)
2. **If a manifest already exists AND `--refresh-existing` is NOT set** → SKIP (never overwrite without explicit flag)
3. **If a manifest exists AND `--refresh-existing` IS set AND it is refresh-eligible** → REGENERATE: write a backup alongside (`<page>.yaml.bak`), re-scan the route components, overwrite the manifest, and print a one-line diff summary (e.g. `dashboard/home.yaml: 2 steps added, 1 selector updated`). Warn: `Refreshing {N} eligible manifests.`
4. **If a manifest exists AND `--refresh-existing` IS set AND it is NOT refresh-eligible** → SKIP, report as `skipped (hand-maintained)`
5. **If no manifest exists** → CREATE new manifest

**Skeleton manifest** (minimum viable test):
```yaml
name: "<Page Name>"
description: "Auto-generated — customize with real test steps"
priority: medium
requires_auth: true              # derived per route — see rule below, never hardcode
timeout: 30s
tags: [auto-generated]
generated_by: sg-visual-discover
generated_date: "<YYYY-MM-DD>"

steps:
  - action: open
    url: "{base_url}<route_path>"

  - action: llm-check
    description: "Page loads correctly"
    criteria: "Page content is visible, no error messages, no blank screen"
    severity: critical
    screenshot: "<page-name>-load.png"
```

**Deriving `requires_auth`:**
- `requires_auth: false` for public routes — login, signup, logout, landing/root when unauthenticated, password-reset — and any route outside the app's auth middleware/guards.
- `requires_auth: true` otherwise.
- Concrete detection: check the middleware config (`middleware.ts` `matcher`), layout-level auth wrappers/guards, route groups like `(auth)`/`(public)`, and any explicit public-route list in the codebase.
- The login page manifest itself is always `requires_auth: false`.

> **Contract lock:** the authoritative action/field list is `sg-visual-run/references/action-reference.md`. `llm-*` actions use `screenshot:` — only the standalone `screenshot` action uses `filename:`. `steps[0]` must always be `open` with a route-bearing URL (it is the runner's route-matching key).

**Enhanced manifest** (when interactive components are detected):

If the page has forms, uploads, chat, etc., generate steps that exercise them:
- Forms → `fill` + `click` submit + `llm-check` result
- Uploads → `upload` + `llm-wait` for processing + `llm-check` result
- Chat → `fill` message + `press Enter` + `wait` + `llm-check` response
- Tables → `llm-check` "data is displayed, rows visible"

Pre-fill `data:` section with discovered test files when relevant.

Report:
- `scope_mode == "diff"`: `Created {N} new manifests. Refreshed {R}. Skipped {S} (exist / hand-maintained). {U} unmapped files (changed files with no component/route match).`
- `scope_mode == "full"`: `Created {N} new manifests. Refreshed {R}. Skipped {S} (exist / hand-maintained). {D} routes deprecated.`

**Terminology:** "unmapped files" = changed files this skill could not map to any route or component. The pipeline reserves "uncovered routes" for routes that have no manifest — those are reported by `sg-visual-run`, not here.

### 4.3 Deprecated Handling

For each existing manifest whose route no longer exists in the codebase:
- Add `deprecated: true` as a **top-level key** in the manifest
- Do NOT delete the file

## Phase 5: Output Summary

After generation, output:

```
## /sg-visual-discover Summary

**Framework:** Next.js App Router (or "Static HTML fallback — no framework detected")
**Routes found:** 24
**Navigation groups:** 4

### Generated
- _config.yaml (new)
- _shared/login.yaml (new)
- auth/login.yaml (new)
- dashboard/home.yaml (new)
- ...

### Refreshed (--refresh-existing, .bak written)
- dashboard/home.yaml — 2 steps added, 1 selector updated

### Skipped
- dashboard/home.yaml (exists)
- billing/invoices.yaml (hand-maintained)

### Deprecated
- dashboard/old-feature.yaml (route removed)

### Test Data Found
- data-sample/sample-contract.pdf
- data/sample-corpus/ (15 PDFs)

Run `/sg-visual-run` to execute tests.
Run `/sg-visual-run --regressions` to run only known failures.
```

## agent-browser Reference

Discovery needs only three commands: `agent-browser open <url>`, `agent-browser snapshot`, `agent-browser close`. The full command set and manifest action list live with the executor: `sg-visual-run/references/action-reference.md`.

## Key Rules

1. **NEVER overwrite a manifest that lacks the auto-generated marker** (`auto-generated` tag + `generated_by: sg-visual-discover`) — hand-maintained manifests are never touched, even with `--refresh-existing`. Refresh-eligible manifests are overwritten only when `--refresh-existing` is passed, and only after a `.bak` is written alongside. By default, only create new manifests.
2. **NEVER delete manifests** — mark deprecated (top-level `deprecated: true`)
3. **Always verify agent-browser is installed** before running
4. **Best-effort live snapshots** — if `base_url` is reachable, snapshot each page for real button/input text; otherwise read the component source to derive selectors
5. **Pre-fill test data** when fixtures are found
6. **Ask the user** if framework or route detection fails

## Final Checklist

Before considering the discovery complete, verify:

- [ ] agent-browser installed and functional
- [ ] Framework detected (or fallback per `references/static-html-discovery.md` documented)
- [ ] At least one route collected
- [ ] `_config.yaml` created or existing one left untouched
- [ ] `_regressions.yaml` created with the canonical stub (`regressions: []` under the "Auto-maintained by /sg-visual-run — do not edit manually" header) if absent
- [ ] No hand-maintained manifest overwritten; every refreshed manifest has a `.bak` alongside
- [ ] Summary displayed (generated / refreshed / skipped / deprecated)
