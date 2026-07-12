# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ShipGuard is a Claude Code and Codex plugin providing `sg-*` skills for mission control and diff-scoped verification: code audit, process simulation, visual E2E testing, macro recording, review dashboards, and self-improvement. GitHub: `bacoco/ShipGuard`. License MIT. Main branch: `main`.

Pipeline: static **find** (`sg-code-audit`) → dynamic **simulate** (`sg-process-check`) → visual **confirm** (`sg-visual-run`) → human **decides** (`sg-visual-review`). `/sg-ship` orchestrates all of it. Report-only by default; `--fix` opts in.

## Structure

```
.claude-plugin/marketplace.json      # Claude Code marketplace manifest
.agents/plugins/marketplace.json     # Codex marketplace manifest
plugins/shipguard/                   # The plugin itself
├── .claude-plugin/plugin.json       # Plugin manifest (name, version — currently 2.6.0)
├── .codex-plugin/plugin.json        # Codex plugin manifest
├── hooks/hooks.json                 # Codex model-aware mission-lock injection
├── docs/                            # sandbox.md, codex-migration.md
├── examples/                        # e.g. client-validation-report.html
└── skills/                          # 13 skills, one dir each
    ├── sg-mission-lock/             # Mission/authority guard + hook smoke test
    ├── sg-ship/                     # Orchestrator: full pipeline on a diff
    ├── sg-code-audit/               # Parallel audit agents + verification
    ├── sg-process-check/            # Before/after behavior simulation (reason/hybrid/execute)
    ├── sg-visual-discover/          # Generate YAML test manifests from routes
    ├── sg-visual-run/               # Execute manifests via agent-browser
    ├── sg-visual-review/            # HTML dashboard (build-review.mjs, _review-template.html)
    ├── sg-visual-review-stop/       # Stop the review server
    ├── sg-visual-fix/               # Fix bugs annotated on screenshots
    ├── sg-change-report/            # Durable before/after client reports
    ├── sg-record/                   # Macro recorder (sg-record.mjs + lib/)
    ├── sg-improve/                  # Session learnings → .shipguard/ + GitHub issues
    └── sg-scout/                    # GitHub technique scouting
docs/                                # architecture.md, product-roadmap.md, specs/, scout-reports/, screenshots/
examples/                            # Canonical manifests: _config.yaml, _regressions.yaml, _shared/login.yaml, auth/, chat/, documents/
visual-tests/                        # This repo's own _config.yaml (dogfooding)
scripts/build-demo-gif.py            # README demo GIF builder
```

## Skill format

Each skill directory contains:
- `SKILL.md` — YAML frontmatter (at minimum `name` and `description`; older Claude-focused skills may also use `context` and `argument-hint`) followed by the prompt/instructions. This is the source of truth for behavior.
- `agents/openai.yaml` — Codex CLI adapter for that skill.
- Optional `references/`, `fixtures/`, `examples/`, and Node scripts.

## Tests

Smoke tests are standalone Node scripts (no test framework, no package.json):

```bash
node plugins/shipguard/skills/sg-visual-review/review-smoke-test.mjs
node plugins/shipguard/skills/sg-visual-review/monitor-smoke-test.mjs
node plugins/shipguard/skills/sg-improve/improve-dry-run-smoke-test.mjs
node plugins/shipguard/skills/sg-improve/improve-rollback-smoke-test.mjs
node plugins/shipguard/skills/sg-visual-fix/visual-fix-dry-run-smoke-test.mjs
node plugins/shipguard/skills/sg-scout/offline-dry-run-smoke-test.mjs
node plugins/shipguard/skills/sg-mission-lock/scripts/mission-lock-smoke-test.mjs
```

Run the relevant smoke test after touching a skill's scripts or templates.

## Conventions and constraints

- Results contract: skills read/write `visual-tests/_results/` (`audit-results.json` canonical, `audit-results.toon` compact, `process-results.json`, change reports under `change-reports/`). Legacy `.code-audit-results/` is read as a fallback. Keep these paths and JSON shapes stable — skills consume each other's outputs (`--from-audit`, `--from-process`).
- Version bumps go in `plugins/shipguard/.claude-plugin/plugin.json` (keep `.codex-plugin/plugin.json` and marketplace manifests consistent).
- Visual flows require `agent-browser` (npm, global). Always close browsers after use.
- Code audit parallelism relies on Claude Code's Agent tool with worktree isolation; other CLIs get the non-parallel lanes.
- `--model=haiku` is deliberately refused for audits — do not relax this.
- Per-project learned state lives in the target project's `.shipguard/` directory, not in this repo.
- Keep the two marketplace manifests (`.claude-plugin/` and `.agents/plugins/`) in sync when plugin metadata changes.
- `sg-mission-lock` is cross-skill governance. Its hook injects context only for `gpt-5.6` / `gpt-5.6-sol` or explicit Sol-model prompts; it must not mutate, persist state, or block unrelated prompts.
