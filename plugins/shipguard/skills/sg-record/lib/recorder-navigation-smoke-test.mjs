#!/usr/bin/env node
// CE-01/CE-02/CE-03: real POST and manual history navigation + untouched YAML replay. The host's
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
const currentSource = readFileSync(join(here, '../sg-record.mjs'), 'utf8');
const source = process.argv.includes('--baseline')
  ? (await exec('git', ['show', 'd6c8e1e8:plugins/shipguard/skills/sg-record/sg-record.mjs'], { cwd: here })).stdout
  : currentSource;
const observer = currentSource.match(/function observeNavigationIntent\(\) \{[\s\S]*?\n    \}/)?.[0];
const note = source.match(/function noteNavigation\([^)]*\) \{[\s\S]*?\n    \}/)?.[0]
  || 'function noteNavigation() {}';
assert.ok(observer, 'actual browser navigation observer is present');
const callback = source.match(/function recordNavigation\([^)]*\) \{[\s\S]*?\n    \}/)?.[0];
assert.ok(callback, 'actual host navigation callback is present');
const queue = source.match(/function queueNavigation\([^)]*\) \{[\s\S]*?\n    \}/)?.[0];
assert.ok(queue, 'actual host navigation queue is present');
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
    res.setHeader('Cache-Control', 'max-age=3600');
    res.end(req.method === 'POST' ? '<h1 id="confirmation">Reserved</h1><a id="next" href="/two">Next</a>' : '<h1>GET is not a reservation</h1>');
  } else if (req.url === '/manual' || req.url === '/linked') {
    res.end('<h1>Destination</h1>');
  } else if (req.url === '/one') {
    res.setHeader('Cache-Control', 'no-store');
    res.end('<h1 id="one">One</h1><a id="next" href="/two">Next</a><button id="idle">Idle</button><button id="appforward" onclick="history.forward()">Advance in application</button>');
  } else if (req.url === '/two') {
    res.setHeader('Cache-Control', 'no-store');
    res.end('<h1 id="two">Two</h1><button id="idle">Idle</button><button id="appback" onclick="history.back()">Return in application</button>');
  } else {
    res.end('<!doctype html><h1>Local reservation</h1><form action="/reserve" method="post"><button id="reserve">Reserve</button></form><button id="idle">Stay here</button><a id="link" href="/linked">Follow link</a><a id="first" href="/one">First</a>');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const ab = async (...args) => (await exec('agent-browser', ['--session', session, ...args], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout;
const evaluate = async code => JSON.parse(await ab('--json', 'eval', '-b', Buffer.from(code).toString('base64'))).data.result;
let socket, sequence = 0;
const pending = new Map();
const pageEvents = [], navigationIntents = [];
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
  const host = vm.createContext({ console, stopped: false, paused: false, allSteps: [], navigationTasks: new Map(), navigationEntries: new WeakMap(), navigationIntents: new WeakMap(), navigationError: null });
  host.frame = {}; host.page = { isClosed: () => false, mainFrame: () => host.frame };
  host.observations = [];
  host.context = { newCDPSession: async () => ({ send: async () => host.history, detach: async () => {} }) };
  vm.runInContext(source.slice(source.indexOf('function normalizeUrl'), source.indexOf('function stepDetail'))
    + '\nfunction stepDetail(){return "";}\n' + note + '\n' + callback + '\n' + queue + '\nglobalThis.api={recordStep,queueNavigation,noteNavigation};', host);
  for (const step of steps) host.api.recordStep(step);
  return host;
}
async function observe(host) {
  host.history = await cdp('Page.getNavigationHistory', {}, pageSession);
  const intents = navigationIntents.splice(0);
  for (const intent of intents) host.api.noteNavigation({page:host.page,frame:host.frame}, intent);
  host.observations.push({history:host.history,intents});
  host.api.queueNavigation(host.page);
  await host.navigationTasks.get(host.page);
  if (host.navigationError) throw host.navigationError;
  return host.history.entries[host.history.currentIndex];
}
// agent-browser 0.39.1 back/forward execute history.back()/forward() in the
// page. Use Chromium's browser-side command for the manual-navigation witness.
async function manualTraverse(delta) {
  const history = await cdp('Page.getNavigationHistory', {}, pageSession);
  await cdp('Page.navigateToHistoryEntry', {entryId:history.entries[history.currentIndex + delta].id}, pageSession);
}
let failures = 0;
const checks = [];
function check(label, fn) {
  try { fn(); checks.push({ label, passed: true }); console.log(`PASS ${label}`); }
  catch (error) { failures++; checks.push({ label, passed: false, error: error.message }); console.error(`FAIL ${label}: ${error.message}`); }
}
console.log(`Artifacts: ${root}`);
try {
  // Reproduce Astra's document-load path deterministically. A bfcache restore
  // does not emit DOMContentLoaded, which is the host callback under test.
  await ab('--args', '--disable-features=BackForwardCache', 'open', url);
  socket = new WebSocket((await ab('get', 'cdp-url')).trim());
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  socket.onmessage = event => { const m = JSON.parse(event.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) { pageEvents.push(m.method); if (m.method === 'Runtime.bindingCalled' && m.params.name === '__sgNavigation') navigationIntents.push(JSON.parse(m.params.payload)); } };
  const target = (await cdp('Target.getTargets')).targetInfos.find(t => t.type === 'page' && t.url.startsWith(url));
  pageSession = (await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  await cdp('Page.enable', {}, pageSession);
  await cdp('Runtime.enable', {}, pageSession);
  await cdp('Runtime.addBinding', {name:'__sgNavigation'}, pageSession);
  const observeScript = `(() => { const send = window.__sgNavigation; window.__sgNavigation = intent => { send(JSON.stringify(intent)); return Promise.resolve(); }; (${observer})(); })()`;
  await cdp('Page.addScriptToEvaluateOnNewDocument', {source:observeScript}, pageSession);
  await evaluate(observeScript);
  await evaluate(`sessionStorage.clear();window.__sgRecorderState={steps:[{type:'open',url:${JSON.stringify(url)}}],paused:false,startTime:Date.now()};window.__sgBridge=s=>navigator.sendBeacon('/event',s);${toolbar}`);
  await ab('click', '#reserve');
  await ab('wait', '#confirmation');
  await ab('screenshot', join(root, 'post-capture.png'));
  const entry = await historyEntry();
  const captured = events.filter(event => event.type === 'step').map(event => event.step);
  const host = hostFor([{ type: 'open', url }, ...captured]);
  await observe(host);
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
  try { const run = await exec(process.execPath, [resolve(here, '../../../cli/shipguard.mjs'), 'run', '--profile=test', '--no-crawl'], { cwd: root, timeout: 90000 }); output = run.stdout + run.stderr; }
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
  await observe(manualHost);
  check('manual address navigation after an unrelated click remains open', () => assert.equal(manualHost.allSteps.at(-1).url, url + '/manual'));
  await ab('open', url);
  await ab('click', '#link'); await ab('wait', '--url', '**/linked');
  const linkEntry = await historyEntry();
  const linkHost = hostFor([{ type: 'open', url }, { type: 'click', text: 'Follow link' }]);
  await observe(linkHost);
  check('recorded link navigation does not become another open', () => assert.deepEqual(Array.from(linkHost.allSteps, s => s.type), ['open', 'click']));

  // Same real route as Astra's CE-02 witness; feed every visited entry to the
  // actual host callback, including destinations suppressed after link clicks.
  await ab('open', url);
  const historyHost = hostFor([{ type: 'open', url }]);
  await observe(historyHost);
  await ab('click', '#first'); await ab('wait', '--url', '**/one');
  historyHost.api.recordStep({ type: 'click', text: 'First' });
  const oneEntry = await observe(historyHost);
  await ab('click', '#next'); await ab('wait', '--url', '**/two');
  historyHost.api.recordStep({ type: 'click', text: 'Next' });
  const twoEntry = await observe(historyHost);
  await ab('click', '#idle'); historyHost.api.recordStep({ type: 'click', text: 'Idle' });
  pageEvents.length = 0;
  await manualTraverse(-1); await ab('wait', '--url', '**/one');
  const backEntry = await historyEntry(), backEvents = [...pageEvents];
  await observe(historyHost);
  const backSteps = Array.from(historyHost.allSteps);
  await ab('screenshot', join(root, 'manual-back.png'));
  check('CE-02 manual back to a visited link entry is preserved', () => {
    assert.equal(backEntry.id, oneEntry.id); assert.equal(backEntry.transitionType, 'link');
    assert.ok(backEvents.includes('Page.domContentEventFired'));
    assert.equal(backSteps.at(-1).type, 'back'); assert.equal(backEntry.url, url + '/one');
  });
  await ab('click', '#idle'); historyHost.api.recordStep({ type: 'click', text: 'Idle' });
  await manualTraverse(1); await ab('wait', '--url', '**/two');
  const forwardEntry = await observe(historyHost);
  const forwardSteps = Array.from(historyHost.allSteps);
  check('CE-02 manual forward to a visited link entry is preserved', () => {
    assert.equal(forwardEntry.id, twoEntry.id); assert.equal(forwardEntry.transitionType, 'link');
    assert.equal(forwardSteps.at(-1).type, 'forward'); assert.equal(forwardEntry.url, url + '/two');
  });

  // Actual POST -> link -> Idle -> Back -> Forward -> Back. The browser can
  // restore its cached POST response; replay must use history, never GET it.
  await ab('open', url);
  const postHost = hostFor([{ type: 'open', url }]); await observe(postHost);
  const inject = async () => {
    events.length = 0;
    await evaluate(`sessionStorage.clear();window.__sgRecorderState=${JSON.stringify({steps:Array.from(postHost.allSteps),paused:false,startTime:Date.now()})};window.__sgBridge=s=>navigator.sendBeacon('/event',s);${toolbar}`);
  };
  const collect = () => { for (const event of events.splice(0)) if (event.type === 'step') postHost.api.recordStep(event.step); };
  await inject(); await ab('click', '#reserve'); await ab('wait', '#confirmation'); collect();
  const postEntry = await observe(postHost);
  await inject(); await ab('click', '#next'); await ab('wait', '--url', '**/two'); collect(); await observe(postHost);
  await inject(); await ab('click', '#idle'); collect();
  await manualTraverse(-1); await ab('wait', '#confirmation'); const postBackEntry = await observe(postHost);
  await manualTraverse(1); await ab('wait', '--url', '**/two'); await observe(postHost);
  await manualTraverse(-1); await ab('wait', '#confirmation'); await observe(postHost);
  const postSteps = Array.from(postHost.allSteps);
  check('POST history records Back/Forward without opening the response URL', () => {
    assert.equal(postBackEntry.id, postEntry.id); assert.equal(postBackEntry.transitionType, 'form_submit');
    assert.deepEqual(postSteps.map(s => s.type), ['open','click','click','click','back','forward','back']);
  });
  const historyManifest = actionsToYaml(postSteps, {name:'post-history',baseUrl:url});
  // This history witness declares settling waits after the two document-changing
  // clicks, plus a destination assertion. Keep the converted history actions
  // untouched; the separate CE-01 witness above still replays raw recorder YAML.
  const historyReplayManifest = historyManifest
    .replace(/(    target: "(?:Reserve|Next)"\n)/g, '$1  - action: wait\n    duration: 500ms\n')
    .replace('  - action: screenshot', '  - action: assert_text\n    expected: "Reserved"\n  - action: screenshot');
  writeFileSync(join(root, 'post-history-recorded.yaml'), historyManifest);
  writeFileSync(manifestPath, historyReplayManifest);
  calls.length = 0;
  let historyExit = 0, historyOutput = '';
  try { const run = await exec(process.execPath, [resolve(here, '../../../cli/shipguard.mjs'), 'run', '--profile=test', '--no-crawl'], { cwd: root, timeout: 90000 }); historyOutput = run.stdout + run.stderr; }
  catch (error) { historyExit = error.code; historyOutput = (error.stdout || '') + (error.stderr || ''); }
  writeFileSync(join(root, 'history-replay.log'), historyOutput);
  const historyCalls = [...calls];
  const historyResult = JSON.parse(readFileSync(join(tests, '_results/visual-results.json'), 'utf8')).tests[0];
  check('POST history replays to Reserved with one POST and zero GET of the response', () => {
    assert.equal(historyExit, 0); assert.equal(historyResult.status, 'PASS');
    assert.equal(readFileSync(manifestPath, 'utf8'), historyReplayManifest);
    assert.deepEqual(historyCalls.filter(c => c.path === '/reserve'), [{method:'POST',path:'/reserve'}]);
  });
  // CE-03: a captured page button already traverses history. Exercise Back,
  // Forward, and then a manual Back after an unrelated click in the same tab.
  await ab('open', url);
  const appHost = hostFor([{type:'open',url}]); await observe(appHost);
  const injectApp = async () => {
    events.length = 0;
    await evaluate(`sessionStorage.clear();window.__sgRecorderState=${JSON.stringify({steps:Array.from(appHost.allSteps),paused:false,startTime:Date.now()})};window.__sgBridge=s=>navigator.sendBeacon('/event',s);${toolbar}`);
  };
  const appClick = async (selector, destination) => {
    await injectApp(); await ab('click', selector); await ab('wait', destination);
    for (let i=0; i<40 && !events.some(e=>e.type==='step'); i++) await new Promise(done=>setTimeout(done,25));
    const captured = events.splice(0).filter(e=>e.type==='step');
    assert.ok(captured.length, 'real toolbar captured '+selector);
    for (const event of captured) appHost.api.recordStep(event.step);
    await observe(appHost);
  };
  await appClick('#first', '#one'); await appClick('#next', '#two');
  await appClick('#appback', '#one');
  const appBackSteps = Array.from(appHost.allSteps);
  check('CE-03 page Back is represented only by its recorded click', () => {
    assert.equal(appHost.observations.at(-1).intents.at(-1).scriptedTraversal, true);
    assert.deepEqual(appBackSteps.map(s=>s.type), ['open','click','click','click']);
  });
  const appManifest = actionsToYaml(appBackSteps, {name:'application-back',baseUrl:url});
  const appReplayManifest = appManifest
    .replace(/(    target: "(?:First|Next|Return in application)"\n)/g, '$1  - action: wait\n    duration: 500ms\n')
    .replace('  - action: screenshot', '  - action: assert_text\n    expected: "One"\n  - action: screenshot');
  writeFileSync(join(root, 'application-back-recorded.yaml'), appManifest);
  writeFileSync(manifestPath, appReplayManifest);
  calls.length = 0;
  let appExit = 0, appOutput = '';
  try { const run = await exec(process.execPath, [resolve(here, '../../../cli/shipguard.mjs'), 'run', '--profile=test', '--no-crawl'], {cwd:root,timeout:90000}); appOutput=run.stdout+run.stderr; }
  catch (error) { appExit=error.code; appOutput=(error.stdout||'')+(error.stderr||''); }
  writeFileSync(join(root,'application-back-replay.log'),appOutput);
  const appCalls=[...calls];
  const appResult=JSON.parse(readFileSync(join(tests,'_results/visual-results.json'),'utf8')).tests[0];
  check('CE-03 page Back replay stops at One instead of returning home twice', () => {
    assert.equal(appExit,0); assert.equal(appResult.status,'PASS');
    // The browser may restore One without an HTTP request. The destination
    // assertion above proves the page; the log must not show the extra home GET.
    assert.ok(!appCalls.slice(appCalls.findIndex(c=>c.path==='/two')+1).some(c=>c.path==='/'));
  });
  await appClick('#appforward', '#two');
  const appForwardSteps=Array.from(appHost.allSteps);
  check('CE-03 page Forward is represented only by its recorded click', () => {
    assert.equal(appHost.observations.at(-1).intents.at(-1).scriptedTraversal,true);
    assert.equal(appForwardSteps.at(-1).type,'click');
    assert.equal(appForwardSteps.at(-1).text,'Advance in application');
  });
  await injectApp(); await ab('click','#idle');
  for(const event of events.splice(0)) if(event.type==='step') appHost.api.recordStep(event.step);
  await manualTraverse(-1); await ab('wait','#one'); await observe(appHost);
  check('CE-03 manual Back still records after a page traversal and idle click', () => {
    assert.equal(appHost.observations.at(-1).intents.at(-1).scriptedTraversal,false);
    assert.equal(appHost.allSteps.at(-1).type,'back');
  });
  writeFileSync(join(root, 'evidence.json'), JSON.stringify({ applicationHistory: {observations:appHost.observations,backSteps:appBackSteps,forwardSteps:appForwardSteps,finalSteps:Array.from(appHost.allSteps),manifest:appManifest,replayManifest:appReplayManifest,calls:appCalls,result:appResult}, checks, entry, captured, hostSteps: steps, manifest, replayCalls, result, manualEntry, linkEntry, history: { oneEntry, twoEntry, backEntry, backEvents, backSteps, forwardEntry, forwardSteps }, postHistory: {postEntry,postBackEntry,steps:postSteps,manifest:historyManifest,replayManifest:historyReplayManifest,calls:historyCalls,result:historyResult} }, null, 2));
} finally {
  socket?.close();
  try { await ab('close'); } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
}
process.exitCode = failures ? 1 : 0;
