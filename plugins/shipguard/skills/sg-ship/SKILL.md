---
name: sg-ship
description: "Use when a change is ready to ship — before a PR or release — and the user wants the full ShipGuard verification (audit, behavior, visual, review) run on it."
context: conversation
argument-hint: "[quick|standard|deep|paranoid] [--all] [--diff=ref] [--focus=path] [--no-visual] [--report-only|--fix] [--mode=reason|hybrid|execute]"
---

# /sg-ship — Run the whole ShipGuard pipeline, one command

`sg-ship` is the orchestrator: it runs ShipGuard's three discovery lanes in order and opens a single review for you to decide.

```
static FIND ──► dynamic SIMULATE ──► visual CONFIRM ──► human DECIDES
sg-code-audit    sg-process-check      sg-visual-run        sg-visual-review
```

It is a **thin sequencer** — it invokes the existing skills through the bridges they already expose (`--from-audit`, `--from-process`) and **adds no new analysis logic**. Each lane governs its own behavior; `sg-ship` only resolves the scope once, threads it through every lane so they all look at the **same diff**, and consolidates the result. **Diff-scoped by default** (the module you're working on), not the whole repo.

> **Model guidance:** a fast, capable general-purpose model is enough to drive the orchestration; each sub-skill picks its own model (e.g. `sg-process-check` leans on the strongest available reasoning model for `reason` mode).

> ⚠️ **Token cost.** This runs three lanes. The audit alone is token-heavy (`standard` ≈ 2M). Default diff-scope keeps it sane; `--all` on a large repo is expensive. See each sub-skill's own budget notes.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-ship` | **Diff-scoped full pipeline** — audit + process-check + visual + review on what changed |
| `/sg-ship deep` | Pass audit depth (`quick`/`standard`/`deep`/`paranoid`) to `sg-code-audit` |
| `/sg-ship --all` | Full-repo scope (skips the "audit only changes?" question) |
| `/sg-ship --diff=main` | Scope to everything changed since `main` |
| `/sg-ship --focus=src/api` | Narrow the audit lane to a path (passed through to `sg-code-audit`) |
| `/sg-ship --no-visual` | Skip the browser lane (headless project, no UI, or agent-browser absent) |
| `/sg-ship --report-only` | States the default explicitly: no fixes anywhere — pure find/observe, human decides |
| `/sg-ship --fix` | Opt the **audit lane** into fix-mode (the only lane that may modify sources — see Phase 1) |
| `/sg-ship --mode=hybrid` | Pass the process-check mode through (default `reason`) |

Flags combine: `/sg-ship deep --diff=main --fix`.

---

## Phase 0 — Scope & plan (once)

1. **Resolve the diff once.** Default scope = committed changes vs the merge-base of the upstream branch:
   - `base = git merge-base HEAD @{upstream}` (fall back to the repo's default branch if no upstream is set); `--diff=<ref>` overrides the base; `--all` means full-repo scope.
   - Scope = `git diff {base}...HEAD` (three-dot). **The diff scope covers committed changes only.**
   - If `git status --porcelain` shows uncommitted or staged work, warn explicitly: *"uncommitted changes are not visible to the pipeline — commit or stash them first"*, then ask **once** whether to continue on the committed state.
   - The resolved ref is passed as an explicit `--diff={ref}` to every lane. Passing `--diff` also suppresses each sub-skill's own interactive scope question — the lanes never re-ask.
2. **Detect applicable lanes.** Backend code present? UI/routes present? `agent-browser --version` available? `visual-tests/_config.yaml` present? A lane with nothing to do is skipped and logged.
   If the visual lane is applicable but `{base_url}` is down and `_config.yaml` declares `app.start`, start the app once for the whole pipeline: `node visual-tests/shipguard.mjs serve` (copy the CLI from `$SHIPGUARD_PLUGIN_ROOT/cli/shipguard.mjs` if missing). Stop it after Phase 5 with `node visual-tests/shipguard.mjs stop` — only if the CLI started it.

2bis. **Write the lane manifest.** Create `visual-tests/_results/run.json` now and update it after every phase, so skipped work is *declared*, never silent:

```json
{
  "schema_version": "1.0",
  "run_id": "run-<timestamp>",
  "timestamp": "<iso>",
  "scope": {"type": "diff", "value": "<ref>"},
  "lanes": {
    "audit":   {"status": "ran", "results": "audit-results.json"},
    "process": {"status": "ran", "results": "process-results.json"},
    "visual":  {"status": "skipped", "reason": "no agent-browser"},
    "crawl":   {"status": "not-applicable", "reason": "crawl is a CLI recette lane (shipguard run) — not part of the diff pipeline"}
  }
}
```

Lane statuses: `ran` | `skipped` | `not-applicable` | `error` | `needs-agent` — every non-`ran` status MUST carry a `reason`. The dashboard renders these as lane chips and shows the declared reason in place of generic empty states.
3. **Freshness check (audit reuse).** The audit is the most expensive lane. If `visual-tests/_results/audit-results.json` already exists and is **newer than the last commit touching the scoped files**, offer to reuse it instead of re-running Phase 1. Never reuse silently — say what is being reused and why it is still fresh.
4. **Print the plan** (which lanes will run, on what scope) and confirm if the scope is large. Then proceed.

---

## Phase 1 — Code audit (static find)

Run, literally:

```
/sg-code-audit {depth} --diff={ref} --report-only [--focus={path}]
```

where `{depth}` is `quick|standard|deep|paranoid` (default `standard`) and `{ref}` is the base resolved in Phase 0. The audit lane runs with **`--report-only` by default** — `sg-ship` never lets it mutate sources unless asked.

**`--fix` path (opt-in):** when `sg-ship` was invoked with `--fix`, drop `--report-only` and let the audit apply its fixes:

```
/sg-code-audit {depth} --diff={ref} [--focus={path}]
```

The tree **mutates during Phase 1** in this case, so after the audit lane finishes, **re-resolve the scope** before Phase 2 (the audit's fixes are now part of the tree) and label the audit-fix delta **separately** in the Phase 5 summary — never blend the audit's edits into the user's own change.

This produces `visual-tests/_results/audit-results.json` with `impacted_backend[]` (`{endpoint, reason, severity}` objects) and `impacted_ui_routes[]` (`{route, reason, severity, bug_count}` objects) — the lists the next lanes consume.

If the audit finds nothing impacted, note it and still run the diff-scoped process-check (a clean audit doesn't mean the behavior didn't change).

---

## Phase 2 — Process check (dynamic behavior)

Run, literally:

```
/sg-process-check --from-audit --diff={ref} [--mode=reason|hybrid|execute]
```

(mode passthrough, default `reason`). It reads `impacted_backend[]`, simulates the behavioral delta of the changed units (reasoning by default, no infra), and writes `visual-tests/_results/process-results.json` — including any `impacted_ui_routes[]` and `surprise` flags. Findings stay tagged **reasoned vs measured**.

---

## Phase 3 — Visual confirm (browser)

Unless `--no-visual`, no UI was detected, or agent-browser is unavailable — run, literally:

```
/sg-visual-run --from-audit --from-process
```

sg-visual-run **unions both route lists** (dedupes by route, highest severity wins, ordered severity-first) and confirms the impacted routes in the browser. If the lane is skipped, **say why** (no UI / no agent-browser / `--no-visual`) — never imply visual coverage that didn't run. Record the skip in `run.json` too (status `skipped` + the stated reason) — the spoken reason alone is not enough.

**Staleness guard:** before consuming `audit-results.json` or `process-results.json` here (and in Phase 4), check they are not older than the current scope's last commit. Never consume results older than the scope's last commit without saying so.

---

## Phase 4 — Unified review

Run, literally:

```
/sg-visual-review
```

It builds the single dashboard from `visual-tests/_results/`. The three signals land side by side as tabs: **Visual Tests** (browser), **Code Audit** (static, `audit-results.json`), **Process** (behavior delta, `process-results.json`) — plus **Recorded** for recorded manifests. The human annotates and decides; `/sg-visual-fix` handles anything they choose to fix.

When the visual lane was skipped (`--no-visual`, headless project, no agent-browser), the dashboard still shows the **Code Audit** and **Process** tabs — every lane writes its results to `visual-tests/_results/`, so the review works without a browser run.

---

## Phase 5 — Consolidated summary

Print one summary across all three lanes:
- **Static:** bugs by severity (from `visual-tests/_results/audit-results.json`)
- **Behavior:** units changed / new errors / surprises, reasoned-vs-measured mix (from `visual-tests/_results/process-results.json`)
- **Visual:** pass/fail on impacted routes (or "skipped — reason")
- **Findings:** total from `visual-tests/_results/findings.json` with the evidence mix (measured/reasoned/manual) — the dashboard's Findings tab is the entry point
- **Audit-fix delta** (only under `--fix`): what the audit lane itself changed, labeled separately from the user's own diff
- The dashboard URL, and the single most important thing for the human to look at first.

`sg-ship` itself **never fixes and never decides** — it sequences the find/simulate/confirm lanes and hands the human one place to judge. (Under `--fix`, the fixes are the audit lane's, applied under that lane's own rules; `sg-ship` still only sequences.)

---

## Graceful degradation (stay lean)

- **No backend / no API** → process-check still runs in `reason` on the diff'd functions; its API seam is simply not used.
- **No UI / no agent-browser / `--no-visual`** → skip Phase 3, log the reason, continue — the Phase 4 dashboard still shows the Code Audit and Process tabs from `visual-tests/_results/`.
- **Fix policy:** `--report-only` applies to the audit lane (and is its default under `sg-ship`); process-check and visual-run never modify sources by design. Only `--fix` allows mutation, and only in the audit lane.
- **Clean audit** → still run process-check on the diff; a no-bug audit is not a no-change diff.
- Any lane that errors is reported and the pipeline continues with the others (partial results beat no results).

---

## Final checklist

- [ ] Scope resolved once — `git diff {base}...HEAD`, committed changes only; uncommitted work warned about; plan printed; large scope confirmed
- [ ] Freshness check done — a still-fresh `visual-tests/_results/audit-results.json` offered for reuse before re-running the audit lane
- [ ] `/sg-code-audit {depth} --diff={ref} --report-only` run (or without `--report-only` under `--fix`, with scope re-resolved afterwards) → `visual-tests/_results/audit-results.json`
- [ ] `/sg-process-check --from-audit --diff={ref}` run (mode passthrough) → `visual-tests/_results/process-results.json`
- [ ] `/sg-visual-run --from-audit --from-process` run (union of both route lists, dedupe by route, highest severity wins), or skipped **with a stated reason**
- [ ] `/sg-visual-review` built — one dashboard, three tabs: Visual Tests, Code Audit, Process (plus Recorded)
- [ ] `visual-tests/_results/run.json` written and updated after each phase — every skipped/not-applicable lane declared with a reason
- [ ] Consolidated cross-lane summary printed (audit-fix delta labeled separately under `--fix`); no fixes/decisions made by sg-ship itself
