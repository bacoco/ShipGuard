# ShipGuard

AI-powered code audit + visual E2E testing for Claude Code.

## Quick Reference

| Skill | Description |
|-------|-------------|
| `/sg-code-audit [mode]` | Parallel codebase audit (quick\|standard\|deep\|paranoid) |
| `/sg-visual-run [what]` | Run visual tests -- natural language or flags |
| `/sg-visual-review` | Launch interactive review dashboard |
| `/sg-visual-discover [path]` | Generate YAML test manifests from codebase |
| `/sg-visual-fix` | Fix annotated screenshots automatically |
| `/sg-visual-review-stop` | Stop the review server |

## sg-code-audit

Dispatches parallel AI agents to audit every file in the repo. Each agent reviews a non-overlapping zone, finds bugs, and produces structured JSON.

### Modes

| Mode | Agents | Rounds | Coverage |
|------|--------|--------|----------|
| quick | 5 | 1 | Surface scan |
| standard | 10 | 1 | Full codebase (default) |
| deep | 15 | 2 | Surface + runtime behavior |
| paranoid | 20 | 3 | Surface + runtime + edge cases & security |

### Flags

- `--focus=path/` -- restrict audit to a specific directory
- `--report-only` -- find bugs but do not fix them
- `--all` -- force full scope, skip the smart scope question
- `--diff=<ref>` -- use a specific base reference for smart scope

Flags combine freely: `/sg-code-audit deep --focus=src/ --report-only`

### Output

Results are written to `audit-results.json` with the following structure:
- `summary` -- totals by severity and category
- `bugs[]` -- each bug with file, line, severity, description, and fix status
- `impacted_routes[]` -- UI routes affected by found bugs (consumed by `/sg-visual-run --from-audit`)

### Multi-round audits

- **R1**: Surface scan -- null refs, missing guards, type mismatches
- **R2**: Runtime behavior -- race conditions, async pitfalls, state management
- **R3**: Edge cases + security -- injection, auth bypass, data leaks

### Supported languages

Python, TypeScript/React, Next.js, Infrastructure (Docker/YAML/CI), Go, Rust, JVM.

### Smart Scope (all skills)

By default, skills detect what changed and propose a focused scope:

```
/sg-code-audit              # Asks: "12 files changed since main. Only what changed?"
/sg-visual-run              # Asks: "What do you want to test? Only what changed / Regressions / Full suite"
/sg-visual-discover         # Asks: "5 routes impacted. Generate manifests for new routes only?"
```

Override with flags:

| Flag | Effect |
|------|--------|
| `--all` | Force full scope (skip question) |
| `--diff=<ref>` | Use specific base reference |
| `--refresh-existing` | (discover only) Regenerate existing manifests |

## sg-visual-run

Executes YAML test manifests using agent-browser. Hybrid execution: mechanical steps run directly, complex assertions delegate to LLM evaluation.

### Usage

```bash
/sg-visual-run                                  # Interactive -- asks what to do
/sg-visual-run I changed the sidebar, check it  # Natural language
/sg-visual-run --from-audit                     # Run tests for audit-impacted routes
/sg-visual-run --regressions                    # Re-run previously failed tests
/sg-visual-run --all                            # Force full suite, skip smart scope
/sg-visual-run --diff=<ref>                     # Use specific base reference for scope
```

**Interactive mode** (no args) presents four options: only what changed (git diff), only regressions, full suite, or free-form description.

**Natural language** mode parses the intent, finds matching test manifests, generates missing ones on the fly, and executes them.

**--from-audit** reads `impacted_routes` from `audit-results.json` and runs only the matching test manifests.

**--regressions** re-runs tests listed in `_regressions.yaml`. Tests are removed from the regression list after 3 consecutive passes.

## sg-visual-review

Builds and serves an interactive HTML dashboard at `http://localhost:8888`.

### Two tabs

- **Visual Tests** -- screenshot grid from `/sg-visual-run` results. Filter by status (pass/fail) and category.
- **Code Audit** -- bug cards from `audit-results.json`. Filter by severity, category, and free-text search. CSV export available.

### Screenshot annotations

Click any screenshot to open the annotation view. Use pen tools to circle problem areas. When done, click "Validate & Generate Report" to produce `fix-manifest.json` -- the input for `/sg-visual-fix`.

Stop the server with `/sg-visual-review-stop`.

## sg-visual-discover

Scans the codebase to detect routes, forms, and user journeys, then generates YAML test manifests mirroring the navigation tree.

```bash
/sg-visual-discover                    # Scan current project
/sg-visual-discover path/to/project    # Scan a specific project
/sg-visual-discover --all              # Force full discovery, skip smart scope
/sg-visual-discover --diff=<ref>       # Use specific base reference for scope
/sg-visual-discover --refresh-existing # Regenerate existing manifests too
```

Supports Next.js (App Router & Pages Router), React Router, Vue, and Angular. Manifests are written to `visual-tests/` with one YAML file per route or user journey.

## sg-visual-fix

Reads `fix-manifest.json` produced by the review dashboard annotations.

For each annotated screenshot:
1. Reads the annotation coordinates to identify the problem region
2. Traces the visual bug to source code (component, CSS, data)
3. Implements the fix
4. Rebuilds the app (if `build_command` is set in `_config.yaml`)
5. Re-runs the test to capture an "after" screenshot
6. Generates a before/after comparison page

```bash
/sg-visual-fix                         # Uses latest fix-manifest.json
/sg-visual-fix path/to/manifest.json   # Uses a specific manifest
```

## Configuration

### visual-tests/_config.yaml

```yaml
base_url: "http://localhost:3000"
credentials:
  username: "testuser"
  password: "testpass"
screenshots_dir: "visual-tests/_results/screenshots"
report_path: "visual-tests/_results/report.md"
build_command: "docker compose up -d --build frontend"  # or null
```

### visual-tests/_regressions.yaml

Auto-maintained by `/sg-visual-run`. Tracks tests that failed on the last run. Tests are removed after 3 consecutive passes. Do not edit manually.

## Install

```bash
claude plugin add bacoco/shipguard
```

**Requires:** `agent-browser` CLI

```bash
npm install -g agent-browser && agent-browser install --with-deps
```

## License

MIT
