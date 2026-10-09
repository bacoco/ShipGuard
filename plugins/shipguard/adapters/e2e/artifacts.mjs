/** Local, bounded evidence copy. Nothing is fetched, rendered, published or unredacted. */
import { createHash } from 'node:crypto';
import { lstatSync, readSync, writeFileSync, mkdirSync, realpathSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { ensure, AdapterError } from './contract.mjs';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const REPORT_LIMIT = 32 * 1024 * 1024;
const FILE_LIMIT = 32 * 1024 * 1024;
const TOTAL_LIMIT = 128 * 1024 * 1024;
export function readRegular(file, limit = REPORT_LIMIT) {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    ensure(st.isFile() && st.size <= limit, 'UNSAFE_FILE', 'Expected a bounded regular file', 2);
    // Read at most the declared limit, even if another process grows the file.
    const buffer = Buffer.alloc(Math.min(st.size + 1, limit + 1));
    let used = 0, n;
    do { n = readSync(fd, buffer, used, buffer.length - used, null); used += n; }
    while (n > 0 && used < buffer.length);
    ensure(used === st.size, 'CHANGED_FILE', 'Evidence changed during read', 2);
    return buffer.subarray(0, used);
  } finally { closeSync(fd); }
}
export function evidencePath(root, name) {
  ensure(typeof name === 'string' && name.length > 0 && !/[\\:\x00-\x1f\x7f]/.test(name) &&
    !isAbsolute(name) && name.split('/').every(s => s && s !== '.' && s !== '..'),
    'UNSAFE_ARTIFACT_PATH', 'Artifact path must stay relative to the source output directory');
  const base = realpathSync(root);
  let file = base;
  for (const segment of name.split('/')) {
    file = join(file, segment);
    ensure(!lstatSync(file).isSymbolicLink(), 'SYMLINK_ARTIFACT', 'Artifact symlinks are not accepted');
  }
  const actual = realpathSync(file);
  const rel = relative(base, actual);
  ensure(rel && !rel.startsWith('..') && !isAbsolute(rel), 'ESCAPED_ARTIFACT', 'Artifact escaped output directory');
  return file;
}
export function collectArtifacts(report, sourceRoot, bundle) {
  mkdirSync(join(bundle, 'artifacts'), { mode: 0o700 });
  const records = [];
  const seen = new Set();
  let total = 0;
  for (const t of report.run.results.filter(t => t.selected)) for (const attempt of t.attempts) {
    for (const a of attempt.artifacts) {
      const record = { test_id: t.id, attempt_id: attempt.id, artifact_id: a.id, kind: a.kind,
        source_path: a.path ?? null, redaction: a.redaction, state: 'unavailable', local_file: null };
      records.push(record);
      if (a.redaction !== 'complete') { record.reason = 'redaction-incomplete'; continue; }
      if (!a.path) { record.reason = a.url ? 'remote-not-fetched' : 'withheld'; continue; }
      try {
        const bytes = readRegular(evidencePath(sourceRoot, a.path), FILE_LIMIT);
        ensure(bytes.length > 0, 'EMPTY_ARTIFACT', 'Artifact is empty', 2);
        const hash = digest(bytes);
        ensure(bytes.length === a.size && hash === a.sha256, 'ARTIFACT_INTEGRITY', 'Artifact integrity mismatch', 2);
        total += bytes.length;
        ensure(total <= TOTAL_LIMIT, 'ARTIFACT_BUDGET', 'Artifact byte budget exceeded', 2);
        // Opaque bytes: metadata never becomes an executable HTML path or a trusted image verdict.
        const filename = `artifacts/${hash}.bin`;
        if (!seen.has(hash)) writeFileSync(join(bundle, filename), bytes, { flag: 'wx', mode: 0o600 });
        seen.add(hash);
        Object.assign(record, { state: 'copied', local_file: filename, sha256: hash, size: bytes.length });
      } catch (e) {
        record.state = 'error';
        record.reason = e instanceof AdapterError ? e.code : 'ARTIFACT_UNREADABLE';
      }
    }
  }
  return records;
}
export function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
/** Create beneath a trusted project, rejecting pre-existing symlinks at every managed level. */
export function newBundle(project, id) {
  let dir = realpathSync(project);
  for (const segment of ['visual-tests', '_results', 'e2e']) {
    dir = join(dir, segment);
    try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const st = lstatSync(dir);
    ensure(st.isDirectory() && !st.isSymbolicLink(), 'UNSAFE_OUTPUT', 'Managed output must contain plain directories');
  }
  const bundle = resolve(dir, id);
  ensure(relative(dir, bundle) === id, 'INVALID_BUNDLE', 'Invalid bundle identifier');
  mkdirSync(bundle, { mode: 0o700 }); // exclusive; no reuse or overwrite
  return bundle;
}
