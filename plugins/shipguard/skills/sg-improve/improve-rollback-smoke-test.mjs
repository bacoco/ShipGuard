#!/usr/bin/env node
/**
 * ShipGuard improve rollback smoke test.
 *
 * Validates the rollback contract in isolated fixtures:
 * - existing case: files that pre-existed are restored from the newest
 *   snapshot, and the consumed snapshot is removed;
 * - first-run case: meta.yaml records the files as absent at snapshot time,
 *   so rollback DELETES the files the run created.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function parseArgs() {
  const options = { keepTmp: false, debug: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--keep-tmp') options.keepTmp = true;
    else if (arg === '--debug') options.debug = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function write(path, body) {
  writeFileSync(path, body, 'utf8');
}

function createExistingCaseFixture() {
  const root = mkdtempSync(join(tmpdir(), 'shipguard-improve-rollback-smoke-'));
  const sgDir = join(root, '.shipguard');
  const snapshotDir = join(sgDir, 'history', '20260630-120000');
  mkdirSync(snapshotDir, { recursive: true });

  const initialLearnings = [
    'success_patterns:',
    '  - pattern: "initial fixture learning"',
    '    note: "must be restored"',
    '',
  ].join('\n');
  const initialMistakes = [
    '# Mistakes not to repeat',
    '',
    '- Initial mistake entry that must be restored.',
    '',
  ].join('\n');

  write(join(sgDir, 'learnings.yaml'), initialLearnings);
  write(join(sgDir, 'mistakes.md'), initialMistakes);
  write(join(snapshotDir, 'learnings.yaml'), initialLearnings);
  write(join(snapshotDir, 'mistakes.md'), initialMistakes);
  write(join(snapshotDir, 'meta.yaml'), [
    'timestamp: "2026-06-30T12:00:00Z"',
    'trigger: "sg-improve"',
    'mode: "--local-only"',
    'audit_bugs: 1',
    'files:',
    '  learnings.yaml: existed',
    '  mistakes.md: existed',
    'github: []',
    '',
  ].join('\n'));

  write(join(sgDir, 'learnings.yaml'), 'success_patterns:\n  - pattern: "mutated"\n');
  write(join(sgDir, 'mistakes.md'), '# Mistakes not to repeat\n\n- Mutated entry.\n');

  return { root, sgDir, snapshotDir, initialLearnings, initialMistakes };
}

function createFirstRunCaseFixture() {
  const root = mkdtempSync(join(tmpdir(), 'shipguard-improve-rollback-firstrun-'));
  const sgDir = join(root, '.shipguard');
  const snapshotDir = join(sgDir, 'history', '20260630-130000');
  mkdirSync(snapshotDir, { recursive: true });

  // First run: both target files were ABSENT at snapshot time, so the
  // snapshot holds no copies — only meta.yaml recording the pre-state.
  write(join(snapshotDir, 'meta.yaml'), [
    'timestamp: "2026-06-30T13:00:00Z"',
    'trigger: "sg-improve"',
    'mode: ""',
    'audit_bugs: 1',
    'files:',
    '  learnings.yaml: absent',
    '  mistakes.md: absent',
    'github: []',
    '',
  ].join('\n'));

  // The run then created both files.
  write(join(sgDir, 'learnings.yaml'), 'success_patterns:\n  - pattern: "created by run"\n');
  write(join(sgDir, 'mistakes.md'), '# Mistakes not to repeat\n\n- Created by run.\n');

  return { root, sgDir, snapshotDir };
}

function parseMetaFiles(metaPath) {
  const text = readFileSync(metaPath, 'utf8');
  const files = {};
  const re = /^\s{2}(learnings\.yaml|mistakes\.md):\s*(existed|absent)\s*$/gm;
  let match;
  while ((match = re.exec(text)) !== null) files[match[1]] = match[2];
  assert(Object.keys(files).length > 0, `meta.yaml has no per-file pre-existence entries: ${metaPath}`);
  return files;
}

function rollbackLatest(sgDir) {
  const historyDir = join(sgDir, 'history');
  assert(existsSync(historyDir), 'history directory missing');
  const snapshots = readdirSync(historyDir)
    .filter(name => existsSync(join(historyDir, name, 'meta.yaml')))
    .sort()
    .reverse();
  assert(snapshots.length > 0, 'no rollback snapshot found');

  const latest = snapshots[0];
  const snapshotDir = join(historyDir, latest);
  const preStates = parseMetaFiles(join(snapshotDir, 'meta.yaml'));
  for (const [file, preState] of Object.entries(preStates)) {
    const target = join(sgDir, file);
    if (preState === 'existed') {
      write(target, readFileSync(join(snapshotDir, file), 'utf8'));
    } else {
      // Pre-state was absent: the run created the file; rollback deletes it.
      rmSync(target, { force: true });
    }
  }
  rmSync(snapshotDir, { recursive: true, force: true });
  return latest;
}

function runExistingCase() {
  const fixture = createExistingCaseFixture();
  try {
    const rolledBack = rollbackLatest(fixture.sgDir);
    assert(rolledBack === '20260630-120000', 'wrong snapshot was rolled back');
    assert(readFileSync(join(fixture.sgDir, 'learnings.yaml'), 'utf8') === fixture.initialLearnings, 'learnings.yaml was not restored');
    assert(readFileSync(join(fixture.sgDir, 'mistakes.md'), 'utf8') === fixture.initialMistakes, 'mistakes.md was not restored');
    assert(!existsSync(fixture.snapshotDir), 'consumed snapshot still exists');
    assert(readdirSync(join(fixture.sgDir, 'history')).length === 0, 'unexpected snapshot remained');
    return fixture;
  } catch (error) {
    console.error(`improve rollback fixture kept: ${fixture.root}`);
    throw error;
  }
}

function runFirstRunCase() {
  const fixture = createFirstRunCaseFixture();
  try {
    const rolledBack = rollbackLatest(fixture.sgDir);
    assert(rolledBack === '20260630-130000', 'wrong snapshot was rolled back (first-run case)');
    assert(!existsSync(join(fixture.sgDir, 'learnings.yaml')), 'first-run rollback did not delete learnings.yaml created by the run');
    assert(!existsSync(join(fixture.sgDir, 'mistakes.md')), 'first-run rollback did not delete mistakes.md created by the run');
    assert(!existsSync(fixture.snapshotDir), 'consumed snapshot still exists (first-run case)');
    assert(readdirSync(join(fixture.sgDir, 'history')).length === 0, 'unexpected snapshot remained (first-run case)');
    return fixture;
  } catch (error) {
    console.error(`improve rollback first-run fixture kept: ${fixture.root}`);
    throw error;
  }
}

function main() {
  const options = parseArgs();
  const fixtures = [];
  fixtures.push(runExistingCase());
  fixtures.push(runFirstRunCase());
  console.log('improve rollback smoke test passed (existing + first-run cases)');
  for (const fixture of fixtures) {
    if (!options.keepTmp && !options.debug) {
      rmSync(fixture.root, { recursive: true, force: true });
    } else {
      console.error(`improve rollback fixture kept: ${fixture.root}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`improve rollback smoke test failed: ${error.message}`);
  process.exit(1);
}
