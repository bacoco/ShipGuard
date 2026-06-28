---
name: sg-process-check
description: Diff-driven dynamic behavior check at the PROCESS level — the backend twin of sg-visual-run. Looks at what changed (git diff / recent commits), runs the changed code units (API endpoints, functions, pipeline stages) on a few realistic inputs BEFORE and AFTER the change, and reports how the observable runtime behavior differs. Observe-not-fix; a human decides what matters. Trigger on "sg-process-check", "process check", "check the process", "verify the process", "behavior diff", "runtime check", "I changed X check the process/backend still behaves", "dynamic check", "vérifier le process".
context: conversation
argument-hint: "[what changed, natural language] [--diff=ref] [--from-audit] [--seam=auto|api|function] [--samples=N] [--report-only]"
---

# /sg-process-check — Diff-Driven Process Behavior Check

The backend counterpart of `/sg-visual-run`. Where `sg-visual-run` drives the **browser** to confirm a change is still good in the **UI**, `sg-process-check` drives the **running code** to observe how a change affects the **process behavior** — no browser involved.

It is **scoped to the diff** of the module you are working on (not the whole repo), and its oracle is **before/after**: the previous version of the code is the reference. You are not asking "is this correct in the absolute" — you are asking **"did this change alter the observable behavior, and is that change intended?"** The human decides. This is the process-level twin of `sg-visual-fix`'s before/after screenshots — here we capture before/after **behavior** (output, exceptions, timing, cost) instead of pixels.

**Hard rule — observe, never fix.** `sg-process-check` runs code and reports what it does. It never edits source. Fixing stays with `sg-code-audit` / `sg-visual-fix`. This boundary is what keeps the lane honest.

> **Recommended model: Sonnet 4.6.** Mapping a diff to units, generating a handful of inputs, running them, and diffing the results is mechanical work. Use `/model sonnet` before invoking to save Opus weekly quota. Escalate to Opus only if input synthesis for a complex unit needs deeper reasoning.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-process-check` | **Interactive** — detect the working diff, list the units it touches, confirm scope |
| `/sg-process-check <text>` | Natural language — e.g. `I changed the RAPTOR chunking`; parse intent, map to changed units |
| `/sg-process-check --diff=main` | Scope to everything changed since `main` (instead of the working tree) |
| `/sg-process-check --from-audit` | Exercise the `impacted_backend[]` endpoints/services from `audit-results.json` |
| `/sg-process-check --seam=api` | Force the API seam (drive endpoints) — or `--seam=function` for in-process calls. Default `auto` |
| `/sg-process-check --samples=N` | Inputs to try per unit (default **3** — small on purpose, this is sampling not exhaustive fuzzing) |
| `/sg-process-check --report-only` | Only observe HEAD behavior; skip the before/after baseline (faster, no worktree) |

Flags combine freely: `/sg-process-check I touched the embed batcher --seam=api --samples=5`.

---

## Phase 0 — Pre-flight & scope

1. **Resolve the diff.** Default source of "what changed":
   - working tree + staged changes (`git status --porcelain`, `git diff` and `git diff --staged`), else
   - if `--diff=<ref>` is given, `git diff <ref>...HEAD`, else
   - if the tree is clean, the last commit (`git show --stat HEAD`).
   Record `base_ref` (the "before") and `head_ref` (the "after"). For a dirty working tree, `base_ref` = `HEAD`; for `--diff=main`, `base_ref` = `main`.
2. **Detect the runtime.** Read `visual-tests/_config.yaml` if present (reuse `base_url`, `credentials`, `build_command`). Detect language/stack (Python/FastAPI, Node, etc.) from the changed files.
3. **Confirm scope.** Print the changed files and the units detected (Phase 1) and ask the user to confirm or narrow — unless invoked with explicit natural-language scope or `--all`-style intent. Keep it small: this lane is meant to check **one module's change**, fast.

If nothing changed and no scope is given, stop: "No diff to check. Pass a `--diff=<ref>` or describe what you changed."

---

## Phase 1 — Map the change to process units

For each changed file in scope, identify the **executable units** the diff touches. Three kinds:

| Unit kind | How to detect | How it will be driven |
|-----------|---------------|-----------------------|
| `endpoint` | FastAPI/Flask/Express route whose handler (or a function it calls) is in the diff. Cross-reference `/openapi.json` when the service exposes one. | HTTP request to the live service |
| `function` | A changed top-level function/method with type hints or a clear signature (e.g. `chunk_document(doc) -> list[Chunk]`) | Direct in-process call via an ephemeral harness |
| `pipeline-stage` | A changed step in a known pipeline (RAPTOR index, ColBERT search, embed batch, Celery task) | Call the stage entrypoint directly with a fixture |

Map each unit back to an `impacted_backend` string (e.g. `POST /raptor/query/{id}` or `raptor_query.chunk_document`) for cross-feeding. Skip pure refactors with no reachable behavior (e.g. comment/rename-only) and **log them as skipped** — never silently drop.

**Seam selection (`--seam=auto`):** prefer `api` when the unit is reachable from a running endpoint and a `base_url` is configured (closest to real usage, mirrors how `sg-visual-discover` reads UI routes); fall back to `function` (in-process) when there is no running service or the unit is an internal helper.

---

## Phase 2 — Generate actions

For each unit, synthesize **`--samples` realistic inputs** (default 3). This is the modest "Monte-Carlo" sense: a few varied-but-plausible cases so you don't only see the happy path — *not* thousands, *not* adversarial worst-case hunting.

Source inputs, in priority order:
1. **Fixtures already in the repo** — `data-sample/`, `test/fixtures/`, `__fixtures__/`, factory functions.
2. **OpenAPI examples** for the endpoint, or **type hints / Pydantic models** for the function (one nominal, one boundary, one empty/edge value).
3. **A previously recorded real call** if a request log or `sg-record`-style trace exists.

Each action is `{unit, input_summary, input_ref}`. Keep inputs **deterministic and seeded** so before/after run on the *same* input. Never invent inputs that would mutate shared/production data — see Safety.

---

## Phase 3 — Establish the "before" baseline

Unless `--report-only`:

1. Create a **git worktree pinned to the exact base commit** so "before" is reproducible:
   ```bash
   BASE=$(git rev-parse <base_ref>)
   git worktree add --detach .sg-process-before "$BASE"
   git -C .sg-process-before reset --hard "$BASE"   # pin — never inherit a stale checkout
   ```
   > Pin explicitly with `reset --hard <commit>`. A worktree must run the intended base, not whatever HEAD happened to be — stale-base drift silently invalidates the whole comparison.
2. Bring the baseline up where needed (install deps if the lockfile changed; for the API seam, boot the base build on an **alternate port** so before/after services don't collide). Reuse `build_command` from `_config.yaml`.

If the baseline cannot be built (e.g. base was already broken), record that and fall back to `--report-only` for the affected units — and say so in the report.

---

## Phase 4 — Execute & observe (before + after)

Run **every action on both** the baseline (Phase 3) and HEAD, with the **same seeded input**. For each run, capture an observation record — never assert, just record:

- **outcome**: `ok` | `error` (unhandled exception / non-2xx / panic) + the error text/type
- **output digest**: a stable summary of the result (shape, key fields, counts, a hash or normalized sample — not the full blob)
- **timing**: wall-clock ms
- **cost**: LLM tokens / external calls if the unit hits Albert/Olympia/embeddings (this stack is LLM-heavy — cost regressions matter)
- **trace** (optional, when cheap): which downstream functions/stages were hit (coverage of the changed path)

**Non-determinism control.** This stack calls LLMs and vector DBs. To keep before/after comparable: fix seeds/temperature where possible, and **record-and-replay external calls** (VCR-style cassette captured on the baseline run, replayed on HEAD) so a behavior diff reflects *your code change*, not LLM sampling noise. If a call cannot be made deterministic, mark its observations `noisy` and compare only structural fields.

---

## Phase 5 — Diff & classify

For each action, compare before vs after and assign a `delta`:

| delta | Meaning |
|-------|---------|
| `identical` | Same outcome and output digest |
| `output-changed` | Same outcome, different output digest |
| `now-errors` | OK before, errors after (**likely regression**) |
| `now-recovers` | Errored before, OK after (likely a fix) |
| `cost-changed` / `latency-changed` | Outcome+output same, but tokens/time moved beyond a threshold (default ±25%) |

Roll up per unit into a `verdict`: `unchanged`, `behavior-changed`, or `new-error`. **No pass/fail, no severity verdict on intent** — `output-changed` is not inherently bad (the change may be exactly what the user wanted). The skill states *what moved*; the human judges whether it was intended.

---

## Phase 6 — Report & bridges

1. **Write `process-results.json`** to the results dir (`visual-tests/_results/` if it exists, else `.process-check-results/`) — schema below. This mirrors `audit-results.json` so the `/sg-visual-review` dashboard can surface it (a "Process" tab) alongside Code Audit and Visual Tests.
2. **Write `process-report.md`** next to it: a short, human-first before/after table per unit, newest/most-changed first, with a one-line repro (`seed` + input ref) for each action so the human can re-run the exact case.
3. **Print a summary** to the conversation: units checked, behavior changes, new errors, and the single most notable delta.
4. **Cleanup**: `git worktree remove .sg-process-before --force` (and stop the baseline service/port). Never leave worktrees behind.

### Bridges (mix with the rest of ShipGuard)

- **`--from-audit`** consumes `impacted_backend[]` from `audit-results.json` — dynamically confirm the endpoints a static audit flagged.
- **Feed `sg-visual-run`**: units with a user-facing route get an `impacted_ui_routes` hint so `/sg-visual-run --from-process` (or the operator) can confirm the *visual* effect of a behavior change. Static find → dynamic process check → visual confirm → human decides.
- **Dashboard**: `process-results.json` in the results dir lets `/sg-visual-review` show the before/after behavior next to screenshots and audit findings.

---

## Output schema — `process-results.json`

```json
{
  "repo": "my-project",
  "timestamp": "2026-06-28T10:00:00Z",
  "base_ref": "main",
  "head_ref": "working-tree",
  "seam": "api",
  "summary": {
    "units_checked": 4,
    "actions_run": 12,
    "behavior_changes": 2,
    "new_errors": 1,
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
          "before": { "outcome": "ok", "output_digest": "chunks=18 avg_tokens=512", "duration_ms": 240, "tokens": 0 },
          "after":  { "outcome": "ok", "output_digest": "chunks=11 avg_tokens=870", "duration_ms": 230, "tokens": 0 },
          "delta": "output-changed",
          "observation": "Same doc → 18 chunks → 11; avg chunk +70% tokens. Intended?"
        }
      ]
    }
  ],
  "impacted_backend": ["POST /raptor/query/{id}"],
  "impacted_ui_routes": [{ "route": "/notaire-chat", "reason": "chunking affects RAG answers" }],
  "skipped": [{ "file": "utils.py", "reason": "rename-only, no reachable behavior change" }],
  "uncovered": ["embed_batch.flush() — no fixture available, not exercised"]
}
```

Always populate `skipped` and `uncovered` honestly. Sampling is **not** exhaustive — say what you did not exercise rather than imply full coverage.

---

## Driving seams (how to run without a browser)

- **API seam** — boot the service (`build_command`), read `/openapi.json`, build requests from the schema/examples, fire them at `base_url`. Closest to real usage; works across FastAPI/Flask/Express. Run baseline on an alternate port.
- **Function seam** — write a tiny ephemeral harness (a temp script) that imports the changed module, calls the unit with each seeded input, and prints a JSON observation record. Delete the harness after. No network, fastest, but needs importable units.
- **Pipeline-stage seam** — call the stage entrypoint (e.g. the RAPTOR indexer, ColBERT searcher, a Celery task body) directly with a fixture, capturing the same observation record.

---

## Safety rules

1. **Never fix.** Observe and report only. Zero source edits.
2. **Never mutate shared/production data.** Drive against a local/throwaway instance with seeded, disposable inputs. If only a shared instance is available, restrict to read-only/idempotent actions and **say so** — skip the rest.
3. **Pin the baseline** with `reset --hard <commit>`; always remove the worktree on exit.
4. **Budget the cost.** Default `--samples=3`. Cap total LLM tokens; prefer replayed cassettes over live LLM calls for the before/after comparison.
5. **No secrets in artifacts.** Redact credentials/tokens from captured inputs, outputs, and `process-report.md` before writing.

---

## Edge cases

- **No running service & API-only unit** → fall back to `--seam=function`, or `--report-only` if not importable; note the limitation.
- **Baseline won't build** → `--report-only` for affected units; report "no before available".
- **Non-deterministic output even with cassettes** → compare structural fields only; mark `noisy`.
- **Huge diff** → ask to narrow; this lane is for a module's change, not a repo-wide sweep (use `sg-code-audit --all` for breadth).
- **Binary/again-untestable change** (config, docs) → skip with reason.

---

## Final checklist

- [ ] Diff resolved; `base_ref` / `head_ref` recorded
- [ ] Changed files mapped to executable units (skips logged)
- [ ] `--samples` seeded inputs generated per unit, from real fixtures where possible
- [ ] Baseline worktree pinned with `reset --hard`; service on alternate port if API seam
- [ ] Each action run on before + after with the same input; external calls replayed
- [ ] Deltas classified; per-unit verdicts assigned (no intent verdict)
- [ ] `process-results.json` + `process-report.md` written; `skipped` / `uncovered` populated honestly
- [ ] Bridges emitted (`impacted_backend`, `impacted_ui_routes`)
- [ ] Worktree removed, baseline service stopped, no secrets in artifacts
- [ ] Summary printed
