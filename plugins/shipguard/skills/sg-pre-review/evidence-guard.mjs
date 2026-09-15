// Deterministic provenance guard; validates citations, never semantic correctness.
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

export function validateEvidence(root, evidence, reads) {
  const errors = [];
  if (!Array.isArray(evidence) || !evidence.length) return ['No decisive source evidence supplied'];
  const base = realpathSync(root);
  for (const item of evidence) {
    try {
      if (!item || typeof item.path !== 'string') throw new Error('Evidence path missing');
      const file = realpathSync(resolve(base, item.path));
      const rel = relative(base, file);
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Evidence outside repository');
      if (!Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 1 || item.end < item.start || item.end - item.start >= 8) throw new Error('Evidence must cite 1..8 source lines');
      if (!reads.some(r => r.path === rel && r.start <= item.start && r.end >= item.end)) throw new Error('Cited lines were not read');
      const actual = readFileSync(file, 'utf8').split(/\r?\n/).slice(item.start - 1, item.end).join('\n');
      if (!actual || actual !== item.excerpt) throw new Error('Excerpt does not match source lines');
    } catch (error) { errors.push(error.message); }
  }
  return errors;
}

export function guardDecision(root, result, reads) {
  const errors = validateEvidence(root, result?.evidence, reads);
  if (!['use', 'configure', 'extend', 'create', 'none', 'undetermined'].includes(result?.decision)) errors.push('Decision missing or invalid');
  if (typeof result?.comparison !== 'string' || !result.comparison.trim()) errors.push('Comparison missing');
  // A valid quotation proves provenance only. Never label model semantics as verified.
  return { decision: errors.length ? 'undetermined' : result.decision, status: errors.length || result.decision === 'undetermined' ? 'partial' : 'completed', evidence_validation: errors.length ? 'invalid' : 'valid', semantic_verification: 'not verified', errors };
}
