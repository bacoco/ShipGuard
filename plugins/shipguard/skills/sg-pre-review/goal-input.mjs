// Explicit goal inputs only. No discovery, writes, network, or approval inference.
import { openSync, closeSync, fstatSync, readSync, realpathSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const MAX_BYTES = 64 * 1024;
export const MAX_CRITERIA = 16;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function snapshot(path) {
  const selected_path = resolve(path), actual = realpathSync(selected_path);
  const fd = openSync(actual, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Input must be a regular file <=64 KiB');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0, count;
    while (size < buffer.length && (count = readSync(fd, buffer, size, buffer.length - size, null))) size += count;
    if (size > MAX_BYTES) throw new Error('Input exceeds 64 KiB');
    const bytes = buffer.subarray(0, size), text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!text.trim() || text.includes('\0')) throw new Error('Input must be nonempty UTF-8 text without NUL');
    return Object.freeze({ selected_path, path: actual, sha256: digest(bytes), text });
  } finally { closeSync(fd); }
}

// Deliberately narrow Markdown convention, not a general Markdown or goal parser.
export function parseCriteria(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('Goal exceeds 64 KiB');
  const lines = text.split(/\r?\n/), criteria = [], ids = new Set();
  let section = false, found = false, current = null, fence = null;
  function finish(end) {
    if (!current) return;
    const body = lines.slice(current.start, end).join('\n');
    if (!body.trim() || body.length > 8000) throw new Error('Each criterion needs 1..8000 body characters');
    criteria.push(Object.freeze({ ...current, end, text: lines.slice(current.start - 1, end).join('\n') }));
    current = null;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = i === 0 ? lines[i].replace(/^\uFEFF/, '') : lines[i];
    if (fence) {
      if (new RegExp('^ {0,3}' + fence.char + '{' + fence.length + ',}[ \\t]*$').test(line)) fence = null;
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening) {
      if (section && !current) throw new Error('Unnumbered content in Success criteria');
      fence = { char: opening[1][0], length: opening[1].length };
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/);
    if (heading) {
      const level = heading[1].length, title = heading[2];
      if (level <= 3) finish(i);
      if (level <= 2) section = false;
      if (level === 2 && title === 'Success criteria') {
        if (found) throw new Error('Duplicate Success criteria section');
        section = found = true;
        continue;
      }
      if (section && level === 3) {
        const match = title.match(/^(SG-R[1-9][0-9]{0,3}) [—-] (\S.*)$/);
        if (!match || ids.has(match[1])) throw new Error('Invalid or duplicate criterion heading');
        ids.add(match[1]);
        if (ids.size > MAX_CRITERIA) throw new Error('Goal runner supports at most 16 criteria; none are truncated');
        current = { id: match[1], title: match[2], start: i + 1 };
        continue;
      }
      if (/^SG-R/.test(title)) throw new Error('Criterion outside Success criteria');
    }
    if (section && !current && line.trim()) throw new Error('Unnumbered content in Success criteria');
  }
  if (fence) throw new Error('Unclosed fenced block in goal');
  finish(lines.length);
  if (!found || !criteria.length) throw new Error('Use ## Success criteria with ### SG-R1 — Title and a body; no implicit conversion');
  return Object.freeze(criteria);
}

export function loadGoalInputs(requestPath, goalPath) {
  const request = snapshot(requestPath), goal = snapshot(goalPath);
  return Object.freeze({ request, goal, criteria: parseCriteria(goal.text) });
}

export function inputChanges(inputs) {
  const errors = [];
  for (const name of ['request', 'goal']) {
    try {
      const now = snapshot(inputs[name].selected_path);
      if (now.path !== inputs[name].path || now.sha256 !== inputs[name].sha256) errors.push(`${name.toUpperCase()}_CHANGED`);
    } catch { errors.push(`${name.toUpperCase()}_UNAVAILABLE`); }
  }
  return errors;
}
