# ShipGuard Techniques Library

> Accumulated knowledge from `/sg-scout` runs. Each entry is a technique found in the wild that could improve ShipGuard. Status: `proposed` (idea), `implementing` (in progress), `implemented` (shipped), `rejected` (tried, didn't work).

---

## Surgical Prompt Mutations
- **Source:** [Shubhamsaboo/awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps/tree/main/awesome_agent_skills/self-improving-agent-skills)
- **Score:** 4.2/5.0 (Impact: 5, Novelty: 4, Applicability: 4, Effort: 3)
- **Category:** mutation
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-04-14

Instead of proposing 13 changes at once, make ONE change per round to the audit prompt. Measure impact. Keep if score improves, revert if not. 4 mutation types: `add_example`, `add_constraint`, `restructure`, `add_edge_case`.

**Update 2026-06-10:** their ADK implementation also logs kept/discarded per strategy (post-run stats reveal which mutation type works for a given skill) and uses Pydantic output schemas for the Analyst/Mutator agents so the loop never breaks on malformed JSON. Added as data point on issue #42.

---

## Score-Based Accept/Revert Loop
- **Source:** [Shubhamsaboo/awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps/tree/main/awesome_agent_skills/self-improving-agent-skills)
- **Score:** 4.0/5.0 (Impact: 5, Novelty: 4, Applicability: 3, Effort: 3)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-04-14

Compare audit N vs audit N+1. If bugs_found increases AND false_positives decreases, the prompt mutation is working. If not, revert. Binary zone-level verdict: PASS (0 critical) or FAIL (1+ critical).

---

## N-Parallel Runs for Confidence Intervals
- **Source:** [Alexmacapple/alex-claude-skill](https://github.com/Alexmacapple/alex-claude-skill/tree/main/eval-robuste)
- **Score:** 3.8/5.0 (Impact: 4, Novelty: 4, Applicability: 4, Effort: 2)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-04-14

Dispatch 2 agents on the same zone. Keep only bugs found by both (high confidence). Flag discrepancies. Reduces false positives at the cost of 2x tokens per zone. Best used selectively on critical zones.

---

## Prompt Hash Pinning (SHA256)
- **Source:** [Alexmacapple/alex-claude-skill](https://github.com/Alexmacapple/alex-claude-skill/tree/main/eval-robuste)
- **Score:** 3.6/5.0 (Impact: 3, Novelty: 5, Applicability: 4, Effort: 4)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit, sg-improve
- **Date scouted:** 2026-04-14

SHA256 hash of audit prompt template + checklists + learnings. When the hash changes, mark old session_history baselines as `BASELINE_OBSOLETE`. Prevents comparing apples to oranges when the prompt evolves.

---

## Strict Output Contract with Retry
- **Source:** [Alexmacapple/alex-claude-skill](https://github.com/Alexmacapple/alex-claude-skill/tree/main/eval-robuste)
- **Score:** 3.5/5.0 (Impact: 3, Novelty: 3, Applicability: 5, Effort: 5)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-04-14

Validate each zone JSON against a strict schema (required fields, severity enum, category enum). If validation fails, retry the agent once with an explicit "your JSON was malformed" error message. Currently sg-code-audit accepts partial/malformed results.

---

## Statistical Verdict Categories
- **Source:** [Alexmacapple/alex-claude-skill](https://github.com/Alexmacapple/alex-claude-skill/tree/main/eval-robuste)
- **Score:** 3.4/5.0 (Impact: 3, Novelty: 4, Applicability: 3, Effort: 4)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-04-14

Classify session deltas as: STABLE (within noise), AMELIORATION (significant improvement), REGRESSION (significant degradation), BRUIT (too much variance to tell). Threshold: delta > sigma x 1.5 = significant. Requires ≥3 session_history entries.

---

## 3-Agent Architecture (Executor/Analyst/Mutator)
- **Source:** [Shubhamsaboo/awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps/tree/main/awesome_agent_skills/self-improving-agent-skills)
- **Score:** 3.2/5.0 (Impact: 4, Novelty: 3, Applicability: 3, Effort: 2)
- **Category:** architecture
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve (future)
- **Date scouted:** 2026-04-14

Split sg-improve into 3 specialized passes: Executor (run audit, collect metrics), Analyst (diagnose failures, classify root cause), Mutator (propose ONE prompt change). Currently sg-improve does all three in one pass. Separation would improve diagnosis quality.

---

## Deterministic Aggregation via Script
- **Source:** [Alexmacapple/alex-claude-skill](https://github.com/Alexmacapple/alex-claude-skill/tree/main/eval-robuste)
- **Score:** 3.0/5.0 (Impact: 3, Novelty: 2, Applicability: 4, Effort: 5)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-04-14

Move Phase 6 (aggregate zone JSONs into audit-results.json) from LLM to a Python script (`scripts/aggregate_audit.py`). Ensures reproducible results — no LLM variance in counting, categorizing, or deduplicating. The script handles: severity normalization, category normalization, dedup by file+title, impacted_routes derivation.

---

## Baseline Finding Diff (NEW/FIXED/PERSISTENT)
- **Source:** [alissonlinneker/shield-claude-skill](https://github.com/alissonlinneker/shield-claude-skill)
- **Score:** 4.2/5.0 (Impact: 4, Novelty: 4, Applicability: 5, Effort: 4)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Diff each audit run against the previous one; tag every finding NEW / FIXED / PERSISTENT. Enables trend tracking and regression detection across audit runs. Filed as [#52](https://github.com/bacoco/ShipGuard/issues/52).

---

## Risk Acceptance with Expiry
- **Source:** [wrsmith108/claude-skill-security-auditor](https://github.com/wrsmith108/claude-skill-security-auditor)
- **Score:** 4.1/5.0 (Impact: 4, Novelty: 4, Applicability: 5, Effort: 4)
- **Category:** scoring
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

`accepted-risks.json` with reason + `expires` date per finding. Accepted findings stop cluttering reports; expired acceptances resurface automatically. Filed as [#52](https://github.com/bacoco/ShipGuard/issues/52).

---

## Singleton Verification Gate
- **Source:** [minwoo-data/prism](https://github.com/minwoo-data/prism)
- **Score:** 4.2/5.0 (Impact: 4, Novelty: 4, Applicability: 5, Effort: 4)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Findings flagged by 2+ independent agents are auto-CONFIRMED; findings flagged by exactly 1 agent go to a batched second-pass verifier. Spends verification effort only where false-positive risk lives. Filed as [#53](https://github.com/bacoco/ShipGuard/issues/53).

---

## Fresh-Instance Adversarial Review
- **Source:** [dsifry/metaswarm](https://github.com/dsifry/metaswarm)
- **Score:** 3.7/5.0 (Impact: 4, Novelty: 3, Applicability: 4, Effort: 4)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Each verification iteration uses a NEW reviewer instance with no prior context, binary PASS/FAIL verdict, file:line evidence required. Prevents the verifier inheriting the finder's bias. Part of [#53](https://github.com/bacoco/ShipGuard/issues/53).

---

## Mechanical Verification Gates
- **Source:** [c0rrey/ant-farm](https://github.com/c0rrey/ant-farm)
- **Score:** 3.8/5.0 (Impact: 4, Novelty: 4, Applicability: 4, Effort: 2)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Phase transitions gated by a script reading/writing `gate-status.json` PASS/FAIL verdicts (startup → pre-spawn → scope-verify → claims-vs-code → review-integrity → complete). Code-enforced, not prompt-hoped. Part of [#53](https://github.com/bacoco/ShipGuard/issues/53).

---

## "What NOT to Flag" Negative Guidelines
- **Source:** [spsk-dev/code-review](https://github.com/spsk-dev/code-review)
- **Score:** 4.0/5.0 (Impact: 4, Novelty: 3, Applicability: 5, Effort: 5)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Explicit negative checklist in the reviewer prompt: pre-existing issues, linter-catchable bugs, nitpicks, intentional changes. Cheap, durable false-positive reduction — seed it from sg-improve learnings. Filed as [#54](https://github.com/bacoco/ShipGuard/issues/54).

---

## Cross-Model Agreement Confidence
- **Source:** [spsk-dev/code-review](https://github.com/spsk-dev/code-review)
- **Score:** 3.9/5.0 (Impact: 4, Novelty: 4, Applicability: 4, Effort: 3)
- **Category:** scoring
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Every finding scored 0-100 confidence; only ≥80 posted. Cross-model agreement (Codex/Gemini CLI agents flagging the same issue) boosts confidence; missing CLIs degrade gracefully to Claude-only (3-tier degradation). Part of [#54](https://github.com/bacoco/ShipGuard/issues/54).

---

## Severity Conflict Tracking
- **Source:** [c0rrey/ant-farm](https://github.com/c0rrey/ant-farm)
- **Score:** 3.8/5.0 (Impact: 3, Novelty: 4, Applicability: 5, Effort: 4)
- **Category:** scoring
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit, sg-improve
- **Date scouted:** 2026-06-10

When the same root cause is rated 2+ severity levels apart by different reviewers, log the conflict as a calibration signal (highest severity wins, but the disagreement is surfaced). Part of [#54](https://github.com/bacoco/ShipGuard/issues/54).

---

## Reference Pre-Loading per Category
- **Source:** [thoughtbot/rails-audit-thoughtbot](https://github.com/thoughtbot/rails-audit-thoughtbot)
- **Score:** 3.0/5.0 (Impact: 3, Novelty: 2, Applicability: 4, Effort: 4)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Curated per-category reference checklists (code smells, security checklist, antipatterns) loaded before analysis so criteria stay consistent across agents. Mentioned in [#54](https://github.com/bacoco/ShipGuard/issues/54).

---

## Fix-Safety Tiering (auto / test-first / human)
- **Source:** [thtskaran/claude-skills](https://github.com/thtskaran/claude-skills) (deslop)
- **Score:** 4.2/5.0 (Impact: 4, Novelty: 4, Applicability: 5, Effort: 4)
- **Category:** scoring
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit (fix phase)
- **Date scouted:** 2026-06-10

Every finding gets Tier 1 (safe mechanical fix, auto-apply), Tier 2 (characterization tests required before fixing), or Tier 3 (human review, never auto-touched). Structural encoding of "working code is not a bug". Filed as [#55](https://github.com/bacoco/ShipGuard/issues/55).

---

## Machine-Parseable Finding IDs (15-category taxonomy)
- **Source:** [thtskaran/claude-skills](https://github.com/thtskaran/claude-skills) (deslop)
- **Score:** 2.8/5.0 (Impact: 3, Novelty: 2, Applicability: 4, Effort: 4)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Finding IDs prefixed by category (SEC-001, BUG-002, ERR-003…) across 15 categories; the fix phase consumes the audit file fully decoupled from the find phase. Library only.

---

## Function-Boundary Chunking for God Files
- **Source:** [thtskaran/claude-skills](https://github.com/thtskaran/claude-skills) (deslop)
- **Score:** 2.9/5.0 (Impact: 2, Novelty: 3, Applicability: 4, Effort: 4)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Files >500 lines are chunked by function/class boundaries with the import header re-read per chunk — prevents context-loss false positives inside zones. Library only (zone sizing already learned per-project by sg-improve).

---

## Learnings Ledger with Provenance & Usage Counters
- **Source:** [dsifry/metaswarm](https://github.com/dsifry/metaswarm)
- **Score:** 4.1/5.0 (Impact: 4, Novelty: 4, Applicability: 5, Effort: 3)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-06-10

JSONL knowledge base: each fact has type (api_behavior/code_quirk/pattern/gotcha/decision/performance/security), confidence, provenance (source, PR, date), tags, usageCount + helpfulCount. Counters reveal which learnings actually pay rent. Filed as [#56](https://github.com/bacoco/ShipGuard/issues/56).

---

## Improvement Promotion Pipeline (eval gate → canary → rollback)
- **Source:** [Undertone0809/rudder](https://github.com/Undertone0809/rudder)
- **Score:** 3.8/5.0 (Impact: 4, Novelty: 4, Applicability: 4, Effort: 2)
- **Category:** mutation
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-06-10

Run feedback → retrospective → improvement proposal with risk level (low→critical) → eval gate → canary run → promotion, with rollback. Prompt changes never become default without passing a gate. Part of [#56](https://github.com/bacoco/ShipGuard/issues/56).

---

## Failure-Mode Vocabulary for Retrospectives
- **Source:** [Undertone0809/rudder](https://github.com/Undertone0809/rudder)
- **Score:** 3.2/5.0 (Impact: 3, Novelty: 3, Applicability: 4, Effort: 4)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-06-10

Fixed taxonomy for why a run failed: requirements_unclear, context_missing, wrong_context, memory_stale, skill_missing, skill_misapplied. Makes learnings queryable by cause. Part of [#56](https://github.com/bacoco/ShipGuard/issues/56).

---

## DOM Diff + Pixel Diff Dual Layer
- **Source:** [horai93/vrt](https://github.com/horai93/vrt)
- **Score:** 4.1/5.0 (Impact: 4, Novelty: 4, Applicability: 5, Effort: 3)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-visual-run
- **Date scouted:** 2026-06-10

Two deterministic signals under the LLM layer: `agent-browser diff` for DOM structure changes + reg-cli pixel diff with threshold, per viewport. Pages with zero delta skip the LLM pass entirely. Built on the same agent-browser ShipGuard already uses. Filed as [#57](https://github.com/bacoco/ShipGuard/issues/57).

---

## Before/After Change Classification (improvement/regression/neutral)
- **Source:** [Dinesh-NPC/Design-Audit-Agent](https://github.com/Dinesh-NPC/Design-Audit-Agent)
- **Score:** 3.9/5.0 (Impact: 4, Novelty: 3, Applicability: 5, Effort: 4)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-change-report
- **Date scouted:** 2026-06-10

Vision model classifies each before/after visual change as improvement / regression / neutral with a change_type taxonomy (contrast/spacing/typography/color/layout/content/icon) and a net verdict. Regressions sorted first. Part of [#57](https://github.com/bacoco/ShipGuard/issues/57).

---

## Vision Principle-Scoped Findings
- **Source:** [Dinesh-NPC/Design-Audit-Agent](https://github.com/Dinesh-NPC/Design-Audit-Agent)
- **Score:** 3.3/5.0 (Impact: 3, Novelty: 3, Applicability: 4, Effort: 4)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-visual-review
- **Date scouted:** 2026-06-10

Single-screenshot audit scoped to 5 design principles (hierarchy, contrast, spacing, alignment, consistency), each finding carrying severity + confidence + location + user impact. Could pre-annotate the review page before human annotation. Folded into [#57](https://github.com/bacoco/ShipGuard/issues/57).

---

## Binary Evals (≤6 yes/no assertions)
- **Source:** [arush361/autoresearch-claude-skills](https://github.com/arush361/autoresearch-claude-skills)
- **Score:** 4.1/5.0 (Impact: 4, Novelty: 4, Applicability: 4, Effort: 5)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-06-10

Replace 1-10 scales with 3-6 yes/no assertions max — scales compound variance; more than 6 evals invites gaming. Case study: 59.2% → 97.5% in 3 experiments. Commented on [#44](https://github.com/bacoco/ShipGuard/issues/44).

---

## Per-Eval Breakdown Visibility
- **Source:** [arush361/autoresearch-claude-skills](https://github.com/arush361/autoresearch-claude-skills)
- **Score:** 3.5/5.0 (Impact: 3, Novelty: 3, Applicability: 4, Effort: 5)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-06-10

Report pass rate per assertion, not just aggregate — identifies which mutation moved which eval, enabling causal diagnosis. Commented on [#44](https://github.com/bacoco/ShipGuard/issues/44).

---

## Cost-Tiered Eval Ladder
- **Source:** [bergr7/claude-skill-prompt-optimizer](https://github.com/bergr7/claude-skill-prompt-optimizer)
- **Score:** 3.9/5.0 (Impact: 4, Novelty: 4, Applicability: 4, Effort: 3)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-06-10

Spot check (3-5 cases, 1 sample) → targeted (failing cases) → regression (full suite) → final (full suite, 5 samples). Escalate only on signal; revert immediately on spot-check regression. Commented on [#44](https://github.com/bacoco/ShipGuard/issues/44).

---

## Failure-Pattern → Prompt-Section Mapping
- **Source:** [bergr7/claude-skill-prompt-optimizer](https://github.com/bergr7/claude-skill-prompt-optimizer)
- **Score:** 3.6/5.0 (Impact: 4, Novelty: 3, Applicability: 4, Effort: 3)
- **Category:** mutation
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-06-10

Classify eval failures against a taxonomy, map each pattern to the specific prompt section to edit, rank by test cases affected. Prevents shotgun edits. Commented on [#42](https://github.com/bacoco/ShipGuard/issues/42).

---

## Skill-vs-Baseline A/B Benchmark
- **Source:** [dani-z/frontend-design-skill-benchmark](https://github.com/dani-z/frontend-design-skill-benchmark)
- **Score:** 3.3/5.0 (Impact: 3, Novelty: 4, Applicability: 3, Effort: 3)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve
- **Date scouted:** 2026-06-10

Run the same task suite with and without the skill loaded; assertion pass-rate delta isolates the skill's contribution (their demo: 100% vs 28%). Could measure ShipGuard learnings uplift on a known-bug corpus. Commented on [#44](https://github.com/bacoco/ShipGuard/issues/44).

---

## Partial-Failure Aggregation Policy (n_valid ≥ 3)
- **Source:** [Alexmacapple/alex-claude-skill](https://github.com/Alexmacapple/alex-claude-skill) (eval-robuste)
- **Score:** 3.4/5.0 (Impact: 3, Novelty: 3, Applicability: 4, Effort: 4)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-improve, sg-code-audit
- **Date scouted:** 2026-06-10

When N parallel runs yield <3 valid results, refuse to aggregate (distinct exit code) instead of computing stats on sparse data. CI reliability flag (`ic_fiabilite: faible`) when n<10. Commented on [#44](https://github.com/bacoco/ShipGuard/issues/44).

---

## Weighted Multi-Dimension Score with Critical Veto
- **Source:** [bjulius/skill-evaluator](https://github.com/bjulius/skill-evaluator)
- **Score:** 2.9/5.0 (Impact: 2, Novelty: 3, Applicability: 4, Effort: 4)
- **Category:** scoring
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Weighted dimensions (security 35%, quality 25%, utility 20%, compliance 20%) where any critical security finding caps the overall score regardless of other dimensions. The veto pattern is the reusable bit. Library only — ShipGuard already has a risk score.

---

## Graceful Multi-Tool Degradation
- **Source:** [spsk-dev/code-review](https://github.com/spsk-dev/code-review), [alissonlinneker/shield-claude-skill](https://github.com/alissonlinneker/shield-claude-skill)
- **Score:** 3.0/5.0 (Impact: 2, Novelty: 3, Applicability: 4, Effort: 5)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Detect available external tools (`which codex && which gemini`) pre-flight, run what exists, note gaps in the report, never retry-loop. Covered inside [#54](https://github.com/bacoco/ShipGuard/issues/54).

---

## 4-Phase Breadth-then-Depth Review
- **Source:** [muruai2021/multi-agent-code-review](https://github.com/muruai2021/multi-agent-code-review)
- **Score:** 2.7/5.0 (Impact: 2, Novelty: 3, Applicability: 3, Effort: 4)
- **Category:** evaluation
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Context gathering (10%) → high-level review (30%) → line-by-line (50%) → summary & decision (10%). Enforces breadth before depth so agents don't rabbit-hole on the first issue. Library only.

---

## Semantic Severity Tags with Decision Rule
- **Source:** [muruai2021/multi-agent-code-review](https://github.com/muruai2021/multi-agent-code-review)
- **Score:** 2.4/5.0 (Impact: 2, Novelty: 2, Applicability: 3, Effort: 5)
- **Category:** scoring
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

6 tags (blocking/important/nit/suggestion/learning/praise) with a mechanical verdict rule: any blocking → request changes; any important → comment; else approve. Library only.

---

## CI Exit-Code Gating
- **Source:** [wrsmith108/claude-skill-security-auditor](https://github.com/wrsmith108/claude-skill-security-auditor)
- **Score:** 2.5/5.0 (Impact: 2, Novelty: 2, Applicability: 4, Effort: 5)
- **Category:** infrastructure
- **Status:** `proposed`
- **ShipGuard skill:** sg-code-audit
- **Date scouted:** 2026-06-10

Exit 0 clean / 1 findings above threshold / 2 tool error, with `--fail-on <severity>` for CI pipelines. Library only.

---

## Nielsen Heuristic Severity Scale
- **Source:** [mastepanoski/claude-skills](https://github.com/mastepanoski/claude-skills)
- **Score:** 2.6/5.0 (Impact: 2, Novelty: 3, Applicability: 3, Effort: 3)
- **Category:** scoring
- **Status:** `proposed`
- **ShipGuard skill:** sg-visual-review
- **Date scouted:** 2026-06-10

UX findings mapped to Nielsen's 10 usability heuristics with a 0-4 severity scale per finding — a standard vocabulary for visual-review annotations. Library only.
