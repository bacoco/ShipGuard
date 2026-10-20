#!/usr/bin/env node
/**
 * Deterministic smoke fixtures for the sg-code-audit safety and evidence contract.
 *
 * The skill is an instruction artifact rather than a CLI implementation. This test therefore
 * checks both sides of its contract: required instructions remain present, and small executable
 * policy fixtures exercise the decisions those instructions require without launching agents.
 * Artifact retention also uses real temporary Git worktrees with modeled cleanup, not Agent.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
    'incomplete_artifact_transport',
    'retain-zone-artifact.mjs',
    'Never reconstruct it from the agent\'s output text',
    'Never glob `{results_dir}`',
    'Negative-evidence gate applied to absence claims at every severity',
  ]);
  requireText('agent-prompt.md', files.agentPrompt, [
    'Negative Claims Require Positive Proof Of The Search',
    'mechanical|test-first|human-only',
    'human-only`: never edit',
    'set -euo pipefail',
    'test_path',
    'node "{artifact_retention_script}" --run-id "{run_id}"',
    'artifact_retention_failed',
    'git commit -a',
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
    'incomplete_artifact_transport',
    'artifact_retention_failed',
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
  assert.match(claudeManifest.version, /^\d+\.\d+\.\d+$/);
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

function assertWorktreeArtifactTransport() {
  // Real Git worktrees with a model of clean-worktree cleanup. This is NOT a native Agent test.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shipguard-artifact-transport-')));
  const main = join(root, 'main');
  const git = (cwd, ...args) => {
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const script = join(skillDir, 'retain-zone-artifact.mjs');
  try {
    mkdirSync(main);
    git(main, 'init', '-q');
    writeFileSync(join(main, '.gitignore'), 'visual-tests/\n');
    writeFileSync(join(main, 'source.js'), 'export const unchanged = true;\n');
    writeFileSync(join(main, 'README.md'), 'Sources and contract must remain unchanged.\n');
    git(main, 'add', '.gitignore', 'source.js', 'README.md');
    git(main, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    const base = git(main, 'rev-parse', 'HEAD');
    const relativePath = 'visual-tests/_results/runs/audit-transport/zone-z1-r1-a1.json';
    const artifact = { run_id: 'audit-transport', base_sha: base, zone_id: 'z1', round: 1,
      agent_id: 'a1', zone: 'source.js', bugs: [] };
    const bytes = `${JSON.stringify(artifact)}\n`;
    const writeArtifact = worktree => {
      const path = join(worktree, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      return path;
    };
    const cleanupIfClean = worktree => {
      if (!git(worktree, 'status', '--porcelain', '--untracked-files=all')) {
        git(main, 'worktree', 'remove', '--force', worktree);
      }
    };

    const control = join(root, 'ignored-control');
    git(main, 'worktree', 'add', '--detach', control, base);
    const controlFile = writeArtifact(control);
    assert.equal(git(control, 'check-ignore', relativePath), relativePath);
    cleanupIfClean(control);
    assert.equal(existsSync(controlFile), false, 'unretained ignored JSON is lost at cleanup');

    const worktree = join(root, 'retained');
    git(main, 'worktree', 'add', '--detach', worktree, base);
    const sourceFile = writeArtifact(worktree);
    const parentIndex = readFileSync(join(main, '.git', 'index'));
    const trackedBefore = ['source.js', 'README.md', '.gitignore'].map(path => readFileSync(join(main, path)));
    const oldCanonical = join(main, 'visual-tests', '_results', 'audit-results.json');
    mkdirSync(dirname(oldCanonical), { recursive: true });
    writeFileSync(oldCanonical, '{"run_id":"previous","bugs":[]}\n');
    const oldBytes = readFileSync(oldCanonical);
    const retain = (cwd, overrides = {}) => spawnSync(process.execPath, [script,
      '--run-id', artifact.run_id, '--base-sha', base, '--zone-id', artifact.zone_id,
      '--round', '1', '--agent-id', artifact.agent_id], { cwd, encoding: 'utf8', ...overrides });
    const result = retain(worktree);
    assert.equal(result.status, 0, `ignored zone JSON must be retained before completion: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).artifact, relativePath);
    assert.equal(git(worktree, 'diff', '--cached', '--name-only'), '', 'artifact content must not be staged');
    assert.equal(git(worktree, 'write-tree'), git(main, 'rev-parse', 'HEAD^{tree}'), 'commit tree remains unchanged');
    assert.equal(git(worktree, 'diff', '--name-only'), relativePath, 'only the artifact is made Git-visible');
    cleanupIfClean(worktree);
    assert.equal(readFileSync(sourceFile, 'utf8'), bytes, 'exact JSON survives modeled cleanup');
    const destination = join(main, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(sourceFile, destination);
    assert.equal(readFileSync(destination, 'utf8'), bytes, 'parent copies the exact original file');
    const dispatch = { run_id: artifact.run_id, base_sha: base,
      entries: [{ ...artifact, status: 'completed' }], accepted_artifacts: [relativePath] };
    assert.deepEqual(collectAcceptedArtifacts(main, dispatch), [artifact]);

    const indexPath = git(worktree, 'rev-parse', '--git-path', 'index');
    const childIndex = readFileSync(resolve(worktree, indexPath));
    for (const field of ['run_id', 'base_sha', 'zone_id', 'round', 'agent_id']) {
      writeFileSync(sourceFile, JSON.stringify({ ...artifact, [field]: field === 'round' ? 2 : 'foreign' }));
      assert.notEqual(retain(worktree).status, 0, `reject foreign ${field}`);
      assert.deepEqual(readFileSync(resolve(worktree, indexPath)), childIndex, 'rejection leaves index unchanged');
    }
    writeFileSync(sourceFile, bytes);
    assert.equal(retain(worktree).status, 0, 'retention can be repeated safely');
    writeFileSync(sourceFile, '{invalid');
    assert.notEqual(retain(worktree).status, 0, 'reject malformed JSON without substituting text');
    rmSync(sourceFile);
    assert.notEqual(retain(worktree).status, 0, 'reject a missing artifact');
    assert.deepEqual(readFileSync(resolve(worktree, indexPath)), childIndex, 'failed retention never rewrites the index');
    writeFileSync(sourceFile, bytes);
    assert.notEqual(retain(main).status, 0, 'never mutate the parent index');
    assert.notEqual(retain(worktree, { env: { ...process.env, GIT_INDEX_FILE: join(main, '.git', 'index') } }).status,
      0, 'reject alternate index redirection');
    assert.deepEqual(readFileSync(oldCanonical), oldBytes, 'previous canonical result remains intact');
    assert.deepEqual(readFileSync(join(main, '.git', 'index')), parentIndex, 'parent index is byte-identical');
    for (const [i, path] of ['source.js', 'README.md', '.gitignore'].entries()) {
      assert.deepEqual(readFileSync(join(main, path)), trackedBefore[i]);
      assert.deepEqual(readFileSync(join(worktree, path)), trackedBefore[i]);
    }
    assert.equal(git(main, 'rev-parse', 'HEAD'), base);
    assert.equal(git(worktree, 'rev-parse', 'HEAD'), base);
    assert.equal(git(main, 'status', '--porcelain'), '');
    console.log('artifact transport: real Git worktrees passed (modeled cleanup; native Agent NOT VERIFIED)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  assertInstructionContract();
  assertFixSafetyFixtures();
  assertRunIntegrityFixtures();
  assertSevenAbsenceFixtures();
  assertWorktreeArtifactTransport();
  console.log('code-audit contract smoke test passed (safety, run integrity, quota, tracer, 7 absence fixtures)');
} catch (error) {
  console.error(`code-audit contract smoke test failed: ${error.message}`);
  process.exit(1);
}
