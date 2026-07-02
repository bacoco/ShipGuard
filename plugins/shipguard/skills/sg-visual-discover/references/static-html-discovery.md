# Static HTML / No-Framework Discovery

Used by `/sg-visual-discover` Phase 1.2 when no frontend framework is detected in Phase 1.1. Covers: static `.html` file scan (§1.2), SPA tab detection (§1.2b), and dev-server / `base_url` auto-detection (§1.2c).

## 1.2 Static HTML Fallback

If NO framework is detected:

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
generated_by: sg-visual-discover
generated_date: "<YYYY-MM-DD>"

steps:
  - action: open
    url: "{base_url}/<derived-url-path>"
  - action: llm-check
    description: "Page loads and renders content"
    criteria: "Page content is visible, no blank screen, no broken images or missing resources"
    severity: critical
    screenshot: "pages-<slugified-path>.png"
```

6. **Element-aware manifest generation:** Before generating the minimal manifest, parse each HTML file for interactive elements and enrich the steps:
   - If the file contains `<video>` or `<iframe>` → add: `- action: llm-check` with criteria "Media element loads and is playable/visible, no broken embed"
   - If the file contains `<form>` → add: `- action: fill` + `- action: click` (submit button) + `- action: llm-check` with criteria "Form submission feedback is visible"
   - If the file contains `<img>` (3+ images) → add: `- action: llm-check` with criteria "All images loaded, no broken image icons"
   - If the file contains `role="tab"` or class containing `tab` → add tab click + assert steps (see §1.2b below)

7. **Batch mode:** When invoked with `--all` on a static site, generate all manifests in a single pass without step-by-step user interaction. Print a summary at the end instead of asking confirmation per file.

8. Log detection: "No framework detected — falling back to static HTML scan"
9. If no `.html` files found either, ask the user to specify the route source

## 1.2b SPA Tab Detection

If no JS framework is detected AND only 1-3 HTML files are found, the site may be a single-page app with tabs:

1. Scan each HTML file for tab indicators:
   - `role="tab"` or `role="tablist"` attributes
   - Elements with class containing `tab` (e.g., `nav-tabs`, `fr-tabs`, `tab-button`)
   - `<a href="#section">` hash links that act as tab navigation
2. Scan JS files for:
   - Files named `tab-*.js`, `*-tab.js`, or `*tabs*.js`
   - Hash route handling: `window.location.hash`, `hashchange` event
3. For backend projects (FastAPI/Flask/Django), scan `server.py`, `app.py`, `main.py` for:
   - `@app.get("...")` or `@app.route("...")` decorators → each is a route
   - Hash routes in JS files (`#import`, `#clean`, etc.) → each is a tab/view
4. For each detected tab/section, generate a manifest whose `open` step uses the **hash URL**:
   - `url: "{base_url}/#<hash>"` — always include the hash. Multiple manifests opening bare `{base_url}/` would make from-audit `/`-route matching ambiguous, so hash URLs are required: each manifest must key to a distinct route.
   - Steps: `open {base_url}/#<hash>` → `click` on the tab → `llm-check` "Tab content is visible and correct"
   - Category: `tabs/` subdirectory
   - Name derived from tab text or hash

## 1.2c Auto-Detect Dev Server Command

Before asking the user for `base_url`, auto-detect the dev server command:

1. Check `playwright.config.js` or `playwright.config.ts` → look for `webServer.command` field
2. Check `package.json` → look for `scripts.dev` or `scripts.start`
3. Check for Python dev scripts: `scripts/*.py`, `run.py`, `server.py` with `uvicorn` or `flask` patterns
4. Check for `docker-compose.yml` or `docker-compose.yaml` → propose `docker compose up -d`

If found, propose the result as `build_command` in `_config.yaml`:
```yaml
build_command: "<detected command>"  # auto-detected from {source}
```

If nothing detected, leave as `build_command: null`.

**Deriving `base_url` from the detected command** (extract host and port):

| Source | Rule | Example |
|--------|------|---------|
| Dev script flags | Parse `--port` / `-p` / `--host` | `next dev -p 3001` → `http://localhost:3001` |
| docker-compose | Use the published (host-side) port of the frontend service | `ports: "8051:3000"` → `http://localhost:8051` |
| uvicorn / flask | Parse `--port` / `--host` args | `uvicorn app:app --port 8052` → `http://localhost:8052` |
| Framework default | No explicit port → framework default | Next.js/CRA 3000, Vite 5173, Angular 4200, Vue CLI 8080, Flask 5000, uvicorn/FastAPI 8000 |

Host is `localhost` unless the command, docker-compose, or README says otherwise. Write the result to `base_url` in `_config.yaml`.
