#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main } from './adapter.mjs';
import { fixture, failure } from './fixture.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'sg-e2e-runner-'));
let count = 0;
async function check(name, fn) { await fn(); console.log(`ok ${++count} - ${name}`); }
function setup(name, mode = 'success', document = fixture(), version = '0.18.0') {
  const p = join(root, name); const bin = join(p, 'node_modules', 'e2e', 'dist', 'cli');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(p, 'node_modules', 'e2e', 'package.json'), JSON.stringify({ name: 'e2e', version, type: 'module' }));
  copyFileSync(join(here, 'fake-runner.mjs'), join(bin, 'bin.js'));
  writeFileSync(join(p, 'e2e.config.ts'), JSON.stringify({ mode, document }));
  writeFileSync(join(p, 'selected test.e2e.ts'), '// test double does not load test source');
  return p;
}
function args(p, timeout = 10000) {
  return ['run', '--project', p, '--config', 'e2e.config.ts', '--target', 'web',
    '--test', 'selected test.e2e.ts', '--timeout-ms', String(timeout)];
}
function json(file) { return JSON.parse(readFileSync(file, 'utf8')); }
function alive(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') return !readFileSync(`/proc/${pid}/stat`, 'utf8').includes(') Z ');
    return true;
  } catch { return false; }
}
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); }
  assert.fail('condition not reached');
}
try {
  if (process.platform === 'win32') {
    console.log('SKIPPED runner tests: POSIX execution only');
  } else {
    await check('launches installed runner with narrow argv and forced safety defaults', async () => {
      const p = setup('project with spaces;literal'); const r = await main(args(p)); assert.equal(r.exitCode, 0);
      const v = json(join(r.bundle, 'upstream', 'invocation.json'));
      assert.equal(v.telemetry, '1'); assert.equal(v.ci, '1');
      assert.ok(v.argv.includes('--strict-cache')); assert.equal(v.argv[v.argv.indexOf('--retries') + 1], '0');
      assert.equal(v.argv[v.argv.indexOf('--workers') + 1], '1');
      assert.ok(v.argv.includes(join(p, 'selected test.e2e.ts')));
      assert.equal(json(join(r.bundle, 'adapter-run.json')).mode, 'run');
    });
    await check('runner log retention is bounded without blocking the child', async () => {
      const r = await main(args(setup('noisy', 'noisy'))); assert.equal(r.exitCode, 0);
      assert.equal(readFileSync(join(r.bundle, 'runner.stdout.log')).length, 1024 * 1024);
      assert.equal(json(join(r.bundle, 'adapter-run.json')).execution.logs_truncated, true);
    });
    await check('missing report cannot reuse an old .e2e success', async () => {
      const p = setup('no-report', 'no-report'); mkdirSync(join(p, '.e2e'));
      writeFileSync(join(p, '.e2e', 'report.json'), JSON.stringify(fixture()));
      const r = await main(args(p)); assert.equal(r.exitCode, 2); assert.equal(existsSync(join(r.bundle, 'e2e-results.json')), false);
    });
    await check('process/report exit mismatch is infrastructure', async () => {
      const r = await main(args(setup('mismatch', 'mismatch')));
      assert.equal(r.exitCode, 2); assert.equal(r.error, 'PROCESS_REPORT_MISMATCH');
    });
    await check('stale report timestamps cannot pass', async () => {
      const r = await main(args(setup('stale', 'stale'))); assert.equal(r.exitCode, 2); assert.equal(r.error, 'STALE_REPORT');
    });
    await check('structured configuration failure maps to ShipGuard 3', async () => {
      const r = await main(args(setup('configuration', 'success', fixture('failed', failure('configuration', 'REPLAY_STALE')))));
      assert.equal(r.exitCode, 3);
    });
    await check('structured provider failure maps to ShipGuard 2', async () => {
      const r = await main(args(setup('provider', 'success', fixture('failed', failure('infrastructure', 'MODEL_UNAVAILABLE')))));
      assert.equal(r.exitCode, 2);
    });
    await check('wrong installed version is refused before runner execution', async () => {
      const r = await main(args(setup('version', 'success', fixture(), '0.99.0')));
      assert.equal(r.exitCode, 3); assert.equal(r.error, 'UNSUPPORTED_VERSION');
      assert.equal(existsSync(join(r.bundle, 'upstream')), false);
    });
    await check('absent runner is not installed automatically', async () => {
      const p = join(root, 'absent'); mkdirSync(p);
      const r = await main(args(p)); assert.equal(r.exitCode, 2); assert.equal(r.error, 'RUNNER_UNAVAILABLE');
      assert.equal(existsSync(join(p, 'node_modules')), false);
    });
    await check('timeout escalates and cleans the owned process group', async () => {
      const r = await main(args(setup('timeout', 'timeout'), 500));
      assert.equal(r.exitCode, 2); assert.equal(r.error, 'RUNNER_INCOMPLETE');
      const pids = json(join(r.bundle, 'upstream', 'pids.json'));
      await waitFor(() => !alive(pids.runner) && !alive(pids.child));
      assert.equal(existsSync(join(r.bundle, 'e2e-results.json')), false);
    });
    await check('SIGINT interrupts runner and leaves no success report', async () => {
      const p = setup('interrupt', 'timeout');
      const proc = spawn(process.execPath, [join(here, 'adapter.mjs'), ...args(p)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; proc.stdout.on('data', b => out += b); proc.stderr.resume();
      const exited = new Promise((resolve, reject) => { proc.once('exit', resolve); proc.once('error', reject); });
      let bundle;
      try {
        await waitFor(() => {
          const base = join(p, 'visual-tests', '_results', 'e2e');
          if (!existsSync(base)) return false;
          bundle = join(base, readdirSync(base)[0] ?? 'missing');
          return existsSync(join(bundle, 'upstream', 'pids.json'));
        });
        proc.kill('SIGINT'); assert.equal(await exited, 2);
        assert.equal(JSON.parse(out).error, 'RUNNER_INCOMPLETE');
        const pids = json(join(bundle, 'upstream', 'pids.json'));
        await waitFor(() => !alive(pids.runner) && !alive(pids.child));
      } finally { if (proc.exitCode === null) proc.kill('SIGKILL'); }
    });
  }
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`PASS ${count} runner checks (fake runner only)`);
