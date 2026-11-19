#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, linkSync, mkdtempSync, readdirSync,
  openSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSensitivePath } from '../shipguard-audit-user-rules/paths.mjs';

const usage = 'Usage: node repair.mjs PLAN.json [--project=DIR] [--apply=R01,R04|--apply=all --review=DIGEST]';
const digest = value => createHash('sha256').update(value).digest('hex');
const own = (object, key) => Object.hasOwn(object, key);

function checkoutIdentity(root) {
  const stat = statSync(root, { bigint: true });
  return [realpathSync(root), String(stat.dev), String(stat.ino)];
}
const inside = (root, path) => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
};

function requireFields(object, names) {
  if (!object || !names.every(name => typeof object[name] === 'string' && object[name].trim())) {
    throw new Error('Expected nonempty text for ' + names.join(', '));
  }
}

function safeRelative(root, requested) {
  if (isAbsolute(requested) || requested.includes('\0') || requested.split(/[\\/]/).includes('..')) {
    throw new Error('Expected a project-relative file path');
  }
  const target = resolve(root, requested);
  const path = relative(root, target);
  if (!path || !inside(root, target) || isSensitivePath(path) || path.split(/[\\/]/).some(p => ['.git', '.hg', '.svn'].includes(p.toLowerCase()))) {
    throw new Error('Protected or outside-project path in the plan');
  }
  return path;
}

// lstat every component before opening a file; O_NOFOLLOW also protects the last component.
function regularFile(root, path) {
  let current = root;
  for (const part of path.split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Symbolic link in path: ' + path);
  }
  if (!lstatSync(current).isFile()) throw new Error('Expected an existing regular file: ' + path);
  const fd = openSync(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Expected an existing regular file: ' + path);
    const bytes = readFileSync(fd);
    const text = bytes.toString('utf8');
    if (text.includes('\0') || !Buffer.from(text).equals(bytes)) throw new Error('Expected UTF-8 source: ' + path);
    return { text, mode: stat.mode & 0o7777 };
  } finally {
    closeSync(fd);
  }
}

function readPlan(root, filename) {
  const selected = resolve(filename);
  const actual = join(realpathSync(dirname(selected)), basename(selected));
  if (inside(root, actual) || isSensitivePath(actual) || !actual.endsWith('.json')) {
    throw new Error('Use a non-sensitive JSON plan saved outside the project');
  }
  const raw = regularFile(dirname(actual), basename(actual)).text;
  const plan = JSON.parse(raw);
  requireFields(plan, ['project']);
  if (!isAbsolute(plan.project) || realpathSync(plan.project) !== root) throw new Error('Plan belongs to another project');
  if (!Array.isArray(plan.rules)) throw new Error('Expected rules array');
  const ids = new Set();
  for (const rule of plan.rules) {
    requireFields(rule, ['id', 'problem', 'action', 'target', 'reported', 'ordinary']);
    if (rule.id === 'all' || rule.id.includes(',') || rule.id.trim() !== rule.id || ids.has(rule.id)) {
      throw new Error('Expected a unique, selectable rule ID: ' + rule.id);
    }
    ids.add(rule.id);
    if (!Array.isArray(rule.edits) || !rule.edits.length) throw new Error('Missing edits for ' + rule.id);
    for (const edit of rule.edits) {
      requireFields(edit, ['path']);
      if (typeof edit.before !== 'string' || !edit.before.length || typeof edit.after !== 'string'
          || edit.before === edit.after) throw new Error('Expected an exact before/after change in ' + rule.id);
    }
  }
  const identity = checkoutIdentity(root);
  // Ignore JSON formatting, bind selection to the actual presented proposal and checkout.
  return { rules: plan.rules, filename: actual, identity, planHash: digest(JSON.stringify([identity, plan.rules])) };
}

// Keep the checkout read-only during preview. The receipt beside the outside-project
// plan holds hashes, lengths and positions, never additional source text.
function uniqueContext(text, context) {
  return context.trim().length > 0 && text.indexOf(context) === text.lastIndexOf(context);
}

function snapshotEdit(text, edit) {
  const start = text.indexOf(edit.before);
  if (start < 0 || start !== text.lastIndexOf(edit.before)) {
    throw new Error('Supply unique, current before text: ' + edit.path);
  }
  // A newly generated preview has no earlier anchors. Do not propose inserting
  // the same wrapper twice when the desired text already encloses the old text.
  if (edit.after.includes(edit.before)) {
    const expanded = text.lastIndexOf(edit.after, start);
    if (expanded >= 0 && start + edit.before.length <= expanded + edit.after.length) {
      throw new Error('The replacement already surrounds this excerpt. Check the current source: ' + edit.path);
    }
  }
  const left = text.slice(0, start);
  const right = text.slice(start + edit.before.length);
  // Include the preceding/following code line when the edit sits at a line boundary.
  const nearLeft = (left.match(/[^\n]*\n[ \t]*$/)?.[0] || left.split('\n').at(-1)).slice(-160);
  const nearRight = (right.match(/^[ \t]*\n[^\n]*/)?.[0] || right.split('\n')[0]).slice(0, 160);
  const updated = left + edit.after + right;
  return { updated, anchor: { start, tail: right.length, left: digest(left), right: digest(right),
    prior: digest(text), done: digest(updated),
    nearLeft: [nearLeft.length, digest(nearLeft), uniqueContext(text, nearLeft)],
    nearRight: [nearRight.length, digest(nearRight), uniqueContext(text, nearRight)] } };
}

function candidateLocations(text, edit, anchor) {
  const matches = [];
  for (const [kind, needle] of [['before', edit.before], ['after', edit.after]]) {
    const positions = new Set([anchor.start, text.length - anchor.tail - needle.length]);
    if (needle) {
      for (let pos = text.indexOf(needle); pos !== -1; pos = text.indexOf(needle, pos + 1)) positions.add(pos);
    }
    for (const pos of positions) {
      if (pos < 0 || pos > text.length || !text.startsWith(needle, pos)) continue;
      const end = pos + needle.length;
      const [leftLength, leftHash, leftUnique] = anchor.nearLeft;
      const [rightLength, rightHash, rightUnique] = anchor.nearRight;
      const left = text.slice(Math.max(0, pos - leftLength), pos);
      const right = text.slice(end, end + rightLength);
      if (digest(left) !== leftHash || digest(right) !== rightHash) continue;
      if ((leftUnique && uniqueContext(text, left)) || (rightUnique && uniqueContext(text, right))
          || digest(text.slice(0, pos)) === anchor.left || digest(text.slice(end)) === anchor.right) {
        matches.push({ kind, pos });
      }
    }
  }
  return matches;
}

function matchesReviewedSource(text, pos, edit, anchor) {
  const length = anchor.start + edit.before.length + anchor.tail;
  // Keep trailing additions on separate lines outside the complete reviewed source.
  return pos === anchor.start && text.length >= length
    && (text.length === length || text[length - 1] === '\n' || /^\r?\n/.test(text.slice(length)))
    && digest(text.slice(0, length)) === anchor.prior;
}

function provesLocation(text, edit, anchor, { kind, pos }, siblings) {
  const targetLength = kind === 'after' ? edit.after.length : edit.before.length;
  const restored = kind === 'after' ? text.slice(0, pos) + edit.before + text.slice(pos + targetLength) : text;
  if (matchesReviewedSource(restored, pos, edit, anchor)) return true;

  // Nearby lines locate candidates only. Prove the original placement by
  // undoing other exact edits from this same preview in memory before hashing.
  const replacements = [];
  if (kind === 'after') replacements.push({ pos, length: targetLength, before: edit.before });
  const end = pos + targetLength;
  let originalPos = pos;
  for (const { edit: sibling, anchor: siblingAnchor } of siblings) {
    const locations = candidateLocations(text, sibling, siblingAnchor);
    if (locations.length !== 1 || locations[0].kind !== 'after') continue;
    const start = locations[0].pos;
    const length = sibling.after.length;
    if (start === pos || (start < end && start + length > pos)) return false;
    if (start < pos) originalPos += sibling.before.length - length;
    replacements.push({ pos: start, length, before: sibling.before });
  }
  let source = text;
  let next = text.length + 1;
  for (const change of replacements.sort((a, b) => b.pos - a.pos)) {
    if (change.pos + change.length > next || change.pos === next) return false;
    source = source.slice(0, change.pos) + change.before + source.slice(change.pos + change.length);
    next = change.pos;
  }
  return matchesReviewedSource(source, originalPos, edit, anchor);
}

function applyAnchored(text, edit, anchor, siblings) {
  const hash = digest(text);
  if (hash === anchor.done) return text;
  if (hash === anchor.prior) {
    return text.slice(0, anchor.start) + edit.after + text.slice(anchor.start + edit.before.length);
  }
  const matches = candidateLocations(text, edit, anchor)
    .filter(match => provesLocation(text, edit, anchor, match, siblings));
  if (matches.length !== 1) throw new Error('Reviewed location changed or is ambiguous: ' + edit.path);
  const [{ kind, pos }] = matches;
  return kind === 'after' ? text : text.slice(0, pos) + edit.after + text.slice(pos + edit.before.length);
}

function prepareRule(root, rule, reviewed, reviewedByPath) {
  if (reviewed?.error) throw new Error(reviewed.error);
  const files = new Map();
  const anchors = [];
  for (const [i, edit] of rule.edits.entries()) {
    const path = safeRelative(root, edit.path);
    if (!files.has(path)) {
      const { text, mode } = regularFile(root, path);
      files.set(path, { path, original: text, updated: text, mode });
    }
    const file = files.get(path);
    if (!reviewed) {
      const result = snapshotEdit(file.updated, edit);
      anchors.push(result.anchor);
      file.updated = result.updated;
    } else if (digest(file.original) !== reviewed.final[path]) {
      const siblings = reviewedByPath.get(path).filter(entry => entry.rule !== rule || entry.index > i);
      file.updated = applyAnchored(file.updated, edit, reviewed.anchors[i], siblings);
    }
  }
  const final = Object.fromEntries([...files].map(([key, file]) => [key, digest(file.updated)]));
  return { snapshot: { anchors, final }, changes: [...files.values()].filter(file => file.original !== file.updated) };
}

function indexReviewedEdits(root, rules, evidence) {
  const byPath = new Map();
  for (const rule of rules) {
    const anchors = evidence[rule.id]?.anchors;
    if (!anchors) continue;
    for (const [index, edit] of rule.edits.entries()) {
      const path = relative(root, resolve(root, edit.path));
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push({ rule, index, edit, anchor: anchors[index] });
    }
  }
  return byPath;
}

function receiptPath(filename, review) {
  if (!/^[a-f0-9]{64}$/.test(review)) throw new Error('Invalid review digest');
  return join(dirname(filename), '.shipguard-review-' + review + '.json');
}

function saveReceipt(filename, snapshot) {
  const bytes = JSON.stringify(snapshot);
  const review = digest(bytes);
  const receipt = receiptPath(filename, review);
  const temp = receipt + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
  try {
    try { linkSync(temp, receipt); }
    catch (error) {
      if (error.code !== 'EEXIST' || regularFile(dirname(receipt), basename(receipt)).text !== bytes) throw error;
    }
  } finally { unlinkSync(temp); }
  return review;
}

function loadReceipt(filename, review, planHash) {
  const path = receiptPath(filename, review);
  const bytes = regularFile(dirname(path), basename(path)).text;
  if (digest(bytes) !== review) throw new Error('Preview record changed. Preview the plan again.');
  const snapshot = JSON.parse(bytes);
  if (snapshot.planHash !== planHash) throw new Error('The presented plan or its project changed. Preview the current plan.');
  return snapshot;
}

// Use a sibling for an atomic replacement. Compare the original immediately before rename
// so an edit elsewhere in the file during preparation is never knowingly overwritten.
function writeVersion(identity, file, expected, replacement) {
  const [root] = identity;
  if (JSON.stringify(checkoutIdentity(root)) !== JSON.stringify(identity)) throw new Error('Project changed during repair');
  const target = join(root, file.path);
  const parent = dirname(target);
  if (realpathSync(parent) !== parent) throw new Error('Directory changed: ' + file.path);
  const temp = join(parent, '.shipguard-rule-' + randomUUID() + '.tmp');
  const fd = openSync(temp, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, replacement, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const current = regularFile(root, file.path);
    if (current.text !== expected || current.mode !== file.mode) throw new Error('Source changed: ' + file.path);
    chmodSync(temp, file.mode);
    renameSync(temp, target);
  } finally {
    try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function applyRule(identity, rule, reviewed, reviewedByPath) {
  const [root] = identity;
  const written = [];
  try {
    const { changes } = prepareRule(root, rule, reviewed, reviewedByPath);
    for (const file of changes) {
      writeVersion(identity, file, file.original, file.updated);
      written.push(file);
    }
    return { id: rule.id, status: written.length ? 'applied' : 'already_present',
      files: written.map(file => file.path), verification: 'pending' };
  } catch (error) {
    const remaining = [];
    for (const file of written.reverse()) {
      try { writeVersion(identity, file, file.updated, file.original); }
      catch (rollback) { remaining.push({ path: file.path, reason: rollback.message }); }
    }
    return { id: rule.id, status: remaining.length ? 'partial' : 'unapplied',
      reason: error.message, unreverted: remaining, verification: 'pending' };
  }
}

// Publish a populated lock directory atomically. After a crash, remove only the
// dead owner's unique marker; another contender may already have acquired the lock.
function releaseLock(lock, marker) {
  try { unlinkSync(join(lock, marker)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { rmdirSync(lock); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
}

function withProjectLock(identity, apply) {
  const tmp = realpathSync(tmpdir());
  const lock = join(tmp, 'shipguard-rules-' + digest(JSON.stringify(identity)));
  const staging = mkdtempSync(join(tmp, 'shipguard-rules-tmp-'));
  const marker = process.pid + '-' + randomUUID();
  const pause = new Int32Array(new SharedArrayBuffer(4));
  writeFileSync(join(staging, marker), '', { flag: 'wx', mode: 0o600 });
  try {
    for (;;) {
      try { renameSync(staging, lock); break; }
      catch (error) {
        if (!['ENOTEMPTY', 'EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        let entries;
        try {
          const stat = lstatSync(lock);
          if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw error;
          entries = readdirSync(lock);
        } catch (readError) { if (readError.code === 'ENOENT') continue; throw readError; }
        if (!entries.length) {
          try { rmdirSync(lock); } catch (removeError) {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(removeError.code)) throw removeError;
          }
          continue;
        }
        const owner = /^(\d+)-[a-f0-9-]{36}$/.exec(entries[0]);
        if (entries.length !== 1 || !owner) throw new Error('Unrecognized project lock: ' + lock);
        try { process.kill(Number(owner[1]), 0); }
        catch (signalError) {
          if (signalError.code === 'ESRCH') { releaseLock(lock, entries[0]); continue; }
          if (signalError.code !== 'EPERM') throw signalError;
        }
        Atomics.wait(pause, 0, 0, 50);
      }
    }
    try { return apply(); }
    finally { releaseLock(lock, marker); }
  } finally {
    // A successful rename already removed the staging path.
    releaseLock(staging, marker);
  }
}

export function repair(args) {
  const options = {};
  const positionals = [];
  for (const arg of args) {
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    const match = /^--(project|apply|review)=(.+)$/.exec(arg);
    if (!match || own(options, match[1])) throw new Error(usage);
    options[match[1]] = match[2];
  }
  if (positionals.length !== 1 || own(options, 'apply') !== own(options, 'review')) throw new Error(usage);
  const root = realpathSync(options.project ?? process.cwd());
  if (isSensitivePath(root) || root.split(/[\\/]/).some(name => ['.git', '.hg', '.svn'].includes(name.toLowerCase()))) throw new Error('Protected project path');
  if (!statSync(root).isDirectory()) throw new Error('Project must be a directory');
  const { rules, filename, identity, planHash } = readPlan(root, positionals[0]);
  if (!own(options, 'apply')) {
    const evidence = Object.create(null);
    const proposals = rules.map(rule => {
      try {
        evidence[rule.id] = prepareRule(root, rule).snapshot;
        return { ...rule, applicability: 'ready' };
      } catch (error) {
        evidence[rule.id] = { error: error.message };
        return { id: rule.id, problem: rule.problem, action: rule.action, target: rule.target,
          reported: rule.reported, ordinary: rule.ordinary, applicability: 'needs_review', reason: error.message };
      }
    });
    const review = saveReceipt(filename, { planHash, evidence });
    return { mode: 'preview', project: root, review, proposals };
  }
  const review = options.review;
  const snapshot = loadReceipt(filename, review, planHash);
  const selected = options.apply === 'all' ? rules.map(rule => rule.id) : [...new Set(options.apply.split(',').map(id => id.trim()))];
  const byId = new Map(rules.map(rule => [rule.id, rule]));
  for (const id of selected) if (!byId.has(id)) throw new Error('Unknown rule ID: ' + id);
  const reviewedByPath = indexReviewedEdits(root, rules, snapshot.evidence);
  return withProjectLock(identity, () => ({
    mode: 'apply', project: root, review,
    results: selected.map(id => applyRule(identity, byId.get(id), snapshot.evidence[id], reviewedByPath)),
  }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = repair(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (result.results?.some(rule => ['unapplied', 'partial'].includes(rule.status))) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
