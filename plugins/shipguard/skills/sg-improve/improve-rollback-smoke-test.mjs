#!/usr/bin/env node
/**
 * ShipGuard improve rollback smoke test.
 *
 * Validates the rollback contract in an isolated fixture: current .shipguard
 * files are restored from the newest snapshot, and the consumed snapshot is
 * removed without touching files outside the fixture.
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

function createFixture() {
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
    '# Mistakes',
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
    '',
  ].join('\n'));

  write(join(sgDir, 'learnings.yaml'), 'success_patterns:\n  - pattern: "mutated"\n');
  write(join(sgDir, 'mistakes.md'), '# Mistakes\n\n- Mutated entry.\n');

  return { root, sgDir, snapshotDir, initialLearnings, initialMistakes };
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
  for (const file of ['learnings.yaml', 'mistakes.md']) {
    const source = join(snapshotDir, file);
    if (existsSync(source)) write(join(sgDir, file), readFileSync(source, 'utf8'));
  }
  rmSync(snapshotDir, { recursive: true, force: true });
  return latest;
}

function main() {
  const options = parseArgs();
  let fixture = null;
  let passed = false;
  try {
    fixture = createFixture();
    const rolledBack = rollbackLatest(fixture.sgDir);
    assert(rolledBack === '20260630-120000', 'wrong snapshot was rolled back');
    assert(readFileSync(join(fixture.sgDir, 'learnings.yaml'), 'utf8') === fixture.initialLearnings, 'learnings.yaml was not restored');
    assert(readFileSync(join(fixture.sgDir, 'mistakes.md'), 'utf8') === fixture.initialMistakes, 'mistakes.md was not restored');
    assert(!existsSync(fixture.snapshotDir), 'consumed snapshot still exists');
    assert(readdirSync(join(fixture.sgDir, 'history')).length === 0, 'unexpected snapshot remained');
    passed = true;
    console.log('improve rollback smoke test passed');
    if (options.debug) console.error(`improve rollback fixture=${fixture.root}`);
  } finally {
    if (fixture?.root && passed && !options.keepTmp && !options.debug) {
      rmSync(fixture.root, { recursive: true, force: true });
    } else if (fixture?.root) {
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
