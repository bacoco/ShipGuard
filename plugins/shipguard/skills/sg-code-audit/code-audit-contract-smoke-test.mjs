#!/usr/bin/env node
/**
 * Deterministic smoke fixtures for the sg-code-audit safety and evidence contract.
 *
 * The skill is an instruction artifact rather than a CLI implementation. This test therefore
 * checks both sides of its contract: required instructions remain present, and small executable
 * policy fixtures exercise the decisions those instructions require without launching agents.
 */

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(skillDir, '../../../..');

const files = {
  skill: readFileSync(join(skillDir, 'SKILL.md'), 'utf8'),
  agentPrompt: readFileSync(join(skillDir, 'references', 'agent-prompt.md'), 'utf8'),
  checklists: readFileSync(join(skillDir, 'references', 'checklists.md'), 'utf8'),
  verification: readFileSync(join(skillDir, 'references', 'verification.md'), 'utf8'),
  schema: readFileSync(join(skillDir, 'references', 'output-schema.md'), 'utf8'),
  monitor: readFileSync(join(skillDir, 'references', 'monitor.md'), 'utf8'),
  ship: readFileSync(join(skillDir, '..', 'sg-ship', 'SKILL.md'), 'utf8'),
  improve: readFileSync(join(skillDir, '..', 'sg-improve', 'SKILL.md'), 'utf8'),
  adapter: readFileSync(join(skillDir, 'agents', 'openai.yaml'), 'utf8'),
  rootReadme: readFileSync(join(repoRoot, 'README.md'), 'utf8'),
  pluginReadme: readFileSync(join(repoRoot, 'plugins', 'shipguard', 'README.md'), 'utf8'),
};

function requireText(name, text, fragments) {
  for (const fragment of fragments) {
    assert.ok(text.includes(fragment), `${name} is missing contract text: ${fragment}`);
  }
}

function parseMutationFlags(args) {
  const hasFix = args.includes('--fix');
  const hasReportOnly = args.includes('--report-only');
  if (hasFix && hasReportOnly) return { error: 'Cannot use --fix and --report-only together.' };
  return { fixMode: hasFix };
}

function mayApplyFix(tier, evidence) {
  if (tier === 'human-only') return false;
  if (tier === 'mechanical') return evidence?.kind === 'mechanical' && evidence.result === 'passed';
  if (tier === 'test-first') {
    return evidence?.kind === 'test-first' && evidence.before === 'failed' && evidence.after === 'passed';
  }
  return false;
}

function classifyCapacity(message) {
  const normalized = message.toLowerCase();
  if (/session limit|usage limit|quota exceeded|rate limit resets/.test(normalized)) return 'quota';
  if (/\b529\b|overloaded_error/.test(normalized)) return 'overload';
  return 'error';
}

function acceptArtifact(dispatch, artifact) {
  const entry = dispatch.entries.find((candidate) => candidate.agent_id === artifact.agent_id);
  if (!entry) return { accepted: false, reason: 'unknown-agent' };
  if (entry.status === 'superseded') return { accepted: false, reason: 'superseded-agent' };
  for (const field of ['run_id', 'base_sha']) {
    if (artifact[field] !== dispatch[field]) return { accepted: false, reason: `${field}-mismatch` };
  }
  for (const field of ['zone_id', 'round', 'agent_id']) {
    if (artifact[field] !== entry[field]) return { accepted: false, reason: `${field}-mismatch` };
  }
  return { accepted: true };
}

function resumePending(dispatch, currentHead, probeSucceeded) {
  if (currentHead !== dispatch.base_sha) return { blocked: 'base-sha-changed', agents: [] };
  if (!probeSucceeded) return { blocked: 'capacity-probe-failed', agents: [] };
  return {
    blocked: null,
    agents: dispatch.entries.filter((entry) => entry.status === 'pending').map((entry) => entry.agent_id),
  };
}

function validateCallerCount(finding, deterministicMatches) {
  if (finding.claimedCallers !== deterministicMatches.length) return { accepted: false, reason: 'caller-count-mismatch' };
  if (deterministicMatches.length === 0 && finding.severity !== 'low' && !finding.independentImpact) {
    return { accepted: false, reason: 'unverified-impact-above-low' };
  }
  return { accepted: true };
}

function countByTier(findings) {
  const counts = { mechanical: 0, 'test-first': 0, 'human-only': 0 };
  for (const finding of findings) counts[finding.fix_tier] += 1;
  return counts;
}

function collectAcceptedArtifacts(root, dispatch) {
  return dispatch.accepted_artifacts.map((relativePath) => {
    const value = JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
    const verdict = acceptArtifact(dispatch, value);
    assert.equal(verdict.accepted, true, `dispatch artifact rejected: ${verdict.reason}`);
    return value;
  });
}

function historicalFindingIsCurrent(previousFinding, currentEvidenceKeys) {
  return currentEvidenceKeys.includes(`${previousFinding.file}::${previousFinding.title.toLowerCase()}`);
}

function shellDecision(source, { sourced = false } = {}) {
  const strict = /(^|\n)\s*set\s+(?:-[a-zA-Z]*e[a-zA-Z]*|[^\n]*-o\s+errexit)/m.test(source);
  const pipefail = /(^|\n)\s*set\s+(?:-[a-zA-Z]*o[a-zA-Z]*[^\n]*pipefail|[^\n]*-o\s+pipefail)/m.test(source);
  const capturesStatus = /\$\?/.test(source) && /if\s+\[/.test(source);
  const bareFailure = /(^|\n)\s*false\s*(?:\n|$)/m.test(source);
  return {
    missingSafetyFlags: sourced ? false : !(strict && pipefail),
    uncheckedExit: bareFailure && !strict && !capturesStatus,
    blanketErrexitRecommendation: sourced ? false : !strict && !capturesStatus,
  };
}

function walkFiles(root) {
  const found = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) found.push(...walkFiles(path));
    else found.push(path);
  }
  return found;
}

function inspectCoverage(root, route, missingBranchToken) {
  const testFiles = walkFiles(root).filter((path) => /(?:^|\/)(?:tests?|specs?)(?:\/|$)/.test(path));
  const inspected = [];
  let routeCovered = false;
  let branchCovered = false;
  for (const path of testFiles) {
    const content = readFileSync(path, 'utf8');
    if (content.includes(route)) {
      inspected.push(path);
      routeCovered = true;
      if (content.includes(missingBranchToken)) branchCovered = true;
    }
  }
  return { routeCovered, branchCovered, inspected };
}

function negativeEvidenceAccepted(evidence) {
  return Boolean(
    evidence?.complete
      && evidence.scope?.length
      && evidence.searches?.length
      && evidence.inspected_files?.length,
  );
}

function assertInstructionContract() {
  requireText('SKILL.md', files.skill, [
    'Default: `fix_mode = false`',
    'Cannot use --fix and --report-only together.',
    '--fix requires a clean working tree',
    'sh, bash, zsh',
    'paused_quota',
    'SHIPGUARD_CAPACITY_OK',
    'Never glob `{results_dir}`',
    'Negative-evidence gate applied to absence claims at every severity',
  ]);
  requireText('agent-prompt.md', files.agentPrompt, [
    'Negative Claims Require Positive Proof Of The Search',
    'mechanical|test-first|human-only',
    'human-only`: never edit',
    'set -euo pipefail',
    'test_path',
  ]);
  requireText('checklists.md', files.checklists, [
    'Shell Checklist (`.sh`, `.bash`, `.zsh`)',
    'Read the complete file before judging it.',
    'executed script from a sourced library',
    'Account for `errexit`',
  ]);
  requireText('verification.md', files.verification, [
    'Negative-Evidence Gate (all severities',
    'incomplete_negative_evidence',
    'zero-caller-only claim at `low`',
    'flow_evidence',
    'source_sha',
  ]);
  requireText('output-schema.md', files.schema, [
    'Run-scoped dispatch record',
    'accepted_artifacts',
    'by_fix_tier',
    'broad result-file globs are forbidden',
  ]);
  requireText('monitor.md', files.monitor, ['"run_id": "{run_id}"', '"status": "paused_quota"']);
  requireText('sg-ship/SKILL.md', files.ship, [
    '/sg-code-audit {depth} --diff={ref} --fix',
    'audit lane runs with **`--report-only` by default**',
  ]);
  requireText('sg-improve/SKILL.md', files.improve, [
    'runs/{audit.run_id}/dispatch.json',
    'read only its `accepted_artifacts` paths',
    'Never glob the shared results directory',
  ]);
  requireText('Codex adapter', files.adapter, [
    'report-only unless fixes are explicit',
    'Use $sg-code-audit',
    'without changing source files',
  ]);
  for (const [name, readme] of [['README.md', files.rootReadme], ['plugin README', files.pluginReadme]]) {
    requireText(name, readme, ['`--fix`', 'Shell', 'report-only']);
  }

  const claudeManifest = JSON.parse(
    readFileSync(join(repoRoot, 'plugins', 'shipguard', '.claude-plugin', 'plugin.json'), 'utf8'),
  );
  const codexManifest = JSON.parse(
    readFileSync(join(repoRoot, 'plugins', 'shipguard', '.codex-plugin', 'plugin.json'), 'utf8'),
  );
  assert.equal(claudeManifest.version, '2.9.1');
  assert.equal(codexManifest.version, claudeManifest.version);
}

function assertFixSafetyFixtures() {
  assert.deepEqual(parseMutationFlags([]), { fixMode: false }, 'default must be report-only');
  assert.deepEqual(parseMutationFlags(['--report-only']), { fixMode: false });
  assert.deepEqual(parseMutationFlags(['--fix']), { fixMode: true });
  assert.equal(
    parseMutationFlags(['--fix', '--report-only']).error,
    'Cannot use --fix and --report-only together.',
  );
  assert.equal(mayApplyFix('mechanical', { kind: 'mechanical', result: 'passed' }), true);
  assert.equal(mayApplyFix('test-first', { kind: 'test-first', before: 'passed', after: 'passed' }), false);
  assert.equal(mayApplyFix('test-first', { kind: 'test-first', before: 'failed', after: 'passed' }), true);
  assert.equal(mayApplyFix('human-only', { kind: 'mechanical', result: 'passed' }), false);
  assert.deepEqual(
    countByTier([
      { fix_tier: 'mechanical' },
      { fix_tier: 'test-first' },
      { fix_tier: 'human-only' },
      { fix_tier: 'human-only' },
    ]),
    { mechanical: 1, 'test-first': 1, 'human-only': 2 },
    'summary tier counts must be derived from findings',
  );
}

function assertRunIntegrityFixtures() {
  const dispatch = {
    run_id: 'audit-current',
    base_sha: 'abc123',
    entries: [
      { agent_id: 'a-old', zone_id: 'z1', round: 1, status: 'superseded' },
      { agent_id: 'a-new', zone_id: 'z1', round: 1, status: 'completed' },
      { agent_id: 'a-pending', zone_id: 'z2', round: 1, status: 'pending' },
      { agent_id: 'a-done', zone_id: 'z3', round: 1, status: 'completed' },
    ],
  };
  const current = { run_id: 'audit-current', base_sha: 'abc123', zone_id: 'z1', round: 1, agent_id: 'a-new' };
  assert.deepEqual(acceptArtifact(dispatch, current), { accepted: true });
  assert.equal(acceptArtifact(dispatch, { ...current, run_id: 'audit-stale' }).reason, 'run_id-mismatch');
  assert.equal(acceptArtifact(dispatch, { ...current, base_sha: 'wrong' }).reason, 'base_sha-mismatch');
  assert.equal(acceptArtifact(dispatch, { ...current, agent_id: 'a-old' }).reason, 'superseded-agent');

  assert.equal(classifyCapacity('HTTP 529 overloaded_error'), 'overload');
  assert.equal(classifyCapacity('Usage limit reached; rate limit resets at 17:00'), 'quota');
  assert.deepEqual(resumePending(dispatch, 'abc123', false), {
    blocked: 'capacity-probe-failed',
    agents: [],
  });
  assert.deepEqual(resumePending(dispatch, 'abc123', true), { blocked: null, agents: ['a-pending'] });
  assert.deepEqual(resumePending(dispatch, 'different', true), { blocked: 'base-sha-changed', agents: [] });

  assert.equal(
    validateCallerCount({ claimedCallers: 3, severity: 'high' }, []).reason,
    'caller-count-mismatch',
  );
  assert.equal(
    validateCallerCount({ claimedCallers: 0, severity: 'high', independentImpact: false }, []).reason,
    'unverified-impact-above-low',
  );
  assert.deepEqual(validateCallerCount({ claimedCallers: 0, severity: 'low' }, []), { accepted: true });

  const root = mkdtempSync(join(tmpdir(), 'shipguard-run-integrity-smoke-'));
  try {
    mkdirSync(join(root, 'visual-tests', '_results', 'runs', 'audit-current'), { recursive: true });
    writeFileSync(
      join(root, 'visual-tests', '_results', 'zone-z9-r1.json'),
      JSON.stringify({ run_id: 'audit-stale', base_sha: 'old', zone_id: 'z9', round: 1 }),
    );
    const currentPath = join('visual-tests', '_results', 'runs', 'audit-current', 'zone-z1-r1-a-new.json');
    writeFileSync(join(root, currentPath), JSON.stringify(current));
    const inventory = { ...dispatch, accepted_artifacts: [currentPath] };
    const collected = collectAcceptedArtifacts(root, inventory);
    assert.equal(collected.length, 1, 'stale root artifact must not enter explicit inventory');
    assert.equal(collected[0].run_id, 'audit-current');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const priorFixed = { file: 'src/old.ts', title: 'Dead endpoint' };
  assert.equal(
    historicalFindingIsCurrent(priorFixed, []),
    false,
    'a prior fixed finding absent from current evidence must not be re-reported',
  );
}

function assertSevenAbsenceFixtures() {
  const header = Array.from({ length: 15 }, (_, index) => `# header ${index + 1}`).join('\n');
  const longHeader = `${header}\nset -euo pipefail\nprintf '%s\\n' ok\n`;
  assert.equal(shellDecision(longHeader).missingSafetyFlags, false, 'fixture 1: strict mode below header');

  const bareFailure = '#!/usr/bin/env bash\nset -euo pipefail\nfalse\nprintf done\n';
  assert.equal(shellDecision(bareFailure).uncheckedExit, false, 'fixture 2: errexit propagates bare failure');

  const captured = '#!/usr/bin/env bash\noutput=$(run_optional)\nstatus=$?\nif [ "$status" -ne 0 ]; then recover; fi\n';
  assert.equal(shellDecision(captured).blanketErrexitRecommendation, false, 'fixture 3: deliberate capture');

  const sourcedLibrary = 'helper() { printf helper; }\n';
  assert.equal(shellDecision(sourcedLibrary, { sourced: true }).missingSafetyFlags, false, 'fixture 4: sourced library');

  const root = mkdtempSync(join(tmpdir(), 'shipguard-code-audit-smoke-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests', 'integration'), { recursive: true });
    writeFileSync(join(root, 'src', 'routes.py'), '@app.get("/health")\ndef health(): pass\n');
    writeFileSync(
      join(root, 'tests', 'integration', 'test_health.py'),
      'def test_health_rejects_gateway_error():\n    assert get("/health", upstream=503).status == 503\n',
    );
    const rejectionCovered = inspectCoverage(root, '/health', '503');
    assert.equal(rejectionCovered.branchCovered, true, 'fixture 5: rejection-path test found');

    writeFileSync(
      join(root, 'tests', 'integration', 'test_health.py'),
      'def test_health_ok():\n    assert get("/health").status == 200\n',
    );
    const happyOnly = inspectCoverage(root, '/health', '503');
    assert.equal(happyOnly.routeCovered, true, 'fixture 6: endpoint is not wholly untested');
    assert.equal(happyOnly.branchCovered, false, 'fixture 6: only the precise 503 branch is uncovered');
    assert.equal(happyOnly.inspected.length, 1, 'fixture 6: matching test was inspected');

    assert.equal(
      negativeEvidenceAccepted({ complete: false, scope: ['src/'], searches: [], inspected_files: [] }),
      false,
      'fixture 7: incomplete absence evidence rejected',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  assertInstructionContract();
  assertFixSafetyFixtures();
  assertRunIntegrityFixtures();
  assertSevenAbsenceFixtures();
  console.log('code-audit contract smoke test passed (safety, run integrity, quota, tracer, 7 absence fixtures)');
} catch (error) {
  console.error(`code-audit contract smoke test failed: ${error.message}`);
  process.exit(1);
}
