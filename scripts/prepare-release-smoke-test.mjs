#!/usr/bin/env node

import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'shipguard-release-smoke-'));
const releaseFiles = [
  'plugins/shipguard/.claude-plugin/plugin.json',
  'plugins/shipguard/.codex-plugin/plugin.json',
  'README.md',
  'docs/product-roadmap.md',
  'CHANGELOG.md',
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: temporaryRoot,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function read(path) {
  return readFileSync(join(temporaryRoot, path), 'utf8');
}

try {
  for (const path of [...releaseFiles, 'scripts/prepare-release.mjs']) {
    mkdirSync(dirname(join(temporaryRoot, path)), { recursive: true });
    copyFileSync(join(repositoryRoot, path), join(temporaryRoot, path));
  }
  run('git', ['init', '--quiet']);
  run('git', ['config', 'user.name', 'Release smoke test']);
  run('git', ['config', 'user.email', 'release-smoke@example.invalid']);
  run('git', ['add', '.']);
  run('git', ['commit', '--quiet', '-m', 'Release fixture']);
  const currentVersion = JSON.parse(read(releaseFiles[0])).version;
  const parts = currentVersion.split('.').map(Number);
  parts[2] += 1;
  const nextVersion = parts.join('.');
  const previousTag = `v${currentVersion}`;
  const olderTag = `v${parts[0]}.0.0`;
  assert.notEqual(olderTag, previousTag, 'fixture needs an older stable tag in the same major series');
  run('git', ['tag', olderTag]);
  run('git', ['commit', '--quiet', '--allow-empty', '-m', 'Changes after older release fixture']);
  const beforeMissingTag = new Map(releaseFiles.map((path) => [path, read(path)]));
  for (const mode of ['--dry-run', '--apply']) {
    const result = spawnSync(process.execPath, ['scripts/prepare-release.mjs', nextVersion, mode], {
      cwd: temporaryRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1, `${mode} must refuse when the current version tag is missing`);
    assert.ok(result.stderr.includes(`does not match current manifest version ${currentVersion}`), result.stderr);
    assert.equal(result.stdout, '', `${mode} must refuse before rendering a release plan`);
    for (const path of releaseFiles) assert.equal(read(path), beforeMissingTag.get(path), `${mode} changed ${path}`);
    assert.equal(run('git', ['status', '--porcelain']), '', `${mode} refusal must leave Git clean`);
  }
  run('git', ['tag', previousTag]);
  const subjects = ['Preserve $1 literally', 'Preserve $& literally', 'Preserve $$ literally'];
  const bullets = [];
  for (const subject of subjects) {
    run('git', ['commit', '--quiet', '--allow-empty', '-m', subject]);
    const shortSha = run('git', ['rev-parse', '--short', 'HEAD']).trim();
    bullets.unshift(`- ${subject} (\`${shortSha}\`)`);
  }
  const head = run('git', ['rev-parse', 'HEAD']).trim();
  const before = new Map(releaseFiles.map((path) => [path, read(path)]));
  const dryRun = run(process.execPath, ['scripts/prepare-release.mjs', nextVersion, '--dry-run']);
  for (const bullet of bullets) assert.ok(dryRun.includes(`+${bullet}\n`), `dry-run must preserve ${bullet}`);
  for (const path of releaseFiles) assert.equal(read(path), before.get(path), `dry-run changed ${path}`);
  assert.equal(run('git', ['status', '--porcelain']), '', 'dry-run must leave Git clean');

  run(process.execPath, ['scripts/prepare-release.mjs', nextVersion, '--apply']);
  const changelog = read('CHANGELOG.md');
  const date = changelog.match(/^## [\d.]+ — (\d{4}-\d{2}-\d{2})$/m)?.[1];
  assert.ok(date, 'release heading must retain its date format');
  const expectedEntry = [
    `## ${nextVersion} — ${date}`, '',
    `Changes since [${currentVersion}](https://github.com/bacoco/ShipGuard/releases/tag/${previousTag}),`,
    `covering \`${previousTag}..${head}\`.`, '', '### Changes', '', ...bullets, '', '',
  ].join('\n');
  assert.equal(changelog, before.get('CHANGELOG.md').replace('# Changelog\n\n', () => `# Changelog\n\n${expectedEntry}`));
  assert.deepEqual(
    run('git', ['diff', '--name-only']).trim().split('\n').sort(),
    [...releaseFiles].sort(),
    'apply must prepare exactly the same five files',
  );
  console.log('PASS: missing current tag refuses both modes without mutation; nominal $1, $& and $$ titles preserved; exactly five files prepared in a temporary Git copy.');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
