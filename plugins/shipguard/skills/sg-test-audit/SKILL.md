---
name: sg-test-audit
description: Audit tests that may pass because an AI coding assistant added a product rule that blocks or skips a valid action. Trace the test, the rule and the real outcome to identify contradictions or unsuitable restrictions. Use for whole-project or periodic inventories and for reviewing affected actions in a change. Read-only, with a plain-French report by default.
---

# Audit tests that hide broken actions

## Priorité n° 1 — Faire réussir l’action, jamais l’éviter

Avant de coder ou d’écrire le test, fixe l’action autorisée, sa cible, le cas à reproduire et le résultat attendu d’après la demande et les contraintes déjà autorisées.

Corrige le défaut en gardant l’action possible. Exécute-la par le parcours normal dans le cas signalé et dans le cas ordinaire. Vérifie qu’elle aboutit dans les deux cas et que le défaut a disparu. Un test qui passe parce qu’un bouton a été caché, un clic refusé, le cas évité ou le résultat attendu changé est invalide.

Fais l’action si elle reste possible. Si la situation a changé, explique ce qui a changé et demande une décision si elle est nécessaire. Si l’obstacle est temporaire, conserve la demande et reprends-la sur la cible prévue dès que les conditions autorisées sont réunies.

Un refus doit correspondre à une décision du demandeur ou protéger, dans le cas précis, contre une perte de données, une erreur de cible ou un accès non autorisé. Toute nouvelle règle de blocage, visible ou silencieuse, exige l’accord du demandeur. Explique-lui son effet concret avant de l’ajouter.

Avant d’annoncer la correction, indique l’action exécutée et le résultat observé. Si le cas n’a pas été reproduit, indique qu’il reste à vérifier.

For a read-only audit, apply this priority when evaluating a correction. For both the reported case and an ordinary valid case, record the authorized action, target, expected outcome and observed outcome. Use existing evidence or an authorized isolated run. Mark each case that still needs verification. Requester approval concerns the introduction of a new blocking rule; the original authorization still applies to the requested action on its intended target.

Check whether an AI coding assistant added a rule to make a failing test pass while the intended action stopped working. Follow the evidence of what the test exercised, what the code did, and what result reached the intended target. Treat examples as search leads and include relevant decisions with human, AI, shared or unresolved origins. Establish each finding independently in the current target.

## Fix the scope and preserve the repository

- Identify the target, revision, date, available history and relevant working-tree differences. Use a repository reference supplied or independently verified. Separate committed, historical and locally modified behavior. Preserve unrelated work. Open a fresh temporary directory **outside** the target repository for the report and any working files.
- Keep every audit step read-only for the target. Exclude key, credential and secret files before reading content, including historical versions, diffs, scripts and test fixtures. Enumerate paths first, review safe source paths, then pass only those explicit paths to searches and history commands. Exclude uncertain sensitive paths. Avoid broad searches over contents, unrestricted patches, repository scripts and credential configuration. Prefer static inspection and metadata-only remote reads. If the source or history is unavailable, report exactly what can be established. Keep a plan or a blank template distinct from completed findings.

## Use the installed discovery and reporting tools

Resolve `cli/shipguard.mjs` relative to the **installed** plugin, or use its copied CLI with `--plugin-root=PATH`. Start with `rules scan PROJECT --inventory` to see names and gaps without reading file contents. Review those names for private material; pass the JSON array of eligible project-relative paths on stdin to `rules scan PROJECT --paths-stdin`. For a change review, also pass `--diff=BASE`. Known private files and symlinks remain excluded. Without a local runtime, continue with available read-only repository tools and mark the resulting coverage.

Git discovery includes tracked and nonignored untracked files. Explicitly mark ignored untracked paths and nested projects outside this pass; inspect a named nested project separately if it belongs to the mission. Use the returned paths and line numbers to navigate. A candidate may be a legitimate permission check, a test of a false positive, or even a comment. Read the branch and normal call path before determining the effect. Inspect eligible source with zero signals and out-of-scan languages by hand; list gaps explicitly. Generated output and scratch reports belong outside the target.

After review, prepare the structured findings and call `rules report REVIEW.json` to generate the French report outside the project. [Input format and example](references/review-format.md). Reuse earlier stable IDs when comparing runs and reading a repair selection. If the user asks for fixes, hand the identified cases to [sg-fix-user-rules](../sg-fix-user-rules/SKILL.md). An audit invocation alone carries no authorization to change source.

## Trace what a person can do

1. Read the applicable root and nested instructions (including AGENTS.md, CLAUDE.md, README, review procedures and templates). Record path, line and a short excerpt. Look for mandatory independent review, obligations to fix all high-priority items, simulated personas treated as decisions, and tests required for every refusal. Cite any instructions already protecting the ability to complete an action. Separate instructions from evidence that someone followed them.
2. Make a coverage ledger of product-owned source directories, entry points and languages. Traverse screens, commands, agents, prompts, services, queues, APIs, configurations, workflows and generated templates a client actually uses. Include deployed/generated behavior when its source is unavailable, and label it. Separate behavior in ShipGuard itself from behavior it inserts into another project. Record excluded, inaccessible, generated and third-party areas and the reason. A keyword scan alone is insufficient for a whole-project inventory.
3. For each user journey, follow the action from where it is offered to its final outcome. Check conditional rendering, CSS, disabled controls, permissions, route/feature checks, early returns, waiting and stale state, duplicate checks, confirmations, ceilings, presets, filters, silently changed text and fallback choices. Check regex, keyword lists and textual intent routing for user-visible effects. Trace the ordinary path, the restricted path, and the path back. Look for actions that have disappeared by comparing reachable routes, handlers, tests and prior versions. Classify infrastructure logic only when it changes what someone can do or see. Never convert hits, tests, documentation statements or an explicitly selected option alone into rule counts.
4. Give one stable ID to each distinct **condition and observable consequence**. Combine duplicate implementations of the same decision across layers, listing all locations. Separate genuinely different triggering conditions or consequences. Check tests for both what they forbid and which legitimate action remains possible. Tie each relevant test to the rule's ID. For static evidence, say that the effect is inferred from the code. Describe a verified observation as such only if a safe observation actually occurred.

## Establish provenance

For each current rule, select an ordinary, non-sensitive and discriminating excerpt from a reviewed safe path. Record the revision being audited. The installed CLI accepts one such excerpt on standard input. It returns metadata for the earliest matching commit in the available history. Check that candidate against the code, authorship evidence and any explicit request.

```sh
printf '%s' "$excerpt" | node /path/to/plugin/cli/shipguard.mjs rules history "$project" "$path" --revision="$revision"
```

For committed code, the requested Git history search is:

```sh
git log -S"$excerpt" --format='%h %ad %s' --date=short "$revision" -- "$path" | tail -1
git show -s --format='%h %ad %an%n%s%n%b' --date=short "$candidate"
```

Use the second command after resolving the candidate hash. Inspect commit messages for co-author trailers locally and reproduce the relevant **Co-Authored-By** line as written, withholding any sensitive value if encountered. Write “aucune ligne Co-Authored-By trouvée” when appropriate. If the candidate is empty or ambiguous, inspect line history, renames and changes to that safe path. Check the rule immediately before and after the candidate. A matching string might predate the behavior, survive a reversal, or arrive with a file move. Report separate introducing and modifying commits where they explain the present effect. Use path-filtered revision reads for verification. Mark uncommitted changes, shallow history and unresolved origins explicitly.

Keep these three claims separate:

- **Who was credited.** Report author, date, hash, title and co-author evidence. An account committing a change, an AI credited for the whole commit and the author of this particular decision are different claims. Use an AI attribution for the rule only when the available evidence supports it. Keep unassigned and jointly credited cases visible. Never infer the model or its generation from style, date or a human's account.
- **Who asked.** Check the commit and nearby code comments for an explicit request by the identified user covering the actual decision. Follow linked issues, review comments, specifications or transcripts when available and identify the speaker. A request for a feature does not automatically authorize its hidden limit. An AI's claim to speak for a person, approval of a whole change, or a fictional persona's judgment is insufficient. Cite the source and a short excerpt. Otherwise write **« aucune demande trouvée »** and identify material sources that were unavailable.
- **Where it came from.** Classify as review, simulated study, direct addition, documented combination or undetermined. Give the source supporting the causal link. Mere presence of a later test, a review process or a persona study does not establish origin. Report tests separately as evidence of a refusal being locked in.

## Check whether passing tests hide a broken action

Investigate the proposed sequence independently: a test fails first, then a guard, default, filter, early exit or rewritten assertion makes the legitimate scenario unreachable, and the suite turns green. For every suspect rule, locate the test and decision before and after the transition. Read both safely scoped revisions and the applicable harness. Follow the normal public entry point and the actual side effect. Consider other sequences: the guard predates its test, both first appear in one change, the test later locks in an older refusal, or the order remains unknown. Commit order alone cannot show a formerly failing or newly passing run, and co-occurrence alone cannot show causation or anyone's motives.

Where possible, use comparable existing run evidence or an authorized, isolated, disposable reproduction with known-good non-sensitive input that an authorized person should be able to submit. Preserve the audited repository. Record revision, fixture, eligible scenarios, how many actually reached the real action, how many produced the expected observable result, and how many were refused, skipped, dropped, or answered by a substitute. Check the actual saved change, displayed result, emitted event or equivalent. For this legitimate case, a green suite with zero real invocations, an early return, a skipped case or a mock response counts as missing task completion. Also check the separate case the protection is meant to stop. Keep static reachability, measured outcomes and unavailable evidence distinct. Do not enable a live service or a destructive test to obtain a count.

For causation, publish separate denominators: all distinct rules audited, candidate rules investigated, cases with enough history and matching before/after run evidence to assess the sequence, and confirmed instances. Show unknowns and alternate sequences. Call this the primary observed mechanism only when the comparison supports that claim; specify what population any percentage describes. An intentional shortcut, an attempt to satisfy tests, and other motives require attributable testimony, even when the sequence is demonstrable. Report the evidence for maintainers without introducing an automatic suite failure or universal release gate.

## Judge the trade-off

For each rule, give one concrete scenario in everyday language. Explain what could actually go wrong if the check vanished and what is lost when it fires. Examine data loss, wrong destination, project boundaries, permission/security and any other evidenced need. Mark protection as demonstrated, no concrete harm found, or uncertain. Assess usefulness independently of who asked or who wrote it. Use one exclusive verdict per rule:

- **Utile** when the behavior addresses a concrete need proportionately and allows the legitimate task to proceed where possible.
- **Mal faite** when the aim is justified but the actual decision blocks, distorts or delays a legitimate action unnecessarily.
- **Inutile** when the evidence supports removal of the decision without losing an established purpose. Give the safe scenario that supports that judgment.
- **Indéterminée** when material evidence is missing. Explain what would resolve it.

Recommend the least disruptive behavior that preserves any real protection. Depending on the case, keep the existing rule, keep a user's draft, retry safely after waiting, show the actual alternatives, allow an explicit override when authorized, or ask one precise question when the answer changes the outcome. Never recommend bypassing a permission boundary, silently replaying an unsafe action or guessing the user's choice. For a keyword that triggers an action, show a phrase that would be misread and what the person should be offered. For each proposed remedy, describe an observable successful action a test could verify.

## Deliver and reuse

- Write **rapport-regles.md** at the root of the temporary directory, in simple French unless the user requests another language. Start with the conclusion, severity in terms of effects on people, scope, revision and limits. A verified positive example supports a finding within scope. Reserve project-wide absence claims for complete coverage. When the evidence cannot settle whether the same pattern exists, say so.
- Include the instruction findings; the coverage ledger; an inventory with **every rule's** ID, example, file and line, history and co-author, explicit request or the required absence wording, origin and evidence, related tests, protection, verdict and alternative. Cite revision-pinned source locations where possible. Prefer a small index plus readable individual entries when a single table would be too wide.
- Give totals for distinct rules, rules explicitly requested by the user, each exclusive verdict, and each known AI's evidence-backed authorship. Show unassigned cases and commit-only attribution separately. Explain shared contributions and overlap. Reconcile verdict totals to the inventory size. Partial coverage yields observed counts only. An inaccessible project has unknown counts. Do not turn unknowns into zero.
- Rank the ten most obstructive rules by concrete impact, recoverability and evidence, or all qualifying rules if fewer. List precise proposed changes to applicable instructions, including wording the maintainer can reuse. Give the user the conclusion and report location.
- For recurring ShipGuard use, run the full inventory at adoption and again at the project's existing review cadence, with an incremental review of affected user actions between full audits. Compare with the previous full inventory by stable ID. Show the decision-maker which rules were added, removed or corrected, with the observed effect when verified. Mark areas that could not be compared and keep the scope of each pass visible. In project guidance, recommend asking **« Quel dommage ce refus évite-t-il, et comment une personne autorisée termine-t-elle quand même son action ? »**. Pair a test of the actual protection with a test of the legitimate action when relevant. Record proposals and their rationale. A finding by itself authorizes no product change, release veto, extra approval step, issue publication or calendar action. Follow the user's explicit request for any separate external action.
