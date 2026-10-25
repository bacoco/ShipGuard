#!/usr/bin/env node

import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fixture = mkdtempSync(join(tmpdir(), 'shipguard-suite-smoke-'));
const resultsDirectory = join(fixture, 'visual-tests/_results');
const summaryPath = join(resultsDirectory, 'smoke-summary.json');
const paths = ['scripts/a-smoke-test.mjs', 'scripts/z-smoke-test.mjs'];
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

function checkSummary({ consistencyCode = 0, testCodes = [0, 0] } = {}) {
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

  const stdout = result.stdout.replace(/\d+\.\d{2}s/g, '<duration>');
  if (consistencyCode) {
    assert.equal(stdout, 'Running repository consistency check.\n');
    assert.equal(result.stderr, `Consistency check failed (exit ${consistencyCode}); smoke tests were not run.\n`);
  } else {
    const lines = ['Running repository consistency check.', 'Discovered 2 smoke tests.'];
    codes.forEach((code, index) => {
      lines.push('', `[${index + 1}/2] RUN  ${paths[index]}`, privateMarker,
        `[${index + 1}/2] ${code === 0 ? 'PASS' : 'FAIL'} ${paths[index]} (<duration>${code === 0 ? '' : `, exit ${code}`})`);
    });
    lines.push('', `Summary: ${summary.counts.passed} passed, ${summary.counts.failed} failed, 2 total (<duration>)`, '');
    assert.equal(stdout, lines.join('\n'));
    assert.equal(result.stderr, '');
  }
}

try {
  mkdirSync(join(fixture, 'scripts'), { recursive: true });
  mkdirSync(resultsDirectory, { recursive: true });
  copyFileSync(join(repositoryRoot, 'scripts/run-smoke-suite.mjs'), join(fixture, 'scripts/run-smoke-suite.mjs'));
  write('scripts/check-consistency.mjs', 'process.exit(0);\n');
  for (const path of paths) write(path, `console.log('${privateMarker}');\n`);
  for (const path of existingResults) writeFileSync(join(resultsDirectory, path), `unchanged ${path}\n`);
  assert.equal(run('git', ['init', '--quiet']).status, 0);
  assert.equal(run('git', ['add', 'scripts']).status, 0);

  checkSummary();
  write(paths[0], `console.log('${privateMarker}'); process.exit(7);\n`);
  checkSummary({ testCodes: [7, 0] });
  write('scripts/check-consistency.mjs', 'process.exit(9);\n');
  checkSummary({ consistencyCode: 9 });
  console.log('PASS: numeric smoke summaries on success, test failure and consistency failure; console, order, exit codes and existing results preserved.');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
