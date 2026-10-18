# Review dialogue changes since the last completed study

This is a requested semantic analysis by the current agent, not a background tracker or a function
of the read-only lookup helper. Use existing authorized access and private artifacts only.

## Establish the baseline and interval

Locate the last completed study report and its source index/checkpoints in the user-selected private
archive. Preserve its identity, revision, coverage, sampling method and unresolved issues.
A profile's updatedAt, a file modification time, or a previous assistant's claim is not a completed
study checkpoint. If no usable prior study exists, describe the available new material, explicitly
mark longitudinal comparison unavailable, and create a first baseline only if within the request.
Missing artifacts are not permission to search other hosts.

Use a separate private study-state.json if the archive has no established checkpoint format.
Its minimum record contains:
- schemaVersion: 1; studyId; previousStudyId (null for a first baseline); report reference;
- completedAt and coverage (authorized scope, examined/unexamined sources, sampling and limitations);
- sources: stable source identity, engine/project when known, snapshot hash and last observed event
  identities/timestamps, plus the actual covered frontier and incomplete/backfilled ranges;
- analyzedEventIds and episode references sufficient to distinguish already reviewed cases from new
  material; stable pseudonymous IDs in portable summaries, physical paths only in a private index.

This is a private study record, not a second machine catalog or part of the profile.json schema.
Avoid raw messages and credentials in checkpoints. Use existing format-specific IDs, otherwise a
stable digest with a documented construction; preserve deliberate repetitions at different times.
Do not use line offsets alone: session stores can be copied, rewritten, truncated or rotated.

Determine the delta per source. Capture an observation boundary, compare snapshots and event IDs,
deduplicate mirrors, and report late-arriving historical events separately from genuinely later turns.
A date-only filter can miss those events. Unchanged sources add no new evidence.
Distinguish newly present, already analyzed, excluded, unreadable and unexamined material.
Read enough preceding context to understand new turns without counting it again as new activity.

If the previous report has aggregate counts but no event-level frontier, do not invent one. Use its
documented time/coverage conservatively, flag uncertain overlap and establish explicit checkpoints
for the new study. Never label an uncertain delta complete.

## Summarize events and compare the two sides

Report what happened in the covered interval: relevant user goals, misunderstandings, explicit
frustration/repetition, successful repairs, outstanding issues and changes of vocabulary.
Use the contextual episode method in study-method.md, including successful clear exchanges.

Assess human formulations and AI responses independently. Human-side evidence can include explicit
targets, preserved ordering/conditions, clarified referents, and successful ordinary-language repairs.
AI-side evidence can include fidelity to the target and constraints, useful clarification, using the
shared vocabulary, reducing unnecessary repetition, and matching completion claims to actual proof.
Clear wording may stay clear while AI quality improves; do not invent a need for human correction.

Compare like-for-like tasks, projects and source types where possible. State sample selection,
periods, denominators, number of inspected episodes and unknown outcomes.
Count repeated requests caused by delivery/authentication separately from clarification attempts.
Do not turn absence of new complaints into proof of improved understanding.
When models, tools, task difficulty or project mix differ, state the confounders and avoid causal
claims about the skill. A tiny or incomparable sample permits examples, not a global trend.
Use improved, unchanged, regressed or indeterminate only with the supporting evidence and limits;
no invented scores, personality ratings or unmeasured percentage gains.

## Output and retain progress safely

The private review should answer in ordinary language:
- What happened since the last covered study, over what actual sources and interval?
- Where did repetition, frustration or misinterpretation occur, and what cause is evidenced or unknown?
- What changed in human phrasing and in AI responses, separately, with evidence and limits?
- What can each side do next, and what shared vocabulary should be proposed or revised?

For each improvement, give the concrete problem, an optional phrasing example preserving original
intent, the matching AI behavior, context, and a future observation that could show it helped.
An already clear request may need only an AI-side change. Do not force paired blame or a rigid DSL.
Keep substantive unresolved questions and contradictory cases visible.

Write the new report and checkpoint candidate privately within authorized output paths. Check
that the report exists and its coverage matches the candidate. Advance completed checkpoints only
after a successful authorized save; preserve the prior record and replace atomically.
A truncated session, failed read or unavailable host keeps an explicit gap or its old frontier.
If partial review is allowed, mark it partial and advance only the actually covered sources/ranges;
never imply unexamined gaps were processed. If saving is blocked, return a draft and do not advance.

Updating a study checkpoint does not itself publish a portable profile, deploy a plugin or broaden
data access. Propose lexicon/profile changes as a separate diff and retain existing publication rules.
