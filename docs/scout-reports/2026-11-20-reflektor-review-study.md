# Reflektor: guided review and persistent feedback study

Date: 2026-11-20. Tracking: [#230](https://github.com/bacoco/ShipGuard/issues/230).

**Recommendation: evaluate a small extension to the existing review experience.**
The likely benefit is helping a reviewer navigate a change and resume feedback across rounds.
No comparative runtime evidence establishes an improvement yet.

## Scope and evidence boundary

Requested deliverable: an issue and a PR following the Reflektor comparison.
This PR adds a study only. It does not install Reflektor, enable a service,
change verification rules, or implement the proposed review workflow.

Baseline fetched directly from GitHub's remote main branch before branch creation:
ShipGuard `e4f4c9e38ff148b7483e46d4fe0d189b479e9f25`. Upstream main: `4490b50919502d490c208c5b0a518e2a1288c2eb`.
These immutable revisions make the comparison repeatable. No local checkout was used.

Primary sources inspected:

- Reflektor [README](https://github.com/bashovski/reflektor/blob/4490b50919502d490c208c5b0a518e2a1288c2eb/README.md), [review protocol](https://github.com/bashovski/reflektor/blob/4490b50919502d490c208c5b0a518e2a1288c2eb/skill/SKILL.md)
  and [design rules](https://github.com/bashovski/reflektor/blob/4490b50919502d490c208c5b0a518e2a1288c2eb/DESIGN.md).
- ShipGuard [README](https://github.com/bacoco/ShipGuard/blob/e4f4c9e38ff148b7483e46d4fe0d189b479e9f25/README.md),
  [change-report protocol](https://github.com/bacoco/ShipGuard/blob/e4f4c9e38ff148b7483e46d4fe0d189b479e9f25/plugins/shipguard/skills/sg-change-report/SKILL.md)
  and [review builder](https://github.com/bacoco/ShipGuard/blob/e4f4c9e38ff148b7483e46d4fe0d189b479e9f25/plugins/shipguard/skills/sg-visual-review/build-review.mjs).
- [Study of complexity and review repetition, #220](https://github.com/bacoco/ShipGuard/blob/e4f4c9e38ff148b7483e46d4fe0d189b479e9f25/docs/specs/2026-11-19-review-effort-220.md).

Protocol instructions establish intended operation, not verified execution.
The builder inspection establishes implementation paths, not visual quality or end-to-end behavior.
Neither product was executed during this study. Performance, defect recall and review-time claims remain unmeasured.

## What Reflektor contributes

The upstream protocol separates agent-written judgment in report.json from script-collected
Git facts, diffs, coverage and rendering. It describes a reading order, notes linked to code,
changed contracts, request flows and database relationships. Its plan section distinguishes
completed, partial, missing and extra work.

A local daemon serves an inbox and review pages. The protocol describes line and screenshot
comments, live questions, per-comment progress, subsequent rounds and resumption after the
agent session ends. Updated rounds carry reports forward and move line references; this
behavior needs practical tests when source lines move, disappear or are rewritten.

Project tests, lint and type checks can run while a report is written. Their results update
the page. Coverage can be missing or stale and is distinct from successful behavior.
A self-contained HTML fallback supports manual feedback transfer.

The README identifies the published code as MIT-licensed and local operation as supported.
Hosted collaboration is optional. This does not establish that the entire hosted service is
available for self-hosting, or guarantee future hosted pricing. Reusing code requires retaining
the applicable license notices. Local execution still incurs the chosen agent's costs.

## Existing ShipGuard behavior and incremental value

| Area | Existing evidence | Candidate benefit | Conclusion |
| --- | --- | --- | --- |
| Before/after reporting | sg-change-report stores source report.json and captures; builder renders audience views | Link those views to guided code reading | Reuse current reports |
| Human decisions | Builder renders Accept / Adjust / Reject and exports feedback; proposal-trace artifacts preserve proposals | Track each comment across revisions and sessions | Evaluate lifecycle extension |
| Screenshot feedback | Annotations feed fix-manifest.json | Present code and visual comments together | Avoid a second annotation system |
| Goals and scope | #220 documents pre-review and goal coverage from #79/#90 | Present missing and extra work in the reading path | Reuse goal evidence, verify fidelity |
| Contracts and flows | Code/logic/process lanes already investigate behavior and invariants | Display relevant contracts and paths next to the diff | Presentation opportunity, not new verification |
| Checks | ShipGuard already has audits and visual execution | Progressive display of project check results | Evaluate orchestration cost and duplication |

In the inspected builder, normalizeChangeReport starts at line 732; audience decisions are
rendered at lines 882–884; proposal traces are written at lines 1150–1151; fix-manifest
validation is present near line 1983. These are concrete reuse points, not an exhaustive
inventory of every ShipGuard consumer.

The #220 study already identifies limitations in finding identity, closure and evidence reuse,
but does not establish their effect on repeated reviews. This proposal must not relabel those
limitations as newly discovered defects. Link any future reproduction to #101 and #220;
compare plan coverage with #90 before introducing another goal schema.

## Options and proposed boundary

| Option | Benefit | Cost / unresolved question |
| --- | --- | --- |
| KEEP current behavior | No migration or extra daemon | Is review navigation already sufficient? |
| EXTEND existing reports | One review surface and evidence contract | Can stable feedback and guided reading fit without a new canonical report? |
| ADAPT Reflektor optionally | Reuse a specialized diff viewer and rounds | Schema mapping, evidence provenance, agent/session ownership and upgrades |
| DEFER | Avoid speculative work | Appropriate if the measured benefit is small or evidence unavailable |

EXTEND is the current hypothesis, not an approved implementation decision.
Start by testing one guided reading view and one persistent comment round.
Preserve existing JSON shapes and visual-tests/_results paths.
An optional projection or sidecar can be explored before changing canonical schemas.
Do not introduce a mandatory cloud dependency, a second audit engine or automatic publishing.

For a prototype, identify the report, baseline and candidate revisions, scope, environment,
fixture and stable comment ID. Separate a reviewer's acceptance of risk from measured
verification of a correction. Record changed, deleted or ambiguous references explicitly.
A missing finding in the next report does not prove a fix.

A proposal should show the authorized action, expected outcome, reported case and ordinary
valid case. After a correction, record the actual result of the normal workflow in both cases.
A green test obtained by hiding a control, skipping an action or changing the expected result
cannot justify closure. Missing execution evidence remains unverified.

## Bounded validation protocol

Choose one real PR with fixed baseline/candidate revisions and a reproducible fixture.
Use the same scope, agent/model configuration and project checks for the current report and
candidate. Counterbalance reviewer order when possible and record prior familiarity.
This small comparison is exploratory; it cannot establish general superiority.

| Scenario | Expected observation |
| --- | --- |
| Ordinary code + UI review | Reviewer finds the requested behavior, changed code and before/after evidence |
| Stop and resume the session | Sent comments and decisions remain tied to the same review and revision |
| Move, rewrite or delete a cited line | A valid mapping or explicit unresolved target; no silent relocation |
| Correct a defect | Original action succeeds in reported and ordinary valid cases; proof remains linked |
| Change a test to skip the action | Review exposes the missing outcome despite a green check |
| Missing/stale screenshots or coverage | Evidence is labeled incomplete or stale; no verified-success claim |
| Accepted risk resurfaces after relevant change | Prior decision remains visible with its original scope; changed evidence is reviewed |
| Partial plan or extra change | Missing work and material scope additions remain visible |

Record setup and reviewer time, agent cost where available, defects found/missed against
independently established cases, unsupported findings, review rounds and comment misassignment.
Publish raw commands/results and observed outcomes. Do not manufacture extra defects or revise
the acceptance criteria after seeing the candidate's result.

Choose KEEP / EXTEND / ADAPT / DEFER from the evidence. A favorable presentation alone is
insufficient; record whether any saved review effort comes at the expense of missed defects.
If no useful improvement is observed, retain the current experience and close the investigation
with that result. No new enforcement gate is proposed.

## Independent counter-expertise request

Before runtime implementation, an AI reviewer from the other model family should:

1. Re-read the pinned primary sources and relevant ShipGuard consumers.
2. Challenge the claimed novelty, including #90, #101 and #220.
3. Check reference freshness, comment closure, stale evidence and scope semantics.
4. Assess whether a projection of current evidence is enough.
5. Produce KEEP / EXTEND / ADAPT / DEFER with concrete source references and the smallest justified follow-up.

This request is pending. No independent review or comparative run is claimed in this PR.
The issue remains open after the documentation PR is merged.

## Delivery validation and missing captures

Only this Markdown study is added. Structural validation checks the outgoing file list,
the pinned links, required study sections and exact round-trip contents in GitHub.
No scripts, templates, tests, executable rules or plugin interfaces change, so the repository's
documentation-only structural check applies; the smoke suite is not run.

Visual/document screenshot evidence is incomplete. The work used text retrieval through the
GitHub connector and did not render a running dashboard or document capture. Before the next
runtime claim, build the baseline report with the existing review builder, capture the current
view, and repeat the same fixture and route on the candidate. Record UTC capture time,
environment, revisions, commands, expected and observed results; attach both captures to #230
and the implementation PR. Until then, this study supports source-level comparison only.
