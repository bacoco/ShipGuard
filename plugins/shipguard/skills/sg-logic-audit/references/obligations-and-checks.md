# Obligations and Counterexample Checks

Use this reference while extracting requirements and selecting adversarial cases. Apply only checks
that can falsify a traceable obligation; do not turn the list into a generic checklist.

## Source precedence

Classify every obligation by its strongest supporting source:

| Rank | Source kind | Treatment |
|---|---|---|
| 1 | Executable contract: schema, type invariant, assertion, conformance test | `declared`; strongest local evidence |
| 2 | Explicit specification: protocol, ADR, requirements document, API contract | `declared` |
| 3 | Operational policy: retry, timeout, permission, transaction, lifecycle configuration | `declared` within its configured scope |
| 4 | Example or ordinary test | `observed-expectation`; confirm it is normative before blocking |
| 5 | Current or historical implementation behavior | `observed`; never sufficient by itself |
| 6 | Agent inference or naming convention | `assumed`; may produce only a question |

Repository instructions may constrain how work is performed. Treat them as a product obligation only
when they explicitly define runtime or delivery behavior for the audited candidate.

When two sources of equal or materially different authority disagree, record both and emit
`contract-conflict`. Do not choose the convenient source. A source that applies to another version,
environment, or feature flag is not a contradiction; record its applicability.

## Universal properties

Use an otherwise unstated property only when violating it is inherently destructive or nonsensical
for the domain. State the applicability argument. Examples include:

- committed data must not disappear without a declared deletion path;
- a successful single logical operation must not apply a destructive effect twice merely because
  transport redelivered it;
- an algorithm advertised for a finite valid input must terminate unless a streaming/unbounded
  contract says otherwise;
- authorization cannot be bypassed through an equivalent alternate entry point.

Do not invent business preferences such as ordering, rounding, retry count, or timeout values.

## Procedure checks

Select relevant cases from these groups:

### State and lifecycle

- initial state has a reachable valid successor;
- terminal states reject or safely absorb late events;
- every declared state is reachable and has a defined exit where required;
- invalid transitions cannot be produced through alternate entry points;
- state and emitted events cannot disagree after partial failure.

### Effects and durability

- durable state is committed before acknowledgement when the contract requires recoverability;
- external effects and local records have a defined ordering;
- compensation covers every effect already applied;
- rollback is safe when invoked twice or after a partial rollback;
- success is not exposed before required effects are durable.

### Retry, concurrency, and delivery

- duplicate delivery preserves idempotence where promised;
- retry does not reuse stale state or repeat a non-idempotent effect;
- concurrent actors cannot violate uniqueness or move state backward;
- timeout and late completion have a deterministic winner;
- cancellation races cannot leave an impossible mixed state.

### Authorization and alternate paths

- HTTP, worker, scheduler, admin, webhook, and replay paths enforce equivalent relevant policy;
- permission is checked against the resource actually mutated;
- cached or queued authorization context cannot silently outlive its contract;
- recovery and migration paths do not bypass validation required on the primary path.

## Algorithm checks

Select properties supported by the declared algorithm contract:

- **conservation:** no input item/token/value disappears unexpectedly;
- **uniqueness:** no item/effect is duplicated unexpectedly;
- **ordering/stability:** required ordering and tie behavior are preserved;
- **boundary coverage:** empty, singleton, exact threshold, threshold ±1, maximum, and malformed
  inputs behave as declared;
- **termination/progress:** each iteration reduces a well-founded measure or advances a cursor;
- **monotonicity:** increasing an input does not reverse a promised monotone result;
- **numerical safety:** rounding, overflow, NaN, precision, and unit conversions preserve stated
  constraints;
- **resource bounds:** time, memory, calls, chunks, or tokens remain within declared limits;
- **equivalence:** optimized and fallback paths satisfy the same externally visible contract;
- **determinism:** repeated seeded input is stable when determinism is promised.

Prefer the smallest counterexample that demonstrates a violation. Record any required seed and exact
preconditions.
