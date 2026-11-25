# Review skills after real use

Use this when the user supplies a past run, a correction, a post-mortem, or asks whether the current skills are still useful.

1. Gather the evidence the user supplied or authorized: original request, skill and version, workflow or entry point, run output, expected result, and user feedback. Keep successful cases as well as failures. Record whether the skill instructions were actually loaded, whether the relevant step was followed, and what remains unknown.
2. Tie each effect to the earliest evidenced cause: missing or mismatched skill, incomplete instructions, invocation or routing, missing environment capability, execution error, or a change in the project's real needs. Keep causes that lack evidence as hypotheses. A tool being unavailable says something about the environment; decide separately whether the skill needs a fallback.
3. Compare the observed result against the required coverage and update the keep, adapt, add, replace, or retire decisions. For each affected skill, record the observed result, cause or uncertainty, proposed change and evidence needed to approve it. If the initial outcome was good, record what the skill helped preserve.
4. Define the next representative use to verify the proposal. For a correction, rerun the failing case with comparable inputs and verify an ordinary valid case. Preserve the user's outcome and the original observation when comparing before and after. Distinguish real runs from static checks and report open gaps.

Return a short post-mortem in chat unless asked to save it. When the user authorizes recording durable lessons, consult ShipGuard's existing [improvement workflow](../../sg-improve/SKILL.md) and use only the authorized destination. A post-mortem does not by itself authorize writing project rules or submitting an issue.
