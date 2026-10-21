#!/usr/bin/env node
// CE-01: real POST navigation + untouched recorded YAML replay. The host's
// classification callback is executed verbatim with Chromium's actual history.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { actionsToYaml } from './actions-to-yaml.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'sg-record-navigation-'));
const exec = promisify(execFile);
const session = `sg-record-navigation-${process.pid}`;
const source = readFileSync(join(here, '../sg-record.mjs'), 'utf8');
const callback = source.match(/function recordNavigation\([^)]*\) \{[\s\S]*?\n    \}/)?.[0];
assert.ok(callback, 'actual host navigation callback is present');
const toolbar = readFileSync(join(here, 'recorder-toolbar.js'), 'utf8')
  .replace("'__CSS_PLACEHOLDER__'", JSON.stringify(readFileSync(join(here, 'recorder-toolbar.css'), 'utf8')));
const calls = [], events = [];
const server = createServer((req, res) => {
  if (req.url === '/event') {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { events.push(JSON.parse(body)); res.end('ok'); }); return;
  }
  calls.push({ method: req.method, path: req.url });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/reserve') {
    res.statusCode = req.method === 'POST' ? 200 : 405;
    res.end(req.method === 'POST' ? '<h1 id="confirmation">Reserved</h1>' : '<h1>GET is not a reservation</h1>');
  } else if (req.url === '/manual' || req.url === '/linked') {
    res.end('<h1>Destination</h1>');
  } else {
    res.end('<!doctype html><h1>Local reservation</h1><form action="/reserve" method="post"><button id="reserve">Reserve</button></form><button id="idle">Stay here</button><a id="link" href="/linked">Follow link</a>');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const ab = async (...args) => (await exec('agent-browser', ['--session', session, ...args], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout;
const evaluate = async code => JSON.parse(await ab('--json', 'eval', '-b', Buffer.from(code).toString('base64'))).data.result;
let socket, sequence = 0;
const pending = new Map();
async function cdp(method, params = {}, sessionId) {
  const id = ++sequence;
  const reply = new Promise((done, fail) => {
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP timeout: ${method}`)); }, 5000);
    pending.set(id, message => { clearTimeout(timer); message.error ? fail(new Error(message.error.message)) : done(message.result); });
  });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return reply;
}
let pageSession;
const historyEntry = async () => {
  const history = await cdp('Page.getNavigationHistory', {}, pageSession);
  return history.entries[history.currentIndex];
};
function hostFor(steps) {
  const host = vm.createContext({ console: { log() {} }, stopped: false, paused: false, allSteps: [] });
  vm.runInContext(source.slice(source.indexOf('function normalizeUrl'), source.indexOf('function stepDetail'))
    + '\nfunction stepDetail(){return "";}\n' + callback + '\nglobalThis.api={recordStep,recordNavigation};', host);
  for (const step of steps) host.api.recordStep(step);
  return host;
}
let failures = 0;
const checks = [];
function check(label, fn) {
  try { fn(); checks.push({ label, passed: true }); console.log(`PASS ${label}`); }
  catch (error) { failures++; checks.push({ label, passed: false, error: error.message }); console.error(`FAIL ${label}: ${error.message}`); }
}
console.log(`Artifacts: ${root}`);
try {
  await ab('open', url);
  socket = new WebSocket((await ab('get', 'cdp-url')).trim());
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  socket.onmessage = event => { const m = JSON.parse(event.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const target = (await cdp('Target.getTargets')).targetInfos.find(t => t.type === 'page' && t.url.startsWith(url));
  pageSession = (await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  await evaluate(`sessionStorage.clear();window.__sgRecorderState={steps:[{type:'open',url:${JSON.stringify(url)}}],paused:false,startTime:Date.now()};window.__sgBridge=s=>navigator.sendBeacon('/event',s);${toolbar}`);
  await ab('click', '#reserve');
  await ab('wait', '#confirmation');
  await ab('screenshot', join(root, 'post-capture.png'));
  const entry = await historyEntry();
  const captured = events.filter(event => event.type === 'step').map(event => event.step);
  const host = hostFor([{ type: 'open', url }, ...captured]);
  host.api.recordNavigation(entry.url, entry.transitionType);
  const steps = Array.from(host.allSteps);
  check('POST capture reaches the confirmation', () => assert.equal(entry.transitionType, 'form_submit'));
  check('POST response does not become another open', () => assert.deepEqual(steps.map(s => s.type), ['open', 'click']));
  const manifest = actionsToYaml(steps, { name: 'navigation', baseUrl: url });
  const tests = join(root, 'visual-tests'); mkdirSync(join(tests, 'manifests'), { recursive: true });
  const manifestPath = join(tests, 'manifests/recorded-navigation.yaml');
  writeFileSync(manifestPath, manifest);
  writeFileSync(join(tests, '_config.yaml'), `base_url: "${url}"\nprofiles:\n  test:\n    checks: [page-load]\n`);
  writeFileSync(join(tests, 'build-review.mjs'), 'process.exit(0);\n');
  calls.length = 0;
  let exit = 0, output = '';
  try { const run = await exec(process.execPath, [resolve(here, '../../../cli/shipguard.mjs'), 'run', '--profile=test', '--no-crawl'], { cwd: root, timeout: 30000 }); output = run.stdout + run.stderr; }
  catch (error) { exit = error.code; output = (error.stdout || '') + (error.stderr || ''); }
  writeFileSync(join(root, 'replay.log'), output);
  const replayCalls = [...calls];
  const result = JSON.parse(readFileSync(join(tests, '_results/visual-results.json'), 'utf8')).tests[0];
  check('replay preserves exactly one POST and no GET of its response', () => assert.deepEqual(replayCalls.filter(c => c.path === '/reserve'), [{ method: 'POST', path: '/reserve' }]));
  check('unedited emitted YAML replays successfully', () => { assert.equal(exit, 0); assert.equal(result.status, 'PASS'); assert.equal(readFileSync(manifestPath, 'utf8'), manifest); });

  await ab('open', url);
  await ab('click', '#idle');
  await ab('open', url + '/manual');
  const manualEntry = await historyEntry();
  const manualHost = hostFor([{ type: 'open', url }, { type: 'click', text: 'Stay here' }]);
  manualHost.api.recordNavigation(manualEntry.url, manualEntry.transitionType);
  check('manual address navigation after an unrelated click remains open', () => assert.equal(manualHost.allSteps.at(-1).url, url + '/manual'));
  await ab('open', url);
  await ab('click', '#link'); await ab('wait', '--url', '**/linked');
  const linkEntry = await historyEntry();
  const linkHost = hostFor([{ type: 'open', url }, { type: 'click', text: 'Follow link' }]);
  linkHost.api.recordNavigation(linkEntry.url, linkEntry.transitionType);
  check('recorded link navigation does not become another open', () => assert.deepEqual(Array.from(linkHost.allSteps, s => s.type), ['open', 'click']));
  writeFileSync(join(root, 'evidence.json'), JSON.stringify({ checks, entry, captured, hostSteps: steps, manifest, replayCalls, result, manualEntry, linkEntry }, null, 2));
} finally {
  socket?.close();
  try { await ab('close'); } finally { await new Promise(done => server.close(done)); }
}
process.exitCode = failures ? 1 : 0;
