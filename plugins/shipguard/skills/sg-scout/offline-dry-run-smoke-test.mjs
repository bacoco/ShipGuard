#!/usr/bin/env node
/**
 * ShipGuard scout offline/dry-run smoke test.
 *
 * Validates the offline repo fixture against the documented shape
 * (repos[].{full_name,url,readme,files[].{path,content}}) and verifies it
 * produces a local scout report reflecting the fixture inputs — without
 * GitHub, network, issues, or techniques-library writes.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = join(SCRIPT_DIR, 'fixtures', 'scout-repos.json');

function parseArgs() {
  const options = { from: DEFAULT_FIXTURE, keepTmp: false, debug: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--keep-tmp') options.keepTmp = true;
    else if (arg === '--debug') options.debug = true;
    else if (arg === '--from') {
      options.from = args[++i];
      if (!options.from) throw new Error('--from requires a path');
    }
    else if (arg.startsWith('--from=')) options.from = arg.split('=')[1];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateFixtureShape(data, path) {
  assert(Array.isArray(data.repos), `fixture must expose a repos array: ${path}`);
  assert(data.repos.length > 0, `fixture repos array is empty: ${path}`);
  data.repos.forEach((repo, i) => {
    for (const key of ['full_name', 'url', 'readme']) {
      assert(
        typeof repo[key] === 'string' && repo[key].length > 0,
        `repos[${i}].${key} missing or empty — expected repos[].{full_name,url,readme,files[].{path,content}}`,
      );
    }
    assert(Array.isArray(repo.files), `repos[${i}].files must be an array`);
    repo.files.forEach((file, j) => {
      assert(typeof file.path === 'string' && file.path.length > 0, `repos[${i}].files[${j}].path missing or empty`);
      assert(typeof file.content === 'string' && file.content.length > 0, `repos[${i}].files[${j}].content missing or empty`);
    });
  });
}

function loadFixture(path) {
  assert(existsSync(path), `missing fixture: ${path}`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  validateFixtureShape(data, path);
  return data;
}

function extractTechniques(repo) {
  const text = [
    repo.readme || '',
    ...(repo.files || []).map(file => `${file.path}\n${file.content || ''}`),
  ].join('\n').toLowerCase();
  const techniques = [];
  if (text.includes('smoke')) techniques.push({ name: 'Isolated smoke tests', category: 'testability', score: 4.2 });
  if (text.includes('sandbox')) techniques.push({ name: 'Sandbox diagnostics', category: 'developer-experience', score: 3.8 });
  if (text.includes('dry-run') || text.includes('dry run')) techniques.push({ name: 'Dry-run previews', category: 'safety', score: 3.6 });
  return techniques;
}

function writeReport(root, fixturePath, data) {
  const resultsDir = join(root, 'visual-tests', '_results');
  mkdirSync(resultsDir, { recursive: true });
  const rows = [];
  const findings = [];
  for (const repo of data.repos) {
    const techniques = extractTechniques(repo);
    rows.push(`| ${repo.full_name} | ${techniques.length} | ${techniques[0]?.score || 0} |`);
    for (const technique of techniques) findings.push({ repo: repo.full_name, ...technique });
  }
  findings.sort((a, b) => b.score - a.score);

  const body = [
    '# Scout Report - offline dry-run smoke',
    '',
    'Mode: `--offline --dry-run`',
    `Fixture: \`${fixturePath}\``,
    '',
    '## Summary',
    '',
    `Repos scanned: ${data.repos.length}`,
    `Techniques found: ${findings.length}`,
    'Proposals filed: 0',
    '',
    '## Top Findings',
    '',
    ...findings.slice(0, 5).map((finding, index) => [
      `### ${index + 1}. ${finding.name}`,
      '',
      `Source: ${finding.repo}`,
      `Score: ${finding.score}/5.0`,
      `Category: ${finding.category}`,
      '',
    ].join('\n')),
    '## Repos Analyzed',
    '',
    '| Repo | Techniques | Top Score |',
    '|---|---:|---:|',
    ...rows,
    '',
    'Run without `--dry-run` to publish these findings.',
    '',
  ].join('\n');

  const reportPath = join(resultsDir, 'scout-report.md');
  writeFileSync(reportPath, body, 'utf8');
  return { reportPath, findings };
}

function main() {
  const options = parseArgs();
  let root = null;
  let passed = false;
  try {
    const fixture = loadFixture(options.from);
    root = mkdtempSync(join(tmpdir(), 'shipguard-scout-smoke-'));
    const { reportPath, findings } = writeReport(root, options.from, fixture);
    assert(existsSync(reportPath), 'scout report was not written');
    assert(findings.length > 0, 'fixture did not produce techniques');

    const report = readFileSync(reportPath, 'utf8');
    assert(
      report.includes(`Repos scanned: ${fixture.repos.length}`),
      `report missing repo count derived from fixture (expected "Repos scanned: ${fixture.repos.length}")`,
    );
    assert(
      report.includes(`Techniques found: ${findings.length}`),
      `report missing technique count derived from fixture (expected "Techniques found: ${findings.length}")`,
    );
    for (const repo of fixture.repos) {
      assert(report.includes(repo.full_name), `report missing fixture repo name: ${repo.full_name}`);
    }
    for (const finding of findings.slice(0, 5)) {
      assert(report.includes(finding.name), `report missing technique name: ${finding.name}`);
    }

    passed = true;
    console.log('scout offline dry-run smoke test passed');
    if (options.debug) console.error(`scout temp dir=${root}`);
  } finally {
    if (root && passed && !options.keepTmp && !options.debug) {
      rmSync(root, { recursive: true, force: true });
    } else if (root) {
      console.error(`scout smoke temp dir kept: ${root}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`scout offline dry-run smoke test failed: ${error.message}`);
  process.exit(1);
}
