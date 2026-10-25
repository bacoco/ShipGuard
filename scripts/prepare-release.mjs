#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const releaseFiles = [
  'plugins/shipguard/.claude-plugin/plugin.json',
  'plugins/shipguard/.codex-plugin/plugin.json',
  'README.md',
  'docs/product-roadmap.md',
  'CHANGELOG.md',
];

function fail(message) {
  console.error(`prepare-release: ${message}`);
  process.exit(1);
}

function usage() {
  console.error('Usage: node scripts/prepare-release.mjs <version> (--dry-run | --apply)');
}

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    fail(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function replaceOnce(contents, pattern, replacement, label) {
  const matches = contents.match(new RegExp(pattern.source, `${pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`}`));
  if (matches?.length !== 1) fail(`${label}: expected exactly one version target, found ${matches?.length ?? 0}`);
  return contents.replace(pattern, replacement);
}

function parseStableVersion(value, label) {
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match) fail(`${label} must be a stable semantic version such as 2.18.1`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function changelogAnchor(version, date) {
  return `${version.replaceAll('.', '')}--${date}`;
}

function renderDiff(relativePath, before, after, temporaryRoot) {
  const temporaryPath = join(temporaryRoot, relativePath);
  writeFileSync(temporaryPath, after);
  const result = spawnSync('git', [
    'diff', '--no-index', '--no-ext-diff', '--no-prefix', '--',
    resolve(repositoryRoot, relativePath), temporaryPath,
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.status !== 1) fail(`could not render diff for ${relativePath}: ${result.stderr.trim()}`);
  return result.stdout
    .replace(/^diff --git .*$/m, `diff --git a/${relativePath} b/${relativePath}`)
    .replace(/^--- .*$/m, `--- a/${relativePath}`)
    .replace(/^\+\+\+ .*$/m, `+++ b/${relativePath}`);
}

const args = process.argv.slice(2);
const version = args.find((argument) => !argument.startsWith('--'));
const modes = args.filter((argument) => argument === '--dry-run' || argument === '--apply');
const unknown = args.filter((argument) => argument.startsWith('--') && !modes.includes(argument));

if (!version || args.filter((argument) => !argument.startsWith('--')).length !== 1 || modes.length !== 1 || unknown.length > 0) {
  usage();
  process.exit(1);
}

const mode = modes[0];
const nextVersionParts = parseStableVersion(version, 'version');
const before = new Map(releaseFiles.map((relativePath) => [relativePath, read(relativePath)]));
const claudeManifestPath = releaseFiles[0];
const codexManifestPath = releaseFiles[1];
const currentVersion = JSON.parse(before.get(claudeManifestPath)).version;
const currentVersionParts = parseStableVersion(currentVersion, 'current manifest version');
const codexVersion = JSON.parse(before.get(codexManifestPath)).version;
const readmeVersion = before.get('README.md').match(/^## Version ([^\s]+)$/m)?.[1];
const roadmapVersion = before.get('docs/product-roadmap.md').match(/currently \*\*([^*]+)\*\*/)?.[1];

for (const [label, foundVersion] of [
  [codexManifestPath, codexVersion],
  ['README.md', readmeVersion],
  ['docs/product-roadmap.md', roadmapVersion],
]) {
  if (foundVersion !== currentVersion) fail(`${label}: version ${foundVersion ?? 'not found'} does not match ${currentVersion}`);
}
if (nextVersionParts[0] !== currentVersionParts[0]) {
  fail(`version ${version} is outside the current ${currentVersionParts[0]}.x release series`);
}
if (compareVersions(nextVersionParts, currentVersionParts) <= 0) {
  fail(`version ${version} must be newer than ${currentVersion}`);
}
if (new RegExp(`^## ${version.replaceAll('.', '\\.')} — `, 'm').test(before.get('CHANGELOG.md'))) {
  fail(`CHANGELOG.md already contains version ${version}`);
}

const previousTag = git([
  'describe', '--tags', '--abbrev=0', '--match', `v${currentVersionParts[0]}.*`, '--exclude', '*-*', 'HEAD',
]);
if (!new RegExp(`^v${currentVersionParts[0]}\\.\\d+\\.\\d+$`).test(previousTag)) {
  fail(`latest reachable ${currentVersionParts[0]}.x tag is not a stable release tag: ${previousTag}`);
}
const head = git(['rev-parse', 'HEAD']);
const commitLines = git(['log', '--no-merges', '--format=%h%x09%s', `${previousTag}..HEAD`])
  .split('\n')
  .filter(Boolean);
if (commitLines.length === 0) fail(`no non-merge commits found in ${previousTag}..HEAD`);

const date = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const previousVersion = previousTag.slice(1);
const changelogEntry = [
  `## ${version} — ${date}`,
  '',
  `Changes since [${previousVersion}](https://github.com/bacoco/ShipGuard/releases/tag/${previousTag}),`,
  `covering \`${previousTag}..${head}\`.`,
  '',
  '### Changes',
  '',
  ...commitLines.map((line) => {
    const [shortSha, ...subjectParts] = line.split('\t');
    return `- ${subjectParts.join('\t')} (\`${shortSha}\`)`;
  }),
  '',
].join('\n');

const after = new Map();
after.set(claudeManifestPath, replaceOnce(
  before.get(claudeManifestPath),
  /("version"\s*:\s*")[^"]+("\s*,)/,
  `$1${version}$2`,
  claudeManifestPath,
));
after.set(codexManifestPath, replaceOnce(
  before.get(codexManifestPath),
  /("version"\s*:\s*")[^"]+("\s*,)/,
  `$1${version}$2`,
  codexManifestPath,
));

const readmeSection = [
  `## Version ${version}`,
  '',
  `Prepared from ${commitLines.length} non-merge commit${commitLines.length === 1 ? '' : 's'} since ${previousVersion},`,
  `through \`${head.slice(0, 12)}\`. See the [changelog](CHANGELOG.md#${changelogAnchor(version, date)})`,
  'for the complete commit range.',
  '',
  '',
].join('\n');
after.set('README.md', replaceOnce(
  before.get('README.md'),
  /^## Version [^\n]+\n[\s\S]*?(?=^## )/m,
  readmeSection,
  'README.md version section',
));
after.set('docs/product-roadmap.md', replaceOnce(
  before.get('docs/product-roadmap.md'),
  /(currently \*\*)[^*]+(\*\*)/,
  `$1${version}$2`,
  'docs/product-roadmap.md version note',
));
after.set('CHANGELOG.md', replaceOnce(
  before.get('CHANGELOG.md'),
  /^(# Changelog\n\n)/,
  (_match, heading) => `${heading}${changelogEntry}\n`,
  'CHANGELOG.md heading',
));

for (const relativePath of releaseFiles) {
  if (after.get(relativePath) === before.get(relativePath)) fail(`${relativePath}: planned content is unchanged`);
}

if (mode === '--dry-run') {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'shipguard-release-diff-'));
  try {
    for (const relativePath of releaseFiles) {
      const targetDirectory = resolve(temporaryRoot, dirname(relativePath));
      mkdirSync(targetDirectory, { recursive: true });
      process.stdout.write(renderDiff(relativePath, before.get(relativePath), after.get(relativePath), temporaryRoot));
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  console.log(`Dry run: ${releaseFiles.length} files would be prepared for ${version} from ${previousTag}.`);
  console.log('No repository files were changed. Re-run with --apply to apply this exact preparation.');
} else {
  const dirtyReleaseFiles = git(['status', '--porcelain', '--', ...releaseFiles]);
  if (dirtyReleaseFiles) {
    fail(`refusing to overwrite local changes in release files:\n${dirtyReleaseFiles}`);
  }
  for (const relativePath of releaseFiles) writeFileSync(resolve(repositoryRoot, relativePath), after.get(relativePath));
  console.log(`Prepared ${releaseFiles.length} files for ${version} from ${previousTag}.`);
  for (const relativePath of releaseFiles) console.log(`- ${relativePath}`);
}
