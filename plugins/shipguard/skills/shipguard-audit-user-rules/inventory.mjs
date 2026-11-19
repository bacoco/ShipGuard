import { spawn } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { devNull } from 'node:os';
import { excludedReason } from './paths.mjs';

function git(root, args) {
  // Do not inherit a caller's alternate Git worktree/index, run its filesystem
  // monitor, or fetch blobs when examining a partial checkout.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
  });
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
      env, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', code => resolve({ code, data: Buffer.concat(chunks).toString('utf8') }));
  });
}

export async function checkedGit(root, args) {
  const result = await git(root, args);
  if (result.code !== 0) throw new Error('Cannot inspect Git metadata (' + args[0] + ').');
  return result.data;
}

async function gitMarker(directory) {
  try {
    await lstat(join(directory, '.git'));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function inWorktree(root) {
  for (let directory = root; ; directory = dirname(directory)) {
    if (await gitMarker(directory)) return true;
    if (directory === dirname(directory)) return false;
  }
}

function splitPaths(text) {
  return text.split('\0').filter(Boolean);
}

// Only inspect names and filesystem metadata here. The scanner controls which
// regular files it opens later. Include nonignored untracked files in Git mode.
export async function inventory(root, diff, coverage) {
  const paths = new Set();
  const nested = new Set();

  function excluded(reason) {
    coverage.excluded[reason] = (coverage.excluded[reason] ?? 0) + 1;
  }

  async function visit(path, recurse) {
    const reason = excludedReason(path);
    if (reason) { excluded(reason); return; }
    const parts = path.split('/');
    try {
      for (let i = 0; i < parts.length; i++) {
        const rel = parts.slice(0, i + 1).join('/');
        const absolute = join(root, rel);
        const info = await lstat(absolute);
        if (info.isSymbolicLink()) { excluded('symlink'); return; }
        if (info.isDirectory()) {
          if (await gitMarker(absolute)) { nested.add(rel); return; }
          if (i === parts.length - 1) {
            if (recurse) await walk(rel);
            else nested.add(rel); // e.g. a tracked, uninitialized submodule
          }
        } else if (info.isFile() && i === parts.length - 1) {
          paths.add(rel);
        } else {
          excluded('non_regular');
          return;
        }
      }
    } catch (error) {
      coverage.unexamined.push({ path, reason: error.code || 'unavailable' });
    }
  }

  async function walk(parent) {
    const entries = await readdir(join(root, parent));
    for (const entry of entries.sort()) {
      await visit(parent ? parent + '/' + entry : entry, true);
    }
  }

  let mode = 'filesystem', revision = null, base = null, baseFiles = null;
  if (await inWorktree(root)) {
    mode = 'git';
    const head = await git(root, ['rev-parse', '--verify', 'HEAD']);
    revision = head.code === 0 ? head.data.trim() : null;
    if (diff !== undefined) {
      if (!revision || !diff) throw new Error('A diff needs a baseline and a current Git commit.');
      const requested = (await checkedGit(root, ['rev-parse', '--verify', '--end-of-options', diff + '^{commit}'])).trim();
      base = (await checkedGit(root, ['merge-base', 'HEAD', requested])).trim();
      const listing = await checkedGit(root, ['ls-tree', '-r', '-z', base, '--', '.']);
      baseFiles = new Map();
      for (const record of splitPaths(listing)) {
        const tab = record.indexOf('\t');
        baseFiles.set(record.slice(tab + 1), record.slice(0, tab).split(' ')[2]);
      }
    }
    const names = await checkedGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.']);
    for (const name of new Set(splitPaths(names))) await visit(name.replace(/\/$/, ''), false);
    if (baseFiles) {
      const seen = new Set(splitPaths(names).map(name => name.replace(/\/$/, '')));
      for (const path of baseFiles.keys()) {
        if (!seen.has(path) && !excludedReason(path)) coverage.unexamined.push({ path, reason: 'absent_from_current_inventory' });
      }
    }
  } else {
    if (diff !== undefined) throw new Error('A diff requires a Git project. Omit --diff for a complete scan.');
    await walk('');
  }
  coverage.nested_projects = [...nested].sort();
  return { paths: [...paths].sort(), mode, revision, base, baseFiles };
}
