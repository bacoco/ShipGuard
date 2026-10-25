#!/usr/bin/env node

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);
const smokeTestPattern = /-smoke-test.*\.mjs$/;
// Git tracks files, so include their parent directories while still discovering
// new or renamed tests from the working tree inside those directories.
const trackedDirectories = new Set([repositoryRoot]);
const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

for (const file of trackedFiles) {
  let directory = dirname(resolve(repositoryRoot, file));
  while (directory !== repositoryRoot) {
    trackedDirectories.add(directory);
    directory = dirname(directory);
  }
}

function discoverSmokeTests(directory) {
  const tests = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name) && trackedDirectories.has(resolve(directory, entry.name))) {
        tests.push(...discoverSmokeTests(resolve(directory, entry.name)));
      }
    } else if (entry.isFile() && smokeTestPattern.test(entry.name)) {
      tests.push(resolve(directory, entry.name));
    }
  }

  return tests;
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

const tests = discoverSmokeTests(repositoryRoot)
  .sort((left, right) => left.localeCompare(right));
const suiteStartedAt = Date.now();
let passed = 0;
let failed = 0;
const testResults = [];
let consistency;

// Status is numeric: 0 = passed, 1 = failed. Store no child output or errors.
function measuredResult(path, result, durationMs) {
  return { path, status: result.status === 0 ? 0 : 1, exitCode: result.status ?? 1, durationMs };
}

function writeSummary() {
  const summaryPath = resolve(repositoryRoot, 'visual-tests/_results/smoke-summary.json');
  const summary = {
    status: consistency.status || (failed > 0 ? 1 : 0),
    durationMs: Date.now() - suiteStartedAt,
    counts: { passed, failed, total: tests.length, skipped: tests.length - passed - failed },
    consistency,
    tests: testResults,
  };
  try {
    mkdirSync(dirname(summaryPath), { recursive: true });
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  } catch {
    // Reporting must not replace the suite's original exit code.
    console.error('Could not write smoke summary.');
  }
}

console.log('Running repository consistency check.');
const consistencyStartedAt = Date.now();
const consistencyResult = spawnSync(process.execPath, [resolve(repositoryRoot, 'scripts/check-consistency.mjs')], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: 'inherit',
});
consistency = measuredResult('scripts/check-consistency.mjs', consistencyResult, Date.now() - consistencyStartedAt);

if (consistencyResult.status !== 0) {
  const reason = consistencyResult.error?.message
    ?? (consistencyResult.signal ? `signal ${consistencyResult.signal}` : `exit ${consistencyResult.status}`);
  console.error(`Consistency check failed (${reason}); smoke tests were not run.`);
  writeSummary();
  process.exit(consistencyResult.status ?? 1);
}

console.log(`Discovered ${tests.length} smoke test${tests.length === 1 ? '' : 's'}.`);

for (const [index, test] of tests.entries()) {
  const displayPath = relative(repositoryRoot, test);
  const startedAt = Date.now();
  console.log(`\n[${index + 1}/${tests.length}] RUN  ${displayPath}`);

  const result = spawnSync(process.execPath, [test], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  const durationMs = Date.now() - startedAt;
  const duration = formatDuration(durationMs);
  testResults.push(measuredResult(displayPath, result, durationMs));

  if (result.status === 0) {
    passed += 1;
    console.log(`[${index + 1}/${tests.length}] PASS ${displayPath} (${duration})`);
  } else {
    failed += 1;
    const reason = result.error?.message
      ?? (result.signal ? `signal ${result.signal}` : `exit ${result.status}`);
    console.log(`[${index + 1}/${tests.length}] FAIL ${displayPath} (${duration}, ${reason})`);
  }
}

const totalDuration = formatDuration(Date.now() - suiteStartedAt);
console.log(`\nSummary: ${passed} passed, ${failed} failed, ${tests.length} total (${totalDuration})`);
writeSummary();

if (failed > 0) process.exitCode = 1;
