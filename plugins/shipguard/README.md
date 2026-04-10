# ShipGuard

*Formerly Agentic Visual Debugger*

AI-powered code audit + visual E2E testing for any web app. Audit the code first, verify visually second. Zero tests written.

## Full ShipGuard Flow

```bash
/code-audit                    # Find bugs in code
/visual-run --from-audit       # Verify impacted routes visually
/visual-review                 # See everything in one dashboard
```

## Audit Modes

| Mode | Agents | Rounds |
|------|--------|--------|
| quick | 5 | 1 |
| standard | 10 | 1 |
| deep | 15 | 2 |
| paranoid | 20 | 3 |

## Skills

- `/code-audit` — Multi-agent parallel code audit. Finds real bugs (null refs, race conditions, missing guards). Outputs a prioritized bug list with file locations.
- `/visual-discover` — Explore codebase, detect routes/forms/features, generate YAML test manifests mirroring UI navigation
- `/visual-run` — Describe what to test in natural language. Finds matching tests, generates missing ones, executes with hybrid assertions, tracks regressions. Use `--from-audit` to run only routes impacted by the last code audit.
- `/visual-review` — Build an interactive HTML review page with screenshots, annotations, and export tools
- `/visual-fix` — AI reads annotated screenshots, traces to source code, implements fixes, captures before/after
- `/visual-review-stop` — Stop the review page HTTP server

## Natural Language Interface

```bash
/visual-run                                    # run all tests
/visual-run --regressions                      # run known failures first
/visual-run --from-audit                       # run only audit-impacted routes
/visual-run teste l'upload de PDF              # finds/creates upload test, runs it
/visual-run j'ai modifie le chat, verifie      # git diff → impacted tests → run
```

## Key Features

- Generic (Next.js, React, Vue, Angular)
- Code audit before visual verification — find bugs in code, not just pixels
- Dynamic test management (auto-create, auto-update, auto-retire)
- Mandatory screenshot validation (every screenshot read + inspected, errors = FAIL)
- Regression-aware (failed tests run first, removed after 3 passes)
- Crash recovery + test isolation

## Install

```bash
claude mcp add https://github.com/bacoco/agentic-visual-debugger
```

**Requires:** `agent-browser` CLI (`npm install -g agent-browser && agent-browser install --with-deps`)
