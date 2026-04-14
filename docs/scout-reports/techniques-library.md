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
