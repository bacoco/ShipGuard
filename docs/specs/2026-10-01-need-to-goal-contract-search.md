# RFC: user-need contracts and bounded goal search

Status: **proposal for independent review and development; not implemented**. Requested by the repository owner on 1 October 2026. This PR records a design and a review handoff, not an adopted algorithm or a runtime feature.

## 1. Outcome and central hypothesis

Help a user express an imperfectly worded need without requiring a perfect prompt. Automatically prepare a faithful, inspectable definition of success, propose the relevant guidance and checks, then explore a bounded set of ways to satisfy it. Never let the producing agent redefine success to accommodate its own solution.

Proposed flow:

```text
Original need + relevant authorized sources
  -> alternative interpretations when materially necessary
  -> source-backed draft success contract + explicit unknowns
  -> existing human confirmation and authority boundaries
  -> task-specific guidance, tools and verification proposals
  -> bounded exploration within the accepted contract
  -> observations on the actual candidate
  -> existing acceptance/delivery decision, or explicit unresolved work
```

There are TWO search problems: understanding what outcome the human intends, and finding a solution to that outcome. More attempts at the second cannot establish a missing preference in the first. The hypothesis to challenge is that better need-to-evidence continuity helps more initially than indiscriminately adding reasoning effort, agents or implementation attempts. No improvement has been measured here.

The motivating quantum/energy-landscape analogy is only an analogy for constrained optimization. This design proposes neither a quantum algorithm nor deterministic convergence to the user's true goal. A stable-looking answer is not proof of correctness. Native `/goal` features, where supported, would be downstream execution conveniences, not an authority or verification oracle; their exact integration requires version-specific inspection.

## 2. Evidence boundary and existing-first decision

ShipGuard source inspected at `db30182e55c5fddc82615944404898172de7df58`, reconfirmed before publication. Read repository instructions, the skills and hook sources below, and related issue bodies. Inspections were targeted, not a complete audit of every branch, test or installation. No plugin execution, host qualification or model experiment was performed.

| Existing surface | What the inspected source already provides | Consequence for this proposal |
| --- | --- | --- |
| [GrillGoal][S1] | Source investigation, material clarification, human-confirmed synthesis, observable criteria, counterexamples and a standalone goal. Explicitly forbids weakening success criteria to finish. | Do not invent a second goal interview or claim goal generation is missing. Preserve the standalone single-file contract. |
| [Mission lock][S2] | Scope, modes, authority, protected invariants, completion discipline and bounded delegation in agent instructions. Its hook injects guidance; it is not an execution sandbox. | Reuse the mission boundary. Do not turn its stateless, non-blocking hook into a new enforcement engine. |
| [Pre-review][S3] | Actual producer/consumer investigation and `use / configure / extend / create / none / undetermined` decisions, explicitly report-only. | Use it to decide whether existing behavior is sufficient before any development. Do not make it automatically execute its recommendation. |
| [Logic-audit obligations][S4] | Source applicability, conflicts, traceable obligations and adversarial checks; inferred preferences remain questions. | Reuse these distinctions rather than create a competing requirement taxonomy. Existing behavior or a test is not automatically the intended new behavior. |
| [Dialogue dispatcher][S5] and [helpers][S6] | Opt-in bounded event views, exact-passage validation, findings with two or three interpretations, and one bounded Stop correction. Incomplete `clear` becomes `unknown`. | Alternative interpretations ALREADY exist locally. The possible extension is continuity across the whole need, contract and evidence, not a new ambiguity detector. |
| [Dialogue-hook contract][S7] | Selected context only, no transcript crawling, no automatic controller/provider selection, no semantic permission grant and explicit coverage limits. | Preserve opt-in behavior, source privacy, unknown/unavailable states and actual host boundaries. Do not equate hook delivery with protection or successful completion. |

The candidate delta is therefore **a small, source-backed handoff from the existing goal process to its actual verification consumers, plus selective exploration where ambiguity or a costly decision justifies it**. It may require only better composition/documentation. A new skill, schema, service or search engine is not the default conclusion.

Related [ShipGuard #77][I77] is historical context: the optional hooks are already present in the inspected source, notwithstanding older proposal wording. [ShipGuard #82][I82] is the existing discussion of truthful receipts and objective authority boundaries; do not silently adopt its proposals or copy superseded observations as current bugs.

## 3. A success contract is a view, not a new authority store

Start by expressing the following information inside the existing goal and its source references. These are logical responsibilities, **not a newly approved JSON schema or mandatory sidecar**. Only introduce machine-readable fields after naming a real producer and consumer that need them.

| Information | Required distinction |
| --- | --- |
| Original request and applicable sources | Preserve exact wording, source identity/revision and access boundary. A generated summary is not an original human instruction. |
| Desired result and beneficiary | State the concrete outcome, not just a task list or a preferred implementation. A benefit not yet observed remains a target, not a result. |
| Requirement-to-check mapping | For each material requirement: supporting passage, interpretation status, proposed observable check or human rubric, and expected evidence. |
| Non-negotiable constraints and preferences | Mandatory restrictions cannot be exchanged for speed, cost or aesthetic benefits. Keep unresolved trade-offs visible. |
| Existing authority | Reference the host's or project's actual permission/mission boundary. A field saying `confirmed` must not create approval or execution rights. |
| Unknowns and alternatives | Distinguish human decisions, observations, supported interpretations and assumptions; identify what would resolve a material uncertainty. |
| Completion, revision and stop | Identify what establishes completion, which evidence becomes stale on change, and how cancellation, missing capability or budget exhaustion are reported. |

Do not invent numeric requirements from adjectives. “Faster” does not mean “under 500 ms”; “simpler” does not mean “two clicks.” Seek available evidence first, then ask only for the material preference still missing. Preserve the existing requirement for confirmation of GrillGoal's synthesis, without re-asking settled questions or demanding fresh approval for routine means already delegated. A question budget must not force invention of an answer.

Current specifications, executable contracts and the new request can conflict. Preserve both with their applicability and ask for the necessary decision; do not silently let a stale test override an explicitly requested change, or let an agent inference erase a protected constraint. Exact quote validation establishes provenance, not that an interpretation is entailed by the quote.

Where the need remains underdetermined, return a draft with the unresolved choice. A reversible, already-authorized investigation common to the plausible interpretations may continue; incompatible product decisions must not be silently chosen. The goal can legitimately change through the existing authorized revision process. The worker may change its plan, not quietly rewrite the goal or the checks used to judge it.

## 4. Two bounded explorations, not endless retries

### A. Interpret the need

Generate genuinely different readings only at a consequential ambiguity. For each, retain supporting sources, contradictory sources, added assumptions and the smallest discriminating observation or question. Start from the user's words and available project facts rather than polishing one initial model guess repeatedly.

Reject an interpretation that contradicts an explicit constraint. Do not rank a convenient-to-implement interpretation as the user's preference. A model's confidence is not a calibrated probability of human intent. Multiple models sharing the same bad summary do not supply independent confirmation. Keep access to the relevant original sources rather than only the common summary.

### B. Find a solution to the accepted need

Compare concise, materially different plans before paying for complete implementations. Include reuse, configuration, a minimal extension and no change where they can satisfy the request. Use cheap, relevant source checks or sandboxed probes before expanding a branch. Stop branching when additional candidates would not inform a consequential decision.

The first candidate design is limited alternatives plus evidence-based elimination, not a mandatory Monte Carlo Tree Search runtime. A later tree-search experiment must define its actual state, legal actions, expansion rule, feedback, duplicate-state handling and stop conditions. A different temperature or repeated retry alone should not be advertised as MCTS.

Any future controller must account for all covered exploration, tool, evaluator and retry costs under the existing admitted resource envelope. Changing branch, model, session or child must not reset the budget. Missing telemetry stays unknown. An explicit user stop outranks resumption. A final allowed attempt must still have its result evaluated before reporting exhaustion; evaluation effort must be budgeted too.

First check admissibility, then compare preferences among eligible candidates. An attractive scalar score cannot compensate for a violated mandatory constraint, confer tool authority or authorize delivery. In Loriq, preserve its existing no-score delivery and engine-authority boundaries. Semantic exploration remains fallible even when scheduling and syntactic checks are deterministic.

## 5. Compile the “and everything around the goal” carefully

The proposed output is not merely a longer prompt. For each requirement, propose the smallest relevant guidance, context, skill, tool capability and verification method. Record why each is necessary and which existing component supplies it. Unsupported capabilities are gaps, not tools the model may invent or install implicitly.

Separate a capability request from an actual permission grant. Put exact restrictions in existing enforceable host controls where available; do not describe prose, an advisory PreToolUse message or a positive semantic judgment as equivalent enforcement. If a required guarantee cannot be enforced on a host, state that limitation and use the existing blocked/manual path rather than silently lowering it.

An optional handoff could add a compact requirement-to-proof section to GrillGoal's output and let an explicitly invoked pre-review consume it. The reviewer must establish whether those existing instructions already suffice. GrillGoal itself must remain usable from its single `SKILL.md`, with no required scripts, adapter, external reference or extra files in that skill directory. This RFC adds none.

Adapt task decomposition and guidance to an explicitly selected model only where useful evidence supports doing so. Do not assume that larger models are inherently less steerable or smaller models inherently need the same extra instructions. Model changes must not change the business contract or silently select a provider, increase spending or widen permissions.

## 6. Verification: observe the candidate, not the success story

Bind each relevant result to the accepted requirement revision, actual candidate and check definition, plus the environment/run identity needed to interpret it. Reuse existing artifacts and states. A proposed artifact format is not evidence that a host already supplies these bindings.

Keep separate: a procedure ran; its assertion passed; a business scenario was satisfied; the human benefit was observed; delivery was authorized. A zero exit status, screenshot or completed goal loop is not interchangeable with all five. A mechanical gate only proves what its checks actually cover; qualitative usability may need a human rubric or observation.

The producer must not control the trusted acceptance baseline or make its own edits to a checker authoritative. Legitimate test improvements can be proposed as changes, but must be reviewed without discarding the original requirement. A checker outside the LLM but writable by the worker is not independently protected merely because it is code.

Never promote missing, unavailable, stale, not-run, interrupted or budget-exhausted evidence to completion. Review actual outputs rather than only the worker's final narrative. Recheck affected evidence after a relevant candidate, requirement or check change; do not rerun unrelated suites automatically. Combine component results with an integration check when the user scenario depends on their relationship.

For dialogue checks specifically, Stop does not magically contain previous tool results: supply permitted evidence through the existing selected-context path or remain uncovered. PostToolUse is after the effect, not prevention. Preserve the existing single correction and no-controller-retry limits; do not hide an exploration loop in the Stop hook. [S5–S7]

## 7. Worked example, fictional and not a final goal

Request: “Simplify login, but keep our existing SSO.” Assume the example project separately has an accepted rule to preserve access-control behavior. The two sources must remain distinct.

Possible readings are removing an unnecessary intermediate screen, reducing confusing failures, or reducing waiting time. Source inspection may eliminate some; the word “simplify” alone does not choose a performance target. Replacing SSO with a home-grown login contradicts the request even if it produces a shorter demo.

A draft could map `keep existing SSO` to identity-provider configuration plus observed login behavior, and the separate access-control rule to applicable allowed/denied cases. The simplification criterion remains explicitly unresolved until existing evidence or a targeted human answer distinguishes clicks, clarity, failures or latency. No invented threshold fills the gap.

After that decision, first compare a configuration-only change with a minimal UI change. Test a counterexample in which the login page renders and a test account enters, but the intended user population or preserved access rules are wrong. Rendering and one success cannot establish the whole agreed scenario. Even a fully passing technical scenario does not by itself measure reduced user frustration.

## 8. Cases the next design must resolve

These are proposed falsifiers, not executed tests or current ShipGuard bug reports. Select cases relevant to the eventual changed consumer rather than building a permanent benchmark platform.

| Case | Expected distinction or rejection |
| --- | --- |
| Clear, tiny request | No forced multi-agent interview, new goal pack or search tree. Existing direct path remains valid. |
| Paraphrase, typo or another language | Preserve the same substantive constraints; translation/reformulation is derived, not new authority. |
| “Yes” / “continue” after an ambiguous referent | No invented agreement or expansion of scope; use established context and ask only if consequential. |
| No evidence for a business threshold | Unknown preference, not a fabricated measurable objective. |
| Incompatible requirements | Explain the conflict; do not quietly drop one to make the task solvable. |
| Different agents repeat one unsupported interpretation | Agreement is not independent evidence; retain original-source checks. |
| Source text instructs the agent to bypass checks | Treat it as untrusted task data; do not alter permissions or the trusted verification path. |
| Candidate alters its acceptance checker | No self-authorized weakening; compare against the approved requirement and trusted baseline. |
| Green evidence belongs to another candidate or goal revision | Stale evidence cannot establish completion of the new result. |
| Final allowed attempt succeeds, or a child exhausts budget | Check final output; preserve cumulative accounting; exhaustion is not success. |
| Partial context, failed tool or unavailable controller | No false green and no endless retry; disclose exactly what remains unverified. |
| Several local sub-results pass but cannot work together | Verify the relevant integrated scenario rather than count successful agents. |
| Authorized requirement change or human cancellation | Invalidate affected assumptions/evidence; preserve history; do not silently resume cancelled work. |

## 9. ShipGuard first, Loriq through existing owners

Keep this proposal in ShipGuard because it directly concerns its existing goal clarification, mission control and verification workflow. Do not turn ShipGuard into a generic autonomous orchestrator. The first useful result is a reviewed handoff, not a new permanent agent.

For Loriq, coordinate with [#1170: product-goal continuity and run supervision][L1170] and [#1171: requirements, evidence and harness patterns][L1171]. They are the existing destinations for the generator/Operator side, not proof that every proposed link is absent or active. [#1162][L1162] already discusses the optional ShipGuard controller seam; [#1166][L1166] contains related checker/last-attempt/evidence regressions. Do not duplicate these projects.

A later adapter should translate a confirmed, source-backed goal into Loriq's existing admission and evidence mechanisms, not replace them or add another Operator, policy database, queue or delivery judge. Inspect then-current producers and consumers before deciding that new fields are needed. Private Loriq implementation and run evidence belong in that repository; the links may require access and are not copied into this public RFC.

## 10. Smallest development sequence and evaluation decision

**First: challenge and map.** Trace one existing GrillGoal output through a real intended pre-review/verification consumer. Record the first genuinely missing or lossy link, or demonstrate that there is none. Choose `use`, `configure`, `extend`, `create`, `none` or `undetermined` with source-backed reasoning. Do not begin with a new parser or agent team.

**Then: one opt-in vertical slice, if justified.** Prefer an output/handoff clarification inside existing skill contracts. If executable support is actually necessary, name its producer, consumer, file scope, source/acceptance boundary and focused dependency-free tests before implementation. Leave existing defaults, mission-lock behavior, result schemas and release versions unchanged in this design PR. Provide an opt-out that preserves existing protections and evidence.

**Only later: test whether search earns its cost.** Proposed comparisons are A: direct request under unchanged host safeguards; B: existing GrillGoal plus those same safeguards; C: B plus the proposed coverage handoff; D: C plus selective exploration. B, not a bare-prompt straw man, is the incumbent for judging the new contribution. Keep tasks, model, tools, authority, independent checks and total resource accounting comparable. Include equivalent paraphrases, genuinely underdetermined requests and fresh cases not used to tune the proposal.

Report requirement fidelity, omissions, false completion, scope violations, useful/unnecessary questions, integrated outcomes, latency and total resource use separately. Human adjudication is necessary where the need itself is ambiguous; self-grading is not ground truth. Keep failures and inconclusive results. No aggregate score becomes an execution or delivery authority, and no claim of lower cost follows from token price alone.

**No such model evaluation is authorized or run by this PR.** The maintainer's cancellation recorded in the dialogue-hook documentation remains in effect. Any new model-backed pilot needs a separate explicit mandate and budget; technical protocol fixtures cannot substitute for it. A review may reject the search layer or conclude that no new implementation is needed. [S7]

## 11. Handoff to an independent reviewer

Challenge this proposal rather than endorse it. Read the current code and applicable repository instructions, not just this RFC. Develop the idea by answering the following in the PR discussion, with an updated design patch where warranted:

1. Which claims are confirmed, contradicted, already covered or still unknown? Cite the actual producer, consumer and activation boundary; distinguish instructions, code, configured behavior and observed execution.
2. What is the strongest simpler alternative: use GrillGoal unchanged, improve a handoff, or reuse a current check? Identify the first concrete case where this proposal adds value, or explain why none is established.
3. Can generated requirements or evaluations entrench the same mistaken interpretation? Show a counterexample and the source/human decision needed to break that correlation. Do not turn mathematical notation or valid JSON into semantic proof.
4. Specify the smallest retained change, its input/output, invocation, privacy/authority boundary, compatibility, focused falsifier and removal path. Preserve the single-file GrillGoal and separate mission-lock/dialogue-hook contracts.
5. Decide what belongs in ShipGuard versus the existing Loriq issues. Keep unsupported conclusions, remaining research and any follow-up implementation durably linked; do not mark them implemented because the RFC merges.

Completion of this handoff means a reasoned adopt/modify/defer/reject decision and an actionable next slice, not automatic deployment. This PR publishes documentation only. It does not assign or invoke a reviewer, install a provider, activate hooks, restart cancelled evaluations, launch work, merge code or create a scheduler.

## 12. Sources and research leads

The source links below pin the inspected ShipGuard implementation. Issue bodies were read as historical/design context; not every comment or later branch was audited. Paper abstract pages were checked for the concepts below, not full implementation suitability or reproduced results.

[Tree of Thoughts][R1] motivates comparing paths and backtracking. [Language Agent Tree Search][R2] explicitly integrates Monte Carlo Tree Search and environment feedback. [Cooperative Inverse Reinforcement Learning][R3] is a conceptual reference for uncertainty about the human's objective. None demonstrates the proposed ShipGuard benefit, and none is selected as a dependency. The next researcher should inspect the full methods only where they can change the design decision.

[S1]: https://github.com/bacoco/ShipGuard/blob/db30182e55c5fddc82615944404898172de7df58/plugins/shipguard/skills/grill-goal/SKILL.md
[S2]: https://github.com/bacoco/ShipGuard/blob/db30182e55c5fddc82615944404898172de7df58/plugins/shipguard/skills/sg-mission-lock/SKILL.md
[S3]: https://github.com/bacoco/ShipGuard/blob/db30182e55c5fddc82615944404898172de7df58/plugins/shipguard/skills/sg-pre-review/SKILL.md
[S4]: https://github.com/bacoco/ShipGuard/blob/db30182e55c5fddc82615944404898172de7df58/plugins/shipguard/skills/sg-logic-audit/references/obligations-and-checks.md
[S5]: https://github.com/bacoco/ShipGuard/blob/db30182e55c5fddc82615944404898172de7df58/plugins/shipguard/hooks/dialogue-check.mjs
[S6]: https://github.com/bacoco/ShipGuard/blob/db30182e55c5fddc82615944404898172de7df58/plugins/shipguard/hooks/lib/dialogue-check.mjs
[S7]: https://github.com/bacoco/ShipGuard/blob/db30182e55c5fddc82615944404898172de7df58/plugins/shipguard/docs/dialogue-hooks.md
[I77]: https://github.com/bacoco/ShipGuard/issues/77
[I82]: https://github.com/bacoco/ShipGuard/issues/82
[L1170]: https://github.com/bacoco/Loriq/issues/1170
[L1171]: https://github.com/bacoco/Loriq/issues/1171
[L1162]: https://github.com/bacoco/Loriq/issues/1162
[L1166]: https://github.com/bacoco/Loriq/issues/1166
[R1]: https://arxiv.org/abs/2305.10601v2
[R2]: https://arxiv.org/abs/2310.04406v3
[R3]: https://arxiv.org/abs/1606.03137
