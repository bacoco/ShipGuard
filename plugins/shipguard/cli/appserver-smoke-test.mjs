#!/usr/bin/env node
// appserver-smoke-test.mjs — serve/stop lifecycle against a real tiny HTTP app
import { findFreePort, startApp, stopApp, EXIT } from './shipguard.mjs';
import { execFileSync, spawn } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'shipguard.mjs');
let fails = 0;
const assert = (c, l) => { if (c) console.log(`  PASS ${l}`); else { console.error(`  FAIL ${l}`); fails++; } };

// findFreePort returns a usable port
const port = await findFreePort();
assert(Number.isInteger(port) && port > 0 && port < 65536, 'findFreePort: sane port');

// Fixture project: app.start is a one-line node HTTP server honoring {port}
const tmp = mkdtempSync(join(tmpdir(), 'sg-serve-'));
mkdirSync(join(tmp, 'visual-tests'), { recursive: true });
const APP = `node -e "require('http').createServer((q,s)=>{s.end('<html>ok</html>')}).listen({port},'127.0.0.1')"`;
writeFileSync(join(tmp, 'visual-tests', '_config.yaml'),
`version: 2
app:
  start: "${APP.replace(/"/g, '\\"')}"
  healthcheck: "/"
  startup_timeout_ms: 15000
`);

// serve: exits 0, prints base_url, writes .app.pid
const out = execFileSync('node', [CLI, 'serve'], { cwd: tmp, encoding: 'utf8' });
assert(/base_url: http:\/\/127\.0\.0\.1:\d+/.test(out), 'serve: prints derived base_url');
const pidfile = join(tmp, 'visual-tests', '_results', '.app.pid');
assert(existsSync(pidfile), 'serve: pidfile written');
const [pid, appPort, baseUrl] = readFileSync(pidfile, 'utf8').trim().split('\n');
assert(Number(pid) > 0 && Number(appPort) > 0 && baseUrl.startsWith('http://127.0.0.1:'), 'serve: pidfile has pid/port/url');

// the served app actually answers
const res = await fetch(baseUrl);
assert(res.ok && (await res.text()).includes('ok'), 'serve: app reachable');

// status reports it
const st = execFileSync('node', [CLI, 'status'], { cwd: tmp, encoding: 'utf8' });
assert(st.includes('app server: running'), 'status: app running');

// stop: kills it, removes pidfile
execFileSync('node', [CLI, 'stop'], { cwd: tmp, encoding: 'utf8' });
assert(!existsSync(pidfile), 'stop: pidfile removed');
let dead = false;
try { await fetch(baseUrl, { signal: AbortSignal.timeout(1500) }); } catch { dead = true; }
assert(dead, 'stop: app no longer reachable');

// serve with a command that never opens the port -> exit 2 (infra), no zombie pidfile
const tmp2 = mkdtempSync(join(tmpdir(), 'sg-serve2-'));
mkdirSync(join(tmp2, 'visual-tests'), { recursive: true });
writeFileSync(join(tmp2, 'visual-tests', '_config.yaml'),
`version: 2
app:
  start: "node -e \\"setTimeout(()=>{}, 60000)\\" -- {port}"
  healthcheck: "/"
  startup_timeout_ms: 3000
`);
let code = 0;
try { execFileSync('node', [CLI, 'serve'], { cwd: tmp2, encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code = e.status; }
assert(code === EXIT.INFRA, 'serve: healthcheck timeout -> exit 2');
assert(!existsSync(join(tmp2, 'visual-tests', '_results', '.app.pid')), 'serve: failed start leaves no pidfile');

// Invalid health URLs must be rejected before any detached child exists.
const invalidRoot = mkdtempSync(join(tmpdir(), 'sg-invalid-health-'));
const invalidMarker = join(invalidRoot, 'spawned-pid');
const invalidScript = join(invalidRoot, 'app.cjs');
writeFileSync(invalidScript, `require('fs').writeFileSync(${JSON.stringify(invalidMarker)}, String(process.pid)); setInterval(()=>{},1000);`);
let invalidError = null;
try { await startApp({ app: { start: `node "${invalidScript}" -- {port}`, healthcheck: 'http://[' } }, invalidRoot); }
catch (e) { invalidError = e; }
await new Promise(r => setTimeout(r, 150));
const leakedInvalid = existsSync(invalidMarker);
assert(!leakedInvalid, 'r1-z01-016: invalid health URL is validated before spawn');
if (leakedInvalid) { try { process.kill(Number(readFileSync(invalidMarker, 'utf8')), 'SIGKILL'); } catch {} }

// A server that ignores SIGTERM retains its pidfile and reports failure.
const stubbornRoot = mkdtempSync(join(tmpdir(), 'sg-stubborn-'));
mkdirSync(join(stubbornRoot, 'visual-tests', '_results'), { recursive: true });
const stubborn = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000);"],
  { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
await new Promise(r => stubborn.stdout.once('data', r));
const stubbornPid = join(stubbornRoot, 'visual-tests', '_results', '.app.pid');
writeFileSync(stubbornPid, `${stubborn.pid}\n80\nhttp://localhost\n`);
try {
  const stopped = await stopApp(stubbornRoot);
  assert(stopped.stopped === false && existsSync(stubbornPid) && !/server stopped/.test(stopped.message),
    'r1-z01-015: SIGTERM refusal keeps process tracking and cannot claim stopped');
} finally {
  try { process.kill(-stubborn.pid, 'SIGKILL'); } catch {}
  await new Promise(r => stubborn.once('close', r));
}

// The shell leader may exit while another member of its group survives.
const groupRoot = mkdtempSync(join(tmpdir(), 'sg-group-survivor-'));
mkdirSync(join(groupRoot, 'visual-tests', '_results'), { recursive: true });
const groupMarker = join(groupRoot, 'child-pid');
const groupScript = join(groupRoot, 'child.cjs');
writeFileSync(groupScript, `process.on('SIGTERM',()=>{}); require('fs').writeFileSync(${JSON.stringify(groupMarker)},String(process.pid)); setInterval(()=>{},1000);`);
const groupLeader = spawn('/bin/sh', ['-c', `node "${groupScript}" & wait`], { detached: true, stdio: 'ignore' });
while (!existsSync(groupMarker)) await new Promise(r => setTimeout(r, 20));
const groupPidfile = join(groupRoot, 'visual-tests', '_results', '.app.pid');
writeFileSync(groupPidfile, `${groupLeader.pid}\n80\nhttp://localhost\n`);
try {
  const groupStop = await stopApp(groupRoot);
  assert(groupStop.stopped === false && existsSync(groupPidfile),
    'r1-z01-015: a surviving process-group member keeps tracking after its leader exits');
} finally {
  try { process.kill(-groupLeader.pid, 'SIGKILL'); } catch {}
}

// run must surface failure to clean up the server it owns.
const cleanupRoot = mkdtempSync(join(tmpdir(), 'sg-cleanup-run-'));
mkdirSync(join(cleanupRoot, 'visual-tests', 'pages'), { recursive: true });
const cleanupScript = join(cleanupRoot, 'app.cjs');
writeFileSync(cleanupScript, "process.on('SIGTERM',()=>{}); require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.argv[2]),'127.0.0.1');");
writeFileSync(join(cleanupRoot, 'visual-tests', '_config.yaml'), `app:\n  start: 'node "${cleanupScript}" {port}'\n  startup_timeout_ms: 5000\nprofiles:\n  test:\n    checks: [page-load]\n`);
writeFileSync(join(cleanupRoot, 'visual-tests', 'pages', 'ok.yaml'), 'steps:\n  - action: wait\n    duration: 0ms\n');
writeFileSync(join(cleanupRoot, 'visual-tests', 'build-review.mjs'), 'process.exit(0);');
const cleanupBin = join(cleanupRoot, 'browser');
writeFileSync(cleanupBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
let cleanupCode = 0;
try { execFileSync('node', [CLI, 'run', '--profile=test'], { cwd: cleanupRoot, stdio: 'pipe',
  env: { ...process.env, SHIPGUARD_AGENT_BROWSER: cleanupBin } }); }
catch (e) { cleanupCode = e.status; }
const cleanupPidfile = join(cleanupRoot, 'visual-tests', '_results', '.app.pid');
try {
  const cleanupRun = JSON.parse(readFileSync(join(cleanupRoot, 'visual-tests', '_results', 'run.json'), 'utf8'));
  assert(cleanupCode === EXIT.INFRA && cleanupRun.exit_code === EXIT.INFRA && existsSync(cleanupPidfile),
    'r1-z01-015: run cleanup refusal overrides clean exit and retains its pidfile');
} finally {
  if (existsSync(cleanupPidfile)) {
    try { process.kill(-Number(readFileSync(cleanupPidfile, 'utf8').split('\n')[0]), 'SIGKILL'); } catch {}
  }
}

console.log(fails === 0 ? 'appserver-smoke-test: ALL PASS' : `appserver-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
