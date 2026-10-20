#!/usr/bin/env node
// Project-copy upgrade regressions. Every write stays in temporary fixtures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'sg-copies-'));
const source = join(temp, "plugin's files");
const cli = join(source, 'cli', 'shipguard.mjs');
const groups = {
  'sg-visual-review': ['build-review.mjs', '_review-template.html', 'review-smoke-test.mjs', 'monitor-smoke-test.mjs'],
  'sg-record': ['sg-record.mjs', 'lib/actions-to-yaml.mjs', 'lib/recorder-toolbar.js', 'lib/recorder-toolbar.css', 'lib/actions-to-yaml.test.mjs', 'lib/integration-test.mjs'],
};
const put = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const read = path => readFileSync(path, 'utf8');
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
const fixture = name => {
  const root = join(temp, name);
  put(join(root, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:4711"\n');
  return root;
};

try {
  put(cli, readFileSync(join(plugin, 'cli', 'shipguard.mjs')));
  for (const [skill, files] of Object.entries(groups)) {
    for (const file of files) put(join(source, 'skills', skill, file), readFileSync(join(plugin, 'skills', skill, file)));
  }
  put(join(source, '.claude-plugin', 'plugin.json'), '{"version":"2.16.1"}\n');

  const root = fixture('pinned project');
  const vt = join(root, 'visual-tests');
  const pinned = '// Deliberate project customization.\nprocess.exit(0);\n';
  put(join(vt, 'build-review.mjs'), pinned);
  put(join(vt, '_review-template.html'), 'custom template');
  const review = run(root, 'review');
  assert.equal(review.status, 0, review.stderr);
  assert.match(review.stderr, /copy differs.*build-review\.mjs/i, 'an existing old/custom copy must warn before review');
  assert.match(review.stderr, /init --refresh-copies/, 'warning must give a usable refresh command');
  assert.equal(read(join(vt, 'build-review.mjs')), pinned, 'review must preserve a pinned copy');
  console.log('PASS pinned copy warns without replacement or changed exit code');

  // Checking alone does not scaffold config, gitignore, outputs, or backups.
  const empty = join(temp, 'empty');
  mkdirSync(empty);
  assert.equal(run(empty, 'init', '--check-copies').status, 0);
  assert.deepEqual(readdirSync(empty), []);
  put(join(vt, 'manifests', 'recorded-user.yaml'), 'user scenario');
  const logic = JSON.stringify({ schema_version: '1.0', candidates: [{
    id: 'upgrade', name: 'upgrade sentinel', findings: [{ id: 'logic-1', kind: 'invariant-violation', severity: 'high', evidence: 'reasoned' }],
  }] });
  put(join(vt, '_results', 'logic-results.json'), logic);
  const remedy = review.stderr.match(/To refresh with backup: (.+)/)?.[1];
  assert.ok(remedy, review.stderr);
  const refreshed = spawnSync('/bin/sh', ['-c', remedy], { cwd: root, encoding: 'utf8' });
  assert.equal(refreshed.status, 0, refreshed.stderr);
  const backup = refreshed.stdout.match(/^copies backup: (.+)$/m)?.[1];
  assert.ok(backup, refreshed.stdout);
  assert.equal(read(join(backup, 'build-review.mjs')), pinned);
  assert.equal(read(join(backup, '_review-template.html')), 'custom template');
  assert.equal(read(join(vt, 'build-review.mjs')), read(join(source, 'skills', 'sg-visual-review', 'build-review.mjs')));
  assert.equal(read(join(vt, '_review-template.html')), read(join(source, 'skills', 'sg-visual-review', '_review-template.html')));
  assert.ok(!existsSync(join(vt, 'sg-record.mjs')), 'refresh must not install an unused recorder');
  assert.ok(!existsSync(join(root, '.gitignore')), 'copy-only refresh must not alter gitignore');
  assert.equal(read(join(vt, 'manifests', 'recorded-user.yaml')), 'user scenario');
  assert.equal(read(join(vt, '_results', 'logic-results.json')), logic);
  assert.equal(run(root, 'review').status, 0);
  const findings = JSON.parse(read(join(vt, '_results', 'findings.json')));
  assert.ok(findings.findings.some(f => f.source === 'logic' && f.title.includes('upgrade sentinel')), 'refreshed review must include the logic finding');
  const repeated = run(root, 'init', '--refresh-copies');
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.doesNotMatch(repeated.stdout, /copies backup:/, 'an unchanged refresh creates no new backup');
  assert.equal(run(root, 'init', '--check-copies').stderr, '', 'current copies must not warn');
  assert.equal(read(join(backup, 'build-review.mjs')), pinned, 'later calls preserve the original backup');
  console.log('PASS explicit refresh backs up exact copies and preserves project data');

  put(join(vt, '_review-template.html'), 'only the template changed');
  assert.match(run(root, 'init', '--check-copies').stderr, /copy differs.*_review-template\.html/);
  assert.equal(read(join(vt, '_review-template.html')), 'only the template changed');
  // A readable entry point cannot hide missing or changed recorder companions.
  for (const file of groups['sg-record']) put(join(vt, file), readFileSync(join(source, 'skills', 'sg-record', file)));
  put(join(vt, 'lib', 'recorder-toolbar.js'), 'custom toolbar');
  rmSync(join(vt, 'lib', 'recorder-toolbar.css'));
  const recordCheck = run(root, 'init', '--check-copies');
  assert.match(recordCheck.stderr, /copy differs.*lib\/recorder-toolbar\.js/);
  assert.match(recordCheck.stderr, /copy missing.*lib\/recorder-toolbar\.css/);
  assert.equal(run(root, 'init', '--refresh-copies').status, 0);
  assert.equal(run(root, 'init', '--check-copies').stderr, '');
  console.log('PASS template and recorder companions are checked together');

  const standalone = join(temp, 'standalone.mjs');
  copyFileSync(cli, standalone);
  const bareRun = (...args) => spawnSync(process.execPath, [standalone, ...args], { cwd: root, encoding: 'utf8' });
  const unavailable = bareRun('init', '--check-copies');
  assert.equal(unavailable.status, 0);
  assert.match(unavailable.stderr, /cannot compare project copies/);
  assert.match(unavailable.stderr, /--plugin-root=/);
  assert.equal(bareRun('init', '--refresh-copies').status, 2, 'unknown source cannot refresh');
  assert.equal(bareRun('init', '--check-copies', `--plugin-root=${source}`).stderr, '');
  assert.equal(bareRun('init', '--refresh-copies', '--plugin-root').status, 3, 'valueless source is a configuration error');
  // A selected source need not contain a new CLI: the remedy must invoke the
  // current checker, carrying that explicit source through to the refresh.
  put(join(vt, '_review-template.html'), 'standalone customization');
  const standaloneCheck = bareRun('init', '--check-copies', `--plugin-root=${source}`);
  const standaloneRemedy = standaloneCheck.stderr.match(/To refresh with backup: (.+)/)?.[1];
  assert.ok(standaloneRemedy?.includes(standalone), standaloneCheck.stderr);
  assert.equal(spawnSync('/bin/sh', ['-c', standaloneRemedy], { cwd: root, encoding: 'utf8' }).status, 0);
  console.log('PASS standalone CLI distinguishes an unknown source from current copies');

  const partial = fixture('template without builder');
  put(join(partial, 'visual-tests', '_review-template.html'), 'pinned partial template');
  assert.equal(run(partial, 'review').status, 0);
  assert.equal(read(join(partial, 'visual-tests', '_review-template.html')), 'pinned partial template', 'bootstrap cannot overwrite an existing companion');

  const unsafe = fixture('symlink');
  const outside = join(temp, 'outside-template.html');
  put(outside, 'keep outside');
  put(join(unsafe, 'visual-tests', 'build-review.mjs'), pinned);
  symlinkSync(outside, join(unsafe, 'visual-tests', '_review-template.html'));
  assert.equal(run(unsafe, 'init', '--refresh-copies').status, 2);
  assert.equal(read(outside), 'keep outside');
  assert.equal(read(join(unsafe, 'visual-tests', 'build-review.mjs')), pinned, 'unsafe destinations fail before any replacement');
  console.log('PASS unsafe destination cannot partially refresh or alter an external file');

  // Inject one filesystem rename failure after the first file was replaced.
  const rollbackRoot = fixture('rollback');
  const rollbackVt = join(rollbackRoot, 'visual-tests');
  put(join(rollbackVt, 'build-review.mjs'), pinned);
  put(join(rollbackVt, '_review-template.html'), 'old rollback template');
  const preload = join(temp, 'fail-rename.mjs');
  put(preload, `import fs from 'node:fs';\nimport { syncBuiltinESMExports } from 'node:module';\n`
    + `const original = fs.renameSync; let failed = false;\n`
    + `fs.renameSync = (from, to) => { if (!failed && to === ${JSON.stringify(realpathSync(join(rollbackVt, '_review-template.html')))}) { failed = true; throw new Error('injected rename failure'); } return original(from, to); };\nsyncBuiltinESMExports();\n`);
  const rollback = spawnSync(process.execPath, ['--import', preload, cli, 'init', '--refresh-copies'], { cwd: rollbackRoot, encoding: 'utf8' });
  assert.equal(rollback.status, 2, rollback.stderr);
  assert.match(rollback.stderr, /previous copies restored/);
  assert.equal(read(join(rollbackVt, 'build-review.mjs')), pinned);
  assert.equal(read(join(rollbackVt, '_review-template.html')), 'old rollback template');
  const rollbackBackup = rollback.stdout.match(/^copies backup: (.+)$/m)?.[1];
  assert.equal(read(join(rollbackBackup, 'build-review.mjs')), pinned);
  console.log('PASS a mid-refresh filesystem failure restores the old set and keeps backups');
  console.log('copies-smoke-test: ALL PASS');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
