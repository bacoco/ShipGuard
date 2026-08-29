# ShipGuard

![ShipGuard — Agentic AI Audit & Visual Regression](hero.jpg)

**Ship with confidence.** ShipGuard finds bugs before your users do.

Six AI-powered modules. Use one, some, or all. No test files to write.

Speak normally. For example: **“Vérifie avec ShipGuard si ce que je viens de modifier est prêt à
livrer.”** ShipGuard proposes the scope and applicable checks, then asks one combined question only
when something is ambiguous. Skill identifiers below are implementation names, not syntax the user
must memorize.

| | 📸 **Visual E2E** | 🎬 **Recorder** | 🔍 **Code Audit** | 🧭 **Logic Audit** | 🧪 **Process Check** | 🧠 **Improve** |
|---|---|---|---|---|---|---|
| **What** | Discover routes and verify screenshots | Record interactions as replayable tests | Find implementation bugs | Check procedures and algorithms against contracts/invariants | Compare behavior before/after the diff | Preserve learnings and scout techniques |
| **Command** | `/sg-visual-run` | `/sg-record` | `/sg-code-audit` | `/sg-logic-audit` | `/sg-process-check` | `/sg-improve` |
| **Output** | Screenshots + annotations | YAML manifests | `audit-results.json` | `logic-results.json` + counterexamples | `process-results.json` | `.shipguard/learnings.yaml` + issues |

One orchestrator ties them together: `sg-ship` runs code audit → applicable logic audit → process
check → visual → review. Logic candidates are detected automatically during the scope conversation.

### All skills (15 canonical + 1 deprecated alias)

| Skill | Purpose |
|-------|---------|
| `/sg-mission-lock` | Lock the literal mission and authority before work; model-aware Codex activation for GPT-5.6 Sol |
| `/sg-beat-reference` | Build a paste-ready comparison loop that improves work until it beats a named, fetchable reference |
| `/sg-gauntlet` | Deprecated compatibility alias for `/sg-beat-reference` |
| `/sg-ship` | Conversational pipeline: propose scope once, then code → applicable logic → process → visual → review |
| `/sg-code-audit` | Audit changed or scoped code; report-only by default, tier-gated fixes by opt-in |
| `/sg-logic-audit` | Check workflows, state machines, retries, transactions, and algorithms against declared contracts and invariants |
| `/sg-process-check` | Simulate before/after process behavior from a diff (observe-not-fix) |
| `/sg-visual-discover` | Scan the codebase and generate YAML visual test manifests per route |
| `/sg-visual-run` | Execute visual test manifests with agent-browser |
| `/sg-visual-review` | Interactive review dashboard — Visual Tests, Code Audit, Logic, Process, and Recorded Tests tabs |
| `/sg-visual-fix` | Trace human annotations on screenshots to source code and fix them |
| `/sg-visual-review-stop` | Stop the review HTTP server |
| `/sg-change-report` | Save before/after UI evidence as durable PR/client change reports |
| `/sg-record` | Record browser interactions as replayable test manifests |
| `/sg-improve` | Capture session learnings and improvement issues, with snapshot/rollback safety |
| `/sg-scout` | Research GitHub for techniques that improve ShipGuard's audits and visual runs |

### Mission lock for GPT-5.6 Sol

On Codex, ShipGuard's read-only hook checks the active model slug at session start, on every user
prompt, for subagents, and after compaction. For `gpt-5.6` or `gpt-5.6-sol` — regardless of reasoning
effort — it injects the requirement to run `/sg-mission-lock` first. Explicit `GPT-5.6 Sol`
or `Sol Ultra` prompts also activate it; ordinary uses of the word “sol” do not.

Codex does not trust newly installed plugin hooks automatically. After installing or updating
ShipGuard, open `/hooks`, review and trust the ShipGuard mission-lock hook, then start a new thread.
Until trusted, the skill remains explicitly callable and implicitly selectable, but automatic
model-aware activation is not guaranteed.

To opt in explicitly for all models in a runtime such as Claude Code, prefix the
hook command with `SHIPGUARD_MISSION_LOCK_ALL_MODELS=1`. The default remains
Sol-only, so existing installations do not receive a new automatic guard
silently.

This guard targets mission drift, inferred authority, and overbroad verification claims. It reduces
those failure modes; no prompt or hook can guarantee that a model never hallucinates.

### Install

```bash
# Claude Code
claude plugin marketplace add bacoco/shipguard
claude plugin install shipguard@shipguard

# Codex
codex plugin marketplace add bacoco/shipguard
codex plugin add shipguard@shipguard

# Browser lanes
npm install -g agent-browser && agent-browser install --with-deps
```

Then open `/hooks` in Codex and trust the ShipGuard mission-lock hook once.

Migrating from an older local Codex adapter or a Claude marketplace install? See [`docs/codex-migration.md`](docs/codex-migration.md).

> ⚠️ **Token Usage** — Code audits are token-intensive. `standard` (10 agents) ≈ 2M tokens. `deep` (15 agents, 2 rounds) ≈ 5M+. `paranoid` (20 agents, 3 rounds) can exceed 10M.

---

## One request — SG-SHIP

Ask in ordinary language. SG-SHIP inspects the change, names the proposed scope and useful checks,
and asks once if the scope or an inferred contract is ambiguous:

> “Vérifie avec ShipGuard ce que je viens de modifier.”
>
> “Contrôle le nouveau cycle de retry avant la PR.”
>
> “Vérifie `src/jobs` sans modifier le code.”

Existing command syntax remains compatible for automation, but it is not required or presented as
the normal interface.

```
static FIND ──► semantic CHECK ──► dynamic SIMULATE ──► visual CONFIRM ──► human DECIDES
sg-code-audit    sg-logic-audit      sg-process-check      sg-visual-run        sg-visual-review
```

It's a **thin sequencer** over the skills below. It performs bounded logic-candidate detection on
every run, traces applicable procedures/algorithms, and records `not-applicable` when none exist.
When the contract is ambiguous, that clarification is folded into the single scope question.

---

## Visual E2E Debugger

Mark bugs directly on screenshots. The AI traces each annotation to source code and fixes it.

![Visual Tests — Screenshot Grid](screenshots/visual-tests.jpg)

```bash
/sg-visual-run I changed the sidebar
```

### Commands

| Command | What it does |
|---------|-------------|
| `/sg-visual-discover` | Scan codebase, generate YAML test manifests per route |
| `/sg-record <url>` | Record browser interactions as replayable test manifests |
| `/sg-visual-run [what]` | Execute manifests — natural language or flags |
| `/sg-visual-review` | Launch interactive screenshot review dashboard |
| `/sg-visual-fix` | Auto-fix bugs annotated in the review dashboard |
| `/sg-change-report` | Save before/after UI evidence as committed PR/client review reports |
| `/sg-visual-review-stop` | Stop the review server |

### Durable Change Reports

After UI-visible work, use `/sg-change-report` to save the before/after evidence with the change. ShipGuard stores the source report and screenshots in:

```text
visual-tests/_results/change-reports/<report-id>/
```

Then `/sg-visual-review` or `node visual-tests/build-review.mjs --serve` generates reviewable HTML in:

```text
visual-tests/_results/persona-reports/<report-id>/
```

Commit those durable report folders with the PR. Do not commit the local interactive workspace `visual-tests/_results/review.html` or `.server.pid`.

### Client Validation Reports

ShipGuard can generate client-validation HTML reports from the same visual evidence. The primary use case is simple: give a client or stakeholder a focused page where they can compare before/after screenshots, choose `Accept / Adjust / Reject`, and export comments as JSON.

![Client Validation Report](screenshots/client-validation-report.png)

Open the standalone example: [`examples/client-validation-report.html`](examples/client-validation-report.html)

The same report can be adapted by recipient persona. Put a `report.json` in:

```text
visual-tests/_results/change-reports/<report-id>/report.json
```

Then run `/sg-visual-review`. The dashboard builder creates:

```text
visual-tests/_results/persona-reports/<report-id>/client.html
visual-tests/_results/persona-reports/<report-id>/product.html
visual-tests/_results/persona-reports/<report-id>/design.html
visual-tests/_results/persona-reports/<report-id>/engineering.html
```

It also writes trace and email artifacts next to the report:

```text
visual-tests/_results/persona-reports/<report-id>/client-invite-email.md
visual-tests/_results/persona-reports/<report-id>/client-response-email.md
visual-tests/_results/persona-reports/<report-id>/proposal-trace.md
visual-tests/_results/persona-reports/<report-id>/proposal-trace.json
```

Use `client-invite-email.md` to send the analysis manually. The client can reply using `client-response-email.md` or export JSON from the HTML report. `proposal-trace.*` keeps the local record of what was proposed, which artifacts were generated, and how the client return is expected.

Each page adapts the same change set to the recipient:

| Audience | What it emphasizes |
|----------|--------------------|
| Client | Plain-language choices, before/after evidence, `Accept / Adjust / Reject` decisions |
| Business | Outcome, priority, residual risk |
| Product | Scope, acceptance criteria, route/test references |
| Design | UX rationale, interaction tradeoffs, visual comparison |
| Engineering | Files, tests, implementation boundaries |

Use this when a client or stakeholder needs to validate UI direction without reading the full technical dashboard. The generated pages are static, served by the same review server, and include local comments plus JSON export.

### Smart Annotations (Gemini-style)

The review dashboard uses **draggable annotation cards** to mark visual bugs on screenshots. Click anywhere on a screenshot to place a pin, then describe the problem.

**How it works:**
1. Open a screenshot in the lightbox
2. **Double-click** anywhere on the image — a pin appears instantly (or click **+ Add Note** first)
3. **Click** = point pin. **Drag** = rectangle zone selection (highlights the problem area)
4. Choose severity + type your note → a card appears connected to the pin
5. **Drag the pin** to reposition — zone, card, and leader line all move together
6. **Drag the card** separately to reposition just the label
7. **Double-click** a card to edit text/severity, click X to delete
8. Click **Validate & Generate Report** when done → produces `fix-manifest.json` with zone coordinates
9. Run `/sg-visual-fix` → AI reads your annotations + zone coords, traces to source code, fixes automatically

**Severity colors:**

| Color | Level | When to use |
|-------|-------|-------------|
| 🔴 Red | **Critical** | Broken layout, missing content, crash |
| 🟠 Orange | **High** | Wrong alignment, color mismatch, bad spacing |
| 🔵 Blue | **Medium** | Minor visual inconsistency, polish needed |
| ⚪ Gray | **Info** | Suggestion, not a bug |

![Smart Annotations — Draggable Cards](screenshots/smart-annotations.jpg)

### sg-visual-run options

```bash
/sg-visual-run                                  # Interactive — choose scope
/sg-visual-run I changed the sidebar, check it  # Natural language
/sg-visual-run --from-audit                     # Test audit-impacted routes
/sg-visual-run --from-logic                     # Test routes flagged by Logic Audit
/sg-visual-run --from-process                   # Test routes flagged by Process Check
/sg-visual-run --regressions                    # Re-run previously failed tests
/sg-visual-run --all                            # Full suite
```

The three `--from-*` bridges read `impacted_ui_routes` (or legacy `impacted_routes`) from `audit-results.json`, `logic-results.json`, and `process-results.json`; multiple sources are unioned.

### Discover options

```bash
/sg-visual-discover                    # Current project
/sg-visual-discover --all              # Full discovery
/sg-visual-discover --refresh-existing # Regenerate existing manifests
```

Supports Next.js (App Router & Pages Router), React Router, Vue, Angular.

---

## Macro Recorder

Record what you do in the browser and turn it into a replayable test. Like Excel's macro recorder, but for visual testing.

![Recorded Tests — Test Library](screenshots/recorded-tests-grid.jpg)

```bash
/sg-record http://localhost:3000/dashboard --name my-test
```

### How it works

1. **Launch** — Opens a Playwright browser with a floating toolbar
2. **Navigate** — Browse your app normally. Clicks, inputs, uploads are captured automatically
3. **Check** — Click the Check button, then click an element to mark it as an assertion
4. **Undo / Delete / Pause** — Fix mistakes without restarting
5. **Stop** — Saves a YAML manifest ready for `/sg-visual-run`

### Test Library

Recorded tests appear as cards in the review dashboard under the **Recorded Tests** tab.

![Recorded Tests — Selected for Run](screenshots/recorded-tests-selected.jpg)

Select the tests you want to run, click **Run** — the command is ready to copy.

![Recorded Tests — Run Command](screenshots/recorded-tests-run.jpg)

### Two ways to create tests

| | `/sg-visual-discover` | `/sg-record` |
|---|---|---|
| **Source** | AI scans your code | Human records interactions |
| **When** | After code changes | After manual QA, bug reproduction, new feature walkthrough |
| **Output** | Same YAML format | Same YAML format |

Both feed into the same pipeline: `sg-visual-run` executes them, `sg-visual-review` shows results, `sg-visual-fix` fixes failures.

### Options

```bash
/sg-record http://localhost:3000                              # Interactive — asks for name on stop
/sg-record http://localhost:3000 --name login-flow            # Preset name
/sg-record http://localhost:3000 --storage auth.json          # Skip login (reuse saved auth)
/sg-record http://localhost:3000 --save-storage auth.json     # Save auth for future recordings
```

---

## Code Audit

Dispatch parallel AI agents to audit your codebase. Each agent reviews a non-overlapping zone,
classifies findings by fix-safety tier, and produces structured JSON. The default is report-only;
source changes require explicit `--fix`. Watch progress in real-time on the Mission Control dashboard.

```bash
/sg-code-audit deep
```

### Modes

| Mode | Agents | Rounds | Coverage |
|------|--------|--------|----------|
| quick | 5 | 1 | Surface scan |
| standard | 10 | 1 | Full codebase (default) |
| deep | 15 | 2 | Surface + runtime behavior |
| paranoid | 20 | 3 | Surface + runtime + edge cases & security |

### Multi-round depth

- **R1** — Null refs, missing guards, type mismatches
- **R2** — Race conditions, async pitfalls, state management
- **R3** — Edge cases, injection, auth bypass, data leaks

### Smart Scope

By default, ShipGuard detects what changed and asks whether to limit the audit:

```
/sg-code-audit       # "12 files changed since main. Audit only what changed?"
```

Override with flags:

| Flag | Effect |
|------|--------|
| `--all` | Force full scope, skip the question |
| `--diff=<ref>` | Use a specific base reference |
| `--focus=path/` | Restrict to a directory |
| `--report-only` | Explicitly select the default: report findings without source changes |
| `--fix` | Opt in to safe fixes: mechanical, or test-first with failing-before/passing-after proof |

Flags combine freely except `--fix` and `--report-only`, which are mutually exclusive:
`/sg-code-audit deep --focus=src/ --fix`

### Live Dashboard

At startup, the audit offers to open the Mission Control dashboard. The **Code Audit** tab shows real-time agent pods (running/done/pending), severity heatmap, bug table filterable by severity and free-text search. Polls every 3s during active audit.

![Code Audit — Bugs filtered by Critical](screenshots/code-audit-dark.jpg)

Before aggregation, claims that a test, guard, caller, endpoint, or shell exit check is absent must
carry a complete search record. ShipGuard applies this evidence gate at every severity; unsupported
absence claims move to the audit trail instead of the headline report. This is targeted evidence
validation, not a promise of formal coverage analysis.

### Output

Results are written to `visual-tests/_results/audit-results.json` (the directory is created if
missing; legacy `.code-audit-results/` is read as a fallback). In-flight artifacts are isolated by
`run_id` under `visual-tests/_results/runs/` and never aggregated by a broad glob:

- `run_id` + `base_sha` — immutable run identity
- `summary` — totals by severity, category, and fix-safety tier
- `bugs[]` — file, line, severity, description, fix tier/evidence, and fix status
- `unverified_bugs[]` — unsupported absence claims and rejected critical/high findings
- `impacted_ui_routes[]` — UI routes affected (consumed by `/sg-visual-run --from-audit`)
- `impacted_backend[]` — API endpoints/services affected (reported in dashboard)

### Supported languages

Python, TypeScript/React, Next.js, Shell, Infrastructure (Docker/YAML/CI), Go, Rust, JVM.

---

## Logic Audit

`sg-logic-audit` checks absolute correctness against **declared contracts and invariants**. It is
for workflows, state machines, retries, transactions, authorization paths, and non-trivial
algorithms where each function can look reasonable while the end-to-end property is still wrong.

```bash
/sg-logic-audit --diff=main
/sg-logic-audit --procedure="job retry lifecycle"
/sg-logic-audit --algorithm=chunk_document --mode=hybrid
```

It extracts obligations and their provenance before judging the implementation, models states and
effects across files, then searches for the smallest counterexample. Findings distinguish
`confirmed`, `risk`, `contract-conflict`, `question`, and `uncovered`; evidence is always labeled
`reasoned` or `measured`. It never presents bounded analysis as formal proof.

The lane is report-only and writes:

```text
visual-tests/_results/logic-results.json
visual-tests/_results/logic-report.md
```

SG-SHIP places it automatically between Code Audit and Process Check when the selected change
contains a relevant procedure or algorithm. Logic Audit uses the contract as its oracle; Process
Check still uses the previous version as its before/after reference. A clean delta therefore does
not replace a logic audit, and a clean logic audit does not claim every path was proven.

---

## Process Check

The backend twin of the Visual E2E Debugger. Code Audit *reads* your code; the Visual Debugger drives the *browser*. `sg-process-check` **simulates the running process** — by default it **runs the code "in its head"**: it traces the units your diff touched through the old and new code by reasoning, and reports how the observable behavior moved. No browser, no stack to boot (so it works on a 5-container app). Observe-not-fix — you decide what's intended.

```bash
/sg-process-check I changed the RAPTOR chunking
```

### What it does

1. Looks at your **diff** (working tree, `--diff=<ref>`, or `--from-audit`) — scoped to the module you're working on, not the whole repo.
2. Maps changed files to **units** (API endpoints, functions, pipeline stages).
3. Traces each on a few seeded inputs, **through the old code and the new code**, and diffs the behavior: output, exceptions, timing, LLM token cost.
4. Writes `process-results.json` + `process-report.md` and surfaces a before/after table in `/sg-visual-review` (Process tab).

The oracle is **before/after** — the previous version is the reference, so there's nothing to spec. It's the behavior-level equivalent of the before/after screenshots `sg-visual-fix` produces.

### Modes — a fidelity spectrum

| Mode | What | Infra |
|------|------|-------|
| **`reason`** *(default)* | Simulates by **reasoning** (runs the code in its head). All findings tagged `reasoned`. | none |
| **`hybrid`** | Reasons about the whole, **really runs the cheap parts** (a pure function, an endpoint already up) to anchor. | minimal |
| **`execute`** | Literal before/after via a pinned baseline worktree. All `measured`. | full (opt-in) |

> **Reasoned ≠ measured.** A simulated trace is a *prediction*, not a measurement. Every finding is tagged `reasoned` (with confidence + assumptions) or `measured`. If a real run contradicts the prediction, the measurement wins and the unit is flagged a **surprise** — high signal for you. `hybrid`/`execute` auto-degrade to `reason` for anything not cheap to run; they never boot a multi-container stack unless you ask and it's feasible.

### Options

```bash
/sg-process-check                          # Interactive — detect the diff, confirm scope, reason
/sg-process-check I touched the embedder   # Natural language
/sg-process-check --mode=hybrid            # Reason + really run the cheap parts to anchor
/sg-process-check --mode=execute           # Force literal before/after execution
/sg-process-check --diff=main              # Everything changed since main
/sg-process-check --from-audit             # Simulate impacted_backend[] from audit-results.json
/sg-process-check --samples=5              # Inputs per unit (default 3 — sampling, not fuzzing)
/sg-process-check --depth=deep             # Trace deeper call chains / more edge inputs
```

### Bridges

| Bridge | Effect |
|--------|--------|
| `--from-audit` | Dynamically confirm the endpoints a static audit flagged (`impacted_backend[]`) |
| `impacted_ui_routes[]` → `sg-visual-run --from-process` | Confirm the *visual* effect of a behavior change |
| `process-results.json` → `sg-visual-review` | Before/after behavior shown next to screenshots and audit findings |

Static find → dynamic process check → visual confirm → human decides.

---

## Self-Improving Engine

### `/sg-improve` — learn from sessions

After an audit or visual session, `/sg-improve` extracts what worked and what didn't into `.shipguard/learnings.yaml` and `mistakes.md` (zone hints, bug patterns, noise filters), and can file generic improvements as GitHub issues. Every run snapshots state first, so it is always reversible.

```bash
/sg-improve                  # Full loop — local learnings + GitHub issue
/sg-improve --history        # List all snapshots
/sg-improve --rollback[=#N]  # Undo the last (or a specific) run
/sg-improve --keep-all       # Never prune old snapshots (default keeps last 5)
```

### `/sg-scout` — learn from the ecosystem

Scans GitHub for techniques that could make ShipGuard better, scoring each on impact, novelty, applicability, and effort. High-scoring ideas become GitHub issues; all findings accumulate in `docs/scout-reports/techniques-library.md`.

```bash
/sg-scout                                # Full ecosystem scan
/sg-scout https://github.com/owner/repo  # Deep-dive on one repo
/sg-scout --topic=self-improving         # Focus on one topic
```

---

## Compatibility

Built for **Claude Code**. Partial support for other AI CLIs:

| Feature | Claude Code | Codex CLI / Gemini CLI |
|---------|------------|----------------------|
| Code Audit (parallel) | ✅ Full | ❌ Requires Agent tool |
| Process Check (dynamic) | ✅ Full | ✅ Bash + git worktree + LLM prompts |
| Visual E2E Debugger | ✅ Full | ✅ agent-browser is CLI-independent |
| Macro Recorder | ✅ Full | ✅ Playwright is CLI-independent |
| Review Dashboard | ✅ Full | ✅ Pure Node.js |
| Visual Discover/Fix | ✅ Full | ✅ Bash + LLM prompts |
| Self-Improving Engine | ✅ Full | ✅ gh CLI is universal |
| Mission Lock | ✅ Explicit skill | ✅ Codex hook after `/hooks` trust; explicit skill elsewhere |

The visual testing pipeline works with any AI CLI that can run shell commands and read/write files. Code audit parallelization requires Claude Code's `Agent` tool with worktree isolation.

Community adapters welcome.

---

## Quick Start

```bash
# Install
claude plugin marketplace add bacoco/shipguard
claude plugin install shipguard@shipguard
npm install -g agent-browser && agent-browser install --with-deps

# Everything at once, scoped to your diff
/sg-ship

# …or run a single lane:
/sg-code-audit                          # static audit
/sg-process-check I changed the chunking # dynamic behavior
/sg-record http://localhost:3000         # record a test
/sg-visual-run                           # run visual tests
```

## CLI quickstart — static site recette (2.5.0+)

The deterministic layer is also a standalone CLI — same recette for a human, CI, or any agent, no model required:

```bash
cp "$SHIPGUARD_PLUGIN_ROOT/cli/shipguard.mjs" visual-tests/   # once
node visual-tests/shipguard.mjs init                          # config v2 + .gitignore guard-rails
# declare in visual-tests/_config.yaml:
#   app:      root: docs, start: "python3 -m http.server {port} --bind 127.0.0.1", healthcheck: "/index.html"
#   profiles: site-accessible: { scope: "site-accessible", checks: [page-load, local-assets, browser-errors, screenshots] }
node visual-tests/shipguard.mjs run --profile=site-accessible --serve
# exit 0 = clean, 1 = findings (see the review dashboard's Findings tab), 2 = infra error, 3 = config error
node visual-tests/shipguard.mjs stop --all
```

LLM assertions (`llm-check`/`llm-wait`) are never faked by the CLI — they are declared as a `needs-agent` lane in `run.json`; run `/sg-visual-run` to complete them.

> **Trust boundary:** `shipguard serve`/`run` execute the config's `app.start` command through a shell with your local privileges — the same trust level as running the project's npm scripts. Only use them on a `_config.yaml` you trust.

## Configuration

Create `visual-tests/_config.yaml`:

```yaml
version: 2
base_url: "http://localhost:3000"
credentials:
  username: "testuser"
  password: "testpass"
build_command: "docker compose up -d --build frontend"  # optional
# app:        # optional — lets `shipguard serve/run` own the app lifecycle
#   start: "python3 -m http.server {port} --bind 127.0.0.1"
#   healthcheck: "/index.html"
# profiles:   # optional — named recette scopes for `shipguard run --profile=…`
#   smoke: { scope: all, checks: [page-load, local-assets, browser-errors, screenshots] }
```

## License

MIT
