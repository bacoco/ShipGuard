# Optional goal-to-evidence pre-review

`--goal FILE` extends the **existing explicitly invoked local-model runner**, not the host's
native `/goal`, the dialogue hooks, the dashboard schema or delivery authority. No model is
installed, selected or invoked merely because the plugin contains this feature. Without the flag,
the runner's report fields and citation guard are unchanged. Duplicate CLI options now fail early.

## Producer and consumer

When requested for a ShipGuard pre-review, `grill-goal` can write numbered success criteria inside
its normal standalone Markdown output after its existing confirmation step. The receiving human
or agent retains the original request as a separate, explicitly selected file. The pre-review
compares that request with the goal; it does not infer confirmation from the file's existence.
Ordinary free-form goals and conversational pre-review remain supported without this mode.

The convention is deliberately narrow: exactly one `## Success criteria`, then one unique
`### SG-R1 — Title` heading per criterion, with substantive body text. IDs are `SG-R` followed by
1..9999, not necessarily sequential. ASCII ` - ` also works instead of ` — `. Level-four headings
may organize a criterion; the next level-three heading must start another numbered criterion.
A level-one/two heading ends the section. No unnumbered preamble is accepted in the section.
Fenced examples are not parsed as headings. Unclosed fences and misplaced IDs are rejected.
This is not a general Markdown parser: use plain, unindented ATX headings without closing hashes.

Illustration only — this is not an approved user goal or a claim of executed verification:

```markdown
# Login change
Purpose: simplify the already-identified redundant screen without changing identity or access.

## Success criteria
### SG-R1 — Keep the existing SSO
Source: the user's explicit instruction to retain SSO; not an inferred implementation preference.
The existing identity provider still handles login. Inspect its configuration and exercise the
agreed login flow. A page rendering without using that provider is a counterexample, not success.

### SG-R2 — Preserve denied access
Source: the separately established access-control requirement; do not infer it from SG-R1.
An unauthorized user remains denied. Proposed verification: the agreed allowed/denied scenarios.
A successful test-account login alone does not cover this criterion. These checks have not run.

## Progress
Do not change these requirements to claim completion. A revision requires the existing decision path.
```

Do not introduce requirements absent from the real request or accepted sources to fill this example.
Retain every material constraint in the numbered inventory; code cannot prove that the inventory
captures all human intent. Do not silently reformat, shorten or overwrite an old goal to pass a parser.

## Explicit invocation

Run only when the user has requested the endpoint/model and supplied the input files. Replace the
paths and endpoint with the actual authorized values; this documentation does not activate them.

```bash
node plugins/shipguard/skills/sg-pre-review/run-pre-review.mjs \
  --root /path/to/project \
  --request /path/to/original-request.md \
  --goal /path/to/GOAL-login.md \
  --endpoint http://127.0.0.1:8080 \
  --model configured-model
```

The existing runner posts to `/v1/chat/completions` on the explicit endpoint origin. This mode does
not add authentication, endpoint discovery or a provider fallback. The full selected request,
goal, skill guidance and bounded repository readings reach that endpoint. Choose appropriate
source content and a permitted destination; there is no new automatic redaction or history crawl.
`--trace NEW_FILE`, when explicitly requested, additionally saves that exchange and can contain
sensitive source content. No report or goal file is otherwise written by the runner.

## What is checked

Before a model call, request and goal are read as bounded regular UTF-8 files (each <=64 KiB).
The runner accepts at most 16 numbered criteria, each with 1..8000 body characters. These are
transport bounds, not permission to drop human requirements. Oversized or unsupported inputs fail
before inference; use conversational review or an explicitly scoped division retaining all criteria.

For a final action the model supplies a `goal_alignment` claim (`consistent`, `conflict`, `unknown`)
and one `goal_coverage` row per input ID. A row has `id`, `status` (`analyzed`, `unresolved`, `conflict`),
`comparison`, `verification` and `evidence`. Comparison/verification are nonempty bounded strings.
Analyzed/conflict rows need their own 1..8 exact-line citations from source actually read; evidence
uses the existing guard. An unresolved row may have no citations and must state what is missing.
The goal's text and IDs come from the input snapshot, never from a replacement model inventory.

Missing/duplicate/invented IDs, bad citations, unknown alignment and unresolved/conflicting rows
keep the report `partial` and the decision `undetermined`. Original bytes and selected real-path
identities are rechecked before subsequent calls and final reporting. Changed or unreadable inputs
keep old evidence from validating the new request/goal. This is an equality observation, not a
signature, an OS write lock or a complete audit of transient changes between observations.

Corrections use the existing **same 12-call budget**, not a fresh inner loop. The final permitted
response is checked. In goal mode the output cap is `1800 + 400 * criterion_count` tokens per call,
up to 8200; without it the existing cap remains 1800. This can cost more and is not a monetary
reservation or a global descendant budget. No savings or quality benefit has been measured.

## Result and limitations

Stdout adds `goal_review` with code-computed input digests, criterion text/line ranges, source
freshness, coverage status, per-criterion analysis claims and alignment claim. It remains distinct
from `prereview-results.json`; no dashboard consumer or schema is changed. The raw `model_claim`
is retained as a claim, not promoted into authority. Exit 3 means partial; exit 0 means the
pre-review was delivered under its structural checks, **never that the goal was fulfilled**.
Invalid startup inputs fail nonzero before inference. Existing transport errors also fail nonzero.

A complete inventory does not prove semantic entailment, human approval, test execution, business
benefit or delivery permission. An agent can misclassify an interpretation or give a wrong analysis
with real quotations. The tests deliberately preserve that counterexample. Required human decisions,
independent acceptance checks and the host's permissions remain necessary. This mode does not
freeze the whole repository, validate a delivered candidate SHA, control another worker's files,
interrupt every native tool path or integrate Loriq. Source citations retain the existing guard's
coverage. Request/goal freshness is not a whole-repository immutability claim.

Disable by omitting `--goal`; this creates no durable state to migrate or delete. The ordinary goal,
mission-lock, dialogue checks and prior reports remain untouched. Do not treat disabling the mode
as a reason to label previously unresolved work verified.

## Focused tests

```bash
node plugins/shipguard/skills/sg-pre-review/goal-coverage-smoke-test.mjs
node plugins/shipguard/skills/sg-pre-review/goal-runner-smoke-test.mjs
```

The first tests parsing, source identity, coverage and provenance, including the old guard's gap.
The second exercises the real runner with a loopback HTTP fixture, including last-call success,
revision during execution, limits, cancellation and legacy mode. It calls no real model and is not
a comparison of model performance or a qualification of every Claude Code/Codex host installation.
