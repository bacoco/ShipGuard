#!/usr/bin/env node
// Real toolbar capture -> unedited YAML -> deterministic CLI replay (#121).
// Requires an already-installed agent-browser and Chromium; installs nothing.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { actionsToYaml } from './actions-to-yaml.mjs';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../../../cli/shipguard.mjs');
const root = mkdtempSync(join(tmpdir(), 'sg-record-click-'));
const session = `sg-record-click-${process.pid}`;
const env = { ...process.env, AGENT_BROWSER_SESSION: session };
const bin = process.env.SHIPGUARD_AGENT_BROWSER || 'agent-browser';
const toolbar = readFileSync(join(here, 'recorder-toolbar.js'), 'utf8')
  .replace("'__CSS_PLACEHOLDER__'", '`' + readFileSync(join(here, 'recorder-toolbar.css'), 'utf8').replace(/`/g, '\\`') + '`');
const fixture = `<!doctype html><html><head><meta charset="utf-8">
<title>ShipGuard Recorder Fixture</title>
<style>body{font:20px system-ui;max-width:640px;margin:60px;padding:40px;min-height:400px}
label,input,button{display:block;margin:12px 0}</style></head><body>
<h1>Reservation</h1><form><label for="item">Item name</label><input id="item">
<button type="submit"><span>Reserve item</span></button></form>
<p id="result">No reservation yet</p><div id="custom" tabindex="0">Custom action</div>
<button id="nameless" style="width:40px;height:30px" onclick="fetch('/nameless',{method:'POST'})"></button>
<form id="focus-form"><input id="prefilled" value="preset"><button>Submit preset</button></form>
<p id="scoped">Waiting</p><p>Scoped success</p>
<script>document.querySelector('form').addEventListener('submit',async e=>{
e.preventDefault();const response=await fetch('/reserve',{method:'POST',body:document.querySelector('#item').value});
document.querySelector('#result').textContent=await response.text();
});document.querySelector('#custom').addEventListener('click',()=>{});
document.querySelector('#focus-form').addEventListener('submit',async e=>{
e.preventDefault();
document.querySelector('#scoped').textContent='Scoped success';
await fetch('/focused',{method:'POST',body:document.querySelector('#prefilled').value});
});</script>
</body></html>`;
let reservations = 0;
let observedReservation = null;
let focusedValues = [], namelessClicks = 0;
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/nameless') {
    namelessClicks++; res.writeHead(200); res.end('ok'); return;
  }
  if (req.method === 'POST' && req.url === '/focused') {
    let value = ''; req.setEncoding('utf8'); req.on('data', chunk => { value += chunk; });
    req.on('end', () => { focusedValues.push(value); res.writeHead(200); res.end('ok'); }); return;
  }
  if (req.method === 'POST' && req.url === '/reserve') {
    let value = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { value += chunk; });
    req.on('end', () => {
      observedReservation = `Reserved ${++reservations} ${value}`;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(observedReservation);
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fixture);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const ab = async (...args) => {
  try {
    return (await exec(bin, args, {
      cwd: root, env, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
    })).stdout;
  } catch (error) {
    throw new Error(`agent-browser ${args.find((arg) => !arg.startsWith('-'))}: ${error.stderr || error.stdout || error.code}`);
  }
};
const evaluate = async (code) => {
  const result = JSON.parse(await ab('--json', 'eval', '-b', Buffer.from(code).toString('base64')));
  assert.equal(result.success, true, 'browser evaluation succeeded');
  return result.data.result;
};
const inject = async () => {
  await ab('open', url);
  await evaluate(`window.__sgEvents=[];
    window.__sgBridge=json=>window.__sgEvents.push(JSON.parse(json));
    ${toolbar}`);
};
const clickPoint = async (point) => {
  await ab('mouse', 'move', String(Math.round(point.x)), String(Math.round(point.y)));
  await ab('mouse', 'down');
  await ab('mouse', 'up');
};
let failures = 0;
function check(label, actual, expected) {
  try { assert.deepEqual(actual, expected); console.log(`PASS ${label}`); }
  catch (error) { failures++; console.error(`FAIL ${label}: ${error.message}`); }
}
console.log(`Artifacts: ${root}`);
try {
  await ab('set', 'viewport', '1280', '1200');
  await inject();
  check('margin really targets the document root',
    await evaluate('document.elementFromPoint(5,5).tagName'), 'HTML');
  await clickPoint({ x: 5, y: 5 });
  const bodyPoint = await evaluate(`(() => {
    const r=document.body.getBoundingClientRect();return {x:r.left+10,y:r.top+10};
  })()`);
  check('body padding really targets body',
    await evaluate(`document.elementFromPoint(${bodyPoint.x},${bodyPoint.y}).tagName`), 'BODY');
  await clickPoint(bodyPoint);
  await ab('fill', '#item', 'klklk');
  await ab('click', 'button[type=submit] span');
  await ab('click', '#sg-recorder .sg-btn-stop');
  const events = await evaluate('window.__sgEvents');
  const steps = events.filter((event) => event.type === 'step').map((event) => event.step);
  check('Stop reports the captured steps', events.find((event) => event.type === 'stop')?.steps, steps);
  check('capture preserves fill then one real button click', steps.map((step) => step.type), ['fill', 'click']);
  check('button child resolves to its button', steps.at(-1)?.tagName, 'button');
  await ab('screenshot', join(root, 'capture.png'), '--full');

  const tests = join(root, 'visual-tests');
  mkdirSync(join(tests, 'manifests'), { recursive: true });
  writeFileSync(join(tests, '_config.yaml'), `base_url: "${url}"
profiles:
  fixture:
    scope: all
    checks: [page-load, browser-errors, screenshots]
`);
  const manifest = join(tests, 'manifests/recorded-reservation.yaml');
  // No filtering, assertion insertion, or repair of the captured actions.
  writeFileSync(manifest, actionsToYaml([{ type: 'open', url }, ...steps], {
    name: 'reservation', baseUrl: url,
  }));
  const digest = () => createHash('sha256').update(readFileSync(manifest)).digest('hex');
  const before = digest();
  reservations = 0;
  observedReservation = null;
  let exitCode = 0;
  try {
    const run = await exec(process.execPath, [cli, 'run', '--profile=fixture', '--no-crawl'], {
      cwd: root, env: { ...env, AGENT_BROWSER_SESSION: `${session}-replay` },
      timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    });
    writeFileSync(join(root, 'replay.log'), run.stdout + run.stderr);
  } catch (error) {
    exitCode = error.code;
    writeFileSync(join(root, 'replay.log'), (error.stdout || '') + (error.stderr || ''));
  }
  check('raw manifest remains byte-for-byte unchanged', digest(), before);
  const result = JSON.parse(readFileSync(join(tests, '_results/visual-results.json'), 'utf8')).tests[0];
  check('CLI replay exits cleanly', exitCode, 0);
  check('raw recorded manifest replays successfully', result.status, 'PASS');
  check('replay has no browser errors', result.browser_errors, []);
  check('replay actually submits the recorded value once', observedReservation, 'Reserved 1 klklk');
  check('replay submits exactly one reservation', reservations, 1);
  copyFileSync(join(tests, '_results', result.screenshot), join(root, 'replay.png'));
  writeFileSync(join(root, 'evidence.json'), JSON.stringify({
    manifest_sha256: before, exit_code: exitCode, result, observed_reservation: observedReservation,
  }, null, 2));

  // Cross-component regression: captured CSS fallback, Enter focus and scoped
  // text checks must survive the converter and the mechanical runner together.
  await inject();
  await ab('click', '#nameless');
  await ab('click', '#prefilled');
  await ab('press', 'Enter');
  await ab('wait', '--fn', 'document.querySelector("#scoped").textContent === "Scoped success"');
  await ab('scrollintoview', '#scoped');
  await ab('click', '#sg-check-btn');
  const scopePoint = await evaluate(`(() => { const r=document.querySelector('#scoped').getBoundingClientRect(); return {x:r.left+10,y:r.top+10}; })()`);
  assert.ok(scopePoint.x > 0 && scopePoint.y > 0, `scoped check must be in view: ${JSON.stringify(scopePoint)}`);
  await clickPoint(scopePoint);
  await ab('click', '#sg-recorder .sg-btn-stop');
  const focusedSteps = await evaluate('window.__sgEvents.filter(e=>e.type==="step").map(e=>e.step)');
  check('focused capture keeps only click, Enter and check', focusedSteps.map(s => s.type), ['click', 'press', 'check']);
  await ab('screenshot', join(root, 'focused-capture.png'), '--full');
  const focusedManifest = join(tests, 'manifests/recorded-focused.yaml');
  const focusedYaml = actionsToYaml([{ type: 'open', url }, ...focusedSteps], { name: 'focused', baseUrl: url });
  writeFileSync(focusedManifest, focusedYaml);
  focusedValues = []; namelessClicks = 0;
  let focusedExit = 0;
  try {
    const run = await exec(process.execPath, [cli, 'run', '--profile=fixture', '--scope=recorded-focused', '--no-crawl'], {
      cwd: root, env, timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    });
    writeFileSync(join(root, 'focused-replay.log'), run.stdout + run.stderr);
  } catch (error) {
    focusedExit = error.code;
    writeFileSync(join(root, 'focused-replay.log'), (error.stdout || '') + (error.stderr || ''));
  }
  const focusedResult = JSON.parse(readFileSync(join(tests, '_results/visual-results.json'), 'utf8')).tests[0];
  check('focused raw YAML remains unchanged', readFileSync(focusedManifest, 'utf8'), focusedYaml);
  check('focused/scoped raw YAML replay exits cleanly', focusedExit, 0);
  check('focused/scoped raw YAML replay passes', focusedResult.status, 'PASS');
  check('textless control is replayed exactly once', namelessClicks, 1);
  check('Enter submits the prefilled field exactly once', focusedValues, ['preset']);
  copyFileSync(join(tests, '_results', focusedResult.screenshot), join(root, 'focused-replay.png'));
  writeFileSync(join(root, 'focused-evidence.json'), JSON.stringify({
    steps: focusedSteps, manifest_sha256: createHash('sha256').update(focusedYaml).digest('hex'),
    exit_code: focusedExit, result: focusedResult, focused_values: focusedValues, nameless_clicks: namelessClicks,
  }, null, 2));

  // Preserve existing fallback clicks; this fix must not discard every custom control.
  await inject();
  await ab('click', '#custom');
  check('custom event-listener target is still captured',
    await evaluate('window.__sgEvents.filter(e=>e.type==="step").map(e=>e.step.selector)'), ['#custom']);
  await evaluate('window.__sgEvents=[];document.body.setAttribute("onclick","void 0")');
  await clickPoint(bodyPoint);
  check('explicitly interactive body is still captured',
    await evaluate('window.__sgEvents.filter(e=>e.type==="step").map(e=>e.step.tagName)'), ['body']);
  await evaluate(`window.__sgEvents=[];document.body.removeAttribute('onclick');
    document.documentElement.setAttribute('role','button')`);
  await clickPoint({ x: 5, y: 5 });
  check('explicitly interactive document root is still captured',
    await evaluate('window.__sgEvents.filter(e=>e.type==="step").map(e=>e.step.tagName)'), ['html']);

  // A bare body click can still be useful without an onclick attribute or role.
  await inject();
  await evaluate(`window.__bodyClicks=0;
    const panel=document.createElement('section');panel.id='panel';panel.textContent='Open panel';
    document.body.appendChild(panel);
    document.body.addEventListener('click',event=>{
      if(event.target!==document.body)return;
      window.__bodyClicks++;panel.style.display='none';
    });`);
  check('panel dismissal targets bare body',
    await evaluate(`document.elementFromPoint(${bodyPoint.x},${bodyPoint.y}).tagName`), 'BODY');
  await clickPoint(bodyPoint);
  const bodyHandler = await evaluate(`({
    clicks:window.__bodyClicks,
    hidden:document.querySelector('#panel').style.display==='none',
    steps:window.__sgEvents.filter(e=>e.type==='step').map(e=>({type:e.step.type,tag:e.step.tagName}))
  })`);
  check('background handler actually closes the panel',
    { clicks: bodyHandler.clicks, hidden: bodyHandler.hidden }, { clicks: 1, hidden: true });
  check('useful body listener click is retained', bodyHandler.steps, [{ type: 'click', tag: 'body' }]);
  writeFileSync(join(root, 'body-handler-evidence.json'), JSON.stringify(bodyHandler, null, 2));
  await ab('screenshot', join(root, 'body-handler.png'), '--full');
} finally {
  try { await ab('close'); } catch (error) { console.error(`Browser cleanup: ${error.message}`); failures++; }
  await new Promise((done) => server.close(done));
}
console.log(`${failures ? 'FAIL' : 'PASS'} recorder click/replay; evidence retained in ${root}`);
process.exitCode = failures ? 1 : 0;
