#!/usr/bin/env node
// appserver-smoke-test.mjs — serve/stop lifecycle against a real tiny HTTP app
import { findFreePort, EXIT } from './shipguard.mjs';
import { execFileSync } from 'child_process';
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

console.log(fails === 0 ? 'appserver-smoke-test: ALL PASS' : `appserver-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
