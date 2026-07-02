#!/usr/bin/env node
/**
 * ShipGuard visual-fix dry-run smoke test.
 *
 * Deterministic contract test for the dry-run flow:
 * - the fixture fix-manifest.json is a real dashboard-export sample (top-level
 *   action "validate-and-fix" + timestamp; per-test optional boolean flags
 *   redo_entirely / revert_to_before / improve_ui; annotations with normalized
 *   0-1 coordinates, note, and severity defaulting to "critical"),
 * - the generated dry-run plan contains one entry per test with the correct
 *   mode label (validate-and-fix / redo / improve),
 * - no fixture source file the plan-builder could plausibly touch is modified.
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

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l7w4agAAAABJRU5ErkJggg==',
  'base64',
);

const SOURCE_PAGES = ['login.html', 'dashboard.html', 'settings.html'];

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'shipguard-visual-fix-smoke-'));
  const resultsDir = join(root, 'visual-tests', '_results');
  const screenshotsDir = join(resultsDir, 'screenshots');
  mkdirSync(screenshotsDir, { recursive: true });
  mkdirSync(join(root, 'src', 'pages'), { recursive: true });

  // Fixture project source files — the sentinels the plan-builder could
  // plausibly touch (candidate files traced from each test's route).
  for (const page of SOURCE_PAGES) {
    writeFileSync(join(root, 'src', 'pages', page), [
      '<!doctype html>',
      '<html lang="en">',
      `<body><main><h1>${page.replace('.html', '')}</h1></main></body>`,
      '</html>',
      '',
    ].join('\n'), 'utf8');
  }

  for (const shot of ['login-load.png', 'dashboard-load.png', 'settings-load.png']) {
    writeFileSync(join(screenshotsDir, shot), TINY_PNG);
  }

  // Real dashboard-export sample. action is ALWAYS "validate-and-fix" at the
  // top level; per-test behavior comes from the three optional boolean flags.
  // Test-level url is resolved; step urls are raw ({base_url} placeholder).
  // screenshot paths are relative to visual-tests/_results/ and already
  // include the screenshots/ prefix.
  writeJson(join(resultsDir, 'fix-manifest.json'), {
    action: 'validate-and-fix',
    timestamp: '2026-07-02T10:00:00.000Z',
    tests: [
      {
        test: 'auth/login',
        name: 'Login page',
        url: 'http://127.0.0.1:8001/login.html',
        screenshot: 'screenshots/login-load.png',
        steps: [{ action: 'open', url: '{base_url}/login.html', screenshot: 'login-load.png' }],
        annotations: [
          {
            x1: 0.2,
            y1: 0.3,
            x2: 0.8,
            y2: 0.6,
            note: 'Sign-in button overlaps the password input.',
            severity: 'critical',
          },
        ],
        redo_entirely: false,
        revert_to_before: false,
        improve_ui: false,
      },
      {
        test: 'dashboard/home',
        name: 'Dashboard home',
        url: 'http://127.0.0.1:8001/dashboard.html',
        screenshot: 'screenshots/dashboard-load.png',
        steps: [{ action: 'open', url: '{base_url}/dashboard.html', screenshot: 'dashboard-load.png' }],
        annotations: [
          {
            x1: 0.05,
            y1: 0.1,
            x2: 0.95,
            y2: 0.9,
            // severity intentionally omitted: the consumer must default to "critical".
            note: 'Redo this whole panel from scratch: the stat cards are unusable.',
          },
        ],
        redo_entirely: true,
        revert_to_before: false,
        improve_ui: false,
      },
      {
        test: 'settings/profile',
        name: 'Settings profile',
        url: 'http://127.0.0.1:8001/settings.html',
        screenshot: 'screenshots/settings-load.png',
        steps: [{ action: 'open', url: '{base_url}/settings.html', screenshot: 'settings-load.png' }],
        annotations: [],
        redo_entirely: false,
        revert_to_before: false,
        improve_ui: true,
      },
    ],
  });
  return root;
}

// Field-presence assertions on the fixture itself, so contract drift fails
// the test.
function assertManifestContract(manifest) {
  assert(manifest.action === 'validate-and-fix', 'manifest action must be "validate-and-fix"');
  assert(
    typeof manifest.timestamp === 'string' && !Number.isNaN(Date.parse(manifest.timestamp)),
    'manifest timestamp must be an ISO date string',
  );
  assert(Array.isArray(manifest.tests) && manifest.tests.length === 3, 'manifest must contain the 3 fixture tests');

  for (const test of manifest.tests) {
    assert(typeof test.test === 'string' && test.test.length > 0, 'each test needs a "test" id');
    assert(typeof test.url === 'string' && !test.url.includes('{base_url}'), `test ${test.test}: test-level url must be resolved`);
    assert(
      typeof test.screenshot === 'string' && test.screenshot.startsWith('screenshots/'),
      `test ${test.test}: screenshot must already include the screenshots/ prefix`,
    );
    for (const flag of ['redo_entirely', 'revert_to_before', 'improve_ui']) {
      assert(typeof test[flag] === 'boolean', `test ${test.test}: missing boolean flag ${flag}`);
    }
  }

  const annotated = manifest.tests.find((t) => t.test === 'auth/login');
  assert(annotated && Array.isArray(annotated.annotations) && annotated.annotations.length === 1, 'annotated fixture test missing');
  const [annotation] = annotated.annotations;
  for (const field of ['x1', 'y1', 'x2', 'y2']) {
    assert(
      typeof annotation[field] === 'number' && annotation[field] >= 0 && annotation[field] <= 1,
      `annotation ${field} must be a normalized 0-1 number`,
    );
  }
  assert(typeof annotation.note === 'string' && annotation.note.length > 0, 'annotation missing note');
  assert(annotation.severity === 'critical', 'annotation severity must be "critical"');

  const redo = manifest.tests.find((t) => t.redo_entirely === true);
  assert(redo, 'fixture must include a redo_entirely test');
  const improve = manifest.tests.find((t) => t.improve_ui === true);
  assert(improve && (improve.annotations || []).length === 0, 'fixture must include an improve_ui test with no annotations');
}

// Per-test mode from the optional flags (mirrors SKILL.md Step 1).
function modeForTest(test) {
  if (test.revert_to_before) return 'revert';
  if (test.redo_entirely) return 'redo';
  if (test.improve_ui) return 'improve';
  return 'validate-and-fix';
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
    // Screenshot paths are relative to visual-tests/_results/ and already
    // include the screenshots/ prefix — resolve directly, never prepend.
    const screenshot = join(resultsDir, test.screenshot || '');
    assert(existsSync(screenshot), `missing screenshot: ${screenshot}`);
    const shotStat = statSync(screenshot);

    // Candidate files via the SKILL.md Step 2b method (static HTML route
    // lookup from the resolved test-level url).
    const routeFile = test.url ? new URL(test.url).pathname.split('/').pop() : '';
    const candidateFiles = routeFile
      ? [join(root, 'src', 'pages', routeFile)].filter(existsSync)
      : [];

    sections.push(`## Test: ${test.test || '(unknown)'}`);
    sections.push(`- Name: ${test.name || '(none)'}`);
    sections.push(`- URL: ${test.url || '(none)'}`);
    sections.push(`- Screenshot: ${screenshot}`);
    sections.push(`- Screenshot bytes: ${shotStat.size}`);
    sections.push(`- Mode: ${modeForTest(test)}`);
    sections.push('- Annotations:');
    const annotations = test.annotations || [];
    if (annotations.length === 0) sections.push('  - (none)');
    for (const [index, annotation] of annotations.entries()) {
      sections.push(`  - Region ${index + 1}: x1=${annotation.x1} y1=${annotation.y1} x2=${annotation.x2} y2=${annotation.y2}`);
      sections.push(`    Severity: ${annotation.severity || 'critical'}`);
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

function extractTestSection(plan, testId) {
  const header = `## Test: ${testId}`;
  const start = plan.indexOf(header);
  assert(start !== -1, `plan missing entry for test: ${testId}`);
  const rest = plan.slice(start + header.length);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

function assertPlanMode(plan, testId, mode) {
  const section = extractTestSection(plan, testId);
  assert(section.includes(`- Mode: ${mode}`), `plan entry for ${testId} missing mode label "${mode}"`);
}

function main() {
  const options = parseArgs();
  let root = null;
  let passed = false;
  try {
    root = createFixture();

    const manifest = JSON.parse(readFileSync(join(root, 'visual-tests', '_results', 'fix-manifest.json'), 'utf8'));
    assertManifestContract(manifest);

    // Sentinels INSIDE the fixture project that the plan-builder could
    // plausibly touch (they are its candidate files).
    const sentinels = SOURCE_PAGES.map((page) => join(root, 'src', 'pages', page));
    const before = sentinels.map(sha256);

    const planPath = buildPlan(root);

    const after = sentinels.map(sha256);
    sentinels.forEach((file, index) => {
      assert(before[index] === after[index], `dry-run modified fixture source file: ${file}`);
    });

    const plan = readFileSync(planPath, 'utf8');
    assert(plan.includes('Mode: dry-run'), 'plan missing dry-run mode');
    assertPlanMode(plan, 'auth/login', 'validate-and-fix');
    assertPlanMode(plan, 'dashboard/home', 'redo');
    assertPlanMode(plan, 'settings/profile', 'improve');
    assert(plan.includes('Sign-in button overlaps the password input.'), 'plan missing annotation note');
    assert(extractTestSection(plan, 'auth/login').includes('Severity: critical'), 'plan missing explicit severity');
    assert(
      extractTestSection(plan, 'dashboard/home').includes('Severity: critical'),
      'severity default "critical" not applied to annotation without severity',
    );
    assert(plan.includes('Candidate files'), 'plan missing candidate files');
    for (const page of SOURCE_PAGES) {
      assert(plan.includes(join('src', 'pages', page)), `plan missing candidate file for ${page}`);
    }

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
