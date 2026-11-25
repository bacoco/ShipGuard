#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const pluginRoot = resolve(repositoryRoot, 'plugins/shipguard');
const skillsRoot = resolve(pluginRoot, 'skills');
const claudeManifestPath = 'plugins/shipguard/.claude-plugin/plugin.json';
const codexManifestPath = 'plugins/shipguard/.codex-plugin/plugin.json';
const errors = [];

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function captureVersion(relativePath, pattern, label) {
  const match = read(relativePath).match(pattern);
  if (!match) {
    errors.push(`${label}: version not found`);
    return null;
  }
  return match[1];
}

const claudeManifest = readJson(claudeManifestPath);
const codexManifest = readJson(codexManifestPath);

const plainDirectory = (path) => existsSync(path) && lstatSync(path).isDirectory();
if (!plainDirectory(pluginRoot) || !plainDirectory(skillsRoot)) {
  errors.push('plugins/shipguard/skills: expected a directory in the shared plugin tree');
}

const claudeSkills = claudeManifest.skills === undefined
  ? ['./skills/']
  : [].concat(claudeManifest.skills);
if (claudeSkills.length !== 1 || !['./skills', './skills/'].includes(claudeSkills[0])) {
  errors.push(`${claudeManifestPath}: skills must resolve to the shared plugin skills directory`);
}
if (!['./skills', './skills/'].includes(codexManifest.skills)) {
  errors.push(`${codexManifestPath}: skills must resolve to the shared plugin skills directory`);
}

const claudeMarketplacePath = '.claude-plugin/marketplace.json';
const codexMarketplacePath = '.agents/plugins/marketplace.json';
const claudeMarketplace = readJson(claudeMarketplacePath);
const codexMarketplace = readJson(codexMarketplacePath);
const shipguardEntries = (marketplace) => Array.isArray(marketplace.plugins)
  ? marketplace.plugins.filter((entry) => entry?.name === 'shipguard')
  : [];
const claudeEntries = shipguardEntries(claudeMarketplace);
const codexEntries = shipguardEntries(codexMarketplace);
const [claudeEntry] = claudeEntries;
const [codexEntry] = codexEntries;
const sharedPluginPaths = ['./plugins/shipguard', './plugins/shipguard/'];
if (claudeEntries.length !== 1 || !sharedPluginPaths.includes(claudeEntry?.source)
  || claudeMarketplace.metadata?.pluginRoot !== undefined
  || claudeEntry.skills !== undefined || claudeEntry.strict === false) {
  errors.push(`${claudeMarketplacePath}: use one local ShipGuard entry without skill or path overrides`);
}
if (codexEntries.length !== 1 || codexEntry?.source?.source !== 'local'
  || !sharedPluginPaths.includes(codexEntry.source.path)) {
  errors.push(`${codexMarketplacePath}: use one local ShipGuard entry pointing to the shared plugin directory`);
}

const versions = new Map([
  [claudeManifestPath, claudeManifest.version],
  [codexManifestPath, codexManifest.version],
  ['README.md', captureVersion('README.md', /^## Version ([^\s]+)$/m, 'README.md')],
  ['docs/product-roadmap.md', captureVersion('docs/product-roadmap.md', /currently \*\*([^*]+)\*\*/, 'docs/product-roadmap.md')],
]);
const expectedVersion = claudeManifest.version;

for (const [source, version] of versions) {
  if (version !== null && version !== expectedVersion) {
    errors.push(`${source}: version ${version} does not match ${expectedVersion}`);
  }
}

const skillDirectories = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => resolve(skillsRoot, entry.name))
  .sort((left, right) => left.localeCompare(right));
let deprecatedAliasCount = 0;

for (const skillDirectory of skillDirectories) {
  const directoryName = basename(skillDirectory);
  const skillPath = resolve(skillDirectory, 'SKILL.md');

  if (!existsSync(skillPath)) {
    errors.push(`${directoryName}: missing SKILL.md`);
    continue;
  }

  const contents = readFileSync(skillPath, 'utf8');
  const frontmatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const name = frontmatter?.[1].match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];

  if (!frontmatter) {
    errors.push(`${directoryName}/SKILL.md: missing YAML frontmatter`);
  } else if (!name) {
    errors.push(`${directoryName}/SKILL.md: missing frontmatter name`);
  } else if (name !== directoryName) {
    errors.push(`${directoryName}/SKILL.md: name ${name} does not match directory`);
  }

  if (/^description:\s*["']?Deprecated alias\b/im.test(frontmatter?.[1] ?? '')) {
    deprecatedAliasCount += 1;
  }

  if (directoryName !== 'grill-goal' && !existsSync(resolve(skillDirectory, 'agents/openai.yaml'))) {
    errors.push(`${directoryName}: missing agents/openai.yaml`);
  }
}

const canonicalSkillCount = skillDirectories.length - deprecatedAliasCount;
for (const relativePath of ['AGENTS.md', 'docs/architecture.md']) {
  const contents = read(relativePath);
  const match = contents.match(
    /(\d+) canonical skills? (?:\+ (\d+)|plus (one|\d+)) deprecated alias(?:es)?/,
  );

  if (!match) {
    errors.push(`${relativePath}: skill count not found`);
    continue;
  }

  const documentedCanonicalCount = Number(match[1]);
  const documentedAliasCount = match[2] ? Number(match[2]) : (match[3] === 'one' ? 1 : Number(match[3]));
  if (documentedCanonicalCount !== canonicalSkillCount || documentedAliasCount !== deprecatedAliasCount) {
    errors.push(
      `${relativePath}: documents ${documentedCanonicalCount} canonical + ${documentedAliasCount} deprecated, `
      + `found ${canonicalSkillCount} canonical + ${deprecatedAliasCount} deprecated`,
    );
  }
}

if (errors.length > 0) {
  console.error(`Consistency check failed (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Consistency check passed: version ${expectedVersion}; `
    + `${canonicalSkillCount} canonical skills + ${deprecatedAliasCount} deprecated alias.`,
  );
}
