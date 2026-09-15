# Pre-review report contract

Answer in the user's language. For each requested outcome, provide:

- **Need:** original result and named destination/client.
- **Evidence:** short decisive source excerpts with file/line or symbol, classified as
  interfaces or usages/constraints, applicability, source_kind and reasoned/measured.
  An executed-path mapping names input/defaults, transformation/branch and final consumer;
  mark untraced steps and runtime not performed. Do not label static reading as execution.
- **Comparison:** what the quoted code produces in this case and whether it meets the Need.
- **Decision:** candidate path/symbol, `use | configure | extend | create | none | undetermined`,
  smallest affected boundary, justification and remaining uncertainty. `use` proposes reuse;
  `none` establishes that no change is needed. Recommendations are not accepted decisions.
- **Status:** one of completed, partial, error. Missing decisive evidence or an unperformed
  analysis is partial, never a completed finding of no change.

Retain repository/commit/relevant local changes when known, scope and exclusions. Record conflicts
with both sources and incompatible effects, questions and uncovered paths. Compare a named supplied
plan with the request/interfaces and its tasks with each other; otherwise say no plan supplied.

State search queries/roots, inspected matches and exclusions. Distinguish not-found (not located),
absent-in-scope (bounded search completed), inaccessible, not-active, unsuitable. None proves
universal absence; stale contracts do not prove API absence. Name required unavailable evidence.

Declare selected references, with model transmission not observable. Do not collect broad history
or secrets; label redactions and their effect. Write only when a report path was requested.
Static reading, isolated execution and browser observation prove only their respective layers.
Structural validation does not prove this skill's behavioral effectiveness.

For explicitly requested dashboard output, follow [output-schema.md](output-schema.md).
