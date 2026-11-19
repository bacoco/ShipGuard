import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanProject } from './scan.mjs';
import { isSensitivePath } from './paths.mjs';

const scan = fileURLToPath(new URL('./scan.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'sg-rules-scan-'));
const root = join(dir, 'project');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const cli = (...args) => JSON.parse(execFileSync(process.execPath, [scan, ...args], { encoding: 'utf8' }));
const app = `export function showButton(context) {
  if (context.archived) return null;
  return { disabled: context.pending };
}
export function save(context) {
  if (!context.authorized) return false; // legitimate protection, subject to human review
  if (context.stale) return false;
  return confirm('Test marker not for publication');
}
export const defaultListing = rows => rows.slice(0, 2);
export const route = text => text.includes('draw');
test.skip('unexercised normal path', () => {});
const toolbar = editable && <Button>Close</Button>;
if (text === 'draw') return openCanvas();
`;

try {
  mkdirSync(root);
  mkdirSync(join(root, 'ui'));
  writeFileSync(join(root, 'ui', 'main.js'), app);
  writeFileSync(join(root, 'ui', 'other.js'), 'export const VERSION = 1;\n');
  writeFileSync(join(root, 'README.md'), 'Only list this path.\n');
  writeFileSync(join(root, 'image.js'), Buffer.from([0xff, 0, 0x20]));
  writeFileSync(join(root, 'latin.js'), Buffer.from([0xff, 0x20]));
  writeFileSync(join(root, '.env.test'), 'harmless fixture marker');
  symlinkSync(join(root, '.env.test'), join(root, 'link.js'));
  mkdirSync(join(root, 'inner'));
  execFileSync('git', ['-C', join(root, 'inner'), 'init', '-q']);

  const files = cli(root);
  assert.equal(files.mode, 'filesystem');
  assert.equal(files.revision, null);
  assert.equal(files.scope.type, 'all');
  assert.deepEqual(files.coverage.scanned, ['ui/main.js', 'ui/other.js']);
  assert.deepEqual(files.coverage.nested_projects, ['inner']);
  assert.equal(files.coverage.excluded.possibly_sensitive, 1);
  assert.equal(files.coverage.excluded.symlink, 1);
  assert(files.coverage.unexamined.some(e => e.path === 'image.js' && e.reason === 'binary'));
  assert(files.coverage.unexamined.some(e => e.path === 'latin.js' && e.reason === 'unsupported_encoding'));
  assert(files.coverage.unexamined.some(e => e.path === 'README.md' && e.reason === 'no_text_scanner'));
  const result = files.candidates;
  for (const [category, line] of [
    ['visibility', 2], ['waiting', 3], ['refusal', 6], ['refusal', 7],
    ['confirmation', 8], ['default_or_filter', 10], ['language_routing', 11], ['skipped_or_success', 12],
    ['visibility', 13], ['language_routing', 14],
  ]) {
    const hit = result.find(c => c.path === 'ui/main.js' && c.line === line && c.category === category);
    assert(hit, `${category} at line ${line}`);
    assert.equal(hit.verdict, undefined, 'a path/line lead cannot declare a product policy invalid');
  }
  assert(!JSON.stringify(files).includes('Test marker not for publication'));
  assert(isSensitivePath('private/id_ed25519'));
  assert(isSensitivePath('config/api-key.json'));
  assert(isSensitivePath('downloads/myproject-firebase-adminsdk-abcd1-012345.json'));
  assert(isSensitivePath('android/keystore.properties'));
  assert(!isSensitivePath('docs/firebase-adminsdk-setup.md'));
  assert(!isSensitivePath('themes/design-tokens.css'));
  assert.equal(spawnSync(process.execPath, [scan, root, '--diff=HEAD']).status, 1);

  git('init', '-q');
  writeFileSync(join(root, '.gitignore'), '.env.test\ninner/\n*.ignored.js\n');
  git('add', '--', 'ui', '.gitignore');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base');
  const initial = git('rev-parse', 'HEAD').trim();
  writeFileSync(join(root, 'skip.ignored.js'), 'return false;');
  writeFileSync(join(root, 'ui', 'main.js'), app + '\nexport const waiting = true;\n');
  writeFileSync(join(root, 'ui', 'new.ts'), 'const hidden = true;\n');
  git('add', '--', 'ui/main.js');

  const before = git('status', '--porcelain=v1');
  const full = cli(root);
  const delta = cli(root, '--diff=HEAD');
  const inventory = cli(root, '--inventory');
  assert.deepEqual(inventory.coverage.scanned, []);
  assert.deepEqual(inventory.candidates, []);
  assert(inventory.inventory.includes('ui/new.ts'));
  assert(!inventory.inventory.includes('link.js'));
  const limited = JSON.parse(execFileSync(process.execPath, [scan, root, '--diff=HEAD', '--paths-stdin'], {
    input: JSON.stringify(['ui/new.ts', '../elsewhere.js', '.env.test']), encoding: 'utf8',
  }));
  assert.deepEqual(limited.coverage.scanned, ['ui/new.ts']);
  assert.equal(limited.coverage.unmatched_reviewed_paths, 2);
  assert(limited.coverage.unexamined.some(p => p.path === 'ui/main.js' && p.reason === 'not_selected'));
  assert(limited.candidates.every(p => p.path === 'ui/new.ts'));
  assert.deepEqual((await scanProject(root, { paths: [] })).coverage.scanned, []);
  assert.equal(spawnSync(process.execPath, [scan, root, '--paths-stdin'], { input: '{}' }).status, 1);
  assert.equal(full.revision, initial);
  assert.match(full.coverage.ignored_untracked, /not enumerated/);
  assert.deepEqual(full.coverage.scanned, ['ui/main.js', 'ui/new.ts', 'ui/other.js']);
  assert.equal(delta.scope.base, initial);
  assert.deepEqual(delta.coverage.scanned, ['ui/main.js', 'ui/new.ts']);
  assert.equal(delta.coverage.unchanged, 1);
  const scoped = await scanProject(join(root, 'ui'), { diff: 'HEAD' });
  assert.deepEqual(scoped.coverage.scanned, ['main.js', 'new.ts']);
  assert.equal(spawnSync(process.execPath, [scan, root, '--diff=does-not-exist']).status, 1);
  assert.equal(git('status', '--porcelain=v1'), before);
  assert.equal(readFileSync(join(root, 'ui', 'main.js'), 'utf8'), app + '\nexport const waiting = true;\n');
  const history = fileURLToPath(new URL('./history.mjs', import.meta.url));
  const historyCli = (file, excerpt, ...args) =>
    spawnSync(process.execPath, [history, root, file, ...args], { input: excerpt, encoding: 'utf8' });
  const original = JSON.parse(historyCli('ui/main.js', 'return confirm(\n').stdout);
  assert.equal(original.status, 'matched');
  assert.equal(original.commit.hash, initial);
  assert.equal(JSON.parse(historyCli('./ui/main.js', 'return confirm(').stdout).commit.hash, initial);
  assert.equal(original.commit.author, 'Fixture');
  assert.deepEqual(original.commit.coauthors, []);
  assert.equal(original.shallow, false);
  assert.equal(JSON.parse(historyCli('ui/main.js', 'missing phrase').stdout).status, 'no_match');
  assert.equal(JSON.parse(historyCli('ui/new.ts', 'hidden').stdout).status, 'not_tracked_at_revision');
  assert.equal(JSON.parse(historyCli('ui/*', 'return confirm(').stdout).status, 'not_tracked_at_revision');
  assert.match(historyCli('ui/main.js', ' ').stderr, /non-empty/);
  assert.notEqual(historyCli('private/id_rsa', 'phrase').status, 0);
  assert.notEqual(historyCli('link.js', 'phrase').status, 0);
  assert.notEqual(historyCli('../ui/main.js', 'phrase').status, 0);
  assert.notEqual(historyCli('.', 'phrase').status, 0);
  assert.notEqual(historyCli('ui/', 'return false').status, 0);
  writeFileSync(join(root, 'ui', 'main.js'), readFileSync(join(root, 'ui', 'main.js'), 'utf8') + '\n// return confirm( again\n');
  git('add', '--', 'ui/main.js');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'add waiting',
    '-m', 'Co-Authored-By: Example <second@example.invalid>');
  const wait = JSON.parse(historyCli('ui/main.js', 'export const waiting', '--revision=HEAD').stdout);
  assert.deepEqual(wait.commit.coauthors, ['Co-Authored-By: Example <second@example.invalid>']);
  assert.equal(JSON.parse(historyCli('ui/main.js', 'export const waiting', '--revision=HEAD~1').stdout).status, 'no_match');
  assert.equal(JSON.parse(historyCli('ui/main.js', 'return confirm(').stdout).commit.hash, initial);
  const shallowRoot = join(dir, 'shallow');
  execFileSync('git', ['clone', '-q', '--depth=1', '--no-checkout', pathToFileURL(root).href, shallowRoot]);
  const localHistory = JSON.parse(execFileSync(process.execPath, [history, shallowRoot, 'ui/main.js'], {
    input: 'return confirm(', encoding: 'utf8',
  }));
  assert.equal(localHistory.shallow, true);
  assert.equal(localHistory.commit.hash, wait.commit.hash);
  console.log('PASS user-rule discovery: source and protected-path leads, coverage, Git scope and read-only CLI');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
