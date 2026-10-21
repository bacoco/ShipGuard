#!/usr/bin/env node
// Local HTTP protocol fixtures. No model service is started or called.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeView, validateController, outputFor } from './lib/dialogue-check.mjs';
const script = fileURLToPath(new URL('./model-controller.mjs', import.meta.url));
let mode = 'valid', received = null, calls = 0;
let reply = { status: 'unknown', message: 'Protocol fixture only: no semantic judgment.' };
const input = { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: '65 active clients.' };
const view = makeView(input, { original_request: 'Count the union: 40 subscribers, 25 logged in, 18 overlap.',
  sources: [{ reference: 'fixture calculation', text: '40 + 25 - 18 = 47.', origin: 'tool' }] });
const server = createServer(async (req, res) => {
  let text = ''; for await (const c of req) text += c;
  received = { path: req.url, body: JSON.parse(text) }; calls++;
  if (mode === 'error') { res.writeHead(503); return res.end(); }
  if (mode === 'oversized') { return res.end('x'.repeat(65537)); }
  const content = mode === 'invalid' ? '{invalid JSON' : JSON.stringify(reply);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ finish_reason: mode === 'incomplete' ? 'length' : 'stop', message: { content } }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = 'http://127.0.0.1:' + server.address().port + '/explicit/chat/completions';
function run(target = endpoint, suppliedView = view, splitUtf8 = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, SHIPGUARD_DIALOGUE_ENDPOINT: target,
      SHIPGUARD_DIALOGUE_MODEL: 'protocol-fixture-not-a-model', SHIPGUARD_DIALOGUE_API_KEY: '' }, stdio: ['pipe','pipe','pipe'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('fixture child exceeded deadline')); }, 8000);
    let out = ''; child.stdout.on('data', c => out += c); child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
    child.stdin.on('error', () => {});
    const bytes = Buffer.from(JSON.stringify(suppliedView));
    if (splitUtf8) {
      const split = bytes.indexOf(Buffer.from('é')) + 1;
      child.stdin.write(bytes.subarray(0, split));
      setTimeout(() => child.stdin.end(bytes.subarray(split)), 80);
    } else child.stdin.end(bytes);
  });
}
try {
  const first = await run();
  assert.equal(first.code, 0); assert.equal(calls, 1, 'one controller invocation makes one request');
  assert.equal(received.path, '/explicit/chat/completions', 'endpoint must not be silently changed');
  assert.equal(received.body.model, 'protocol-fixture-not-a-model');
  assert.equal(received.body.max_tokens, 1200);
  assert.equal(received.body.messages.length, 2);
  assert.equal(received.body.messages[0].role, 'system');
  assert.equal(received.body.messages[1].role, 'user');
  assert.ok(received.body.messages[0].content.includes('never a completion or approval'));
  assert.deepEqual(JSON.parse(received.body.messages[1].content), view, 'source origins and request must survive transport');
  assert.equal(validateController(JSON.parse(first.out), view).status, 'unknown');
  const unicodeView = makeView({ ...input, last_assistant_message: 'Été 😀' }, { original_request: 'Préserver le café 😀', sources: [] });
  assert.equal((await run(endpoint, unicodeView, true)).code, 0);
  assert.deepEqual(JSON.parse(received.body.messages[1].content), unicodeView, 'split stdin UTF-8 must survive transport');
  reply = { status: 'clear', message: 'Fixture: response can stand.' };
  let result = await run(); assert.equal(result.code, 0);
  let check = validateController(JSON.parse(result.out), view);
  assert.equal(check.action, 'keep'); assert.equal(outputFor(input, view, check).decision, undefined);
  reply = { status: 'finding', message: 'Fixture: correct the count.', finding: {
    action: 'correct', basis: 'fact', source: 'response', passage: '65',
    interpretations: ['union', 'intersection'], consequences: ['different count'],
    correction: 'The union is 47.', human_intent_missing: false,
    references: [{ source: 'context.sources.0.text', passage: '40 + 25 - 18 = 47.' }] } };
  result = await run(); assert.equal(result.code, 0);
  check = validateController(JSON.parse(result.out), view);
  assert.equal(check.action, 'correct'); assert.equal(outputFor(input, view, check).decision, 'block');
  reply = { ...reply, finding: { ...reply.finding, references: [{ source: 'response', passage: '65' }] } };
  result = await run(); assert.equal(result.code, 0);
  assert.equal(validateController(JSON.parse(result.out), view).status, 'unknown', 'transport success is not evidence validity');
  for (const failure of ['error', 'incomplete', 'invalid', 'oversized']) {
    mode = failure; const before = calls;
    assert.notEqual((await run()).code, 0, failure);
    assert.equal(calls, before + 1, 'failure must not trigger an HTTP retry');
  }
  const before = calls;
  assert.notEqual((await run('http://user:password@127.0.0.1:1/')).code, 0);
  assert.equal(calls, before, 'invalid endpoint must not send a request');
  console.log('model controller smoke: passed (HTTP contract/fault fixtures; no model calls)');
} finally { await new Promise(resolve => server.close(resolve)); }
