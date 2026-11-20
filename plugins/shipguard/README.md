# ShipGuard plugin

## First priority — Make the authorized action succeed

Before writing code or a test, identify the authorized action, its target, the case to reproduce, and the expected result from the request and existing constraints.

Fix the defect while keeping the action available. Use the normal workflow for both the reported case and an ordinary case. Verify that the action succeeds in both cases and that the defect is gone. A passing test is invalid if it hides a button, refuses a click, skips the case, or changes the expected result.

Complete the action if it is still possible. If the situation has changed, explain the change and ask for a decision when one is needed. If the obstacle is temporary, retain the request and resume it on the intended target when the authorized conditions are met.

A refusal must follow the requester’s decision or protect against a specific risk of data loss, a wrong target, or unauthorized access. Explain the practical effect of any new blocking rule, visible or silent, and obtain the requester’s approval before adding it.

Before reporting a fix, state the action performed and the observed result. If the case could not be reproduced, say that it still needs verification.

![ShipGuard — Agentic AI Audit & Visual Regression](hero.jpg)

ShipGuard is a Claude Code and Codex plugin for scope protection, code and logic audits,
process checks, visual testing, browser-flow recording, and review dashboards.

The [root README](../../README.md) is the complete, canonical guide for features, installation,
configuration, compatibility, and usage.

Code audits are report-only by default and include Shell support. Explicit `--fix` opts in to
tier-gated safe fixes in Claude Code; Codex `--fix` is not supported.

## Audit tests that hide broken actions

ShipGuard instructs the coding agent to avoid test-driven development. Define the result from the user request, implement the behavior, then add or update regression tests that check the actual result.

Before a push, review new or changed tests and software rules. Trace rules prompted by user feedback, another AI's findings, or the coding agent's own findings, even when no test was added. Verify that the intended action still completes in the reported and ordinary valid cases and that skipping the action would fail the test.

AI coding assistants sometimes add contradictory or unsuitable product rules to make tests pass. A test can report success after the code skips a valid action, blocks it, or returns early. Ask **“Find tests that pass when the actual action is skipped”** to run the [read-only audit](skills/sg-test-audit/SKILL.md). It traces the test and the rule, checks the outcome through the normal workflow, and writes `rapport-regles.md` outside the project. Ask **“Fix R01 and R04”** to [apply those proposals and check the outcome](skills/sg-fix-user-rules/SKILL.md).

Include the priority above in the project’s README and agent instructions when adopting it. Repeat the full inventory at the project’s existing review interval and tell the decision-maker which rules were added, removed or corrected. Routine change reviews cover the affected actions. Ask what harm each refusal prevents and how an authorized person can still complete the action.

## Screenshot evidence for issues and pull requests

The installed plugin's hooks provide this rule in every project where they are enabled. Attach a screenshot of the observed problem when opening an issue. After the change, add a screenshot of the same scenario and its result to the issue. Include both screenshots in any related pull request. For a non-UI change, capture the actual command and result or the actual document, then link the underlying evidence. [`sg-change-report`](skills/sg-change-report/SKILL.md) records the revisions, reproduction conditions and observed outcomes with the captures.

## Plugin package references

- [`skills/`](skills/) contains the canonical skill instructions.
- [`cli/shipguard.mjs`](cli/shipguard.mjs) is the standalone deterministic CLI.
- [`docs/codex-migration.md`](docs/codex-migration.md) covers migration to the Codex plugin.
- [`docs/dialogue-hooks.md`](docs/dialogue-hooks.md) documents the optional dialogue hooks.
- [`docs/communication-memory.md`](docs/communication-memory.md) documents private communication memory.
- [`docs/sandbox.md`](docs/sandbox.md) describes sandbox requirements and limitations.

ShipGuard is licensed under the [MIT License](LICENSE).
