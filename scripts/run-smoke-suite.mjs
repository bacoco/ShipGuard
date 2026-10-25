#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);
const smokeTestPattern = /-smoke-test.*\.mjs$/;

function discoverSmokeTests(directory) {
  const tests = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
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
  const duration = formatDuration(Date.now() - startedAt);

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

if (failed > 0) process.exitCode = 1;
