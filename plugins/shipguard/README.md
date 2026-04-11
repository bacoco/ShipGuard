# ShipGuard

![ShipGuard — Agentic AI Audit & Visual Regression](hero.jpg)

**AI-powered code audit + visual testing for Claude Code.**

Two independent superpowers. Use one or both.

> ⚠️ **Token Usage**
> Code audits are token-intensive. A `standard` audit (10 agents) on a medium codebase uses ~2M tokens. `deep` (15 agents, 2 rounds) can use 5M+. `paranoid` (20 agents, 3 rounds) can exceed 10M tokens. Monitor your usage.

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

![Code Audit — Dark Mode](screenshots/code-audit-dark.jpg)

![Bugs filtered by Critical](screenshots/bugs-critical.jpg)

### Output

Results are written to `audit-results.json`:

- `summary` — totals by severity and category
- `bugs[]` — file, line, severity, description, fix status
- `impacted_routes[]` — UI routes affected (consumed by `/sg-visual-run --from-audit`)

### Supported languages

Python, TypeScript/React, Next.js, Infrastructure (Docker/YAML/CI), Go, Rust, JVM.

---

## Visual Testing

Agent-browser E2E testing with LLM-powered assertions. Discover routes, generate tests, run them, review screenshots, annotate problems, auto-fix.

![Visual Tests — Screenshot Grid](screenshots/visual-tests.jpg)

```bash
/sg-visual-run I changed the sidebar
```

### Commands

| Command | What it does |
|---------|-------------|
| `/sg-visual-discover` | Scan codebase, generate YAML test manifests per route |
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

![Smart Annotations — Draggable Cards](screenshots/smart-annotations.jpg)

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

## Compatibility

Built for **Claude Code**. Partial support for other AI CLIs:

| Feature | Claude Code | Codex CLI / Gemini CLI |
|---------|------------|----------------------|
| Code Audit (parallel) | ✅ Full | ❌ Requires Agent tool |
| Visual Testing | ✅ Full | ✅ agent-browser is CLI-independent |
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

# Test your UI
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
