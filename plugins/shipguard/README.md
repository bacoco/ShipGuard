# ShipGuard

![ShipGuard — Agentic AI Audit & Visual Regression](hero.jpg)

**Ship with confidence.** ShipGuard finds bugs before your users do.

Five AI-powered modules. Use one, some, or all. No test files to write.

| | 📸 **Visual E2E Debugger** | 🎬 **Macro Recorder** | 🔍 **Code Audit** | 🧪 **Process Check** |
|---|---|---|---|---|
| **What** | Auto-discover routes, generate tests, mark bugs on screenshots — AI fixes the code | Record your browser interactions and turn them into replayable tests | Parallel AI agents scan your codebase, find bugs, fix them | Simulate the process your diff touched (runs the code "in its head") before/after, report how the behavior moved |
| **Command** | `/sg-visual-run` | `/sg-record` | `/sg-code-audit` | `/sg-process-check` |
| **Output** | Screenshots + annotation cards + auto-fix | YAML test manifests + test library cards | Bug report + auto-fixes + Mission Control dashboard | Before/after behavior report + `process-results.json` |

### Install

```bash
# Claude Code
claude plugin add bacoco/shipguard

# Codex
codex plugin marketplace add bacoco/shipguard
codex plugin add shipguard@shipguard

# Browser lanes
npm install -g agent-browser && agent-browser install --with-deps
```

Migrating from an older local Codex adapter or a Claude marketplace install? See [`docs/codex-migration.md`](docs/codex-migration.md).

> ⚠️ **Token Usage** — Code audits are token-intensive. `standard` (10 agents) ≈ 2M tokens. `deep` (15 agents, 2 rounds) ≈ 5M+. `paranoid` (20 agents, 3 rounds) can exceed 10M.

---

## One command — `/sg-ship`

Don't want to run the lanes by hand? `/sg-ship` runs the whole pipeline on your diff and opens one review:

```bash
/sg-ship                 # audit + process-check + visual + review, scoped to what changed
/sg-ship deep --all      # full-repo, deeper audit
/sg-ship --no-visual     # headless project / no UI
/sg-ship --report-only   # find & observe, fix nothing
```

```
static FIND ──► dynamic SIMULATE ──► visual CONFIRM ──► human DECIDES
sg-code-audit    sg-process-check      sg-visual-run        sg-visual-review
```

It's a **thin sequencer** over the skills below — same scope threaded through every lane, connected by the `--from-audit` / `--from-process` bridges, no new analysis. Skips any lane that doesn't apply (no UI → no browser pass) and says so. You can still run each skill individually.

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
/sg-visual-run --regressions                    # Re-run previously failed tests
/sg-visual-run --all                            # Full suite
```

`--from-audit` reads `impacted_ui_routes` (or legacy `impacted_routes`) from `audit-results.json` — a natural bridge between the two features.

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

Dispatch parallel AI agents to audit your entire codebase. Each agent reviews a non-overlapping zone, finds bugs, fixes them, and produces structured JSON. Watch progress in real-time on the Mission Control dashboard.

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
| `--report-only` | Find bugs but do not fix them |

Flags combine freely: `/sg-code-audit deep --focus=src/ --report-only`

### Live Dashboard

At startup, the audit offers to open the Mission Control dashboard. The **Code Audit** tab shows real-time agent pods (running/done/pending), severity heatmap, bug table filterable by severity and free-text search. Polls every 3s during active audit.

![Code Audit — Bugs filtered by Critical](screenshots/code-audit-dark.jpg)

### Output

Results are written to `audit-results.json`:

- `summary` — totals by severity and category
- `bugs[]` — file, line, severity, description, fix status
- `impacted_ui_routes[]` — UI routes affected (consumed by `/sg-visual-run --from-audit`)
- `impacted_backend[]` — API endpoints/services affected (reported in dashboard)

### Supported languages

Python, TypeScript/React, Next.js, Infrastructure (Docker/YAML/CI), Go, Rust, JVM.

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

The visual testing pipeline works with any AI CLI that can run shell commands and read/write files. Code audit parallelization requires Claude Code's `Agent` tool with worktree isolation.

Community adapters welcome.

---

## Quick Start

```bash
# Install
claude plugin add bacoco/shipguard
npm install -g agent-browser && agent-browser install --with-deps

# Everything at once, scoped to your diff
/sg-ship

# …or run a single lane:
/sg-code-audit                          # static audit
/sg-process-check I changed the chunking # dynamic behavior
/sg-record http://localhost:3000         # record a test
/sg-visual-run                           # run visual tests
```

## Configuration

Create `visual-tests/_config.yaml`:

```yaml
base_url: "http://localhost:3000"
credentials:
  username: "testuser"
  password: "testpass"
build_command: "docker compose up -d --build frontend"  # optional
```

## License

MIT
