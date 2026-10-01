#!/usr/bin/env node
// Actual runner + deterministic loopback HTTP fixture. No model/provider invoked.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'sg-goal-runner-'));
const project = join(root, 'project'); mkdirSync(project);
const request = join(root, 'request.md'), goal = join(root, 'goal.md');
const requestText = 'Keep SSO and denied access.\n';
const goalText = '# Goal\n## Success criteria\n### SG-R1 — SSO\nPreserve the provider.\n### SG-R2 — Denial\nPreserve denied access.\n';
const app = 'const sso = true;\nconst allowUnknown = false;\n';
writeFileSync(join(project, 'app.js'), app);
const a = { path: 'app.js', start: 1, end: 1, excerpt: 'const sso = true;' };
const b = { path: 'app.js', start: 2, end: 2, excerpt: 'const allowUnknown = false;' };
const read = { action: 'read', path: 'app.js', start: 1, end: 2 };
const final = {
  action: 'final', decision: 'none', comparison: 'Static analysis only', evidence: [a],
  goal_alignment: { status: 'consistent', comparison: 'Both supplied constraints remain represented.' },
  goal_coverage: [a, b].map((e, i) => ({ id: `SG-R${i + 1}`, status: 'analyzed', comparison: 'Compare the source value with the requirement.', verification: 'Proposed behavior check, not executed.', evidence: [e] })),
};
let handler, requests = [], faults = [], child = null;
const server = createServer(async (req, res) => {
  try {
    let data = ''; for await (const chunk of req) data += chunk;
    assert.equal(req.url, '/v1/chat/completions'); const body = JSON.parse(data); requests.push(body);
    assert.equal(body.model, 'fixture-no-model');
    const action = handler(requests.length, body);
    if (action === null) { child.kill('SIGTERM'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: action.finish_reason || 'stop', message: { content: JSON.stringify(action) } }] }));
  } catch (error) { faults.push(error); res.statusCode = 500; res.end('fixture error'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let cases = 0;
async function run(name, dispatch, { withGoal = true, extra = [], invalidGoal = null } = {}) {
  writeFileSync(request, requestText); writeFileSync(goal, invalidGoal ?? goalText);
  handler = dispatch; requests = []; faults = [];
  const argv = [join(here, 'run-pre-review.mjs'), '--root', project, '--request', request,
    '--endpoint', `http://127.0.0.1:${server.address().port}`, '--model', 'fixture-no-model',
    ...(withGoal ? ['--goal', goal] : []), ...extra];
  const output = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Runner test timed out: ' + name)); }, 10000);
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
  assert.deepEqual(faults, []); assert.deepEqual(readdirSync(project), ['app.js']);
  assert.equal(readFileSync(join(project, 'app.js'), 'utf8'), app, 'runner must not mutate project');
  cases++; console.log('ok', name);
  return { ...output, report: output.stdout ? JSON.parse(output.stdout) : null, requests: requests.slice() };
}
try {
  let r = await run('legacy mode unchanged', n => n === 1 ? read : final, { withGoal: false });
  assert.equal(r.code, 0); assert.equal(r.report.goal_review, undefined); assert.equal(r.requests[0].max_tokens, 1800);
  r = await run('goal reaches provider fixture and every criterion reaches report', n => n === 1 ? read : final);
  assert.equal(r.code, 0); assert.equal(r.requests.length, 2);
  const sent = JSON.parse(r.requests[0].messages[1].content);
  assert.equal(sent.original_request, requestText); assert.equal(sent.supplied_goal, goalText); assert.equal(sent.criteria.length, 2);
  assert.equal(r.report.goal_review.criteria.length, 2); assert.equal(r.report.semantic_verification, 'not verified');
  assert.equal(r.requests[0].max_tokens, 2600);
  r = await run('omission cannot produce completed after correction budget', n => n === 1 ? read : { ...final, goal_coverage: [final.goal_coverage[0]] });
  assert.equal(r.code, 3); assert.equal(r.requests.length, 12); assert.ok(r.report.errors.includes('GOAL_CRITERION_MISSING:SG-R2'));
  r = await run('per-criterion fabricated quote cannot pass', n => n === 1 ? read : { ...final, goal_coverage: final.goal_coverage.map(x => ({ ...x, evidence: [{ ...a, excerpt: 'invented' }] })) });
  assert.equal(r.code, 3); assert.equal(r.requests.length, 12);
  r = await run('honest unresolved result stops without retry loop', n => n === 1 ? read : { ...final, decision: 'undetermined', goal_coverage: final.goal_coverage.map(x => ({ ...x, status: 'unresolved', evidence: [] })) });
  assert.equal(r.code, 3); assert.equal(r.requests.length, 2);
  r = await run('goal changes before final response', n => {
    if (n === 1) return read; writeFileSync(goal, goalText + '\nChanged decision'); return final;
  });
  assert.equal(r.code, 3); assert.equal(r.requests.length, 2); assert.equal(r.report.goal_review.inputs_unchanged, false);
  r = await run('request change stops before next provider call', () => { writeFileSync(request, requestText + 'New constraint'); return read; });
  assert.equal(r.code, 3); assert.equal(r.requests.length, 1); assert.match(r.report.runtime_note, /REQUEST_CHANGED/);
  r = await run('last allowed response is still validated', n => n < 12 ? read : final);
  assert.equal(r.code, 0); assert.equal(r.requests.length, 12); assert.equal(r.report.goal_review.coverage_status, 'complete');
  r = await run('nonfinal call budget ends as partial', () => read);
  assert.equal(r.code, 3); assert.equal(r.requests.length, 12); assert.match(r.report.runtime_note, /budget exhausted/);
  r = await run('truncated model response stays partial', () => ({ finish_reason: 'length' }));
  assert.equal(r.code, 3); assert.equal(r.requests.length, 1); assert.equal(r.report.claim_origin, 'runtime-status');
  r = await run('legacy goal rejected before provider call', () => final, { invalidGoal: '# Old goal\nA free-form goal remains valid for conversational use.\n' });
  assert.notEqual(r.code, 0); assert.equal(r.requests.length, 0); assert.match(r.stderr, /no implicit conversion/);
  r = await run('duplicate goal argument rejected before provider call', () => final, { extra: ['--goal', goal] });
  assert.notEqual(r.code, 0); assert.equal(r.requests.length, 0); assert.match(r.stderr, /Duplicate --goal/);
  r = await run('unknown tool never becomes execution', () => ({ action: 'execute', command: 'touch forbidden' }));
  assert.equal(r.code, 3); assert.equal(r.requests.length, 12);
  r = await run('conflicting original request and goal stay partial', n => n === 1 ? read : { ...final, decision: 'undetermined', goal_alignment: { status: 'conflict', comparison: 'A goal contradicts the original source.' } });
  assert.equal(r.code, 3); assert.equal(r.requests.length, 2);
  r = await run('cancellation terminates without retry or success claim', () => null);
  assert.equal(r.signal, 'SIGTERM'); assert.equal(r.report, null); assert.equal(r.requests.length, 1);
  console.log(`${cases} actual-runner cases passed using loopback fixtures; no real model evaluated`);
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
