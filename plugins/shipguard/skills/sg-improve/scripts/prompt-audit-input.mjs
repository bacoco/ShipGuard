// Explicit, bounded source reads. No crawling, import resolution, commands, or network.
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

export const MAX_FILE_BYTES = 128 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const hash = value => createHash('sha256').update(value).digest('hex');
export const textLines = text => text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);

export function requireObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected object`);
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label}: unknown field`);
}

export function requireText(value, label, maximum = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) {
    throw new Error(`${label}: expected bounded nonempty text`);
  }
  return value;
}

export function sourcePath(path) {
  if (typeof path !== 'string' || path.length > 512 || !/^[A-Za-z0-9_. -]+(?:\/[A-Za-z0-9_. -]+)*$/.test(path)) {
    throw new Error('source path: expected portable repository-relative path');
  }
  const parts = path.split('/');
  if (parts.some(part => part === '.' || part === '..' || part.trim() !== part)) throw new Error('source path: traversal or ambiguous segment');
  return path;
}

function excluded(path) {
  const parts = path.toLowerCase().split('/');
  return parts.some(part => ['.git', 'node_modules', '.ssh', '.aws', '.venv', 'venv', 'dist', 'build'].includes(part))
    || parts.some(part => /^(?:\.env(?:\.|$)|\.?mcp(?:\.|$)|\.?credentials?(?:\.|$)|secrets?(?:\.|$)|settings(?:\.|$))/.test(part))
    || !['.md', '.mjs', '.js', '.cjs', '.ts', '.yaml', '.yml', '.json'].includes(extname(path).toLowerCase());
}

export function protectedSurface(path) {
  return /^(?:AGENTS|CLAUDE)(?:\.local)?\.md$/i.test(basename(path))
    || /(?:^|\/)(?:hooks|sg-mission-lock|grill-goal)(?:\/|$)/i.test(path);
}

export function readSource(root, path) {
  sourcePath(path);
  if (excluded(path)) throw new Error('excluded-sensitive-or-unsupported-path');
  let current = root;
  const parts = path.split('/');
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('symlink-not-read');
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('not-a-directory');
    if (index === parts.length - 1 && !stat.isFile()) throw new Error('not-a-regular-file');
  }
  const fd = openSync(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1) throw new Error('nonregular-or-hardlinked-file');
    if (before.size > MAX_FILE_BYTES) throw new Error('file-size-limit');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(fd);
    if (size > MAX_FILE_BYTES) throw new Error('file-size-limit');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || size !== after.size) {
      throw new Error('source-changed-during-read');
    }
    const bytes = buffer.subarray(0, size);
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (content.includes('\0')) throw new Error('binary-source');
    return { path, status: 'read', sha256: hash(bytes), bytes: size, lines: textLines(content).length,
      protected: protectedSurface(path), visibility: 'source-only; runtime loading not observed', content };
  } finally { closeSync(fd); }
}

export function inventory(request) {
  requireObject(request, ['operation', 'root', 'files', 'target', 'base_sha', 'prompt_hash', 'review'], 'request');
  if (!['inventory', 'review'].includes(request.operation)) throw new Error('operation: expected inventory or review');
  if (request.operation === 'inventory' && request.review !== undefined) throw new Error('inventory cannot include review');
  requireText(request.root, 'root', 4096);
  const root = realpathSync(resolve(request.root));
  if (!lstatSync(root).isDirectory()) throw new Error('root: expected directory');
  if (!Array.isArray(request.files) || !request.files.length || request.files.length > 32) throw new Error('files: select 1..32 explicit files');
  const paths = request.files.map(sourcePath).sort();
  if (new Set(paths).size !== paths.length) throw new Error('files: duplicate path');
  const inputTarget = request.target ?? {};
  requireObject(inputTarget, ['model', 'host', 'effort'], 'target');
  const target = Object.fromEntries(['model', 'host', 'effort'].map(key => [key, requireText(inputTarget[key] ?? 'unknown', `target.${key}`, 200).trim()]));
  for (const key of ['base_sha', 'prompt_hash']) {
    const value = request[key];
    const pattern = key === 'base_sha' ? /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/ : /^[a-f0-9]{64}$/;
    if (value != null && (typeof value !== 'string' || !pattern.test(value))) throw new Error(`${key}: invalid hash`);
  }
  let total = 0;
  const files = paths.map(path => {
    try {
      if (total >= MAX_TOTAL_BYTES) throw new Error('total-size-limit');
      const source = readSource(root, path);
      if (total + source.bytes > MAX_TOTAL_BYTES) throw new Error('total-size-limit');
      total += source.bytes;
      return source;
    } catch (error) {
      const known = ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'ELOOP'];
      const reason = known.includes(error.code) ? error.code : (error.code ? 'read-error' : error.message);
      return { path, status: 'not-read', reason };
    }
  });
  const identity = { target, base_sha: request.base_sha ?? null, prompt_hash: request.prompt_hash ?? null,
    files: files.map(({ path, status, sha256, reason }) => ({ path, status, sha256, reason })) };
  return { root, receipt: { schema_version: 1, operation: 'inventory', status: files.every(f => f.status === 'read') ? 'unreviewed' : 'partial',
    inventory_id: hash(JSON.stringify(identity)), target, base_sha: identity.base_sha, prompt_hash: identity.prompt_hash,
    identity_provenance: 'target/base_sha/prompt_hash supplied by caller; inventory_id hashes selected sources and these declarations',
    semantic_verification: 'not verified', authority_effect: 'none', files } };
}
