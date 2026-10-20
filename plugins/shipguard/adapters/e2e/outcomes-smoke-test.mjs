#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeReport } from './outcomes.mjs';
import { mergeExit, sourceExit } from './contract.mjs';
import { fixture, agentFixture, failure, recount } from './fixture.mjs';
let count = 0;
function check(name, fn) { fn(); console.log(`ok ${++count} - ${name}`); }
function rejects(edit, code = 'INVALID_REPORT') {
  const d = fixture(); edit(d);
  assert.throws(() => normalizeReport(d), e => e.code === code);
}
check('execution PASS is not visual or shipping approval', () => {
  const r = normalizeReport(fixture()); assert.equal(r.exit_code, 0);
  assert.equal(r.tests[0].status, 'PASS'); assert.equal(r.visual_review, 'not-performed');
  assert.equal(r.ship_ready, false); assert.equal(r.tests[0].screenshot, null);
});
check('product failure', () => {
  const r = normalizeReport(fixture('failed', failure()));
  assert.equal(r.tests[0].status, 'FAIL'); assert.equal(r.exit_code, 1);
});
check('REPLAY_STALE means stale/config, not infrastructure', () => {
  const r = normalizeReport(fixture('failed', failure('configuration', 'REPLAY_STALE')));
  assert.equal(r.tests[0].status, 'STALE'); assert.equal(r.exit_code, 3);
});
for (const category of ['infrastructure', 'internal', 'interrupted']) check(`${category} is not a product finding`, () => {
  const r = normalizeReport(fixture('failed', failure(category, 'MODEL_UNAVAILABLE')));
  assert.equal(r.tests[0].status, 'ERROR'); assert.equal(r.exit_code, 2);
});
check('exit translation and precedence', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 130].map(sourceExit), [0, 1, 3, 2, 2, 2]);
  assert.equal(mergeExit(1, 3), 3); assert.equal(mergeExit(1, 2, 3), 2);
});
check('flaky is not clean even when upstream exits zero', () => {
  const d = fixture('flaky'); d.run.results[0].attempts[0].steps[0].status = 'passed';
  const r = normalizeReport(d); assert.equal(r.exit_code, 1); assert.equal(r.tests[0].status, 'FAIL');
});
check('selected skipped test is incomplete', () => {
  const r = normalizeReport(fixture('skipped')); assert.equal(r.exit_code, 3); assert.equal(r.tests[0].status, 'SKIPPED');
});
check('out-of-scope skipped test does not invalidate selected pass', () => {
  const d = fixture(); const t = structuredClone(d.run.results[0]);
  Object.assign(t, { id: 'not-selected', selected: false, status: 'skipped', attempts: [] });
  d.run.results.push(t); recount(d);
  const r = normalizeReport(d); assert.equal(r.exit_code, 0);
  assert.equal(r.scope.selected_total, 1); assert.equal(r.scope.full_suite_total, 2);
});
check('empty suite cannot pass', () => {
  const d = fixture(); d.run.results = []; recount(d); assert.equal(normalizeReport(d).exit_code, 3);
});
check('setup-only suite cannot pass', () => {
  const d = fixture(); d.run.results[0].kind = 'setup'; assert.equal(normalizeReport(d).exit_code, 3);
});
check('no recorded assertion cannot pass', () => {
  const d = fixture(); d.run.results[0].attempts[0].steps = []; assert.equal(normalizeReport(d).exit_code, 3);
});
check('agent assertion is recognized, not claimed as independent visual review', () => {
  const d = agentFixture(); const r = normalizeReport(d);
  assert.equal(r.exit_code, 0); assert.equal(r.visual_review, 'not-performed');
  assert.equal(r.ship_ready, false); assert.equal(r.tests[0].screenshot, null);
  assert.equal(r.tests[0].recorded_checks, 1);
  assert.deepEqual(r.tests[0].source_attempts, d.run.results[0].attempts);
});
check('passing agent assertion without its observation or explanation is refused', () => {
  for (const field of ['observationRevision', 'explanation']) {
    const d = agentFixture(); delete d.run.results[0].attempts[0].steps[0][field];
    assert.throws(() => normalizeReport(d), e => e.code === 'INVALID_REPORT', field);
  }
});
check('agent assertion requires valid recorded metrics', () => {
  for (const field of ['modelCalls', 'actionSteps', 'observationBytes', 'contextBytes', 'ledgerBytes']) {
    for (const value of [undefined, -1, 0.5, '0', null]) {
      const d = agentFixture(); d.run.results[0].attempts[0].steps[0].metrics[field] = value;
      assert.throws(() => normalizeReport(d), e => e.code === 'INVALID_REPORT', field);
    }
  }
  for (const metrics of [undefined, null, [], 0]) {
    const d = agentFixture(); d.run.results[0].attempts[0].steps[0].metrics = metrics;
    assert.throws(() => normalizeReport(d), e => e.code === 'INVALID_REPORT');
  }
  const d = agentFixture(); d.run.results[0].attempts[0].steps[0].metrics.pixelBytes = -1;
  assert.throws(() => normalizeReport(d), e => e.code === 'INVALID_REPORT');
});
check('agent assertion evidence obeys report-1 string bounds', () => {
  for (const [field, values] of Object.entries({
    observationRevision: ['', null, 1, 'x'.repeat(257)], explanation: [null, 1, 'x'.repeat(8193)],
  })) for (const value of values) {
    const d = agentFixture(); d.run.results[0].attempts[0].steps[0][field] = value;
    assert.throws(() => normalizeReport(d), e => e.code === 'INVALID_REPORT', field);
  }
  const d = agentFixture(); const s = d.run.results[0].attempts[0].steps[0];
  s.observationRevision = '😀'.repeat(256); s.explanation = '😀'.repeat(8192);
  assert.equal(normalizeReport(d).exit_code, 0);
  s.explanation = ''; // report-1 allows an empty explanation, but requires the field.
  assert.equal(normalizeReport(d).exit_code, 0);
});
check('failed evaluated agent assertion also requires its evidence', () => {
  for (const field of ['observationRevision', 'explanation']) {
    const d = agentFixture('failed', failure()); const s = d.run.results[0].attempts[0].steps[0];
    s.metrics.modelCalls = 1; delete s[field];
    assert.throws(() => normalizeReport(d), e => e.code === 'INVALID_REPORT', field);
  }
  assert.equal(normalizeReport(agentFixture('failed', failure())).exit_code, 1);
});
check('unavailable agent with no model call needs no fabricated observation', () => {
  const d = agentFixture('failed', failure('infrastructure', 'MODEL_UNAVAILABLE'));
  const s = d.run.results[0].attempts[0].steps[0];
  delete s.observationRevision; delete s.explanation;
  assert.equal(normalizeReport(d).exit_code, 2);
});
check('failed cleanup overrides passing assertions', () => {
  const d = fixture(); d.run.results[0].attempts[0].cleanup = 'failed'; assert.equal(normalizeReport(d).exit_code, 2);
});
check('secondary provider failure overrides an otherwise passing attempt', () => {
  const d = fixture(); d.run.results[0].attempts[0].secondaryErrors.push(failure('infrastructure'));
  assert.equal(normalizeReport(d).exit_code, 2);
});
check('cancelled step without an error remains infrastructure failure', () => {
  const d = fixture(); d.run.results[0].attempts[0].steps[0].status = 'cancelled';
  assert.equal(normalizeReport(d).exit_code, 2);
});
check('unexpected version is refused', () => rejects(d => d.run.runner.version = '0.19.0', 'UNSUPPORTED_VERSION'));
check('schema version is not guessed', () => rejects(d => d.schemaVersion = 'report-2'));
check('unknown result status is refused', () => rejects(d => d.run.results[0].status = 'success'));
check('unknown step status is refused', () => rejects(d => d.run.results[0].attempts[0].steps[0].status = 'running'));
check('missing attempts are refused', () => rejects(d => d.run.results[0].attempts = []));
check('duplicate result IDs are refused', () => rejects(d => d.run.results.push(structuredClone(d.run.results[0]))));
check('summary mismatch is refused', () => rejects(d => d.run.summary.selected = 2));
check('unknown error category is refused', () => rejects(d => d.run.errors.push(failure('unknown'))));
check('serial groups are explicitly unsupported', () => rejects(d => d.run.serialGroups.push({}), 'UNSUPPORTED_SERIAL'));
check('carried failure debt is not silently dropped', () => rejects(d => d.run.carried = {}, 'UNSUPPORTED_CARRIED'));
check('exploration is not a test run', () => rejects(d => d.run.explore = {}, 'UNSUPPORTED_EXPLORE'));
check('mobile is not silently treated as web', () => rejects(d => d.run.results[0].platform = 'ios', 'UNSUPPORTED_PLATFORM'));
check('missing artifact reference fails closed', () => rejects(d => d.run.results[0].attempts[0].steps[0].artifacts.push('absent')));
check('replay metadata and usage remain unchanged', () => {
  const d = fixture(); const s = d.run.results[0].attempts[0].steps[0];
  s.cache = { mode: 'self-finalized' }; s.metrics = { modelCalls: 0 };
  const r = normalizeReport(d); assert.deepEqual(r.tests[0].source_attempts[0].steps[0].cache, s.cache);
  assert.deepEqual(r.source.usage, d.run.usage);
});
console.log(`PASS ${count} outcome checks`);
