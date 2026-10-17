import { sep } from 'node:path';
import { validateEvidence } from '../../sg-pre-review/evidence-guard.mjs';
import { inventory, readSource, requireObject, requireText, textLines } from './prompt-audit-input.mjs';
import { proposedDiff } from './prompt-audit-diff.mjs';

const ACTIONS = ['keep', 'flag', 'rewrite', 'remove'];
const PATTERNS = ['stale-fact', 'instruction-conflict', 'model-workaround', 'tool-contract', 'context-delivery', 'learning', 'keep'];
const isEdit = finding => ['rewrite', 'remove'].includes(finding.action);
const meta = file => Object.fromEntries(Object.entries(file).filter(([key]) => key !== 'content'));
const inline = value => String(value).replace(/[\r\n]/g, ' ').replace(/[<>&`*_\[\]\\]/g, char => `&#${char.charCodeAt(0)};`);

function checkFinding(root, receipt, finding) {
  requireObject(finding, ['id', 'path', 'start', 'end', 'excerpt', 'pattern', 'basis', 'confidence', 'reason', 'action',
    'evidence', 'model_source', 'replacement', 'protected_contract', 'verification_plan'], 'finding');
  requireText(finding.id, 'finding.id', 80);
  if (!PATTERNS.includes(finding.pattern) || !ACTIONS.includes(finding.action)) throw new Error('unknown pattern or action');
  if (!['repository', 'model-doc', 'heuristic'].includes(finding.basis)) throw new Error('unknown finding basis');
  if (!['high', 'medium', 'low'].includes(finding.confidence)) throw new Error('unknown confidence');
  for (const field of ['reason', 'protected_contract', 'verification_plan']) requireText(finding[field], field);
  const sources = receipt.files.filter(file => file.status === 'read');
  const source = sources.find(file => file.path === finding.path);
  if (!source) throw new Error('finding target not in read scope');
  if (!Array.isArray(finding.evidence) || finding.evidence.length > 16) throw new Error('evidence: expected at most 16 citations');
  const target = { path: finding.path, start: finding.start, end: finding.end, excerpt: finding.excerpt };
  const citations = [target, ...finding.evidence];
  for (const citation of citations) {
    requireObject(citation, ['path', 'start', 'end', 'excerpt'], 'citation');
    const file = sources.find(candidate => candidate.path === citation.path);
    if (!file || !Number.isInteger(citation.start) || !Number.isInteger(citation.end)
      || citation.start < 1 || citation.end < citation.start || citation.end > file.lines || citation.end - citation.start >= 8) {
      throw new Error('citation must cover 1..8 lines in selected source');
    }
    if (textLines(file.content).slice(citation.start - 1, citation.end).join('\n') !== citation.excerpt) throw new Error('citation differs from inventory');
  }
  const errors = validateEvidence(root, citations, sources.map(file => ({ path: file.path.split('/').join(sep), start: 1, end: file.lines })));
  if (errors.length) throw new Error('source evidence invalid or changed');
  if (finding.basis === 'model-doc') {
    requireObject(finding.model_source, ['url', 'checked_at', 'supports'], 'model_source');
    const url = new URL(requireText(finding.model_source.url, 'model_source.url', 2048));
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('model_source: expected credential-free HTTPS reference');
    const date = finding.model_source.checked_at;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
      || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('model_source: valid verification date required');
    requireText(finding.model_source.supports, 'model_source.supports');
  } else if (finding.model_source !== undefined) throw new Error('model_source only applies to model-doc');
  if (isEdit(finding)) {
    if (source.protected) throw new Error('protected surface is flag-only in this increment');
    if (finding.confidence === 'low' || finding.basis === 'heuristic') throw new Error('low-confidence/heuristic findings are flag-only');
    if (finding.basis === 'model-doc' && ['model', 'host'].some(key => /^(unknown|unavailable|auto|default|unresolved)$/i.test(receipt.target[key]))) {
      throw new Error('model-dependent edit requires known model and host');
    }
    if (!finding.evidence.length && finding.basis === 'repository') throw new Error('repository edit requires supporting source evidence');
    if (typeof finding.replacement !== 'string' || finding.replacement.length > 16384
      || finding.replacement.includes('\r') || finding.replacement.includes('\0')) throw new Error('invalid replacement');
    if (finding.action === 'remove' ? finding.replacement !== '' : !finding.replacement.endsWith('\n')) throw new Error('rewrite must end in LF; remove must be empty');
    if (`${finding.excerpt}\n` === finding.replacement) throw new Error('no-op edit');
  } else if (finding.replacement !== undefined) throw new Error('keep/flag must not contain replacement');
  return { ...finding, fix_tier: 'human-only', evidence_validation: 'valid', semantic_verification: 'not verified' };
}

function markdown(report) {
  const out = ['# ShipGuard prompt audit', '', `Status: ${report.status}. Semantic verification: not verified. Authority effect: none.`, '',
    `Target (caller-supplied): ${inline(JSON.stringify(report.target))}`, `Inventory: ${report.inventory_id}`,
    `Existing audit prompt_hash: ${report.prompt_hash ?? 'not supplied'}`, '', '## Scope and declared review coverage'];
  for (const file of report.files) {
    const coverage = report.coverage.find(item => item.path === file.path);
    out.push(`- ${inline(file.path)}: ${file.status}; ${inline(coverage?.status ?? 'unknown')}; ${inline(coverage?.reason ?? file.reason ?? '')}`);
  }
  out.push('', '## Findings (agent judgments; citations checked only)');
  for (const finding of report.findings) {
    out.push('', `### ${inline(finding.id)} — ${inline(finding.action)}: ${inline(finding.path)}:${finding.start}-${finding.end}`,
      `Pattern: ${finding.pattern}; confidence: ${finding.confidence}; basis: ${finding.basis}.`,
      `Reason: ${inline(finding.reason)}`, `Protected contract: ${inline(finding.protected_contract)}`,
      `Verification plan: ${inline(finding.verification_plan)}`, '', 'Exact target evidence:');
    out.push(...finding.excerpt.split('\n').map(line => `    ${line}`));
    for (const citation of finding.evidence) {
      out.push('', `Supporting source: ${inline(citation.path)}:${citation.start}-${citation.end}`,
        ...citation.excerpt.split('\n').map(line => `    ${line}`));
    }
    if (finding.model_source) out.push(`Model reference (not fetched by helper): ${inline(JSON.stringify(finding.model_source))}`);
  }
  if (!report.findings.length) out.push('No findings supplied; this is not a safety certification.');
  if (report.errors.length) out.push('', '## Validation errors', ...report.errors.map(error => `- ${inline(error)}`));
  out.push('', '## Proposed diff', report.proposed_diff ? 'Available in proposed_diff. Review before applying; the helper never applies it.' : 'Empty. No source changes proposed by this receipt.',
    '', 'Source-only inspection; runtime delivery and model effectiveness were not measured.');
  return `${out.join('\n')}\n`;
}

export function review(request) {
  const { root, receipt } = inventory(request);
  const report = { ...receipt, operation: 'review', status: 'partial', files: receipt.files.map(meta), coverage: [], findings: [],
    evidence_validation: 'invalid', errors: [], proposed_diff: '' };
  try {
    const proposal = request.review;
    requireObject(proposal, ['inventory_id', 'coverage', 'findings'], 'review');
    if (proposal.inventory_id !== receipt.inventory_id) throw new Error('inventory changed: sources, scope, target, or identity declarations differ');
    if (!Array.isArray(proposal.coverage) || proposal.coverage.length !== receipt.files.length) throw new Error('coverage must list every selected file once');
    const covered = new Set();
    for (const item of proposal.coverage) {
      requireObject(item, ['path', 'status', 'reason'], 'coverage');
      if (!receipt.files.some(file => file.path === item.path) || covered.has(item.path)) throw new Error('unknown or duplicate coverage path');
      if (!['reviewed', 'unknown'].includes(item.status)) throw new Error('coverage status: expected reviewed or unknown');
      requireText(item.reason, 'coverage.reason');
      covered.add(item.path);
      report.coverage.push(item);
    }
    if (!Array.isArray(proposal.findings) || proposal.findings.length > 100) throw new Error('findings: expected at most 100 entries');
    const ids = new Set();
    for (const finding of proposal.findings) {
      if (ids.has(finding?.id)) throw new Error('duplicate finding id');
      const checked = checkFinding(root, receipt, finding);
      ids.add(checked.id);
      report.findings.push(checked);
    }
    if (receipt.files.some(file => file.status !== 'read') || report.coverage.some(item => item.status !== 'reviewed')) {
      throw new Error('incomplete scope or declared review: no patch emitted');
    }
    const diff = receipt.files.map(file => proposedDiff(file.path, file.content,
      report.findings.filter(finding => finding.path === file.path && isEdit(finding)))).join('');
    for (const file of receipt.files) {
      if (readSource(root, file.path).sha256 !== file.sha256) throw new Error('source changed before receipt completion');
    }
    report.evidence_validation = 'valid';
    report.status = report.findings.some(isEdit) ? 'proposal-ready' : 'reviewed-no-patch';
    report.proposed_diff = diff;
  } catch (error) {
    report.errors.push(error.code ? 'source unavailable during validation' : error.message);
  }
  report.report_markdown = markdown(report);
  return report;
}
