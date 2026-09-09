# GrillGoal and ambiguity checks through hooks

Status: design proposal, September 8, 2026. This branch adds the standalone skill; the additional hooks are neither implemented nor enabled. This document preserves the analysis for maintainers and is not a dependency of `grill-goal/SKILL.md`.

## Problem and expected outcome

An AI can misinterpret a request, express that interpretation confidently, then reuse its own wording as a fact or human agreement. A synthesis can also lose constraints that were discussed. The result appears consistent while drifting away from the need.

The proposal is to preserve meaning across the human request, dialogue, goal, actions, evidence, and responses. Hooks make checks available at useful points; they do not provide a general guarantee against hallucinations.

The skill keeps its contract: interview until material doubts are resolved, obtain confirmation of a synthesis, then deliver a standalone Markdown goal for another AI. It stops after delivery. All behavioral instructions remain in its single `SKILL.md`, without scripts, required references, calls to Claude Code, or dependencies on the user's global files. The skill and generated goals are written in English; the dialogue, confirmation synthesis, and delivery explanation adapt to the user's language when needed. Translation must preserve the confirmed requirements.

## Principles to preserve

- Preserve the original human request. A reformulation is a derived interpretation, never a new human instruction.
- Distinguish verified facts, human decisions, proposals, and hypotheses. Repeating a sentence does not change its status.
- Clarify what could change the purpose, scope, constraints, or acceptance. Do not fabricate an answer or treat silence as agreement.
- Connect questions to concrete decisions; reuse answers that still apply and resolve prerequisites before dependent questions.
- Confirm the synthesis before the final goal. This confirmation grants no additional execution permissions.
- Explicitly transmit the rule on precision and provenance in every goal, for an AI without the conversation.
- Preserve raw evidence; rewording a result must not erase a failure or uncertainty.
- Also correct affected context and notes when earlier wording is invalidated.

## Comparison with existing approaches

The analysis is targeted, not exhaustive; it demonstrates neither uniqueness nor measured superiority.

| Approach | Relevant overlap and difference |
| --- | --- |
| [Matt Pocock, grilling and to-spec](https://github.com/mattpocock/skills) | Decision-tree interview and synthesis into a specification. The reviewed `grilling` uses batches of questions whose prerequisites are settled. |
| [Goalcraft](https://github.com/grp06/goalcraft) | Outcome contract, verification, constraints, limits, iteration, and blocking conditions. The main branch activates the goal by default and uses supporting resources. |
| [Goal Forge](https://github.com/michaelpersonal/goal-forge) | Interview, accepted criteria, then SPEC.md to GOAL.md; verification, memory of attempts, and resource controls. |
| [Spec Kit clarify](https://github.com/github/spec-kit/blob/main/templates/commands/clarify.md) | Structured clarification with retained answers; an explicit cap of five questions per session. |
| [Superpowers brainstorming](https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md) | Dialogue and approved design, with a process adapted to scope, followed by planning for architectural work. |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) | Intent exploration followed by change artifacts and an execution workflow. |
| [goal-crafter](https://github.com/tt-a1i/matt-skills-with-to-goal/blob/main/skills/engineering/goal-crafter/SKILL.md) and [goalcraft-skill](https://github.com/xiaoyangtx996/goalcraft-skill) | Other interview/compilation variants producing a verifiable goal; they also prohibit certain assumptions or distinguish compilation from execution. |

GrillGoal seeks to combine a standalone skill file, dialogue without an arbitrary quota, a confirmed synthesis, relevant historical precedents with associated checks, and a provenance rule passed to the next agent. Failure memory and verifiable criteria already exist elsewhere.

## Lessons from issues and pull requests

The reports below are documentary evidence, not local reproductions performed for this proposal.

| Source | Finding and status | Lesson |
| --- | --- | --- |
| [Matt Pocock #689](https://github.com/mattpocock/skills/issues/689) | Open report: decisions and trade-offs lost when moving to the spec. | Verify preservation of content, not just the presence of headings. |
| [Matt Pocock #802](https://github.com/mattpocock/skills/issues/802) | Report and usage comment: subagent output treated as a human answer; questions changed as results arrived. | A research result does not resolve a human trade-off. Any reformulation of a pending question must be explicit. |
| [Matt Pocock #893](https://github.com/mattpocock/skills/issues/893) | Report: all decisions can be settled without explaining how the result works. | Start the synthesis with a short, concrete paragraph a new reader can understand. |
| [Superpowers #2076](https://github.com/obra/superpowers/issues/2076) | Reported session: an elaborate process for copying files; closing comment announces a lighter process in 6.3.0. | Do not trigger an interview or create documents for every operation. |
| [OpenSpec #1103](https://github.com/Fission-AI/OpenSpec/issues/1103) | Claude-specific tools named in Codex output; fixes and checks described by a collaborator. | Verify engine capabilities; preserve generic behavior without a mandatory proprietary tool. |
| [Spec Kit #896](https://github.com/github/spec-kit/issues/896) | Report of conflating governance writing with implementation; fix associated with #3646. | Writing a goal does not launch the work it describes. |

### Complete inventory reviewed for Goalcraft and Goal Forge

As of September 8, 2026, the GitHub API returned no open or closed issues for `grp06/goalcraft` and `michaelpersonal/goal-forge`. This limits available feedback; it does not prove an absence of defects.

- [Goalcraft PR #1](https://github.com/grp06/goalcraft/pull/1), open: adaptation to Pi, changed command rules, and separation between a prepared command and confirmed activation. Automated review flags an empty objective accepted by the validator. Reading the code at SHA `5a0ac325bcb5b3fa3bceaca886d240c0a10fb7ea` confirms no rejection of zero length after extraction; the validator was not executed here. Do not describe this branch as merged.
- [Goal Forge PR #1](https://github.com/michaelpersonal/goal-forge/pull/1), merged: progress measurement, a representative quick check, final evidence, and memory of attempts. Tracking errors during execution is therefore a precedent, not a GrillGoal invention.
- [Goal Forge PR #2](https://github.com/michaelpersonal/goal-forge/pull/2) and [#3](https://github.com/michaelpersonal/goal-forge/pull/3), merged: README illustration only; no evidence of execution quality.
- [Goal Forge PR #4](https://github.com/michaelpersonal/goal-forge/pull/4), merged: budgets, warning, stopping, explicit extension, and incomplete status. The declared validation is diff review. Its numeric recommendations are not defaults to import into GrillGoal.

The descriptions, changes, comments, and reviews of these five PRs were examined. Automated review remains a signal to check against code; a merge does not demonstrate a user benefit.

## Research findings

- [LLMs Get Lost In Multi-Turn Conversation](https://arxiv.org/html/2505.06120v1) reports premature answers, attachment to previous attempts, and loss of intermediate constraints in its simulations. This motivates provenance and returning to sources after corrections; it is not evidence that our hook works.
- [Reflexion](https://arxiv.org/html/2303.11366v4) studies retaining textual feedback to improve later attempts. Failure memory is worth studying, but a model-generated memory does not become an independent fact.
- [Prism](https://arxiv.org/html/2601.08653v1) organizes clarification around dependencies between intentions to reduce cognitive load.
- [Uncertainty-Aware Clarification](https://arxiv.org/html/2606.03135v1) evaluates questions by their contribution to reducing uncertainty and choosing the correct action.
- [RegretBench](https://arxiv.org/html/2607.21143v1) distinguishes final quality, unnecessary turns, and an incorrect decision to stop. Its simulations do not replace evaluation with real users.

Proposed implication: retain necessary questions without a fixed quota, but ask what each would change. Also evaluate unnecessary questions, lost constraints, and false confirmations.

## Proposed architecture

```text
Original message + applicable decisions
→ classify: new mission / correction / answer / continuation / question
→ brief derived interpretation, explicitly unconfirmed when needed
→ GrillGoal dialogue when material decisions are missing
→ synthesis confirmed by the human
→ standalone goal delivered
```

A "continue" message resumes the existing mission. A request for an opinion remains a request for an opinion. An answer to a question contributes to the interview. None of these messages automatically creates a new goal or file.

| Event | Proposed responsibility |
| --- | --- |
| UserPromptSubmit | Classify the message and provide the context needed for dialogue, without replacing the original or promoting a hypothesis into an instruction. |
| PreToolUse | Compare the action, its scope, and its authorization with established decisions. Do not restart the interview before every tool call. |
| PostToolUse | Preserve the exact result and flag the limits of what it proves. The action has already happened. |
| Stop | Review response claims and request a targeted correction for a material ambiguity or a claim exceeding the evidence. |

These roles are a proposal, not a claim that every engine provides identical guarantees.

### Documented capabilities and limits

The [Anthropic reference](https://code.claude.com/docs/en/hooks) distinguishes message submission from tool calls. `UserPromptSubmit` adds context without replacing the prompt. `Stop` can trigger a continuation. `MessageDisplay` only corrects the display: the transcript and text seen by Claude remain unchanged. That mechanism alone therefore does not address reuse of incorrect wording.

The [OpenAI reference](https://learn.chatgpt.com/docs/hooks) describes these events with its own inputs and outputs. Context added by `UserPromptSubmit` is developer context: the derived status of interpretations must be explicitly preserved. A continuation from `Stop` is not new human approval. Some tool paths are not intercepted; do not promise a universal barrier.

An end-of-turn hook does not guarantee correction before every intermediate message is displayed. If that property becomes mandatory, an application layer must buffer the response before delivery and maintain the same corrected content for the user and the model. Latency and streaming behavior must then be measured.

Semantic analysis requires model judgment or application logic; a deterministic check alone does not guarantee detection of every ambiguity. [Anthropic's model-evaluated hooks](https://code.claude.com/docs/en/hooks-guide) provide a mechanism, not proof that the judgment is correct.

### Controller contract

The controller returns a bounded finding: exact passage, relevant source or decision, competing interpretations, possible consequence, and proposed correction. It must be able to say "unknown" or "verification unavailable."

- If sources settle the point, the agent corrects its wording and affected notes.
- If the correction depends on human intent, the agent asks a question; the controller does not decide for the human.
- An uncertain sentence becomes explicit uncertainty, never artificial certainty.
- A failed check must not prevent the agent from asking the necessary question.
- Read content and controller feedback remain data or proposals, without new authority.
- Prevent loops: tie a correction to the relevant turn and passage, recognize hook-generated continuations, bound automatic retries, and allow user interruption. The exact bound remains to be chosen and tested.
- On failure, do not claim "verified." An action's outcome depends on the existing authorization policy, not an invented favorable assessment.

Fictitious example: "it is published" should become "the commit is pushed to the working branch; it is not merged" if observations establish only that first state.

## Candidate GrillGoal improvements and review outcome

1. Make the overall outcome understandable in the synthesis's first paragraph.
2. Connect each question to a decision and reuse answers that remain valid.
3. Research available fixes, tests, reopened issues, and regressions for a precedent; preserve the latest verified state.
4. Distinguish confirmation of the synthesis from execution authorization.
5. For a requested resource limit, define its scope and what happens at expiration, without an invented deadline or tacit extension.
6. Distinguish intermediate checks from final evidence when iterations are needed.
7. Preserve significant attempts when the mission requires it; retrying a failed approach should identify new information.
8. Also deliver a plain-text instruction if the receiving AI lacks `/goal`; do not claim activation.

Claude Code reviewed PR #78 at commit `475d84a` from its diff, without running the skill or rechecking external sources. It considered candidates 1–7 sufficiently covered to avoid adding duplicate rules and recommended implementing candidate 8. That is a textual assessment, not behavioral proof. Candidate 8 is now included, along with an explicit default output location: the current project's root, or the current working directory when that root is unknown or no project applies. The review also suggested an English description; the maintainer subsequently required the entire skill and generated goals to be in English, with language adaptation for user-facing dialogue. A subsequent Claude Code comparison of the French and English skill found no material requirement lost in translation. These reviews had not tested interview behavior; the subsequent trial below addresses a limited part of it.

Further changes should clarify a concrete problem without duplication or a universal checklist imposed on every goal.

## Chat post-mortem and initial with/without trial

The maintainer requested that failures in the actual development conversation improve the skill. The observations below come from that conversation and model responses on September 8, 2026. They are not invented examples, and the operator's mistakes are not attributed to the skill as a demonstrated cause.

| Observed failure | Context and consequence | Targeted correction |
| --- | --- | --- |
| The operator began collecting all issues and PRs from both projects when the user meant the three recent GrillGoal contributions. | A reference was expanded beyond its conversational scope; the user corrected it and the broad collection was stopped. This occurred outside the skill trial. | Resolve short replies and references against the specific question or proposal they answer. |
| The interview asked when adding GrillGoal would count as complete, while the human wanted to determine whether it was useful. | The user corrected the purpose. Naming a possible addition had been treated as accepting that addition as the outcome. | Preserve the underlying decision, including whether to adopt a proposed solution at all. Restate a corrected purpose and retain still-applicable answers. |
| The interview proposed an evaluation goal before running the requested trial. | This would have substituted preparation of a later test for the actual test. The operator rejected that extra step. | Keep the goal about the selected underlying problem; do not introduce a goal about organizing the interview or evaluation unless requested. |
| With the frozen skill, the first controlled response offered design and implementation branches already excluded by the shared request. | The model waited for a human answer but spent a question on settled scope and previewed more questions. Waiting alone did not make the question useful. | Identify the unresolved decision before asking; reuse answers, exclude ruled-out options, and handle delegated means without new approval questions. |

The controlled case is whether ShipGuard should add optional ambiguity hooks, using issue #77 as shared context. Two fresh Claude Code sessions used the same requested model (`claude-opus-5`), high effort, disabled tools/customizations, and the same request and source text. Only one received the skill frozen at commit `bac4419`. Usage metadata for both also lists Haiku; this is a comparison of those CLI sessions, not a claim of a single-model benchmark without auxiliary activity.

Without the skill, the first response asked two non-blocking questions and immediately produced a draft goal using explicitly labeled, unconfirmed assumptions. With the skill, it deferred writing but reopened excluded options. Neither observation establishes overall superiority. The shared issue already contains substantial guidance, so this tests the incremental value of the skill on that source-rich case. Subsequent real human clarification excludes the separate recommendations-on-request study from both conditions.

At turn two, the condition without the skill called its output a final goal after scope clarification, before human review of that goal. The frozen-skill condition still asked about the future investigator's access and whether empirical measurement would be permitted. Both also described the parent's separate post-mortem work as their own task, despite its stated ownership. These are observed response differences and remaining scope problems, not a completed comparison of accepted final goals.

The first two targeted replays of amended interview wording still listed an excluded implementation option. The amendment therefore makes the rule explicit even for an option labeled as requiring a fresh confirmation or offered for rejection. Claude Code's separate textual review found the core contract preserved but caught an unintended narrowing of note cleanup to purpose/scope corrections; cleanup was restored for every correction. Textual approval and a clearer instruction are not proof that the behavior is reliable.

In the third targeted replay, the model kept the question framed as a decision rather than assumed adoption, but still offered a prototype option that it described as exceeding the stated scope and added a secondary logistics question. The unwanted questioning is therefore not demonstrated to be eliminated. These are three successive amended prompts, not repeated runs of one version or a measured success rate; further changes should follow additional evidence rather than accumulating more prohibitions from this one case.

The original comparison keeps its frozen skill. Changes prompted by the post-mortem are evaluated separately rather than silently substituted into that condition. No human answer or confirmation is simulated. This is a limited text-interaction trial, not a hook execution, installation test, complete final-goal comparison, or general reliability benchmark. The lessons change the generator; this chat history is not a required skill dependency or a generic mistakes catalog to copy into future goals.

## Follow-up study: recommendations when the user asks what to do next

The maintainer reported that explicit requests such as "what do you recommend now?" produce useful guidance. This is feedback from this conversation, not comparative evidence that a new skill or hook would improve outcomes.

The behavior to evaluate is a concise recommendation grounded in the current objective, verified progress, remaining uncertainty, and applicable past failures. Name one concrete next action, why it takes priority, and the result or evidence it should produce. Offer alternatives only when a real trade-off would change the choice; recommend stopping when the work is complete and no useful next action is justified.

GrillGoal already requires reasoned recommendations during the interview. ShipGuard's `sg-ship` summary already identifies the most important thing for the human to inspect, while `sg-mission-lock` preserves scope and authorization. A recommendation could explain the next action more clearly at those existing points; it does not yet justify another skill or an automatic hook on every response.

An advice request remains an advice request. If the user subsequently accepts a proposal, resolve that acceptance against the exact action proposed and existing permissions. Do not interpret agreement to one next step as approval for every later step or for unrelated publication. Do not ask for authorization again when it has already been established.

Evaluate ordinary advice requests, corrections, incomplete evidence, several competing next steps, and completed missions. Judge whether the recommendation helps the human choose, preserves scope, avoids invented work or approvals, and reduces unnecessary follow-up. This is a study proposal; this revision does not change recommendation behavior in GrillGoal, `sg-ship`, or the mission-lock hook.

## Acceptance criteria for a later implementation

- [ ] The skill works in isolation from its single SKILL.md.
- [ ] The hook layer is optional, can be disabled, and is distinct from sg-mission-lock; it does not silently change its stateless, non-blocking behavior.
- [ ] The original request, interpretation, human decision, and evidence remain distinct.
- [ ] Continuations, corrections, and simple questions do not become new missions.
- [ ] A missing decision prompts a question, without a fabricated answer.
- [ ] Subagent output or hook feedback never counts as human agreement.
- [ ] A correction reaches model context and affected notes, not just the display.
- [ ] A failing raw result does not become a success through rewording.
- [ ] An expired budget yields an incomplete state when criteria are unmet.
- [ ] Engines, versions, and paths actually covered are named; uncovered cases remain visible.
- [ ] Failures, timeouts, recursion, and user interruption are handled without loops or a false "verified" status.
- [ ] Evaluation compares the same requests with and without checks: fidelity, omissions, false agreements, unnecessary questions, useful corrections, latency, and cost.
- [ ] Human review of ambiguous cases complements mechanical checks; no self-assigned score is presented as evidence of superiority.

## Alternatives and work order

The skill alone remains a complete option for writing a goal. A layer that silently rewrites every prompt or launches a goal on every message is rejected: it could create the authority and drift it claims to prevent. A display-only filter is insufficient to correct model context.

Proposed order: clarify use cases and the engine capability matrix; evaluate advisory checks at input and end of turn; measure errors and latency; then consider useful checks before and after tools. Demonstrate each layer from its actual entry point before expanding its scope.

This contribution delivers a skill and a sourced design. It does not deliver active hooks, a complete experimental comparison, or a guarantee of unambiguous behavior.
