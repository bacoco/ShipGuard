---
name: sg-ship
description: "Use when a user asks in ordinary language whether a change is ready, wants ShipGuard to check recent work, or requests end-to-end verification before a PR or release. Resolve and confirm scope conversationally, then orchestrate code bugs, applicable contract/invariant logic, behavior changes, visual evidence, and human review without requiring the user to know skill names or flags."
---

# sg-ship — Conversational ShipGuard orchestration

`sg-ship` is the orchestrator. The user speaks normally; never require them to know a slash command,
skill name, flag, lane, or result filename. Infer the request, propose one concrete scope and lane plan,
ask one combined question only when needed, then open a single review for the user to decide.

```
static FIND ──► semantic CHECK ──► dynamic SIMULATE ──► visual CONFIRM ──► human DECIDES
sg-code-audit    sg-logic-audit      sg-process-check      sg-visual-run        sg-visual-review
```

It is a **thin sequencer** — it invokes the existing skills through internal bridges and **adds no new
analysis logic**. Each lane governs its own behavior; `sg-ship` resolves the scope once, threads it
through every lane so they all inspect the same change, and consolidates the result. Logic Audit is
an integral lane: always perform bounded candidate detection and run the semantic trace when a
workflow, state machine, retry, transaction, authorization path, or non-trivial algorithm is in scope.

> **Model guidance:** a fast, capable general-purpose model is enough to drive the orchestration; each sub-skill picks its own model (e.g. `sg-process-check` leans on the strongest available reasoning model for `reason` mode).

> ⚠️ **Token cost.** The audit alone is token-heavy (`standard` ≈ 2M), and semantic tracing adds
> cross-file work when applicable. Keep the proposed scope narrow and disclose a materially large
> plan before starting.

## Conversational entry

Examples of user requests that should trigger this skill:

- "Vérifie avec ShipGuard ce que je viens de modifier."
- "Est-ce que cette branche est prête à livrer ?"
- "Contrôle le nouveau cycle de retry avant la PR."
- "Fais une vérification complète de `src/jobs`, sans modifier le code."

Translate ordinary language into internal depth, scope, evidence, visual, and mutation controls.
Existing command/flag syntax remains backward compatible, but never advertise it or ask the user to
reformulate. A natural-language exclusion such as "sans navigateur" or "ne vérifie pas la logique
métier" is authoritative and must be recorded as the lane's skip reason. Source mutation remains
off unless the user explicitly asks ShipGuard to fix/apply/correct the findings; translate that
ordinary-language authorization into the internal audit fix control.

---

## Phase 0 — Scope & plan (once)

1. **Resolve the diff once.** Default scope = committed changes vs the merge-base of the upstream branch:
   - `base = git merge-base HEAD @{upstream}` (fall back to the repo's default branch if no upstream is set); `--diff=<ref>` overrides the base; `--all` means full-repo scope.
   - Scope = `git diff {base}...HEAD` (three-dot). **The diff scope covers committed changes only.**
   - If `git status --porcelain` shows uncommitted or staged work, include that fact in the single
     scope question. Do not create a separate interrogation round.
   - The resolved ref is passed as an explicit `--diff={ref}` to every lane. Passing `--diff` also suppresses each sub-skill's own interactive scope question — the lanes never re-ask.
2. **Detect applicable lanes.** Inspect the changed symbols and their immediate contracts/tests for
   backend code, UI/routes, and semantic candidates. Logic candidate signals include lifecycle/state
   transitions, retries, transactions, ordered effects, workers/callbacks, authorization across
   entry points, and algorithms with conservation, boundary, termination, or complexity properties.
   Always do this bounded detection; the user does not opt into it.

   Classify Logic Audit before asking about scope:

   - **applicable**: name the candidate in the proposed plan and include the lane;
   - **not applicable**: say no procedural/algorithmic candidate was detected and record the reason;
   - **ambiguous**: fold one short clarification into the scope question, naming the candidate and
     why its contract is unclear. Never ask the user what a lane or flag means.

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
    "logic":   {"status": "ran", "results": "logic-results.json"},
    "process": {"status": "ran", "results": "process-results.json"},
    "visual":  {"status": "skipped", "reason": "no agent-browser"},
    "crawl":   {"status": "not-applicable", "reason": "crawl is a CLI recette lane (shipguard run) — not part of the diff pipeline"}
  }
}
```

Lane statuses: `ran` | `skipped` | `not-applicable` | `error` | `needs-agent` — every non-`ran` status MUST carry a `reason`. The dashboard renders these as lane chips and shows the declared reason in place of generic empty states.
3. **Freshness check (audit reuse).** The audit is the most expensive lane. If `visual-tests/_results/audit-results.json` already exists and is **newer than the last commit touching the scoped files**, offer to reuse it instead of re-running Phase 1. Never reuse silently — say what is being reused and why it is still fresh.
4. **Ask at most one scope question.** Present the concrete scope and planned checks in plain
   language, including any Logic Audit candidate or reason it does not apply. Example:

   > Je vais vérifier les changements depuis `main` dans `src/jobs` : bugs de code, invariants du
   > cycle de retry et comportement avant/après. Aucune interface n'est touchée. Je lance ce
   > périmètre ?

   If the user's request already fixes the scope and checks unambiguously, proceed without asking a
   redundant question. Never make the user choose among internal lane names.

---

## Phase 1 — Code audit (static find)

Run, literally:

```
/sg-code-audit {depth} --diff={ref} --report-only [--focus={path}]
```

where `{depth}` is `quick|standard|deep|paranoid` (default `standard`) and `{ref}` is the base resolved in Phase 0. The audit lane runs with **`--report-only` by default** — `sg-ship` never lets it mutate sources unless asked.

**Fix path (opt-in):** when the user explicitly asked in ordinary language to fix/apply/correct the
audit findings (or used the backward-compatible `--fix` syntax), pass that authorization to the
audit as its internal explicit opt-in:

```
/sg-code-audit {depth} --diff={ref} --fix [--focus={path}]
```

The tree **mutates during Phase 1** in this case, so after the audit lane finishes, **re-resolve the scope** before Phase 2 (the audit's fixes are now part of the tree) and label the audit-fix delta **separately** in the Phase 5 summary — never blend the audit's edits into the user's own change.

This produces `visual-tests/_results/audit-results.json` with `impacted_backend[]` (`{endpoint, reason, severity}` objects) and `impacted_ui_routes[]` (`{route, reason, severity, bug_count}` objects) — the lists the next lanes consume.

If the audit finds nothing impacted, note it and still run the diff-scoped process-check (a clean audit doesn't mean the behavior didn't change).

---

## Phase 1.5 — Logic audit (semantic contract check)

After Phase 0 confirmation, run the bounded discovery internally unless the user explicitly
excluded semantic checking:

```
/sg-logic-audit --from-audit --diff={ref} --report-only [--focus={path}]
```

It extracts traceable obligations for workflows, state machines, retries, transactions, and
non-trivial algorithms impacted by the diff, searches for counterexamples, and writes
`visual-tests/_results/logic-results.json` plus `logic-report.md`. It is always report-only.

For an applicable candidate, continue through the semantic trace. For a candidate classified
not-applicable in Phase 0, stop after discovery and write the valid `not-applicable` result. Update
`run.json` with `logic.status = "ran"` and its result path in both cases: the skill executed and
declared its result. Skip the lane only when the user excluded it in ordinary language, and record
that exact exclusion.

Logic findings judge absolute contracts and invariants. They do not replace the before/after
process lane, even when the logic result is clean.

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

When Logic Audit ran, use its internal bridge:

```
/sg-visual-run --from-audit --from-logic --from-process
```

sg-visual-run **unions every selected route list** (dedupes by route, highest severity wins, ordered severity-first) and confirms the impacted routes in the browser. If the lane is skipped, **say why** (no UI / no agent-browser / `--no-visual`) — never imply visual coverage that didn't run. Record the skip in `run.json` too (status `skipped` + the stated reason) — the spoken reason alone is not enough.

**Staleness guard:** before consuming `audit-results.json`, `logic-results.json`, or `process-results.json` here (and in Phase 4), check they are not older than the current scope's last commit. Never consume results older than the scope's last commit without saying so.

---

## Phase 4 — Unified review

Run, literally:

```
/sg-visual-review
```

It builds the single dashboard from `visual-tests/_results/`. Signals land side by side as tabs: **Visual Tests** (browser), **Code Audit** (static, `audit-results.json`), **Logic** (contracts/invariants, `logic-results.json`), and **Process** (behavior delta, `process-results.json`) — plus **Recorded** for recorded manifests. The human annotates and decides; `/sg-visual-fix` handles anything they choose to fix.

When the visual lane was skipped (user exclusion, headless project, or no browser driver), the
dashboard still shows **Code Audit**, **Logic** when applicable, and **Process** — every lane writes
its results to `visual-tests/_results/`, so the review works without a browser run.

---

## Phase 5 — Consolidated summary

Print one summary across all applicable lanes:
- **Static:** bugs by severity (from `visual-tests/_results/audit-results.json`)
- **Logic:** confirmed violations / risks / contract conflicts / uncovered, `not applicable — reason`, or `skipped — user exclusion` (from `logic-results.json`)
- **Behavior:** units changed / new errors / surprises, reasoned-vs-measured mix (from `visual-tests/_results/process-results.json`)
- **Visual:** pass/fail on impacted routes (or "skipped — reason")
- **Findings:** total from `visual-tests/_results/findings.json` with the evidence mix (measured/reasoned/manual) — the dashboard's Findings tab is the entry point
- **Audit-fix delta** (only under `--fix`): what the audit lane itself changed, labeled separately from the user's own diff
- The dashboard URL, and the single most important thing for the human to look at first.

`sg-ship` itself **never fixes and never decides** — it sequences the find/check/simulate/confirm lanes and hands the human one place to judge. (Under `--fix`, the fixes are the audit lane's, applied under that lane's own rules; `sg-ship` still only sequences.)

---

## Graceful degradation (stay lean)

- **No semantic candidate** → keep the valid `not-applicable` result and continue; do not claim an audit was skipped.
- **No backend / no API** → process-check still runs in `reason` on the diff'd functions; its API seam is simply not used.
- **No UI / no agent-browser / user excludes visual checking** → skip Phase 3, log the reason, continue — the dashboard still shows the non-visual evidence.
- **Fix policy:** `--report-only` applies to the audit lane (and is its default under `sg-ship`); process-check and visual-run never modify sources by design. Only `--fix` allows mutation, and only in the audit lane.
- **Clean audit** → still run process-check on the diff; a no-bug audit is not a no-change diff.
- Any lane that errors is reported and the pipeline continues with the others (partial results beat no results).

---

## Final checklist

- [ ] Scope resolved once; one plain-language scope/plan question asked only if needed
- [ ] Logic candidate detection integrated into that scope decision; no flag or lane knowledge requested from the user
- [ ] Freshness check done — a still-fresh `visual-tests/_results/audit-results.json` offered for reuse before re-running the audit lane
- [ ] `/sg-code-audit {depth} --diff={ref} --report-only` run (or with explicit `--fix`, with scope re-resolved afterwards) → `visual-tests/_results/audit-results.json`
- [ ] `/sg-logic-audit --from-audit --diff={ref} --report-only` run for applicable candidates → `logic-results.json`; `not-applicable` or explicit user exclusion recorded honestly
- [ ] `/sg-process-check --from-audit --diff={ref}` run (mode passthrough) → `visual-tests/_results/process-results.json`
- [ ] `/sg-visual-run --from-audit [--from-logic] --from-process` run (union of selected route lists, dedupe by route, highest severity wins), or skipped **with a stated reason**
- [ ] `/sg-visual-review` built — one dashboard with Visual Tests, Code Audit, Logic, Process, and Recorded tabs
- [ ] `visual-tests/_results/run.json` written and updated after each phase — every skipped/not-applicable lane declared with a reason
- [ ] Consolidated cross-lane summary printed (audit-fix delta labeled separately under `--fix`); no fixes/decisions made by sg-ship itself
