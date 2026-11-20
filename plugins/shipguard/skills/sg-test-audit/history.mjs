#!/usr/bin/env node
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedGit } from './inventory.mjs';
import { isSensitivePath } from './paths.mjs';

const metadataPath = path => path.split(/[\\/]/).some(part => ['.git', '.hg', '.svn'].includes(part.toLowerCase()));

async function checkLocation(project, path) {
  const root = await realpath(resolve(project));
  if (isSensitivePath(root) || metadataPath(root) || isSensitivePath(path) || metadataPath(path)) {
    throw new Error('History lookup excludes private files and version-control metadata.');
  }
  if (!path || path.includes('\0') || isAbsolute(path) || win32.isAbsolute(path) ||
      path.split('/').some(part => !part || part === '.' || part === '..') || path.split('\\').includes('..')) {
    throw new Error('Supply one reviewed repository-relative file path.');
  }
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('History lookup excludes symbolic links.');
    } catch (error) {
      if (error.code === 'ENOENT') break; // a safe path can exist only at an earlier revision
      throw error;
    }
  }
  return root;
}

export async function lookupHistory(project, path, excerpt, { revision = 'HEAD' } = {}) {
  if (typeof excerpt !== 'string' || !excerpt.trim() || excerpt.includes('\0')) {
    throw new Error('Supply a non-empty, non-sensitive text excerpt.');
  }
  if (process.platform === 'win32') path = path.replaceAll('\\', '/');
  path = path.replace(/^(?:\.\/)+/, '');
  const root = await checkLocation(project, path);
  const commitRef = (await checkedGit(root, ['rev-parse', '--verify', '--end-of-options', revision + '^{commit}'])).trim();
  const shallow = (await checkedGit(root, ['rev-parse', '--is-shallow-repository'])).trim() === 'true';
  const result = { path, revision: commitRef, shallow, status: 'not_tracked_at_revision', commit: null };
  // --literal-pathspecs protects filenames containing Git wildcard/magic syntax.
  const entry = await checkedGit(root, ['--literal-pathspecs', 'ls-tree', '-z', commitRef, '--', path]);
  if (!entry) return result;
  const records = entry.split('\0').filter(Boolean);
  if (records.length !== 1 || records[0].slice(records[0].indexOf('\t') + 1) !== path ||
      !/^100(?:644|755) blob /.test(records[0])) throw new Error('Select a regular tracked file.');

  // Equivalent to taking the last hash of git log -S. Never print a patch or
  // follow another historic filename without separately reviewing its path.
  const changes = await checkedGit(root, ['--literal-pathspecs', 'log', '--no-show-signature', '--no-follow', '--no-ext-diff', '--no-textconv', '--no-renames',
    '--format=%H', '-S' + excerpt, commitRef, '--', path]);
  const hash = changes.trim().split('\n').at(-1);
  if (!hash) return { ...result, status: 'no_match' };

  const metadata = await checkedGit(root, ['show', '-s', '--no-notes', '--no-show-signature', '--date=short',
    '--format=%h%x00%ad%x00%an%x00%s%x00%(trailers:key=Co-Authored-By,only=true)', hash, '--']);
  const [short_hash, date, author, subject, trailers] = metadata.trimEnd().split('\0');
  return { ...result, status: 'matched', commit: {
    hash, short_hash, date, author, subject, coauthors: trailers.split('\n').filter(Boolean),
  }, evidence: 'Oldest available text-count change on this path; commit credits alone do not establish who wrote or requested this rule.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [project, path, option, ...extra] = process.argv.slice(2);
    if (!project || !path || extra.length || (option !== undefined && !/^--revision=.+$/.test(option))) {
      throw new Error('Usage: history.mjs PROJECT RELPATH [--revision=REV] < excerpt');
    }
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const excerpt = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
    console.log(JSON.stringify(await lookupHistory(project, path, excerpt, { revision: option?.slice(11) }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
