# AGENTS.md

This file provides guidance to Codex and other coding agents working in this repository.

## Golden Rule

Take the most direct, safe, verifiable path:
- Define "done" before you start; state it in one sentence.
- Work in small, reviewable increments — one skill or one concern per change.
- Use the project's existing harness: the smoke-test `.mjs` scripts next to each skill are the verification mechanism. Run the relevant ones after any change to skill scripts or templates.
- Do not invent new frameworks, test runners, or build steps; this repo is deliberately dependency-free (no package.json).

## Repository Guidance

`CLAUDE.md` at the repo root is the detailed authority on structure, skill file format, test commands, and constraints. Read it first.

## Branch Rule

The main branch is `main`. Create feature branches for changes; do not commit directly to `main` unless explicitly asked.

## Critical Constraints

- This is a Claude Code plugin: each skill lives in `plugins/shipguard/skills/<name>/` with a `SKILL.md` (YAML frontmatter + prompt) and an `agents/openai.yaml` Codex adapter — keep both in sync when changing a skill's interface.
- Keep the `visual-tests/_results/` output contract stable (`audit-results.json`, `logic-results.json`, `process-results.json`, TOON format): skills consume each other's files.
- Version lives in `plugins/shipguard/.claude-plugin/plugin.json`; mirror metadata changes in `.codex-plugin/plugin.json` and both marketplace manifests (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`).
- Keep `sg-mission-lock`, its Codex hook, and its smoke test aligned. The hook must remain read-only, stateless, non-blocking, and a no-op for unrelated models/prompts.
- Skills are report-only by default; `--fix` is always opt-in. Do not change that default.
- `--model=haiku` is refused for audits by design — do not relax.
