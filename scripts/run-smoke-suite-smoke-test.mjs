#!/usr/bin/env node

import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fixture = mkdtempSync(join(tmpdir(), 'shipguard-suite-smoke-'));
const resultsDirectory = join(fixture, 'visual-tests/_results');
const summaryPath = join(resultsDirectory, 'smoke-summary.json');
const recorder = 'plugins/shipguard/skills/sg-record';
const unitTest = `${recorder}/lib/actions-to-yaml.test.mjs`;
const integrationTest = `${recorder}/lib/integration-test.mjs`;
const paths = [unitTest, integrationTest, 'scripts/a-smoke-test.mjs', 'scripts/z-smoke-test.mjs'];
const integrationFixtures = join(fixture, 'integration-fixtures.jsonl');
const sourceArtifacts = [`${recorder}/manifests/recorded-integration-test.yaml`, `${recorder}/_results/review.html`];
const privateMarker = 'CHILD_OUTPUT_MUST_NOT_ENTER_JSON';
const existingResults = ['audit-results.json', 'logic-results.json', 'process-results.json', 'audit-results.toon'];

function write(path, content) {
  writeFileSync(join(fixture, path), content);
}

function run(command, args) {
  return spawnSync(command, args, { cwd: fixture, encoding: 'utf8' });
}

function checkRecord(record, path, exitCode) {
  assert.deepEqual(Object.keys(record).sort(), ['durationMs', 'exitCode', 'path', 'status']);
  assert.equal(record.path, path);
  assert.equal(record.status, exitCode === 0 ? 0 : 1);
  assert.equal(record.exitCode, exitCode);
  assert.ok(Number.isInteger(record.durationMs) && record.durationMs >= 0);
}

function checkSummary({ consistencyCode = 0, testCodes = paths.map(() => 0) } = {}) {
  const result = run(process.execPath, ['scripts/run-smoke-suite.mjs']);
  const status = consistencyCode || (testCodes.some(code => code !== 0) ? 1 : 0);
  assert.equal(result.status, status, result.stderr);
  const raw = readFileSync(summaryPath, 'utf8');
  assert.ok(!raw.includes(privateMarker));
  assert.ok(!raw.includes(fixture));
  const summary = JSON.parse(raw);
  assert.deepEqual(Object.keys(summary).sort(), ['consistency', 'counts', 'durationMs', 'status', 'tests']);
  assert.equal(summary.status, status === 0 ? 0 : 1);
  assert.ok(Number.isInteger(summary.durationMs) && summary.durationMs >= 0);
  checkRecord(summary.consistency, 'scripts/check-consistency.mjs', consistencyCode);
  const codes = consistencyCode ? [] : testCodes;
  assert.deepEqual(summary.counts, {
    passed: codes.filter(code => code === 0).length,
    failed: codes.filter(code => code !== 0).length,
    total: paths.length,
    skipped: paths.length - codes.length,
  });
  assert.equal(summary.tests.length, codes.length);
  codes.forEach((code, index) => checkRecord(summary.tests[index], paths[index], code));
  assert.ok(summary.durationMs >= summary.consistency.durationMs + summary.tests.reduce((sum, test) => sum + test.durationMs, 0));

  // Every JSON leaf is a number or an expected repository-relative path.
  function checkLeaves(value) {
    if (value && typeof value === 'object') return Object.values(value).forEach(checkLeaves);
    if (typeof value === 'number') return assert.ok(Number.isFinite(value));
    assert.equal(typeof value, 'string');
    assert.ok(!isAbsolute(value) && !value.split('/').includes('..'));
    assert.ok(['scripts/check-consistency.mjs', ...paths].includes(value));
  }
  checkLeaves(summary);
  for (const path of existingResults) assert.equal(readFileSync(join(resultsDirectory, path), 'utf8'), `unchanged ${path}\n`);
  assert.deepEqual(readdirSync(resultsDirectory).sort(), [...existingResults, 'smoke-summary.json'].sort());
  for (const path of sourceArtifacts) assert.equal(readFileSync(join(fixture, path), 'utf8'), `unchanged ${path}\n`);
  if (existsSync(integrationFixtures)) {
    for (const line of readFileSync(integrationFixtures, 'utf8').trim().split('\n')) {
      assert.ok(!existsSync(JSON.parse(line)), 'integration fixture removed after success or failure');
    }
  }

  const stdout = result.stdout.replace(/\d+\.\d{2}s/g, '<duration>');
  if (consistencyCode) {
    assert.equal(stdout, 'Running repository consistency check.\n');
    assert.equal(result.stderr, `Consistency check failed (exit ${consistencyCode}); smoke tests were not run.\n`);
  } else {
    const lines = ['Running repository consistency check.', `Discovered ${paths.length} smoke tests.`];
    codes.forEach((code, index) => {
      lines.push('', `[${index + 1}/${paths.length}] RUN  ${paths[index]}`, privateMarker,
        `[${index + 1}/${paths.length}] ${code === 0 ? 'PASS' : 'FAIL'} ${paths[index]} (<duration>${code === 0 ? '' : `, exit ${code}`})`);
    });
    lines.push('', `Summary: ${summary.counts.passed} passed, ${summary.counts.failed} failed, ${paths.length} total (<duration>)`, '');
    assert.equal(stdout, lines.join('\n'));
    assert.equal(result.stderr, '');
  }
}

try {
  mkdirSync(join(fixture, 'scripts'), { recursive: true });
  mkdirSync(join(fixture, recorder, 'lib'), { recursive: true });
  mkdirSync(join(fixture, recorder, 'manifests'), { recursive: true });
  mkdirSync(join(fixture, recorder, '_results'), { recursive: true });
  const review = 'plugins/shipguard/skills/sg-visual-review';
  mkdirSync(join(fixture, review), { recursive: true });
  mkdirSync(resultsDirectory, { recursive: true });
  copyFileSync(join(repositoryRoot, 'scripts/run-smoke-suite.mjs'), join(fixture, 'scripts/run-smoke-suite.mjs'));
  write('scripts/check-consistency.mjs', 'process.exit(0);\n');
  for (const path of paths) write(path, `console.log('${privateMarker}');\n`);
  write(`${recorder}/lib/actions-to-yaml.mjs`, 'export const fixture = true;\n');
  write(`${review}/build-review.mjs`, '// fixture builder\n');
  write(`${review}/_review-template.html`, '<!-- fixture template -->\n');
  const integrationSource = `
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fixture } from './actions-to-yaml.mjs';
const visualTests = dirname(import.meta.dirname);
const project = dirname(visualTests);
assert.ok(!project.startsWith(${JSON.stringify(fixture)} + sep));
assert.equal(process.cwd(), project);
assert.equal(fixture, true);
assert.equal(readFileSync(join(visualTests, 'build-review.mjs'), 'utf8'), '// fixture builder\\n');
assert.equal(readFileSync(join(visualTests, '_review-template.html'), 'utf8'), '<!-- fixture template -->\\n');
assert.equal(readFileSync(join(visualTests, '_config.yaml'), 'utf8'), 'base_url: "http://localhost:6969"\\n');
mkdirSync(join(visualTests, '_results'), { recursive: true });
writeFileSync(join(visualTests, '_results/review.html'), 'fixture result');
appendFileSync(${JSON.stringify(integrationFixtures)}, JSON.stringify(project) + '\\n');
console.log('${privateMarker}');
`;
  write(integrationTest, integrationSource);
  // Include only the two named exceptions, not arbitrary tests in tracked directories.
  write('scripts/unrelated.test.mjs', 'process.exit(99);\n');
  write('scripts/integration-test.mjs', 'process.exit(99);\n');
  for (const path of sourceArtifacts) write(path, `unchanged ${path}\n`);
  for (const path of existingResults) writeFileSync(join(resultsDirectory, path), `unchanged ${path}\n`);
  assert.equal(run('git', ['init', '--quiet']).status, 0);
  assert.equal(run('git', ['add', 'scripts', 'plugins']).status, 0);

  checkSummary();
  write('scripts/a-smoke-test.mjs', `console.log('${privateMarker}'); process.exit(7);\n`);
  checkSummary({ testCodes: [0, 0, 7, 0] });
  write(unitTest, `console.log('${privateMarker}'); process.exit(6);\n`);
  write(integrationTest, `${integrationSource}\nprocess.exit(8);\n`);
  checkSummary({ testCodes: [6, 8, 7, 0] });
  write('scripts/check-consistency.mjs', 'process.exit(9);\n');
  checkSummary({ consistencyCode: 9 });
  console.log('PASS: converter discovery and disposable integration on success/failure; numeric summaries, console, order, exit codes and existing results preserved.');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
