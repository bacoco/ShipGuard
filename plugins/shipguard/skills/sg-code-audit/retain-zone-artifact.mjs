#!/usr/bin/env node
// Keep an ignored zone JSON visible to Git before the native agent finishes.
// Only its own linked-worktree index changes; no content is staged or committed.
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export function retainZoneArtifact(worktreeRoot, identity) {
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) {
    if (process.env[key]) throw new Error(`Refusing Git environment override: ${key}`);
  }
  for (const field of ['run_id', 'zone_id', 'agent_id']) {
    if (typeof identity[field] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(identity[field])) {
      throw new Error(`Invalid ${field}`);
    }
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(identity.base_sha || '')) throw new Error('Invalid base_sha');
  if (!Number.isSafeInteger(identity.round) || identity.round < 1) throw new Error('Invalid round');
  const root = realpathSync(worktreeRoot);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], {
      encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    if (result.error || result.status === null) throw new Error('Git could not run');
    return result;
  };
  const checkedGit = (...args) => {
    const result = git(...args);
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  if (realpathSync(checkedGit('rev-parse', '--show-toplevel')) !== root
      || realpathSync(checkedGit('rev-parse', '--absolute-git-dir'))
        === realpathSync(checkedGit('rev-parse', '--path-format=absolute', '--git-common-dir'))) {
    throw new Error('Retention requires the root of an isolated linked worktree, never the parent checkout');
  }
  const relativePath = `visual-tests/_results/runs/${identity.run_id}/zone-${identity.zone_id}-r${identity.round}-${identity.agent_id}.json`;
  const path = join(root, relativePath);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path) {
    throw new Error('Zone artifact must be a regular file inside its own worktree without symlinks');
  }
  const artifact = JSON.parse(readFileSync(path, 'utf8'));
  for (const field of ['run_id', 'base_sha', 'zone_id', 'round', 'agent_id']) {
    if (artifact?.[field] !== identity[field]) throw new Error(`Zone artifact identity mismatch: ${field}`);
  }
  if (!Array.isArray(artifact.bugs) || typeof artifact.zone !== 'string') throw new Error('Invalid zone artifact shape');
  if (checkedGit('ls-tree', '--name-only', 'HEAD', '--', relativePath)) {
    throw new Error('Refusing an artifact already committed at this path');
  }
  const staged = git('diff', '--cached', '--quiet', '--', relativePath);
  if (staged.status !== 0) throw new Error('Refusing an artifact with staged content');
  checkedGit('add', '--intent-to-add', '--force', '--', relativePath);
  if (!checkedGit('status', '--porcelain', '--untracked-files=all', '--', relativePath)
      || git('diff', '--cached', '--quiet', '--', relativePath).status !== 0) {
    throw new Error('Zone artifact retention could not be verified');
  }
  return { artifact: relativePath, retention: 'intent-to-add' };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url))) {
  try {
    const { values } = parseArgs({ options: {
      'run-id': { type: 'string' }, 'base-sha': { type: 'string' }, 'zone-id': { type: 'string' },
      round: { type: 'string' }, 'agent-id': { type: 'string' },
    } });
    if (!/^[1-9]\d*$/.test(values.round || '')) throw new Error('Invalid round');
    const result = retainZoneArtifact(process.cwd(), {
      run_id: values['run-id'], base_sha: values['base-sha'], zone_id: values['zone-id'],
      round: Number(values.round), agent_id: values['agent-id'],
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`Zone artifact retention failed: ${error.message}`);
    process.exitCode = 1;
  }
}
