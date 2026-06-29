---
name: sg-ship
description: "Run the full diff-scoped ShipGuard pipeline: code audit, process check, visual run, and unified review."
context: conversation
argument-hint: "[quick|standard|deep] [--all] [--diff=ref] [--no-visual] [--report-only] [--mode=reason|hybrid|execute]"
---

# /sg-ship — Run the whole ShipGuard pipeline, one command

`sg-ship` is the orchestrator: it runs ShipGuard's three discovery lanes in order and opens a single review for you to decide.

```
static FIND ──► dynamic SIMULATE ──► visual CONFIRM ──► human DECIDES
sg-code-audit    sg-process-check      sg-visual-run        sg-visual-review
```

It is a **thin sequencer** — it invokes the existing skills through the bridges they already expose (`--from-audit`, `--from-process`) and **adds no new analysis logic**. Each lane governs its own behavior; `sg-ship` only resolves the scope once, threads it through every lane so they all look at the **same diff**, and consolidates the result. **Diff-scoped by default** (the module you're working on), not the whole repo.

> **Recommended model: Sonnet 4.6** to drive the orchestration; each sub-skill picks its own model (e.g. `sg-process-check` leans on Opus for `reason`). 

> ⚠️ **Token cost.** This runs three lanes. The audit alone is token-heavy (`standard` ≈ 2M). Default diff-scope keeps it sane; `--all` on a large repo is expensive. See each sub-skill's own budget notes.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-ship` | **Diff-scoped full pipeline** — audit + process-check + visual + review on what changed |
| `/sg-ship deep` | Pass audit depth (`quick`/`standard`/`deep`) to `sg-code-audit` |
| `/sg-ship --all` | Full-repo scope (skips the "audit only changes?" question) |
| `/sg-ship --diff=main` | Scope to everything changed since `main` |
| `/sg-ship --no-visual` | Skip the browser lane (headless project, no UI, or agent-browser absent) |
| `/sg-ship --report-only` | No fixes anywhere — pure find/observe, human decides |
| `/sg-ship --mode=hybrid` | Pass the process-check mode through (default `reason`) |

Flags combine: `/sg-ship deep --diff=main --report-only`.

---

## Phase 0 — Scope & plan (once)

1. **Resolve the diff once.** Working tree + staged, or `--diff=<ref>`, or `--all` for full scope. This single scope is threaded into every lane so they agree on what changed.
2. **Detect applicable lanes.** Backend code present? UI/routes present? `agent-browser --version` available? `visual-tests/_config.yaml` present? A lane with nothing to do is skipped and logged.
3. **Print the plan** (which lanes will run, on what scope) and confirm if the scope is large. Then proceed.

---

## Phase 1 — Code audit (static find)

Run **`/sg-code-audit`** with the resolved scope, passing through `quick|standard|deep`, `--diff`/`--all`/`--focus`, and `--report-only`. This produces `audit-results.json` with `impacted_backend[]` and `impacted_ui_routes[]` — the lists the next lanes consume.

If the audit finds nothing impacted, note it and still run the diff-scoped process-check (a clean audit doesn't mean the behavior didn't change).

---

## Phase 2 — Process check (dynamic behavior)

Run **`/sg-process-check --from-audit`** (passing `--mode`, default `reason`). It reads `impacted_backend[]`, simulates the behavioral delta of the changed units (reasoning by default, no infra), and writes `process-results.json` — including any `impacted_ui_routes[]` and `surprise` flags. Findings stay tagged **reasoned vs measured**.

---

## Phase 3 — Visual confirm (browser)

Unless `--no-visual`, no UI was detected, or agent-browser is unavailable: run **`/sg-visual-run --from-audit --from-process`** to confirm the impacted routes in the browser. If the lane is skipped, **say why** (no UI / no agent-browser / `--no-visual`) — never imply visual coverage that didn't run.

---

## Phase 4 — Unified review

Run **`/sg-visual-review`** to build the single dashboard. The three signals land side by side: **Code Audit** (static), **Process** (behavior delta), **Visual Tests** (browser). The human annotates and decides; `/sg-visual-fix` handles anything they choose to fix.

---

## Phase 5 — Consolidated summary

Print one summary across all three lanes:
- **Static:** bugs by severity (from `audit-results.json`)
- **Behavior:** units changed / new errors / surprises, reasoned-vs-measured mix (from `process-results.json`)
- **Visual:** pass/fail on impacted routes (or "skipped — reason")
- The dashboard URL, and the single most important thing for the human to look at first.

`sg-ship` itself **never fixes and never decides** — it sequences the find/simulate/confirm lanes and hands the human one place to judge.

---

## Graceful degradation (no usine à gaz)

- **No backend / no API** → process-check still runs in `reason` on the diff'd functions; its API seam is simply not used.
- **No UI / no agent-browser / `--no-visual`** → skip Phase 3, log the reason, continue.
- **`--report-only`** → propagated to every lane; nothing is modified.
- **Clean audit** → still run process-check on the diff; a no-bug audit is not a no-change diff.
- Any lane that errors is reported and the pipeline continues with the others (partial results beat no results).

---

## Final checklist

- [ ] Scope resolved once; plan printed; large scope confirmed
- [ ] `sg-code-audit` run with passthrough flags → `audit-results.json`
- [ ] `sg-process-check --from-audit` run (mode passthrough) → `process-results.json`
- [ ] `sg-visual-run --from-audit --from-process` run, or skipped **with a stated reason**
- [ ] `sg-visual-review` built — one dashboard, three tabs
- [ ] Consolidated cross-lane summary printed; no fixes/decisions made by sg-ship itself
