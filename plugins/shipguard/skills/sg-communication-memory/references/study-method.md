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

## Outputs and validation

Write the detailed private report with methodology, counts by unit, corpus and sample boundaries,
findings, counterexamples, mutual communication improvements, and explicit unknowns.
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
