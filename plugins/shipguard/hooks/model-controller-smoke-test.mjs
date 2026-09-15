#!/usr/bin/env node
// Local HTTP protocol fixture. No model service is started or called.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./model-controller.mjs', import.meta.url));
let mode = 'valid', received = null;
const server = createServer(async (req, res) => {
  let text = ''; for await (const c of req) text += c;
  received = { path: req.url, body: JSON.parse(text) };
  if (mode === 'error') { res.writeHead(503); return res.end(); }
  const content = JSON.stringify({ status: 'unknown', message: 'Protocol fixture only: no semantic judgment.' });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ finish_reason: mode === 'incomplete' ? 'length' : 'stop', message: { content } }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = 'http://127.0.0.1:' + server.address().port + '/explicit/chat/completions';
function run(target = endpoint) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, SHIPGUARD_DIALOGUE_ENDPOINT: target,
      SHIPGUARD_DIALOGUE_MODEL: 'protocol-fixture-not-a-model', SHIPGUARD_DIALOGUE_API_KEY: '' }, stdio: ['pipe','pipe','pipe'] });
    let out = ''; child.stdout.on('data', c => out += c); child.stderr.resume();
    child.on('error', reject); child.on('close', code => resolve({ code, out }));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ event: 'Stop', passages: { response: 'Protocol fixture.' }, coverage: { missing: ['no original request'] } }));
  });
}
try {
  assert.equal((await run()).code, 0);
  assert.equal(received.path, '/explicit/chat/completions', 'endpoint must not be silently changed');
  assert.equal(received.body.model, 'protocol-fixture-not-a-model');
  assert.ok(received.body.messages[0].content.includes('never a completion or approval'));
  mode = 'error'; assert.notEqual((await run()).code, 0);
  mode = 'incomplete'; assert.notEqual((await run()).code, 0);
  assert.notEqual((await run('http://user:password@127.0.0.1:1/')).code, 0);
  console.log('model controller smoke: passed (local HTTP protocol fixture; no model calls)');
} finally { await new Promise(resolve => server.close(resolve)); }
