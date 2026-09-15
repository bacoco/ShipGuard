---
name: sg-pre-review
description: "Review a proposed change before coding: find reusable interfaces, trace their actual consumers, and recommend the smallest justified change. Explicit invocation, report-only; not a bug audit or a goal interview."
---

# /sg-pre-review — Evidence before a development decision

Analyze the concrete request in the user message, not this skill description. Determine whether
the current path meets that request and identify the smallest justified change. Invoke explicitly. Accept the request or confirmed goal, repository and optional
`--focus=<path>` within that repository. Preserve scope, exclusions and explicit decisions;
a quoted proposal is not a decision. Ask about material ambiguity, without restarting GrillGoal.

Report-only: reject `--fix`; no source changes, business API calls, hooks, commits or publication.
Reuse applicable sources already read. Record commit and relevant working-tree changes when
available; do not invent Git state for an archive. Write only an explicitly requested report path,
without overwriting an existing report without agreement. Otherwise return the report in chat.

## Perform the analysis, one requested outcome at a time

1. **Need.** Copy the concrete outcome from the user message and its exact destination/client.
   Keep this unchanged; do not substitute the general purpose of this skill.
2. **Find.** Keep two search lists: interfaces/contracts/exports/configuration, and
   usages/callers/tests/examples/decisions. Use native search and read contracts as text. Start from the destination
   named in the request and find the function that produces it. Read its body, not only its name.
   For literal search, use one unchanged identifier or filename from the request per query;
   do not translate it or concatenate a sentence. If no match, shorten the query instead of
   adding words. A generated result file need not be tracked: search its filename in the source
   to find its producer/consumer, rather than requiring an existing runtime result to review code.
3. **Extract.** Before a verdict, quote the actual source lines that determine the output:
   transformation, selection/loop, condition and return as relevant. Follow the input through
   the called functions and active branches to the final consumer. Inspect each named client.
   With tools, read small relevant sections and follow concrete unresolved calls. With a supplied
   corpus and no tools, locate and quote those sections in the corpus; runtime was not executed.
   The current path must cite implementation, not example JSON. For a collection output, check
   which input members the producer's loops read. For a command result, follow the caller's
   return value; the worker's returned object alone does not determine the command status.
   Copy only the decisive source text (at most eight lines per excerpt). Do not reconstruct
   output artifacts, reproduce whole schemas, or substitute a fabricated example for evidence.
4. **Compare.** Trace one item or case satisfying the user’s preconditions through the quoted
   code. Write the actual selected fields or return value, then compare this with the Need. Finding an input artifact or a different consumer does not prove the named destination
   works. An empty example in a schema is not an actual run. Check executable assertions and
   active branches before adopting a prose claim or comment. Do not invent calls or results.
5. **Decide.** Recommend `use | configure | extend | create | none | undetermined` with a precise
   path/symbol and reason. `none` requires the quoted path to already satisfy the Need. Missing
   decisive source yields `undetermined`, a named gap and `partial` status. A list of future checks
   is not a completed analysis. Prefer an existing boundary over a parallel implementation.

For disagreements, read only the **Source precedence** section of
[obligations-and-checks.md](../sg-logic-audit/references/obligations-and-checks.md).
Reuse its authority and applicability rules; do not load unrelated audit checklists.
Preserve applicable incompatible sources as `contract-conflict`, inferences as questions, and
missing paths as uncovered. A stale example/comment is not by itself an authoritative requirement.
Use `source_kind`: `declared | observed-expectation | observed | assumed`.
Evidence is `reasoned` for static code reading, `measured` only for a real execution trace with
its conditions. A schema describes shape; it does not establish current runtime results.

## Deliver

When the user explicitly requests a local-model endpoint, use the read-only
[local runner](run-pre-review.mjs) with `--root`, `--request` (the original request file),
`--endpoint` and `--model`. It guides search and checks quoted source lines mechanically.
An optional `--trace` must name a new file explicitly requested for evidence. Do not invoke
another model implicitly or select a provider. The runner returns JSON on stdout, not a dashboard
result; render it using the report contract. Exit 3 means partial. Exit 0 means review delivery,
never a clean audit or proof of semantic correctness. `model_claim` remains an agent claim;
only citation provenance is mechanically validated, even when evidence_validation is valid.

Use [references/report.md](references/report.md). For each request, provide the extracted evidence,
comparison and decision, not instructions to perform them later. Then summarize the smallest next
action and coverage limits. Compare a plan and its tasks only if a named plan was supplied.
Stop at the recommendation; do not implement it or add automatic controls.

## Optional dashboard delivery

Only when explicitly requested, write the additive report described in
[output-schema.md](references/output-schema.md) to the named repository's
`visual-tests/_results/prereview-results.json`. Keep the original request and separate evidence
arrays; missing decisive evidence or an undetermined candidate makes the report partial.
The existing `sg-visual-review` dashboard consumes it. Completed is delivery, never PASS.
