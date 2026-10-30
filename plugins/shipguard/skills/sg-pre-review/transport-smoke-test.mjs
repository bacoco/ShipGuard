#!/usr/bin/env node
// Real CLI with fake fetch, then real loopback HTTP only. No external service or model.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'sg-pre-review-transport-'));
const project = join(root, 'project');
mkdirSync(project);
const request = join(root, 'request.md');
const source = 'const fixture = true;\n';
writeFileSync(join(project, 'app.js'), source);
writeFileSync(request, 'Review fixture without changing it.\n');
const final = { action: 'final', decision: 'undetermined', comparison: 'Synthetic transport test', evidence: [] };
const response = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(final) } }] });
const fake = join(root, 'fake-fetch.mjs');
writeFileSync(fake, `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  appendFileSync(process.env.SG_TRANSPORT_LOG, JSON.stringify({ url: String(url), ...options, body: JSON.parse(options.body), signal: { aborted: options.signal.aborted } }) + '\\n');
  return { ok: true, status: 200, json: async () => JSON.parse(${JSON.stringify(response)}) };
};
`);
let cases = 0;
async function run(endpoint, mocked = false) {
  const log = join(root, `calls-${cases++}.jsonl`);
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      ...(mocked ? ['--import', fake] : []), join(here, 'run-pre-review.mjs'),
      '--root', project, '--request', request, '--endpoint', endpoint, '--model', 'fixture-no-model',
    ], { env: { PATH: process.env.PATH, SG_TRANSPORT_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Transport fixture timed out')); }, 10000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  assert.deepEqual(readdirSync(project), ['app.js']);
  assert.equal(readFileSync(join(project, 'app.js'), 'utf8'), source);
  return { ...output, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [] };
}

const servers = [];
async function listen(handler, host = '127.0.0.1') {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  return server;
}
try {
  for (const endpoint of [
    'http://remote.example.test', 'http://192.0.2.1', 'http://192.168.1.2',
    'http://10.0.0.1', 'http://172.16.0.1', 'http://0.0.0.0', 'http://[::]',
    'http://localhost.example.test', 'http://localhost.evil', 'http://127.0.0.1.example.test',
    'http://127.evil', 'http://[2001:db8::1]',
  ]) {
    const result = await run(endpoint, true);
    assert.equal(result.code, 1, endpoint);
    assert.match(result.stderr, /Use HTTPS for remote endpoints/);
    assert.deepEqual(result.calls, [], 'rejection must precede fetch: ' + endpoint);
  }
  for (const endpoint of ['http://user:fixture@localhost', 'ftp://localhost']) {
    const result = await run(endpoint, true);
    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, []);
  }
  let expectedBody;
  for (const endpoint of [
    'https://remote.example.test:8443/ignored?query=fixture',
    'http://localhost:8080', 'http://LOCALHOST:8080', 'http://127.0.0.1:8080',
    'http://127.2.3.4:8080', 'http://[::1]:8080',
  ]) {
    const result = await run(endpoint, true);
    assert.equal(result.code, 3, result.stderr);
    assert.equal(result.calls.length, 1);
    const call = result.calls[0];
    assert.equal(call.url, new URL('/v1/chat/completions', endpoint).href);
    assert.equal(call.method, 'POST');
    assert.equal(call.redirect, 'error');
    assert.deepEqual(call.headers, { 'Content-Type': 'application/json' });
    assert.equal(call.signal.aborted, false);
    expectedBody ??= call.body;
    assert.deepEqual(call.body, expectedBody, 'transport must preserve the request payload');
    assert.deepEqual(Object.keys(call.body), ['model', 'messages', 'temperature', 'seed', 'max_tokens', 'cache_prompt', 'response_format']);
    assert.equal(call.body.model, 'fixture-no-model');
    assert.equal(call.body.temperature, 0.2);
    assert.equal(call.body.seed, 101);
    assert.equal(call.body.max_tokens, 1800);
    assert.equal(call.body.cache_prompt, false);
    assert.deepEqual(call.body.response_format, { type: 'json_object' });
    assert.equal(call.body.messages[1].content, 'Review fixture without changing it.');
  }
  console.log('ok endpoint policy: remote HTTP rejected before fetch; HTTPS and validated loopback accepted by fake fetch');

  let destinationCalls = 0, initialCalls = 0;
  const destination = await listen((req, res) => { destinationCalls++; req.resume(); res.end(response); });
  const target = `http://127.0.0.1:${destination.address().port}/redirect-target`;
  let status = 200, location = target;
  const received = [], faults = [];
  const origin = await listen(async (req, res) => {
    try {
      initialCalls++;
      let data = ''; for await (const chunk of req) data += chunk;
      assert.equal(req.url, '/v1/chat/completions');
      assert.equal(req.method, 'POST');
      received.push(JSON.parse(data));
      res.writeHead(status, status === 200 ? { 'Content-Type': 'application/json' } : { Location: location });
      res.end(status === 200 ? response : '');
    } catch (error) { faults.push(error); res.statusCode = 500; res.end('fixture error'); }
  });
  const endpoint = `http://127.0.0.1:${origin.address().port}/ignored`;
  const accepted = await run(endpoint);
  assert.equal(accepted.code, 3, accepted.stderr);
  assert.deepEqual(received[0], expectedBody);
  assert.equal(initialCalls, 1);
  console.log('ok real loopback HTTP request preserves the path and payload');
  for (status of [301, 302, 303, 307, 308]) {
    for (location of [target, '/same-origin-target']) {
      const before = initialCalls;
      const result = await run(endpoint);
      assert.equal(result.code, 1, `redirect ${status}`);
      assert.match(result.stderr, /fetch failed/);
      assert.equal(initialCalls, before + 1, 'no same-origin second request');
      assert.equal(destinationCalls, 0, 'redirect destination must never be contacted');
    }
    console.log(`ok redirect ${status} rejected before a second request`);
  }
  assert.deepEqual(faults, []);
  console.log(`${cases} transport cases passed; network requests used synthetic loopback fixtures only`);
} finally {
  await Promise.all(servers.map(server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }));
  rmSync(root, { recursive: true, force: true });
}
