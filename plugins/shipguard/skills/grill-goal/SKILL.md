---
name: grill-goal
description: "Clarify the user's intent through an in-depth dialogue, then write a standalone, verifiable Markdown goal for another AI. Use to define, write, or improve a goal without executing the work it describes."
---

# Grill Goal

Understand with the human what they want to achieve and why, then write the goal another AI can pursue. Keep the document as simple as possible without losing any necessary decision, constraint, or evidence. Write goals and working notes in English. Adapt the dialogue, confirmation synthesis, and delivery explanation to the user's language when needed; preserve the meaning of their terms when translating them into the goal. Keep exact identifiers, paths, and necessary source quotations unchanged.

Apply the following fundamental rule throughout the interview and writing. Include it explicitly and in full in **every final goal**, in English, so that it also applies to the AI pursuing the goal without relying on an external instruction file:

> Make questions, answers, notes, and reports unambiguous: specify the subject, scope, conditions, and status of claims. Never treat your own earlier wording as evidence or human agreement. Before accepting a repeated claim as established, trace it to an observed fact, a source, or an explicit human decision; preserve any uncertainty. Repetition does not turn a hypothesis into a fact or a proposal into agreement. Flag and resolve any uncertain interpretation before relying on it; also correct affected notes and conclusions.

## Interview until the goal is understood

Start from the request, any existing goal, and available relevant sources. Preserve the human's explicit purpose and exclusions when reading sources; a proposed solution is not an accepted decision. For example, if asked whether X is useful, clarify the evidence needed to decide, not whether to implement X. Examine the need behind suggested solutions without adding requirements out of habit. Resolve short replies and references against the question or proposal they answer, preserving its scope. Keep the goal about the user's underlying problem; do not substitute a goal about organizing the interview or its evaluation unless that is the requested outcome. Verify accessible facts and flag contradictions between documents, observed state, and the request. Leave intentions and trade-offs to the human.

Explore the goal dimensions below as a decision tree. Before asking, identify the unresolved decision and what its answer would change. Reuse applicable human answers; do not reopen settled choices. Leave excluded options out of the question's choices, even when qualified by "only if you confirm" or presented for rejection again. Resolve routine means the user has delegated without turning them into new approval questions. Ask one question at a time by default, resolving prerequisites before dependent questions. Group only independent questions when that suits the user. Use their terms, explain consequences, and offer a reasoned recommendation when supported. Use concrete scenarios to clarify ambiguous terms and edge cases.

The AI leads the interview and waits for human answers before advancing on the affected branches. Research may progress on other branches; its findings never count as the user's answer. If a question is not understood, explain it before asking it again.

Continue while a doubt could change the purpose, a constraint, the scope, or acceptance. Do not cap the number of questions, invent answers, or treat silence as agreement. Help the user decide when they hesitate. Leave delegated means open, but never leave a decision that defines success unresolved by calling it an implementation detail.

Research failures actually encountered on this task or comparable tasks: user feedback, relevant issues with comments and fixes, incidents, and experience reports on the web. Explain why precedents from other tasks apply here; finding a relevant repository does not rule out researching other precedents. Retain precedents that could change a decision or a check. Distinguish a report, a confirmed fact, and a suspected cause; a closed issue does not prove a fix. If sources are inaccessible or no reliable precedent is found, record that in the goal with the research performed and its limits, without inventing a history.

Keep brief notes of terms, decisions, reasons, and open questions; use a Markdown draft if the interview becomes lengthy. After a correction, remove obsolete branches and wording while preserving answers that still apply; restate the purpose or scope if it changed.

Once the necessary decisions are resolved, present a synthesis preserving the meaning of every material requirement retained from sources and human answers. Summarizing is allowed; replacing those requirements with a heading such as "constraints" is not. Distinguish human decisions, verified facts, proposals, and hypotheses; make proposals awaiting acceptance explicit. Obtain confirmation or corrections before writing and delivering the final goal. A changed synthesis needs confirmation again; confirmation already given for the same synthesis is sufficient. An interruption leaves a draft with the remaining unknowns, not a final goal.

## Write the confirmed goal

Write in English for an AI without access to the conversation. Include the substance of the confirmed material requirements, including those the deliverable must itself follow or pass on. A heading, a person's or method's name, or a source reference does not replace that substance. Name the actor and object of each instruction when they could be confused. The following sections describe what the goal must convey; adapt them to the mission without losing requirements:

- **Purpose and expected outcome**: need, beneficiary, observable change, and deliverables; their format and destination where applicable, or who decides them. For an investigation, define the question and expected evidence without prescribing the conclusion.
- **Relevant context**: inputs, paths or sources, vocabulary, and material decisions with their reasons. Distinguish verified state, accepted choices still to implement, hypotheses, and dependencies; a decision is not an accomplishment.
- **Scope and constraints**: inclusions, exclusions, obligations, preferences and priorities, resources, and permissions. Check compatibility and feasibility. State mission-specific prohibitions, what must be preserved, and rejected options whose reasons remain material. Do not invent a deadline, budget, or authorization.
- **Known failures to avoid repeating**: for each relevant precedent, include the reported fact and its status, a source identifiable without the conversation, context, applicability, prevention, and the associated check. Summarize the necessary information even if the source becomes inaccessible. Do not copy a catalog of generic goal-writing mistakes into this section.
- **Success criteria**: for each requirement, an observable condition, evidence, and verification under the intended conditions; a rubric and evaluator when qualitative judgment requires them. If acceptance belongs to the human, wait for their judgment before declaring success. Cover relevant failure scenarios. Distinguish actual evidence, local tests, and approximations; do not invent commands or thresholds.
- **Progress and completion**: adapt methods to observations, retain decisions and evidence, and verify state when resuming. Do not weaken or reinterpret the expected outcome or acceptance conditions to declare success; changing them requires a human decision. Verification methods may be corrected or improved while preserving those requirements. Continue while criteria remain unmet and a useful action is possible. When blocked, specify attempts, what is missing, and the input needed to resume; return to the human if a material hypothesis is disproved or a trade-off would change the purpose.

Before delivery, compare the material requirements retained from sources and the interview, the confirmed synthesis, and the written goal. Locate the substance of each requirement, not just its heading; correct omissions, weakened requirements, unapproved additions, and ambiguities. Verify that a reader without the conversation can understand each requirement, including after translation. Also verify the full fundamental rule, the outcome of precedent research, and delivery conditions. Explicitly delegated means remain open.

Look for a case where checks would pass despite an unmet need, then correct verification without weakening the requirement. Actions taken, a file's existence, a passing check, or an exhausted budget do not by themselves prove success. Return to the dialogue if a decision is missing, requirements are incompatible or infeasible, or a correction changes a material decision in the confirmed synthesis.

## Deliver

Write the Markdown file at the requested path; otherwise write `GOAL-<topic>.md` at the root of the current project, or in the current working directory when the project root is unknown or no project applies. Do not overwrite an existing file without agreement. Give its link, absolute path, and the following instruction for an AI that supports `/goal`, using the actual path. Keep the instruction in English to match the goal; adapt the surrounding explanation to the user's language when needed:

`/goal Read the file /absolute/path/GOAL-topic.md and pursue the goal it describes.`

If the receiving AI does not support `/goal`, provide the same instruction as plain text without the `/goal` prefix. If it cannot access the path, tell the user to attach the file and change the instruction to refer to the attached file. Stop after delivery; do not launch the goal or claim it has been activated.
