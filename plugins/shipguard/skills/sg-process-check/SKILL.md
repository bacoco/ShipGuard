---
name: sg-process-check
description: Simulate before/after process behavior from a diff. Default reason mode needs no running stack; hybrid/execute can measure cheap seams.
context: conversation
argument-hint: "[what changed, natural language] [--mode=reason|hybrid|execute] [--diff=ref] [--from-audit] [--samples=N] [--depth=shallow|deep]"
---

# /sg-process-check — Diff-Driven Process Behavior Simulation

The backend counterpart of `/sg-visual-run`. Where the visual lane drives the **browser** to confirm a change in the **UI**, `sg-process-check` simulates the **running process** to show how a change affects its **behavior** — no browser.

**The default is to run the code "in its head."** It reads the diff and the code paths it touches, builds a model of the process (pipeline stages, data flow), and **traces representative inputs through the OLD and NEW code by reasoning** — predicting how the observable behavior differs. It can *optionally* really execute the cheap parts to anchor that reasoning, but it never needs to boot the stack. That is what makes it work on a 5-container app: the floor mode requires no infra.

It is **scoped to the diff** of the module you're working on (not the whole repo). Its oracle is **before/after**: the previous version is the reference. The question is not "is this correct in the absolute" — it's **"did the observable behavior change, and was that intended?"** The human decides. This is the behavior-level twin of `sg-visual-fix`'s before/after screenshots.

> ### ⚠️ Reasoned ≠ measured — the honesty rule
> A simulated trace is a **prediction**, not a measurement. Never present predicted behavior as observed. **Every observation carries an `evidence` tag — `reasoned` (with confidence + assumptions) or `measured` (really executed).** If a measured result contradicts the reasoned one, the measurement wins and the surprise is flagged. The whole value is the human judging a clearly-labelled delta — not a confident-sounding guess dressed up as fact.

**Hard rule — observe, never fix.** Reports what the process does; never edits source. Remediation stays with `sg-code-audit` / `sg-visual-fix`.

> **Recommended model: Opus for `--mode=reason` (the reasoning IS the product), Sonnet for `hybrid`/`execute`** where most of the work is mechanical orchestration. The default leans on code-tracing reasoning, so spend the better model there.

## Modes — a fidelity spectrum

| Mode | What it does | When |
|------|--------------|------|
| **`reason`** *(default)* | Simulates the process **by reasoning** — traces inputs through old vs new code in-head, predicts the behavioral delta. **Zero infra.** Every finding `evidence: reasoned`. | Always available — complex multi-container apps, nothing running, quick check |
| **`hybrid`** | Reasons about the whole, **but really executes the parts that are cheap to run** (a pure importable function, an endpoint already up) to anchor/verify the reasoning. Mixed `reasoned` + `measured`. | When some part is trivially runnable |
| **`execute`** | Literal before/after: build a baseline worktree, run each action on old + new for real. All `measured`. | **Opt-in**, only when the stack is simple or already running |

`hybrid` and `execute` **auto-degrade to `reason`** for any unit that can't be run cheaply (and say so) — they never boot a 5-container stack unless you explicitly ask and it's feasible.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-process-check` | **Interactive** — detect the working diff, list the units it touches, confirm scope, run `reason` |
| `/sg-process-check <text>` | Natural language — e.g. `I changed the RAPTOR chunking` |
| `/sg-process-check --mode=hybrid` | Reason + execute the cheap parts to anchor |
| `/sg-process-check --mode=execute` | Force literal before/after execution |
| `/sg-process-check --diff=main` | Scope to everything changed since `main` |
| `/sg-process-check --from-audit` | Simulate the `impacted_backend[]` endpoints from `audit-results.json` |
| `/sg-process-check --samples=N` | Representative inputs to trace per unit (default **3**) |
| `/sg-process-check --depth=deep` | Trace deeper call chains / more edge inputs (more tokens) |

---

## Phase 0 — Scope

1. **Resolve the diff.** Working tree + staged (`git status --porcelain`, `git diff`, `git diff --staged`); or `git diff <ref>...HEAD` for `--diff`; or `git show HEAD` if the tree is clean. Record `base_ref` (before) and `head_ref` (after).
2. **Read context.** `visual-tests/_config.yaml` if present (stack hints, `base_url`); detect language/stack from the changed files.
3. **Confirm scope.** Print changed files + detected units; ask to confirm/narrow unless explicit scope was given. This lane checks **one module's change**, not the repo.

If nothing changed and no scope is given, stop.

---

## Phase 1 — Map the change to process units

For each changed file, find the **executable units** the diff touches:

| Unit kind | Detect | Modelled as |
|-----------|--------|-------------|
| `endpoint` | route handler (or callee) in the diff; cross-ref `/openapi.json` | request → handler → downstream calls |
| `function` | changed top-level function/method with a clear signature | input → return / effects |
| `pipeline-stage` | changed step in a known pipeline (RAPTOR index, ColBERT search, embed batch, Celery task) | stage input → output |

Map each to an `impacted_backend` string (e.g. `POST /raptor/query/{id}`, `raptor_query.chunk_document`). **Skip** rename/comment-only changes — and **log them as skipped**, never silently drop.

---

## Phase 2 — Build the model & representative inputs

For each unit:
1. **Read the relevant code paths** — the changed function plus what it calls/returns into, enough to trace the effect of the change (follow imports as needed; `--depth=deep` follows further).
2. **Pick `--samples` representative inputs** (default 3): one nominal, one boundary, one empty/edge. Prefer real repo fixtures (`data-sample/`, `test/fixtures/`), then OpenAPI examples / type hints. Use the **same** seeded inputs for before and after.

This is the modest "sampling" sense — a few cases so you don't only see the happy path. Not exhaustive.

---

## Phase 3 — Simulate before vs after (the core, `reason`)

For each (unit, input), **trace the input through the OLD code and the NEW code by reasoning**, and produce two observation records. For each side predict:
- **outcome**: `ok` | `error` (and which exception / status, traced to the line that raises it)
- **output**: shape / key fields / counts — what the unit returns or emits
- **effects**: writes, external/LLM calls made, state touched
- **cost/latency signal**: relative — "more LLM calls", "an extra O(n) pass", "one less DB round-trip" (qualitative unless measured)

Each record gets `evidence: reasoned`, a **`confidence`** (high/medium/low), and the **`assumptions`** it rests on (e.g. "assumes `doc.pages` is non-empty", "assumes Albert returns within token budget"). Be explicit about what you could NOT trace with confidence — that goes to `uncovered`, not a confident guess.

---

## Phase 4 — Anchor by real execution (`hybrid` / `execute` only)

For units that are **cheap to run**, execute the same seeded inputs for real and replace the reasoned record with a `measured` one:
- **function** seam → ephemeral harness imports the module and calls the unit; capture outcome/output/timing/cost; delete the harness.
- **endpoint** seam → if a service is already up (or `build_command` is a single container), fire the request at `base_url`; for `execute`, build a baseline **worktree pinned at the base commit** (`git worktree add --detach … && git reset --hard <BASE>` — pin explicitly, never inherit a stale checkout) on an alternate port for the "before".
- **pipeline-stage** seam → call the stage entrypoint with a fixture.

Control non-determinism (LLMs, vector DB) with record-replay cassettes so a measured delta reflects the code change, not sampling noise; otherwise mark `noisy` and compare structural fields only.

**Reconcile:** if a `measured` result **contradicts** the `reasoned` prediction, the measurement wins, the unit is flagged `surprise: true`, and that's a high-signal item for the human (the model's mental model of the process was wrong there). Always clean up worktrees/baseline services.

---

## Phase 5 — Diff & classify

Per action, compare before vs after → `delta`: `identical` / `output-changed` / `now-errors` / `now-recovers` / `cost-changed` / `latency-changed`. Per unit → `verdict`: `unchanged` / `behavior-changed` / `new-error`. **No intent verdict, no pass/fail** — `output-changed` may be exactly what was wanted; the skill states *what moved* and *how it knows* (reasoned/measured), the human judges.

---

## Phase 6 — Report & bridges

1. **`process-results.json`** (schema below) to the results dir (`visual-tests/_results/` else `.process-check-results/`) — mirrors `audit-results.json` so `/sg-visual-review` can show it (Process tab).
2. **`process-report.md`** — short before/after table per unit, **reasoned and measured findings visually separated**, most-changed/`surprise` first, each with a one-line repro (mode, seed, input ref).
3. **Print a summary**: units checked, behavior changes, new errors, surprises, and how much was reasoned vs measured.

### Bridges
- **`--from-audit`** consumes `impacted_backend[]` from `audit-results.json`.
- Emits **`impacted_ui_routes[]`** for `sg-visual-run --from-process` (visual confirm).
- `process-results.json` → `sg-visual-review`. Static **find** → behavioral **simulate** → visual **confirm** → human **decides**.

---

## Output schema — `process-results.json`

```json
{
  "repo": "my-project",
  "timestamp": "2026-06-28T10:00:00Z",
  "mode": "reason",
  "base_ref": "main",
  "head_ref": "working-tree",
  "summary": {
    "units_checked": 4,
    "behavior_changes": 2,
    "new_errors": 1,
    "surprises": 0,
    "evidence_mix": { "reasoned": 10, "measured": 2 },
    "by_verdict": { "unchanged": 2, "behavior-changed": 1, "new-error": 1 }
  },
  "units": [
    {
      "id": "u01",
      "kind": "function",
      "ref": "raptor_query.chunk_document",
      "file": "raptor_query.py",
      "verdict": "behavior-changed",
      "impacted_backend": "POST /raptor/query/{id}",
      "actions": [
        {
          "seed": 1,
          "input_summary": "acte.pdf (12 pages)",
          "evidence": "reasoned",
          "confidence": "medium",
          "assumptions": ["doc has >1 page", "no custom separators configured"],
          "before": { "outcome": "ok", "output": "≈18 chunks, ~512 tok each", "effects": "0 LLM calls" },
          "after":  { "outcome": "ok", "output": "≈11 chunks, ~870 tok each", "effects": "0 LLM calls" },
          "delta": "output-changed",
          "surprise": false,
          "observation": "New min-chunk-size merges small chunks → fewer, larger chunks. Downstream embed cost likely up. Intended?"
        }
      ]
    }
  ],
  "impacted_backend": ["POST /raptor/query/{id}"],
  "impacted_ui_routes": [{ "route": "/notaire-chat", "reason": "chunking affects RAG answers" }],
  "skipped": [{ "file": "utils.py", "reason": "rename-only" }],
  "uncovered": ["embed_batch.flush() — could not trace the retry path with confidence; not simulated"]
}
```

`evidence`, `skipped`, and `uncovered` are always populated honestly. Reasoning is a prediction; say what you did not (or could not) trace.

---

## Safety rules

1. **Never fix.** Observe/simulate and report only. Zero source edits.
2. **Reasoned ≠ measured.** Tag every observation. Never let a prediction read as a measurement.
3. **`reason` mode touches no infra.** `hybrid`/`execute` run code only against local/throwaway instances with seeded, disposable inputs; read-only/idempotent only if a shared instance is the only option (and say so). Pin baselines (`reset --hard`), always remove worktrees.
4. **Budget.** Default `--samples=3`; cap tokens; prefer cassettes over live LLM calls when executing.
5. **No secrets** in captured inputs/outputs or `process-report.md`.

---

## Edge cases

- **5-container app, nothing running** → `reason` (the default) handles it; `hybrid`/`execute` degrade to `reason` per un-runnable unit and note it.
- **Baseline won't build (execute)** → degrade that unit to `reason`; report "no measured before".
- **Reasoning low-confidence on a unit** → say so in `confidence`/`uncovered`; suggest `--mode=hybrid` to anchor it if runnable.
- **Huge diff** → ask to narrow; this lane is per-module, not a repo-wide sweep.

---

## Final checklist

- [ ] Diff resolved; `base_ref` / `head_ref` recorded
- [ ] Changed files mapped to units (skips logged)
- [ ] Model built; `--samples` seeded inputs chosen from real fixtures where possible
- [ ] Before/after **simulated by reasoning** (default), with `evidence`/`confidence`/`assumptions`
- [ ] (hybrid/execute) cheap units **measured**; contradictions flagged `surprise`; worktrees cleaned
- [ ] Deltas classified; per-unit verdicts (no intent verdict)
- [ ] `process-results.json` + `process-report.md` written; reasoned vs measured separated; `skipped`/`uncovered` honest
- [ ] Bridges emitted (`impacted_backend`, `impacted_ui_routes`)
- [ ] No secrets in artifacts; summary printed
