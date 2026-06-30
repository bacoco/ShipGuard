#!/usr/bin/env node
/**
 * ShipGuard improve dry-run smoke test.
 *
 * Validates that structured audit/visual fixtures can produce a preview report
 * without writing .shipguard state, snapshots, source files, or GitHub issues.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(SCRIPT_DIR, 'fixtures');

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

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'shipguard-improve-smoke-'));
  const resultsDir = join(root, 'visual-tests', '_results');
  mkdirSync(resultsDir, { recursive: true });
  copyFileSync(join(FIXTURE_DIR, 'audit-results.json'), join(resultsDir, 'audit-results.json'));
  copyFileSync(join(FIXTURE_DIR, 'visual-results.json'), join(resultsDir, 'visual-results.json'));
  writeFileSync(join(resultsDir, 'fix-manifest.json'), JSON.stringify({ action: 'validate-and-fix', tests: [] }, null, 2), 'utf8');
  return root;
}

function buildPreview(root) {
  const resultsDir = join(root, 'visual-tests', '_results');
  const audit = JSON.parse(readFileSync(join(resultsDir, 'audit-results.json'), 'utf8'));
  const visual = JSON.parse(readFileSync(join(resultsDir, 'visual-results.json'), 'utf8'));
  const preview = [
    '# sg-improve preview - smoke',
    '',
    'Mode: `--dry-run`',
    '',
    '## Structured Data',
    '',
    `- Audit mode: ${audit.mode}`,
    `- Agent count: ${audit.agent_count || audit.agents}`,
    `- Bugs: ${audit.summary?.total_bugs || 0}`,
    `- Visual pass: ${visual.summary?.pass || 0}/${visual.summary?.total || 0}`,
    '',
    '## Target Files That Would Be Written In Real Mode',
    '',
    '- `.shipguard/history/<timestamp>/meta.yaml`',
    '- `.shipguard/learnings.yaml`',
    '- `.shipguard/mistakes.md`',
    '- GitHub issue or comment',
    '',
    '## Proposed Learning',
    '',
    '```yaml',
    'success_patterns:',
    '  - pattern: "dry-run preview smoke fixture"',
    '    note: "sg-improve preview can be generated without writing .shipguard."',
    '```',
    '',
    'Dry-run completed without writing target files.',
    '',
  ].join('\n');
  const previewPath = join(resultsDir, 'sg-improve-preview.md');
  writeFileSync(previewPath, preview, 'utf8');
  return previewPath;
}

function main() {
  const options = parseArgs();
  let root = null;
  let passed = false;
  try {
    root = createFixture();
    const previewPath = buildPreview(root);
    assert(existsSync(previewPath), 'preview was not written');
    assert(!existsSync(join(root, '.shipguard', 'learnings.yaml')), 'dry-run wrote learnings.yaml');
    assert(!existsSync(join(root, '.shipguard', 'mistakes.md')), 'dry-run wrote mistakes.md');
    assert(!existsSync(join(root, '.shipguard', 'history')), 'dry-run wrote history snapshot');
    const preview = readFileSync(previewPath, 'utf8');
    assert(preview.includes('Target Files'), 'preview missing target files');
    assert(preview.includes('Proposed Learning'), 'preview missing proposed learning');
    passed = true;
    console.log('improve dry-run smoke test passed');
    if (options.debug) console.error(`improve dry-run fixture=${root}`);
  } finally {
    if (root && passed && !options.keepTmp && !options.debug) {
      rmSync(root, { recursive: true, force: true });
    } else if (root) {
      console.error(`improve dry-run fixture kept: ${root}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`improve dry-run smoke test failed: ${error.message}`);
  process.exit(1);
}
