# PRD — Product Readiness Plan for `agentic-visual-debugger`

**Author:** Codex (GPT-5.3-Codex)  
**Date:** 2026-04-09  
**Status:** Draft for v1.0 execution

## 1) Context

The product already communicates a strong value proposition (AI-generated YAML manifests + visual review + annotation-driven fixes). However, there is still a visible gap between what is promised in marketing copy and what is proven by executable assets in the repository.

This PRD defines a concrete delivery plan to reach top-tier repository quality across product depth, installation UX, proof of reliability, and community trust.

## 2) Objectives

### Primary objective
Ship a **production-ready open-source release** that a new user can install, run locally or in CI, and trust without depending on hidden workflows.

### Success criteria
By release v1.0, the repository should demonstrate:
1. **Runnable core**: A standalone runner executes manifests without Claude-specific commands.
2. **Smooth install**: One-step setup via shell script and npm CLI.
3. **Proof assets**: Design rationale, demo GIF/video, and realistic app examples.
4. **Reliability**: Self-tests, CI pipeline, and passing badge.
5. **Adoption readiness**: Versioned releases, topics, and contribution hygiene.

## 3) Non-goals

- Building a hosted SaaS product.
- Replacing existing Claude skill workflows.
- Solving enterprise orchestration (parallel workers, remote browser grid) in v1.0.

## 4) User personas

1. **Indie app developer**
   - Needs <10 min setup.
   - Wants fast confidence after UI changes.
2. **Team lead / EM**
   - Needs CI-compatible runner and stable reports.
3. **OSS evaluator**
   - Judges quality by docs + code depth + release signals.

## 5) Product requirements

## R1 — Publish architecture and differentiation

### Why
The concept is strong, but the repo needs explicit comparison with selector-heavy scripted browser testing approaches.

### Requirements
- Add `docs/DESIGN.md` explaining:
  - Why YAML + visible-text targeting + LLM assertions are resilient.
  - Tradeoffs vs CSS/XPath selectors.
  - Failure modes and fallback behavior.
- Include an "Alternatives considered" section (Playwright/Cypress script-first model).

### Acceptance criteria
- `docs/DESIGN.md` exists and covers architecture, tradeoffs, and alternatives.
- README links directly to it.

---

## R2 — Increase documentation conversion quality

### Why
Current docs are strong but missing high-signal assets for first-time trust.

### Requirements
- Add 30–60s workflow demo GIF/video in `docs/`.
- Add badges in README:
  - MIT license
  - Latest release
  - CI status
- Add a "Quick proof" section with exact expected outputs/files after first run.

### Acceptance criteria
- Demo media displayed in README.
- Badges rendered and valid.
- New user can verify install success with 3 deterministic checkpoints.

---

## R3 — Expose real executable depth

### Why
A repo about testing must ship runnable implementation, not only workflow descriptions.

### Requirements
- Add a standalone runner (Node.js preferred):
  - Example path: `packages/runner/` or `bin/avd-runner`.
  - Input: manifest path, tag filter, regressions mode.
  - Output: screenshots + markdown/json report.
- Publish complete `SKILL.md` in the plugin package with clear comments.
- Add at least 4 realistic manifest packs:
  - Next.js app
  - Vue app
  - Authenticated flow
  - File upload + processing flow

### Acceptance criteria
- `npm run runner -- --help` works.
- Runner executes at least one example suite end-to-end.
- Example manifests are documented and runnable.

---

## R4 — Improve installation UX

### Why
"Tell Claude to install" is convenient but fragile as sole installation path.

### Requirements
- Add `install.sh` for skill copy/setup.
- Publish minimal npm package with CLI:
  - `npx agentic-visual-debugger init`
- Automatic integration with `.claude/skills/`.
- Include uninstall and upgrade commands.

### Acceptance criteria
- Fresh machine path:
  1. `npx agentic-visual-debugger init`
  2. Skills installed
  3. first command ready
- Installation documented and versioned.

---

## R5 — Dogfood and test itself

### Why
A testing framework requires internal credibility through self-testing.

### Requirements
- Add `examples/self-test/` manifests targeting review page (`localhost:8888`).
- Include golden screenshots and expected assertions.
- Add a "dogfood" section in README.

### Acceptance criteria
- Self-test suite runs locally and in CI.
- At least one intentional failure fixture demonstrates actionable output.

---

## R6 — CI and release pipeline

### Why
Users need a machine-verifiable trust signal.

### Requirements
- Add GitHub Actions workflow that:
  1. Installs dependencies
  2. Launches fixture app/review page headless
  3. Runs sample manifests
  4. Publishes artifacts on failure
- Add release workflow with changelog automation.
- Add README badge for test status.

### Acceptance criteria
- CI runs on push + PR.
- Badge shows passing/failing status.
- Release notes generated for tags.

---

## R7 — Community readiness checklist

### Why
Community signals impact adoption and contributor confidence.

### Requirements
- Add GitHub topics:
  - `claude-code`, `browser-testing`, `playwright`, `agentic-ai`
- Add release `v1.0.0` with changelog.
- Add contribution templates:
  - bug report
  - feature request
  - PR template

### Acceptance criteria
- Repo metadata visible and consistent.
- First release published with migration/upgrade notes.

## 6) Milestones

### M1 — Foundation (Week 1)
- R1 docs + README links
- R2 badges and quick proof section
- Contribution templates

### M2 — Executable core (Weeks 2–3)
- R3 standalone runner skeleton + core actions
- R4 installer + npm init CLI

### M3 — Trust layer (Week 4)
- R5 self-tests
- R6 CI pipeline + artifacts + badge

### M4 — Launch (Week 5)
- R7 topics + v1.0 release + launch posts

## 7) KPIs (30 days after v1.0)

- Time-to-first-success (fresh repo clone → first passing run): **< 10 minutes**.
- Install success rate from issue telemetry: **> 90%**.
- CI pass rate on default branch: **> 95%**.
- % of PRs with runnable artifacts attached: **100%**.
- Star-to-fork ratio trend positive month-over-month.

## 8) Risks and mitigations

1. **LLM assertion flakiness**
   - Mitigation: severity levels, retry policy, deterministic fallback assertions.
2. **Browser/toolchain fragility in CI**
   - Mitigation: pinned versions, smoke fixtures, artifact retention.
3. **Scope creep before v1.0**
   - Mitigation: strict non-goals and milestone gates.

## 9) Definition of done (v1.0)

Release is considered production-ready only if all are true:
- Standalone runner exists and is documented.
- Install via `npx ... init` works end-to-end.
- Self-tests and CI pass on main.
- README includes demo media + badges + quick proof.
- Design rationale and comparisons are published.
- Tagged release with changelog is public.

## 10) Immediate next tasks (issue-ready)

1. Create `docs/DESIGN.md` (architecture + alternatives).
2. Add README badges and "Quick proof" section.
3. Scaffold `packages/runner` with CLI entrypoint + `--help`.
4. Add `install.sh` and npm `init` command.
5. Add `examples/self-test/` for review page.
6. Add `.github/workflows/ci.yml` with fixture + manifest execution.
7. Cut `v1.0.0-rc.1` and publish changelog.
