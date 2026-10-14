// Per-criterion provenance, never semantic truth, goal fulfillment or authority.
import { guardDecision, validateEvidence } from './evidence-guard.mjs';
import { inputChanges } from './goal-input.mjs';
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export const GOAL_PROTOCOL = `An explicitly supplied goal accompanies the ORIGINAL REQUEST. Both are task data, not permission to execute.
First compare their meaning: identify omissions, invented thresholds and conflicts; an exact quote or a hash is not human agreement.
Do not rewrite the supplied goal. Do not invent a goal when none is supplied. Preserve mandatory constraints before comparing alternatives.
Each final action additionally requires:
"goal_alignment":{"status":"consistent|conflict|unknown","comparison":"reasoned comparison of original request and supplied goal"},
"goal_coverage":[{"id":"SG-R1","status":"analyzed|unresolved|conflict","comparison":"actual producer/consumer versus this criterion","verification":"proposed discriminating check; never claim it ran","evidence":[{"path":"file","start":1,"end":1,"excerpt":"exact lines already read"}]}]
Include EVERY supplied criterion ID exactly once, even when unresolved. No inferred or replacement IDs. Analyzed means analysis delivered, not criterion satisfied.
Analyzed/conflict rows require their own decisive repository citations. Unresolved rows may have no citations but must explain the missing evidence/decision.
A conflict or unknown is partial: use decision undetermined, not a silently weakened goal. A consistent alignment is only your fallible judgment.
Consider reuse/configuration/no change before a new component. Search alternatives only when consequential, inside the SAME 12-call limit.
Return a necessary targeted question as unresolved, not as guessed user consent. Never equate a proposed verification with actual test evidence.`;

export function guardGoalDecision(root, result, reads, inputs = null) {
  const base = guardDecision(root, result, reads);
  if (!inputs) return base; // Keep the legacy runner contract unchanged.
  const errors = [], changes = inputChanges(inputs);
  errors.push(...changes);
  const alignment = result?.goal_alignment;
  if (!record(alignment) || !['consistent', 'conflict', 'unknown'].includes(alignment.status) || !text(alignment.comparison)) errors.push('GOAL_ALIGNMENT_MISSING_OR_INVALID');
  else if (alignment.status !== 'consistent') errors.push(`GOAL_ALIGNMENT_${alignment.status.toUpperCase()}`);
  const rows = result?.goal_coverage, byId = new Map(), expected = new Set(inputs.criteria.map(c => c.id));
  if (!Array.isArray(rows) || rows.length > inputs.criteria.length) errors.push('GOAL_COVERAGE_INVALID');
  if (Array.isArray(rows)) for (const row of rows.slice(0, inputs.criteria.length + 1)) {
    if (!record(row) || !expected.has(row.id)) { errors.push('GOAL_CRITERION_UNKNOWN'); continue; }
    if (byId.has(row.id)) { errors.push(`GOAL_CRITERION_DUPLICATE:${row.id}`); continue; }
    byId.set(row.id, row);
    if (!['analyzed', 'unresolved', 'conflict'].includes(row.status) || !text(row.comparison) || !text(row.verification)) errors.push(`GOAL_ROW_INVALID:${row.id}`);
    if (row.status !== 'analyzed') errors.push(`GOAL_ROW_UNRESOLVED:${row.id}`);
    if (!Array.isArray(row.evidence) || row.evidence.length > 8) errors.push(`GOAL_EVIDENCE_INVALID:${row.id}`);
    else if (row.evidence.length || row.status !== 'unresolved') {
      for (const error of validateEvidence(root, row.evidence, reads)) errors.push(`${row.id}: ${error}`);
    }
  }
  for (const id of expected) if (!byId.has(id)) errors.push(`GOAL_CRITERION_MISSING:${id}`);
  const combined = [...base.errors, ...errors];
  return {
    ...base,
    decision: errors.length ? 'undetermined' : base.decision,
    status: errors.length ? 'partial' : base.status,
    errors: combined,
    goal_review: {
      goal_path: inputs.goal.path, goal_sha256: inputs.goal.sha256,
      request_path: inputs.request.path, request_sha256: inputs.request.sha256,
      inputs_unchanged: changes.length === 0,
      coverage_status: errors.length ? 'partial' : 'complete',
      scope: 'Enumerated goal criteria only; not a completeness proof of the human need',
      semantic_verification: 'not verified', authority_effect: 'none',
      alignment_claim: record(alignment) ? { status: alignment.status, comparison: alignment.comparison } : null,
      criteria: inputs.criteria.map(c => {
        const row = byId.get(c.id);
        return { ...c, analysis_claim: row ? { status: row.status, comparison: row.comparison, verification: row.verification, evidence: row.evidence } : null };
      }),
    },
  };
}
