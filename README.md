# ShipGuard

![ShipGuard — Agentic AI Audit & Visual Regression](docs/screenshots/hero-banner.jpg)

**Ship with confidence.** ShipGuard finds bugs before your users do.

Three AI-powered modules. Use one, two, or all three. No test files to write.

<table>
<tr>
<td width="33%" valign="top">

### 📸 Visual E2E Debugger

Auto-discover routes, generate tests, mark bugs on screenshots — **AI traces to source code and fixes automatically**.

```
/sg-visual-run
```

</td>
<td width="33%" valign="top">

### 🎬 Macro Recorder

Record your browser interactions and **turn them into replayable tests**. Like Excel's macro recorder, but for visual testing.

```
/sg-record http://localhost:3000
```

</td>
<td width="33%" valign="top">

### 🔍 Code Audit

Parallel AI agents scan your entire codebase, find bugs, and **fix them automatically**. Race conditions, auth gaps, silent exceptions, resource leaks.

```
/sg-code-audit
```

</td>
</tr>
</table>

### Install

```bash
claude plugin add bacoco/shipguard
npm install -g agent-browser && agent-browser install --with-deps
```

![Smart Annotations](docs/screenshots/smart-annotations.jpg) ![Code Audit Dashboard](docs/screenshots/code-audit-dark.jpg)

### 🧠 Self-Improving — ShipGuard learns from every run

After each session, run `/sg-improve` to extract what worked and what didn't. ShipGuard remembers:

- **Zone sizing** — directories that overflow get smaller zones next time
- **Bug patterns** — codebase-specific patterns get added to the checklist
- **Noise filters** — low-value findings get batched automatically
- **Infra timing** — how long services take to rebuild, which ports to use

Generic improvements are filed as GitHub issues so the whole community benefits. Project-specific learnings stay local in `.shipguard/learnings.yaml`.

```
Audit 1: hooks/ overflows at 172 files → sg-improve saves max_files: 80
Audit 2: sg-code-audit reads the hint → splits into 2 zones → no overflow ✓
```

> ⚠️ **Token Usage** — Code audits are token-intensive. `standard` (10 agents) ≈ 2M tokens. `deep` (15 agents, 2 rounds) ≈ 5M+. `paranoid` (20 agents, 3 rounds) can exceed 10M.

---

## Visual E2E Debugger

Mark bugs directly on screenshots. The AI traces each annotation to source code and fixes it.

![Visual Tests — Screenshot Grid](docs/screenshots/visual-tests.jpg)

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
| `/sg-visual-review-stop` | Stop the review server |

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

![Smart Annotations — Draggable Cards](docs/screenshots/smart-annotations.jpg)

### sg-visual-run options

```bash
/sg-visual-run                                  # Interactive — choose scope
/sg-visual-run I changed the sidebar, check it  # Natural language
/sg-visual-run --from-audit                     # Test audit-impacted routes
/sg-visual-run --regressions                    # Re-run previously failed tests
/sg-visual-run --all                            # Full suite
```

`--from-audit` reads `impacted_routes` from `audit-results.json` — a natural bridge between the two features.

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

![Recorded Tests — Test Library](docs/screenshots/recorded-tests-grid.jpg)

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

![Recorded Tests — Selected for Run](docs/screenshots/recorded-tests-selected.jpg)

Select the tests you want to run, click **Run** — the command is ready to copy.

![Recorded Tests — Run Command](docs/screenshots/recorded-tests-run.jpg)

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

![Code Audit — Bugs filtered by Critical](docs/screenshots/code-audit-dark.jpg)

### Output

Results are written to `audit-results.json`:

- `summary` — totals by severity and category
- `bugs[]` — file, line, severity, description, fix status
- `impacted_routes[]` — UI routes affected (consumed by `/sg-visual-run --from-audit`)

### Supported languages

Python, TypeScript/React, Next.js, Infrastructure (Docker/YAML/CI), Go, Rust, JVM.

---

## Self-Improving Feedback Loop

Every session teaches ShipGuard something. `/sg-improve` captures those lessons automatically.

```bash
/sg-improve              # Full loop — local learnings + GitHub issue
/sg-improve --local-only # Save learnings locally, skip GitHub
/sg-improve --dry-run    # Preview what would be saved
```

### How it works

1. **Reads structured data** — `audit-results.json`, zone JSONs, git log, regressions
2. **Extracts signals** — context overflows, retry counts, merge failures, noise patterns, high-value finds
3. **Classifies** — project-specific (saves locally) vs generic (files GitHub issue)
4. **Saves locally** — `.shipguard/learnings.yaml` with zone hints, audit patterns, noise filters
5. **Files upstream** — GitHub issue on `bacoco/ShipGuard` with deduplication (comments on existing issues instead of creating duplicates)

### What gets learned

| Learning type | Example | Used by |
|---------------|---------|---------|
| Zone sizing | "hooks/ needs max 80 files per zone" | `sg-code-audit` zone discovery |
| Bug patterns | ".first() without None guard → critical" | Agent checklist injection |
| Noise filters | "f-string loggers → batch into single entry" | Agent prompt |
| Infra timing | "api-synthesia needs 4 min to start" | Post-audit rebuild wait |
| Success patterns | "worktree isolation works — don't change" | What NOT to touch |

### The reinforcement loop

```
Run 1 → learns → Run 2 is smarter → learns more → Run 3 is even smarter
```

No ML model, no fine-tuning — just structured memory and adaptive prompts. Each audit on your project accumulates knowledge in `.shipguard/learnings.yaml`. The next `/sg-code-audit` reads it and adjusts zone sizes, patterns, and noise thresholds automatically.

Generic insights flow upstream via GitHub issues. When multiple users report the same friction, it becomes a ShipGuard improvement that benefits everyone.

---

## Compatibility

Built for **Claude Code**. Partial support for other AI CLIs:

| Feature | Claude Code | Codex CLI / Gemini CLI |
|---------|------------|----------------------|
| Code Audit (parallel) | ✅ Full | ❌ Requires Agent tool |
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

# Audit your code
/sg-code-audit

# Record a test manually
/sg-record http://localhost:3000

# Run all tests
/sg-visual-run
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
