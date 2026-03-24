# e2e-agent-browser

Automated E2E testing for any web app using agent-browser (Playwright CLI).

**Skills:**
- `/e2e-discover` — Explore codebase, detect routes/forms/features, generate YAML test manifests mirroring UI navigation
- `/e2e-run` — Describe what to test in natural language. Finds matching tests, generates missing ones, executes with hybrid assertions, tracks regressions.

**Natural language interface:**
```bash
/e2e-run                                    # run all tests
/e2e-run --regressions                      # run known failures first
/e2e-run teste l'upload de PDF              # finds/creates upload test, runs it
/e2e-run j'ai modifie le chat, verifie      # git diff → impacted tests → run
```

**Key features:**
- Generic (Next.js, React, Vue, Angular)
- Dynamic test management (auto-create, auto-update, auto-retire)
- Mandatory screenshot validation (every screenshot read + inspected, errors = FAIL)
- Regression-aware (failed tests run first, removed after 3 passes)
- Crash recovery + test isolation

**Requires:** `agent-browser` CLI (`npm install -g agent-browser && agent-browser install --with-deps`)
