#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const skillsRoot = resolve(repositoryRoot, 'plugins/shipguard/skills');
const errors = [];

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function captureVersion(relativePath, pattern, label) {
  const match = read(relativePath).match(pattern);
  if (!match) {
    errors.push(`${label}: version not found`);
    return null;
  }
  return match[1];
}

const versions = new Map([
  ['plugins/shipguard/.claude-plugin/plugin.json', JSON.parse(read('plugins/shipguard/.claude-plugin/plugin.json')).version],
  ['plugins/shipguard/.codex-plugin/plugin.json', JSON.parse(read('plugins/shipguard/.codex-plugin/plugin.json')).version],
  ['README.md', captureVersion('README.md', /^## Version ([^\s]+)$/m, 'README.md')],
  ['docs/product-roadmap.md', captureVersion('docs/product-roadmap.md', /currently \*\*([^*]+)\*\*/, 'docs/product-roadmap.md')],
]);
const expectedVersion = versions.get('plugins/shipguard/.claude-plugin/plugin.json');

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
for (const relativePath of ['CLAUDE.md', 'docs/architecture.md']) {
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
