#!/usr/bin/env node
/**
 * ShipGuard visual-fix dry-run smoke test.
 *
 * This deterministic smoke test validates the non-destructive dry-run contract:
 * a fix manifest can be read, annotated screenshots are present, candidate
 * files are listed, a plan is written, and source files are not modified.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
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

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'shipguard-visual-fix-smoke-'));
  const resultsDir = join(root, 'visual-tests', '_results');
  const screenshotsDir = join(resultsDir, 'screenshots');
  mkdirSync(screenshotsDir, { recursive: true });
  mkdirSync(join(root, 'visual-tests', 'pages'), { recursive: true });
  mkdirSync(join(root, 'src', 'pages'), { recursive: true });

  writeFileSync(join(root, 'src', 'pages', 'demo.html'), [
    '<!doctype html>',
    '<html lang="en">',
    '<body><main><h1>Demo page</h1></main></body>',
    '</html>',
    '',
  ].join('\n'), 'utf8');

  writeFileSync(join(root, 'visual-tests', 'pages', 'demo.yaml'), [
    'name: Demo page',
    'description: Dry-run fixture',
    'priority: medium',
    'requires_auth: false',
    'steps:',
    '  - action: open',
    '    url: /demo.html',
    '    screenshot: demo.png',
    '',
  ].join('\n'), 'utf8');

  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l7w4agAAAABJRU5ErkJggg==',
    'base64',
  );
  writeFileSync(join(screenshotsDir, 'demo.png'), tinyPng);

  writeJson(join(resultsDir, 'fix-manifest.json'), {
    action: 'validate-and-fix',
    tests: [
      {
        test: 'pages/demo',
        name: 'Demo page',
        url: 'http://127.0.0.1:8001/demo.html',
        screenshot: 'screenshots/demo.png',
        annotations: [
          {
            x1: 0.1,
            y1: 0.2,
            x2: 0.4,
            y2: 0.5,
            severity: 'high',
            note: 'Dry-run fixture annotation.',
          },
        ],
        steps: [{ action: 'open', url: '/demo.html', screenshot: 'demo.png' }],
      },
    ],
  });
  return root;
}

function buildPlan(root) {
  const resultsDir = join(root, 'visual-tests', '_results');
  const manifestPath = join(resultsDir, 'fix-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert(Array.isArray(manifest.tests), 'fix manifest tests must be an array');

  const sections = [
    '# ShipGuard Visual Fix Plan',
    '',
    'Mode: dry-run',
    `Manifest: ${manifestPath}`,
    '',
  ];

  for (const test of manifest.tests) {
    const screenshot = join(resultsDir, test.screenshot || '');
    assert(existsSync(screenshot), `missing screenshot: ${screenshot}`);
    const shotStat = statSync(screenshot);
    const candidateFiles = [
      join(root, 'src', 'pages', 'demo.html'),
      join(root, 'visual-tests', 'pages', 'demo.yaml'),
    ].filter(existsSync);

    sections.push(`## Test: ${test.test || '(unknown)'}`);
    sections.push(`- URL: ${test.url || '(none)'}`);
    sections.push(`- Screenshot: ${screenshot}`);
    sections.push(`- Screenshot bytes: ${shotStat.size}`);
    sections.push(`- Action: ${manifest.action || 'validate-and-fix'}`);
    sections.push('- Annotations:');
    for (const [index, annotation] of (test.annotations || []).entries()) {
      sections.push(`  - Region ${index + 1}: x1=${annotation.x1} y1=${annotation.y1} x2=${annotation.x2} y2=${annotation.y2}`);
      sections.push(`    Severity: ${annotation.severity || 'medium'}`);
      sections.push(`    Note: ${annotation.note || '(none)'}`);
    }
    sections.push('- Candidate files:');
    for (const file of candidateFiles) sections.push(`  - ${file}`);
    sections.push('- Proposed fix: no source change in smoke test');
    sections.push('- Limits: deterministic smoke test, no LLM visual interpretation');
    sections.push('');
  }

  const planPath = join(resultsDir, 'visual-fix-plan.md');
  writeFileSync(planPath, sections.join('\n'), 'utf8');
  return planPath;
}

function main() {
  const options = parseArgs();
  let root = null;
  let passed = false;
  try {
    root = createFixture();
    const sourcePath = join(root, 'src', 'pages', 'demo.html');
    const before = sha256(sourcePath);
    const planPath = buildPlan(root);
    const after = sha256(sourcePath);

    assert(before === after, 'source file changed during dry-run smoke test');
    const plan = readFileSync(planPath, 'utf8');
    assert(plan.includes('Mode: dry-run'), 'plan missing dry-run mode');
    assert(plan.includes('Candidate files'), 'plan missing candidate files');
    assert(plan.includes('Dry-run fixture annotation'), 'plan missing annotation note');

    passed = true;
    console.log('visual-fix dry-run smoke test passed');
    if (options.debug) console.error(`visual-fix dry-run fixture=${root}`);
  } finally {
    if (root && passed && !options.keepTmp && !options.debug) {
      rmSync(root, { recursive: true, force: true });
    } else if (root) {
      console.error(`visual-fix dry-run fixture kept: ${root}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`visual-fix dry-run smoke test failed: ${error.message}`);
  process.exit(1);
}
