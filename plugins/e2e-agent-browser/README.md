# agentic-visual-debugger

Automated visual testing for any web app using agent-browser.

**Skills:**
- `/visual-discover` — Explore codebase, detect routes/forms/features, generate YAML test manifests mirroring UI navigation
- `/visual-run` — Describe what to test in natural language. Finds matching tests, generates missing ones, executes with hybrid assertions, tracks regressions.
- `/visual-review` — Build an interactive HTML review page with screenshots, annotations, and export tools
- `/visual-fix` — AI reads annotated screenshots, traces to source code, implements fixes, captures before/after
- `/visual-review-stop` — Stop the review page HTTP server

**Natural language interface:**
```bash
/visual-run                                    # run all tests
/visual-run --regressions                      # run known failures first
/visual-run teste l'upload de PDF              # finds/creates upload test, runs it
/visual-run j'ai modifie le chat, verifie      # git diff → impacted tests → run
```

**Key features:**
- Generic (Next.js, React, Vue, Angular)
- Dynamic test management (auto-create, auto-update, auto-retire)
- Mandatory screenshot validation (every screenshot read + inspected, errors = FAIL)
- Regression-aware (failed tests run first, removed after 3 passes)
- Crash recovery + test isolation

**Requires:** `agent-browser` CLI (`npm install -g agent-browser && agent-browser install --with-deps`)
