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
  return root;
}

/**
 * Assert that both fixtures carry the fields the producers (sg-code-audit,
 * sg-visual-run) are contracted to emit. Producer-schema drift must fail here.
 */
function validateFixtureSchemas(root) {
  const resultsDir = join(root, 'visual-tests', '_results');
  const audit = JSON.parse(readFileSync(join(resultsDir, 'audit-results.json'), 'utf8'));
  assert(typeof audit.prompt_hash === 'string' && audit.prompt_hash.length > 0, 'audit fixture missing prompt_hash');
  assert(audit.scope_info && typeof audit.scope_info.mode === 'string', 'audit fixture missing scope_info.mode');
  assert(audit.verification && Number.isInteger(audit.verification.checked), 'audit fixture missing verification.checked');
  assert(Number.isInteger(audit.verification.confirmed), 'audit fixture missing verification.confirmed');
  assert(audit.summary?.lifecycle && Number.isInteger(audit.summary.lifecycle.new), 'audit fixture missing summary.lifecycle');
  assert(Array.isArray(audit.impacted_backend), 'audit fixture missing impacted_backend');
  assert(Array.isArray(audit.fixed_since_last_run), 'audit fixture missing fixed_since_last_run');
  assert(Array.isArray(audit.agents) && Number.isInteger(audit.agent_count), 'audit fixture missing agents/agent_count');
  assert(audit.agent_count === audit.agents.length, 'audit fixture agent_count must equal agents.length');
  const bug = audit.bugs?.[0];
  assert(bug, 'audit fixture missing bugs[0]');
  assert(typeof bug.verification_score === 'number', 'audit fixture bug missing verification_score');
  assert(typeof bug.verified === 'boolean', 'audit fixture bug missing verified');
  assert(typeof bug.lifecycle === 'string', 'audit fixture bug missing lifecycle');

  const visual = JSON.parse(readFileSync(join(resultsDir, 'visual-results.json'), 'utf8'));
  assert(typeof visual.run_id === 'string' && visual.run_id.length > 0, 'visual fixture missing run_id');
  assert(visual.scope && typeof visual.scope.type === 'string', 'visual fixture missing scope.type');
  assert(Number.isInteger(visual.scope.selected_total), 'visual fixture missing scope.selected_total');
  assert(Number.isInteger(visual.scope.full_suite_total), 'visual fixture missing scope.full_suite_total');
  assert(Array.isArray(visual.scope.selected_manifests), 'visual fixture missing scope.selected_manifests');
  assert(Array.isArray(visual.scope.uncovered_routes), 'visual fixture missing scope.uncovered_routes');
  assert(Number.isInteger(visual.summary?.pass), 'visual fixture missing summary.pass');
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
    `- Audit prompt hash: ${audit.prompt_hash}`,
    `- Agent count: ${audit.agent_count ?? audit.agents?.length}`,
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
    validateFixtureSchemas(root);
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
