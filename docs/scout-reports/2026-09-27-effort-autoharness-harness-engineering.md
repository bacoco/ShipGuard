# Scope-control review: effort, AutoHarness, and harness engineering

Date: 2026-09-27

Tracking: [#82](https://github.com/bacoco/ShipGuard/issues/82)

## Decision

ShipGuard already has the right semantic control in `sg-mission-lock`: powerful models must not
convert their own interpretation into authority. The next improvements should make execution
receipts truthful and move objectively enforceable boundaries out of prose, without turning
ShipGuard into a generic workflow engine or an always-on transcript collector.

This review compares three sources:

- Thariq Shihipar, [Spending Your Effort](https://claude.dev/blog/spending-your-effort/)
- tigerless-labs, [AutoHarness](https://github.com/tigerless-labs/autoharness)
- WalkingLabs, [Learn Harness Engineering](https://github.com/walkinglabs/learn-harness-engineering)

## Findings

### 1. More effort improves verification, not interpretation

Higher effort is useful for verification, brownfield investigation, security, and edge cases. It
also gives the model more room to choose its own reading. A wrong or ambiguous mission therefore
does not become safer merely because the model reasons longer. ShipGuard should route effort by
phase: low or medium for bounded implementation and iteration; high for counterexamples and final
verification; maximum only for explicitly autonomous, difficult work.

### 2. Model-aware activation has an observable coverage gap

Claude Code does not expose model and effort on every hook event. `UserPromptSubmit` has prompt text
but no reliable model field, while `SubagentStart` has neither. The existing all-model environment
opt-in covered this, but the default model-aware path could not guarantee protection after every
delegation. On 2026-09-27 the owner explicitly replaced that policy: protection now follows every
configured host lifecycle event, independently of model and effort. Claude Code and Codex have
shipped adapters; OpenCode and DeepSeek Harness (`dsh`) still require host-specific adapters before
automatic protection can be claimed.

### 3. Deterministic boundaries should guard objective authority

A future `PreToolUse` authority envelope could reject objective violations: writes in read-only
mode, mutation outside named roots, publication or live operations without explicit authority, and
broad destructive commands. It should not pretend to decide whether every line is semantically in
scope. Hooks are drift controls, not a complete security boundary, and the user can disable an
installed plugin hook.

### 4. Progressive disclosure is now material

Several ShipGuard skill bodies are hundreds of lines long. Their entry files should become small
routers containing triggers, invariants, state transitions, and output contracts. Detailed phase
instructions, schemas, examples, and edge cases can live in references loaded only when needed.
Do not copy AutoHarness's 25-line cap literally; use a structural budget that keeps critical rules
visible and test their presence.

### 5. `run.json` pre-claimed work

`sg-ship` instructed the agent to create the run manifest before execution but initialized audit,
logic, and process lanes as `ran`. A crash or interruption could therefore leave a durable false
receipt. The selected implementation introduces `pending` and `running` as visible transitional
states, preserves `ran` as the compatible terminal success state, and requires every final lane to
be terminal. The dashboard renders transitional states distinctly.

The next identity hardening should bind a run to the exact base SHA, head SHA, dirty-diff hash,
ShipGuard version, model/effort per lane, and mission envelope. Timestamp freshness alone is weaker
when uncommitted changes exist.

### 6. AutoHarness is a useful pattern for `sg-improve`, with strict limits

The transferable architecture is:

1. a read-only reflector proposes;
2. deterministic validation checks safety and structure;
3. one writer promotes atomically;
4. an append-only ledger records provenance;
5. archive and rollback preserve recovery.

Only explicitly self-authored artifacts should be eligible for automatic promotion. Core safety
skills, hooks, and authority policy should receive proposals only and require human review. Do not
adopt background raw-transcript capture by default. Measure offered, invoked, applied, prevented,
false-positive, and outcome signals rather than treating a skill view or load as success.

### 7. Evidence layers must remain distinct

ShipGuard currently has static/protocol smoke tests and text-only model-scope probes. These do not
prove that a model using real tools preserves file, publication, or live-operation boundaries. A
small sandboxed integration probe should eventually verify exact diff, no extra files, no publish,
and consistent scope after delegation or resume. It should be a bounded compatibility matrix, not
a permanent benchmark campaign.

## Prioritized follow-up

1. Ship truthful `run.json` transitions and dashboard rendering. **Implemented with this report.**
2. Protect every configured Claude Code and Codex event independently of model and effort.
   **Owner decision accepted and implemented in 2.14.0.**
3. Design a minimal authority envelope for objective `PreToolUse` denials.
4. Add one sandboxed tool-action scope probe.
5. Split the largest skills through progressive disclosure, starting with mission control and audit.
6. Route reasoning effort by lane and measure confirmed yield, false positives, time, and cost.
7. Adapt AutoHarness's proposal/validator/single-writer pattern to the opt-in `sg-improve` path.

## Explicit non-goals

- no generic graph engine;
- no mandatory full end-to-end run for every change;
- no single readiness or safety score;
- no hidden self-editing loop or default transcript capture;
- no automatic removal of a safety guard because it fired infrequently;
- no microtask interpretation of work-in-progress limits.

## Evidence boundary

This is a design review based on source inspection and public documentation. No live behavioral
probe across model providers was run. Static hook tests, text-only model probes, sandboxed tool
integration, and live host behavior are separate evidence layers and must not be reported as one.
