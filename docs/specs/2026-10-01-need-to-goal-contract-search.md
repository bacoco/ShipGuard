# Need-to-goal continuity: challenged design and first implementation

**Status, 1 October 2026:** an opt-in goal-aware pre-review is implemented in PR #89, with
focused deterministic tests. It is not merged, activated or behaviorally qualified with a real
model. Issue #90 remains the owner of the wider study. The owner's later request explicitly
authorized challenging the proposal, implementing the justified change and updating this PR;
the earlier documentation-only mandate is historical, not a prohibition on this implementation.
No merge, model evaluation, deployment, hook activation or scheduler change is included.

The **[complete initial RFC][original] remains preserved at its immutable Git revision**. This
revision replaces its design-only status and records which claims survive the challenge. This is
an adversarial re-analysis by the implementing assistant, not a review by a second independent AI.

## 1. Retained problem; rejected overreach

Retain the user's central idea: an imperfectly worded need should lead to a faithful definition
of success, suitable guidance and verifiable outcomes, without allowing the producing agent to
quietly redefine success. Separate uncertainty about **what is wanted** from uncertainty about
**how to achieve it**. Repeated solutions cannot reveal an absent human preference by themselves.

Reject a quantum-equivalence claim, guaranteed convergence, automatic inference of human consent,
and scalar scores that compensate for violating mandatory constraints. The energy-landscape
analogy is motivation, not an implemented physical or optimization mechanism. Tree search is not
justified as this patch's first dependency. Whether extra exploration earns its cost remains unknown.

The strongest counterargument is that almost everything is already described in GrillGoal and
mission-lock; adding another contract service would duplicate them. That counterargument holds for
a new goal interview, ambiguity controller or orchestrator. A narrower concrete gap remains in
one existing consumer: its mechanical guard checks **some citations**, not **each named criterion**.

## 2. Source baseline and actual counterexample

Main was rechecked at `db30182e55c5fddc82615944404898172de7df58`; PR head before this work was
`15c81e2ee65505ae18cf46910e536ebe779f5829` (only the original RFC). Issue #90 and the PR discussion
were reread. This is targeted source inspection and a local reconstructed test subset, not a full
checkout audit or live plugin installation. Eleven original dependency/source/test blobs were
reconstructed from standard GitHub connector reads and matched against their Git blob SHA-1s.

[The original guard][old-guard] checks decision, comparison and a nonempty exact citation list.
[Its caller][old-runner] uses that guard both at final-action admission and when building the final
report. [The report contract][old-report] nevertheless calls for evidence per requested outcome.

Reproduced counterexample: a supplied goal has two criteria; the final model action cites real code
but discusses only the first. The old `guardDecision()` returns `completed`. That word already meant
review delivery, not business success, so this is **not evidence of an unauthorized product release**.
It is a missing mechanical coverage check. The new explicit `--goal` path returns `partial` and
`undetermined`, naming the omitted ID. The legacy no-goal path is deliberately not redefined.

A second counterexample limits the new implementation: the model supplies real citations for both
criteria but gives a semantically wrong explanation. Structural checks can still complete. A test
retains this case and verifies `semantic_verification: not verified`. No hash, ID or JSON schema
solves human-intent inference, semantic entailment or self-grading bias.

## 3. Claim register: challenge of every initial section

| Initial section / proposition | Decision after challenge | Basis / remaining boundary |
| --- | --- | --- |
| 1: need and solution search are different | Retain as design distinction | An absent preference cannot be established by repeating code attempts. No quantified benefit follows. |
| 1: continuity will help more than extra effort | Unproven hypothesis | No comparative model experiment was run. Do not publish it as a measured ordering. |
| 1: quantum/energy motivation | Analogy only | No quantum algorithm, energy function, convergence proof or hardware adopted. |
| 2: existing goal writing and ambiguity handling | Confirmed at inspected source | GrillGoal already confirms synthesis and preserves criteria; dialogue findings already carry alternative interpretations. Reuse, do not rebuild. |
| 2: mission lock supplies enforcement | Qualify | Its hook injects context and is deliberately non-blocking; not a sandbox. It is unchanged. |
| 2–3: goal-to-evidence consumer may be missing | Narrowly confirmed | Original `guardDecision` and its actual runner do not enumerate criteria. The counterexample is reproduced, not inferred from a filename. |
| 3: contract should not become a second authority store | Retain | Use optional numbered sections in the same Markdown goal; no database, sidecar, signature format or approval field. |
| 3: original request and goal must stay distinct | Implemented input separation | Both explicitly selected inputs reach the reviewer and are content-bound. Their semantic alignment remains a model claim. |
| 3: no invented thresholds or silent trade-offs | Retain; not mechanically proven | Existing dialogue plus explicit alignment comparison. Missing human intent still needs the human. |
| 4: explore interpretations only at real ambiguity | Retain as skill guidance | A small instruction addition; no demonstration that a real model follows it. No extra agent team. |
| 4: MCTS / implementation branches | Not selected for this patch | No comparative evidence justifies another runtime. The existing 12-call review loop is not advertised as MCTS. |
| 4: global budgets and final-attempt correctness | Split | Last permitted response is tested; this runner does not add monetary reservation or recursive child accounting. |
| 5: generate goals plus skills/tools/checks | Mostly reuse; narrow extension | GrillGoal remains the generator procedure. The new handoff exposes each criterion and proposed check; it does not install tools or generate an entire harness. |
| 5: adapt guidance by model size | Deferred / unproven | No assumption that larger models are less steerable; no model router, provider change or paid trial. |
| 6: candidate-bound independent verification | Partially relevant, not claimed delivered | Input revisions and per-row citations are checked; there is no whole-repository snapshot, immutable delivered candidate or independent acceptance oracle here. |
| 6: tool result, fulfillment and delivery differ | Retain | `analyzed` and `completed` are review statuses, never test execution, fulfillment or permission. |
| 7: SSO example | Illustrative, not an incident | Preserve its distinction between explicit SSO request and separately established access rules; do not invent requirements from the example. |
| 8: thirteen falsifiers | Mixed coverage, detailed below | Passing a protocol fixture must not be generalized to semantic or live-host behavior. |
| 9: ShipGuard versus Loriq | Retain boundary | This is ShipGuard's existing pre-review consumer. No Loriq source, Operator, admission or queue is changed. |
| 10: staged implementation and comparative evaluation | First slice implemented; evaluation not run | The cancelled model campaign remains cancelled. No superiority or savings claim. |
| 11: challenge rather than endorse | Performed as self-review, not independent certification | Both the old omission gap and the new semantic counterexample are retained. A separate reviewer can still reject the design. |
| 12: ToT, LATS, CIRL references | Valid conceptual leads only | Primary abstract pages rechecked; no reproduction, full-method adoption or transfer claim to ShipGuard. |

## 4. Implemented vertical slice and actual owners

```text
Existing GrillGoal, only when a numbered/pre-review goal is requested
  -> same standalone Markdown goal with SG-R criterion headings
  -> explicitly selected original request + goal + configured reviewer endpoint
  -> existing run-pre-review.mjs --goal FILE
  -> bounded input snapshots and enumerated criteria
  -> existing read/search loop, plus alignment/per-criterion model claims
  -> existing citation guard reused per criterion + input freshness checks
  -> stdout report: complete coverage or explicit partial result, never authorization
```

[`grill-goal/SKILL.md`][grill] remains a single independent file. Its optional numbered-output
instructions are embedded, not loaded from this report. Its original confirmation gate stays intact.
A goal's existence or a caller's `--goal` option does not establish that gate was satisfied.

[`goal-input.mjs`][input] performs bounded UTF-8 regular-file reads, parses a deliberately narrow
Markdown convention and records the original request/goal digests and selected paths. It rejects
duplicate/misplaced IDs, unnumbered section content, unclosed fences and oversized inputs rather
than silently truncating or rewriting the goal. IDs come from this input, not from model output.

[`goal-coverage.mjs`][coverage] calls the existing `guardDecision`/`validateEvidence`, checks every
expected ID once, retains unresolved/conflicting rows and exposes the model's alignment claim.
[`run-pre-review.mjs`][runner] is the actual consumer: it sends both original inputs, applies the
checks on the final action and final report, and stops further calls when inputs have changed.
No new effect tool is added. The Codex adapter and the skill's invocation instructions are aligned.

[The operational reference][usage] specifies the full convention, invocation, output and privacy
boundary. No dashboard schema, hook, permission, plugin version or marketplace metadata is changed.
The feature is on a development branch, not a published new release.

## 5. Limits and choices that must remain visible

Input bounds are 64 KiB per file, 16 criteria, 8000 body characters per criterion. These are
transport limits, not a cap on the user's true requirements. Unsupported goals remain usable
conversationally; never silently shrink or overwrite them to satisfy the parser.

The original request is retained verbatim in this optional mode. A structured goal can still omit
a requirement before numbering. Alignment is a fallible model judgment, not a deterministic proof
that nothing was lost. This is why the original request remains visible and human decisions are
not encoded as an auto-trusted `confirmed` boolean.

Input digests establish byte equality at observations, not signature authenticity, an OS write
lock or a record of transient edits reverted between observations. They do not identify every
repository file or prove a delivered candidate. A valid quote does not prove its relevance.

The same 12-call limit covers corrections. Output allowance in goal mode is 1800 + 400 tokens per
criterion per call (maximum 8200), versus 1800 without the option. It can cost more. No monetary
budget, remote inference cancellation or descendant resource control is promised. Client SIGTERM
is tested; stopping a remote provider's actual computation is not.

Only explicitly configured destinations are used. Selected goal/request text and repository
excerpts reach that endpoint. There is no new redaction, automatic provider, installation, broad
transcript collection or network inference triggered merely by installing the plugin. Optional
traces can contain sensitive content. See the reference before choosing input files/destinations.

## 6. Disposition of the original thirteen failure cases

| Original case | Implemented evidence / residual question |
| --- | --- |
| 1: clear tiny request | Legacy runner case and optional mode; no forced new interview or tree. |
| 2: paraphrase/typo/language | UTF-8/CRLF input preservation tested; semantic invariance across wording is NOT VERIFIED. |
| 3: yes/continue referent | Existing conversational/mission-lock responsibility; no new consent inference. Not behaviorally tested here. |
| 4: absent business threshold | Original text preserved, alignment claim required; correct detection of an invented threshold remains model-dependent. |
| 5: incompatible requirements | A reported conflict remains partial. Discovering every conflict is NOT VERIFIED. |
| 6: correlated wrong interpretations | Wrong-semantics/valid-citations counterexample deliberately retained. No consensus mechanism added. |
| 7: hostile instructions in sources | Extra approval fields create no authority; unknown execution action cannot execute. Real-model prompt-injection resistance is NOT VERIFIED. |
| 8: worker changes checker | This runner has no effect tool; a goal change invalidates its report. Independent external checker protection is not supplied. |
| 9: stale requirement/candidate | Goal/request revision and identity changes tested. Full candidate-SHA binding is not implemented by this slice. |
| 10: final attempt / budget | Success on call 12 and exhaustion without final result tested; no child/global monetary guarantee. |
| 11: missing context / failed verification | Omitted criteria, unread/forged citations, missing inputs and truncated response stay partial/nonzero. No full hook/controller qualification. |
| 12: incompatible successful components | The need for an integrated scenario remains in the design; no application integration test was run. |
| 13: revision / cancellation | Input changes stop further calls; SIGTERM stops this client without retry. Authority to change the requirement still comes from outside the model. |

## 7. Verification receipt and reproducible commands

On Linux with Node.js **v22.16.0**, the changed code was tested in a reconstructed subset whose
original dependency blobs were checked against Git. No dependencies were installed. The focused
suites are the existing dependency-free Node scripts, not a new framework:

```bash
node plugins/shipguard/skills/sg-pre-review/pre-review-smoke-test.mjs
node plugins/shipguard/skills/sg-pre-review/evidence-guard-smoke-test.mjs
node plugins/shipguard/skills/sg-pre-review/goal-coverage-smoke-test.mjs
node plugins/shipguard/skills/sg-pre-review/goal-runner-smoke-test.mjs
```

The new unit cases exercise the old omission counterexample, corrected coverage, malformed goals,
source identity/revision, ungrounded citations and the deliberately unresolved semantic limitation.
The runner cases execute the real consumer against an ephemeral loopback HTTP fixture, not a real
LLM: legacy mode, both source inputs, partial reports, bounded correction, last-call success,
revision in flight, incomplete response, unsupported input, unknown effect request and cancellation.
The project fixture remains byte-identical; changes in revision tests are performed by the test
fixture, never by the runner. Packaging and original citation-guard checks also pass.

These tests do not establish model usefulness, live host activation, Windows/macOS compatibility,
browser behavior, whole-repository correctness, remote-provider cancellation or production delivery.
No live benchmark, new scheduled task, plugin installation or merger was performed. Exact test
counts and the published commit identity are recorded in the PR/issue receipt after publication.

## 8. Next decision, not an automatic next action

Retain this opt-in handoff if its structural checks are useful to a real pre-review consumer.
A later reviewer should particularly challenge the narrow Markdown convention, the burden of
numbering, false completeness despite a lossy goal and the output allowance. A simpler manual
review remains a legitimate alternative. Omitting `--goal` removes no existing protection and
leaves no new durable state to migrate.

Issue #90 stays open for any separately authorized behavioral assessment. Compare the existing
GrillGoal path with this handoff before testing a search layer, keeping tasks/models/rights/checks
and total costs comparable. The earlier cancellation of model evaluations is not reversed here.
No result in this patch justifies a new MCTS service, autonomous model router or permission gate.

Loriq [#1170][L1170], [#1171][L1171], [#1162][L1162] and [#1166][L1166] remain related study owners;
their private code and execution evidence are not copied into this public document. This pass
implements no Loriq adapter. ShipGuard [#77][I77] and [#82][I82] remain the prior dialogue-hook and
authority/receipt discussions, not evidence that all their historical proposals are active.

## Sources

The [initial RFC][original] preserves the full historical source register and proposal. The three
primary abstract pages consulted again are [Tree of Thoughts][R1], [Language Agent Tree Search][R2]
and [Cooperative Inverse Reinforcement Learning][R3]. They respectively support the existence of
path exploration/backtracking, MCTS with environment feedback, and uncertainty about human rewards.
They do not demonstrate the usefulness of this ShipGuard implementation.

[original]: https://github.com/bacoco/ShipGuard/blob/15c81e2ee65505ae18cf46910e536ebe779f5829/docs/specs/2026-10-01-need-to-goal-contract-search.md
[old-guard]: https://github.com/bacoco/ShipGuard/blob/db30182e55c5fddc82615944404898172de7df58/plugins/shipguard/skills/sg-pre-review/evidence-guard.mjs
[old-runner]: https://github.com/bacoco/ShipGuard/blob/db30182e55c5fddc82615944404898172de7df58/plugins/shipguard/skills/sg-pre-review/run-pre-review.mjs
[old-report]: https://github.com/bacoco/ShipGuard/blob/db30182e55c5fddc82615944404898172de7df58/plugins/shipguard/skills/sg-pre-review/references/report.md
[grill]: ../../plugins/shipguard/skills/grill-goal/SKILL.md
[input]: ../../plugins/shipguard/skills/sg-pre-review/goal-input.mjs
[coverage]: ../../plugins/shipguard/skills/sg-pre-review/goal-coverage.mjs
[runner]: ../../plugins/shipguard/skills/sg-pre-review/run-pre-review.mjs
[usage]: ../../plugins/shipguard/skills/sg-pre-review/references/goal-coverage.md
[L1170]: https://github.com/bacoco/Loriq/issues/1170
[L1171]: https://github.com/bacoco/Loriq/issues/1171
[L1162]: https://github.com/bacoco/Loriq/issues/1162
[L1166]: https://github.com/bacoco/Loriq/issues/1166
[I77]: https://github.com/bacoco/ShipGuard/issues/77
[I82]: https://github.com/bacoco/ShipGuard/issues/82
[R1]: https://arxiv.org/abs/2305.10601v2
[R2]: https://arxiv.org/abs/2310.04406v3
[R3]: https://arxiv.org/abs/1606.03137v4
