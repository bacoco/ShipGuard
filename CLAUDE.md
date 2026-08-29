# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ShipGuard is a Claude Code and Codex plugin providing `sg-*` skills for mission control and diff-scoped verification: code audit, contract/invariant logic audit, process simulation, visual E2E testing, macro recording, review dashboards, and self-improvement. GitHub: `bacoco/ShipGuard`. License MIT. Main branch: `main`.

Pipeline: static **find** (`sg-code-audit`) → optional semantic **check** (`sg-logic-audit`) → dynamic **simulate** (`sg-process-check`) → visual **confirm** (`sg-visual-run`) → human **decides** (`sg-visual-review`). `/sg-ship --logic` orchestrates all lanes. Report-only by default; `--fix` opts in.

## Structure

```
.claude-plugin/marketplace.json      # Claude Code marketplace manifest
.agents/plugins/marketplace.json     # Codex marketplace manifest
plugins/shipguard/                   # The plugin itself
├── .claude-plugin/plugin.json       # Plugin manifest (name and release version)
├── .codex-plugin/plugin.json        # Codex plugin manifest
├── hooks/hooks.json                 # Codex model-aware mission-lock injection
├── docs/                            # sandbox.md, codex-migration.md
├── examples/                        # e.g. client-validation-report.html
└── skills/                          # 15 canonical skills + 1 deprecated alias
    ├── sg-mission-lock/             # Mission/authority guard + hook smoke test
    ├── sg-beat-reference/           # Paste-ready compare/improve loop against a named reference
    ├── sg-gauntlet/                 # Deprecated alias for sg-beat-reference
    ├── sg-ship/                     # Orchestrator: full pipeline on a diff
    ├── sg-code-audit/               # Parallel audit agents + verification
    ├── sg-logic-audit/              # Contracts, invariants, paths, counterexamples
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

- Results contract: skills read/write `visual-tests/_results/` (`audit-results.json` canonical, `audit-results.toon` compact, `logic-results.json`, `process-results.json`, change reports under `change-reports/`). Legacy `.code-audit-results/` is read as a fallback. Keep these paths and JSON shapes stable — skills consume each other's outputs (`--from-audit`, `--from-logic`, `--from-process`).
- Version bumps go in `plugins/shipguard/.claude-plugin/plugin.json` (keep `.codex-plugin/plugin.json` and marketplace manifests consistent).
- Visual flows require `agent-browser` (npm, global). Always close browsers after use.
- Code audit parallelism relies on Claude Code's Agent tool with worktree isolation; other CLIs get the non-parallel lanes.
- `--model=haiku` is deliberately refused for audits — do not relax this.
- Per-project learned state lives in the target project's `.shipguard/` directory, not in this repo.
- Keep the two marketplace manifests (`.claude-plugin/` and `.agents/plugins/`) in sync when plugin metadata changes.
- `sg-mission-lock` is cross-skill governance. Its hook injects context only for `gpt-5.6` / `gpt-5.6-sol` or explicit Sol-model prompts; it must not mutate, persist state, or block unrelated prompts.
