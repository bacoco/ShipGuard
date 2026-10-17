/** Launch only a preinstalled, pinned runner; no shell, installation, or provider discovery. */
import { spawn } from 'node:child_process';
import { openSync, closeSync, writeSync, realpathSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { ensure, SOURCE_VERSION } from './contract.mjs';
import { readRegular } from './artifacts.mjs';

function projectFile(project, name) {
  ensure(typeof name === 'string' && name.length > 0 && !name.startsWith('-'), 'INVALID_PATH', 'Expected a project file');
  const file = realpathSync(join(project, name));
  const rel = relative(project, file);
  ensure(rel && !rel.startsWith('..') && !isAbsolute(rel) && statSync(file).isFile(),
    'OUTSIDE_PROJECT', 'Configuration and selected tests must be regular project files');
  return file;
}
export async function launchRunner({ project, config, tests, target, timeoutMs }, bundle) {
  ensure(process.platform !== 'win32', 'UNSUPPORTED_HOST', 'Execution needs POSIX process-group cleanup; import works independently');
  const pkgRoot = join(project, 'node_modules', 'e2e');
  let pkg;
  try { pkg = JSON.parse(readRegular(join(pkgRoot, 'package.json'), 1024 * 1024).toString('utf8')); }
  catch { ensure(false, 'RUNNER_UNAVAILABLE', 'Install the pinned e2e runner in the target project first', 2); }
  ensure(pkg.name === 'e2e' && pkg.version === SOURCE_VERSION, 'UNSUPPORTED_VERSION', `Execution requires e2e ${SOURCE_VERSION}`);
  const entry = realpathSync(join(pkgRoot, 'dist', 'cli', 'bin.js'));
  const cfg = projectFile(project, config);
  const selected = tests.map(t => projectFile(project, t));
  ensure(selected.length > 0, 'EMPTY_SCOPE', 'Select at least one test file');
  ensure(typeof target === 'string' && /^[a-zA-Z0-9_-]+$/.test(target), 'INVALID_TARGET', 'Select exactly one target ID');
  ensure(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 3600000,
    'INVALID_TIMEOUT', 'Timeout must be between 100 and 3600000 milliseconds');
  const output = join(bundle, 'upstream');
  mkdirSync(output, { mode: 0o700 });
  const args = [entry, 'run', ...selected, '--config', cfg, '--target', target, '--output', output,
    '--workers', '1', '--retries', '0', '--reporter', 'json', '--strict-cache', '--trace=on'];
  const stdout = openSync(join(bundle, 'runner.stdout.log'), 'wx', 0o600);
  let stderr;
  try { stderr = openSync(join(bundle, 'runner.stderr.log'), 'wx', 0o600); }
  catch (e) { closeSync(stdout); throw e; }
  const startedAt = new Date().toISOString();
  try {
    return await new Promise(resolve => {
      const child = spawn(process.execPath, args, { cwd: project, shell: false, detached: true,
        env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let reason = null, hardTimer, finished = false;
      const signalGroup = signal => { if (child.pid) { try { process.kill(-child.pid, signal); } catch { /* already exited */ } } };
      const stop = why => {
        if (reason) return;
        reason = why; signalGroup('SIGTERM');
        hardTimer = setTimeout(() => signalGroup('SIGKILL'), 1000);
      };
      let logsTruncated = false;
      for (const [stream, fd] of [[child.stdout, stdout], [child.stderr, stderr]]) {
        let retained = 0;
        stream.on('data', bytes => {
          const take = Math.min(bytes.length, 1024 * 1024 - retained);
          try {
            let written = 0;
            while (written < take) written += writeSync(fd, bytes, written, take - written);
            retained += written;
            if (take < bytes.length) logsTruncated = true;
          } catch { stop('log-write-failed'); }
        });
      }
      const interrupted = () => stop('interrupted');
      process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted);
      const timer = setTimeout(() => stop('timeout'), timeoutMs);
      const finish = (exitCode, signal, failed) => {
        if (finished) return; finished = true;
        clearTimeout(timer); clearTimeout(hardTimer);
        process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted);
        // Reap only this runner's group, including surviving grandchildren.
        signalGroup('SIGKILL');
        resolve({ exitCode, signal, reason: reason ?? (failed ? 'spawn-failed' : signal ? 'signal' : null),
          logsTruncated, startedAt, finishedAt: new Date().toISOString(), output });
      };
      child.once('error', () => { reason ??= 'spawn-failed'; });
      child.once('exit', () => signalGroup('SIGKILL'));
      // Drain the bounded pipes before closing log descriptors.
      child.once('close', (code, signal) => finish(code, signal, false));
    });
  } finally { closeSync(stdout); closeSync(stderr); }
}
