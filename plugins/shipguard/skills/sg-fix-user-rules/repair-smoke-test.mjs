import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const workspace = mkdtempSync(join(tmpdir(), 'sg-rule-repair-'));
const project = join(workspace, 'notebook');
const other = join(workspace, 'other');
const planFile = join(workspace, 'review.json');
const helper = fileURLToPath(new URL('./repair.mjs', import.meta.url));
const app = join(project, 'notebook.mjs');
const state = join(workspace, 'state.json');

function run(executable, args, cwd = project) {
  return spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8', cwd });
}
function repair(...args) {
  return run(helper, [planFile, ...args]);
}
function success(result) {
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}
function apply(ids, token) {
  return repair('--apply=' + ids, '--review=' + token);
}
function reset() {
  writeFileSync(state, JSON.stringify({ version: 1, owner: 'Alice', comments: [] }));
}
const data = () => JSON.parse(readFileSync(state, 'utf8'));

const original = [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  'const [file, actor, expected, message] = process.argv.slice(2);',
  "const note = JSON.parse(readFileSync(file, 'utf8'));",
  "if (actor !== note.owner) process.exit(2);",
  "if (expected === 'list') console.log(note.comments.slice(0, 1));",
  'else {',
  '  if (Number(expected) !== note.version) process.exit(3);',
  '  note.comments.push(message);',
  '  note.version++;',
  '  writeFileSync(file, JSON.stringify(note));',
  '}',
  '',
].join('\n');
const noteRule = {
  id: 'R01', problem: 'A late append is refused', action: 'Keep independent comments',
  target: 'The authorized note', reported: 'Both comments remain once', ordinary: 'A fresh comment is saved',
  edits: [
    { path: 'notebook.mjs', before: '  if (Number(expected) !== note.version) process.exit(3);\n  note.comments.push(message);', after: '  note.comments.push(message);' },
    { path: 'help.txt', before: 'Only fresh comments.', after: 'Independent comments can be appended.' },
  ],
};
const listRule = {
  id: 'R02', problem: 'List shows only the first comment', action: 'List all comments',
  target: 'The authorized note', reported: 'A second comment is visible', ordinary: 'A single comment is visible',
  edits: [{ path: 'notebook.mjs', before: 'console.log(note.comments.slice(0, 1))', after: 'console.log(note.comments)' }],
};
const plan = { project, rules: [noteRule, listRule] };
const writePlan = (value = plan) => writeFileSync(planFile, JSON.stringify(value));
const append = (actor, expected, message) => run(app, [state, actor, String(expected), message]);

try {
  mkdirSync(project);
  mkdirSync(other);
  writeFileSync(app, original);
  chmodSync(app, 0o750);
  writeFileSync(join(project, 'help.txt'), 'Only fresh comments.');
  writePlan();
  reset();
  assert.equal(append('Alice', 1, 'first').status, 0);
  assert.equal(append('Alice', 1, 'second').status, 3);
  assert.deepEqual(data().comments, ['first']);

  const preview = success(repair());
  assert.deepEqual(preview.proposals.map(p => [p.id, p.applicability]), [['R01', 'ready'], ['R02', 'ready']]);
  assert.deepEqual(readdirSync(project).sort(), ['help.txt', 'notebook.mjs']);
  assert.equal(readFileSync(app, 'utf8'), original);
  assert.notEqual(repair('--apply=R01').status, 0);
  assert.notEqual(apply('R01,R99', preview.review).status, 0);
  assert.notEqual(run(helper, [planFile], other).status, 0);
  writePlan({ project, rules: [{ ...noteRule, action: 'A different proposal' }, listRule] });
  assert.notEqual(apply('R01', preview.review).status, 0);
  writePlan();
  assert.equal(readFileSync(app, 'utf8'), original);

  // All files in one rule are checked before any is published.
  writeFileSync(join(project, 'help.txt'), 'New guide from the user.');
  assert.equal(JSON.parse(apply('R01', preview.review).stdout).results[0].status, 'unapplied');
  assert.equal(readFileSync(app, 'utf8'), original);
  writeFileSync(join(project, 'help.txt'), 'Only fresh comments.');

  // Unrelated working changes and the unselected proposal survive.
  writeFileSync(app, original + '// Unrelated user change.\n');
  const fixed = success(apply('R01', preview.review));
  assert.deepEqual(fixed.results.map(p => [p.id, p.status, p.verification]), [['R01', 'applied', 'pending']]);
  assert.equal(statSync(app).mode & 0o777, 0o750);
  assert.ok(readFileSync(app, 'utf8').endsWith('// Unrelated user change.\n'));
  assert.equal(readFileSync(join(project, 'help.txt'), 'utf8'), noteRule.edits[1].after);
  assert.equal(success(apply('R01', preview.review)).results[0].status, 'already_present');
  reset();
  assert.equal(append('Alice', 1, 'first').status, 0);
  assert.equal(append('Alice', 1, 'second').status, 0);
  assert.equal(append('Alice', 3, 'ordinary').status, 0);
  assert.deepEqual(data(), { version: 4, owner: 'Alice', comments: ['first', 'second', 'ordinary'] });
  const saved = readFileSync(state);
  assert.equal(append('Bob', 4, 'not allowed').status, 2);
  assert.deepEqual(readFileSync(state), saved);
  assert.equal(run(app, [state, 'Alice', 'list']).stdout.trim(), "[ 'first' ]");

  // Applying the presented lot is explicit and idempotent.
  assert.deepEqual(success(apply('all', preview.review)).results.map(p => p.status), ['already_present', 'applied']);
  assert.match(run(app, [state, 'Alice', 'list']).stdout, /ordinary/);
  assert.deepEqual(success(apply('all', preview.review)).results.map(p => p.status), ['already_present', 'already_present']);

  // Independent approvals arriving together must retain both changes to the shared file.
  writeFileSync(app, original);
  writeFileSync(join(project, 'help.txt'), 'Only fresh comments.');
  const concurrent = await Promise.all(['R01', 'R02'].map(id => promisify(execFile)(process.execPath,
    [helper, planFile, '--apply=' + id, '--review=' + preview.review], { cwd: project })));
  assert.ok(concurrent.every(r => JSON.parse(r.stdout).results[0].status === 'applied'));
  assert.equal(readFileSync(app, 'utf8'), original.replace(noteRule.edits[0].before, noteRule.edits[0].after)
    .replace(listRule.edits[0].before, listRule.edits[0].after));
  // Resume an interrupted multi-file repair: app already has R01, help still needs it.
  writeFileSync(app, original.replace(noteRule.edits[0].before, noteRule.edits[0].after));
  writeFileSync(join(project, 'help.txt'), 'Only fresh comments.');
  const resumed = success(apply('R01', preview.review)).results[0];
  assert.deepEqual(resumed.files, ['help.txt']);

  // A stale rule doesn't stop an independent authorized repair.
  writeFileSync(app, original);
  writeFileSync(join(project, 'help.txt'), 'Conflicting edit.');
  const partial = apply('all', preview.review);
  assert.equal(partial.status, 1);
  assert.deepEqual(JSON.parse(partial.stdout).results.map(p => p.status), ['unapplied', 'applied']);
  assert.ok(readFileSync(app, 'utf8').includes('Number(expected) !== note.version'));
  assert.equal(readFileSync(join(project, 'help.txt'), 'utf8'), 'Conflicting edit.');

  // A protected proposal is isolated. It cannot make a valid selected row fail.
  for (const path of ['../other/source.mjs', '.git/config', '.env', 'settings/private-key.pem']) {
    writeFileSync(app, original);
    writePlan({ project, rules: [listRule, { ...noteRule, edits: [{ path, before: 'x', after: 'y' }] }] });
    const safe = success(repair());
    assert.deepEqual(safe.proposals.map(p => p.applicability), ['ready', 'needs_review']);
    assert.ok(!Object.hasOwn(safe.proposals[1], 'edits'));
    assert.equal(success(apply('R02', safe.review)).results[0].status, 'applied');
  }

  // Source or replacement text that moves to another owner is not the reviewed edit.
  const alice = 'function alice() { return noteLimit(); }';
  const bob = 'function bob() { return allNotes(); }';
  const target = join(project, 'owners.mjs');
  const owners = alice + '\n' + bob + '\n';
  writeFileSync(target, owners);
  const replace = (before, after) => writePlan({ project, rules: [{ ...listRule,
    edits: [{ path: 'owners.mjs', before, after }] }] });
  replace('return noteLimit();', 'return allNotes();');
  const owned = success(repair());
  for (const changed of [
    owners.replace('return noteLimit();', 'return otherLimit();').replace('return allNotes();', 'return noteLimit();'),
    owners.replace('return noteLimit();', 'return otherLimit();'),
  ]) {
    writeFileSync(target, changed);
    assert.equal(JSON.parse(apply('R02', owned.review).stdout).results[0].status, 'unapplied');
    assert.equal(readFileSync(target, 'utf8'), changed);
  }

  // Matching lines inside a multiline function do not establish its owner.
  const multilineOwner = [
    'function alice() {',
    '  if (isReady()) {',
    '    return noteLimit();',
    '  }',
    '  return fallback();',
    '}',
    '',
  ].join('\n');
  writeFileSync(target, multilineOwner);
  replace('return noteLimit();', 'return allNotes();');
  const multilineReview = success(repair());
  const differentOwner = multilineOwner.replace('function alice()', 'function bob()');
  writeFileSync(target, differentOwner);
  const moved = apply('R02', multilineReview.review);
  assert.equal(moved.status, 1);
  assert.equal(JSON.parse(moved.stdout).results[0].status, 'unapplied');
  assert.equal(readFileSync(target, 'utf8'), differentOwner);

  // Restoring the approved owner lets the same decision proceed.
  writeFileSync(target, multilineOwner + '// Later unrelated comment.\n');
  assert.equal(success(apply('R02', multilineReview.review)).results[0].status, 'applied');
  assert.equal(readFileSync(target, 'utf8'), multilineOwner.replace('return noteLimit();', 'return allNotes();')
    + '// Later unrelated comment.\n');

  // The old excerpt occurs inside the desired text. A replay must not insert twice.
  writeFileSync(target, owners);
  replace('return noteLimit();', 'audit(); return noteLimit();');
  const insertion = success(repair());
  assert.equal(success(apply('R02', insertion.review)).results[0].status, 'applied');
  writeFileSync(target, readFileSync(target, 'utf8') + '// Later unrelated comment.\n');
  assert.equal(success(apply('R02', insertion.review)).results[0].status, 'already_present');
  assert.equal((readFileSync(target, 'utf8').match(/audit\(\)/g) || []).length, 1);
  assert.equal(success(repair()).proposals[0].applicability, 'needs_review');
  // Explicit empty replacement has an independently checkable post-image on retry.
  writeFileSync(target, owners);
  replace('return noteLimit();', '');
  const deletion = success(repair());
  assert.equal(success(apply('R02', deletion.review)).results[0].status, 'applied');
  assert.equal(success(apply('R02', deletion.review)).results[0].status, 'already_present');
  assert.equal(readFileSync(target, 'utf8'), owners.replace('return noteLimit();', ''));
  if (process.platform !== 'win32') {
    writeFileSync(join(other, 'outside.mjs'), 'One');
    symlinkSync(other, join(project, 'linked'));
    writePlan({ project, rules: [{ ...listRule, edits: [{ path: 'linked/outside.mjs', before: 'One', after: 'Two' }] }] });
    const linked = success(repair());
    assert.equal(linked.proposals[0].applicability, 'needs_review');
    assert.equal(JSON.parse(apply('R02', linked.review).stdout).results[0].status, 'unapplied');
    assert.equal(readFileSync(join(other, 'outside.mjs'), 'utf8'), 'One');
  }
  console.log('Rule repair: preview, consent, fresh and late appends, protected target, unselected rule, retry and drift passed.');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
