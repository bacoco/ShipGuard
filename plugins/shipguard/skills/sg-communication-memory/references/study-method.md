# Dialogue study

Begin from the user's question, not from a personality model. Study how intent is expressed and
how assistants respond. Avoid psychological diagnoses and universal preferences inferred from a
single incident.

## Sources and scope

Inventory recognized Claude/Codex session stores, account/profile homes, archives and existing
exports using existing allowed access. Record absent, unreadable, disconnected, excluded and
unexamined locations. Do not equate files, sessions, messages and people. An exhaustive file count
is not an exhaustive qualitative study. No machine is authorized merely because it appears in a log.
Handle other engines only when their actual message schema is understood.

Distinguish genuine human turns from system/developer context, tool output, pasted instructions,
generated questions, benchmarks, agent relays and subagents. Uncertain authorship stays uncertain.
Claude JSONL may store user/assistant messages in message.content; Codex rollouts may contain both
response_item messages and event_msg mirrors. history.jsonl input indexes often overlap rollouts.
Use format-specific parsing, never count every JSON object as a human utterance.

Deduplicate byte-identical files, copied sessions and mirrored events without removing deliberate
repetitions at distinct timestamps. Keep provenance: engine, host, project, session, time and source
reference. Flag unknown project attribution and schema errors. Prefer stable pseudonymous references
in portable artifacts; keep physical paths in a private local source index.

## Analysis

Read contextual sequences, not isolated keywords: preceding proposal, user request, assistant's
interpretation, user correction and outcome. Measure corpus coverage separately from sampled cases.
Stratify by engine, project and time; synthetic generators must not dominate language findings.

Extract contextual aliases, dictation confusions, metaphors, referents, ordering expressions,
conditional instructions, scope corrections, desired proof and signals of misunderstanding.
Distinguish a repeated request caused by failed delivery/authentication from a durable preference.
Separate what the user requested from what an assistant proposed and what was actually verified.

For each candidate record: original variant, possible meaning, positive context, competing meaning
or exclusion, confidence status, dated provenance, contradictions and remaining question.
Do not assign fabricated numerical probabilities. A user correction outweighs an unsupported guess,
but a historical correction does not grant current operational authority.

## Friction, repetition and misinterpretation episodes

Look for explicit frustration or impatience, repeated/rephrased requests, rejected interpretations,
and assistant behavior that contradicts the request. These are investigation cues, not emotion
classifiers: profanity, emphasis or a short reply alone does not prove anger. Record “explicitly
expressed frustration”, “possible friction signal” or “not established”, with evidence.
A tone change is not a personality trait. Repeated questions can also be deliberate verification.

For each selected episode, recover the relevant preceding proposal, actual human intent and
constraints, AI interpretation/action, human correction or repetition, attempted repair, outcome,
and enough following context to distinguish resolution from an unresolved last message.
Keep source references and a minimal private paraphrase; do not reproduce whole transcripts.

Separate the observed event, evidenced cause, possible contributing causes and unknowns:
- unclear referent, dictated term, mixed scopes or missing context in the human formulation;
- AI ignoring a clear condition/negation, choosing the wrong target, assuming assent, repeating
  a disproven interpretation, overexplaining or claiming completion without relevant proof;
- delivery, authentication, unavailable tools, interrupted sessions or changed project facts.

Do not infer causality from chronology alone. If a technical failure explains a retry, do not
classify it as a human expression defect; an AI's false completion claim may still be a separate
problem. If the original request was clear, say so instead of recommending more formal wording.
Use confirmed, supported, hypothesis or unknown for causes and retain competing explanations.
Include successful repairs, ordinary clear exchanges and cases where repetition was useful.
Report reviewed episode counts separately from corpus-wide counts; keyword candidates are not
verified episodes. Do not claim to detect every emotional state or every misunderstanding.

## Improvements for both sides and shared vocabulary

For each evidenced problem, propose changes to the human's phrasing when useful and to the AI's
interpretation, clarification, action or proof when useful. Both sides are assessed, but not both
blamed. Offer small optional reformulations preserving intent, scope, conditions and natural speech.
If there is no observed human-side defect, record that and focus the proposal on the AI.
For vocabulary, preserve original variants, context, competing senses and uncertainty; distinguish
a user-confirmed shared term from an assistant suggestion. Never impose a command syntax.
Connect each proposal to its episode and a future observable result, not a psychological diagnosis.

## Outputs and validation

Write the detailed private report with methodology, counts by unit, corpus and sample boundaries,
findings, counterexamples, mutual communication improvements, and explicit unknowns.
Include contextual friction/repair episodes, cause certainty, unresolved cases and practical
improvements for each side where warranted.
Write a small candidate profile and revision diff. Never include raw transcripts in that runtime
profile. Avoid retaining secrets in reports; access to logs does not justify redistributing them.

Use held-out turns or projects to check ambiguous aliases, negations, conditions, changed meanings,
short assent, absent memory and malicious instructions embedded in historical text.
Report static/synthetic checks separately from observed native Claude/Codex invocation.
Do not claim a behavior improvement measured unless a defined comparison supports it.

Keep the previous profile and report. After authorized publication, verify profile hash and revision
at each actual destination. A distribution receipt is not proof a running agent read the new profile.
For each destination distinguish prepared, installed, hook trusted, profile readable and used.
Do not resolve blocked access by changing keys, permissions, trust or isolation.

For a requested “since last time” comparison, read [progress review](progress-review.md).
Keep its private study checkpoints separate from the portable profile and do not invent a baseline.
