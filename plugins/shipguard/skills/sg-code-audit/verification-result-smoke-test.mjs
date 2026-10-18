#!/usr/bin/env node
// Test the shipped parser/projection, not a duplicate policy implementation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MAX_REPLY_BYTES, parseVerifierReply, applyVerifierReply, consumeVerificationInput,
} from './verification-result.mjs';

let checks = 0;
function check(name, run) {
  try { run(); checks++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
const id = 'r1-z03-001';
const finding = {
  id, severity: 'high', category: 'integration', file: 'src/a.mjs', line: 3,
  description: 'An existing finding', fix_applied: false,
  fix_evidence: null, negative_evidence: { complete: false },
  verification_score: null, verified: null,
};
const original = structuredClone(finding);
const reply = score => `BUG_ID: ${id}\nSCORE: ${score}`;

check('score 80 keeps the existing confirmed mapping', () => {
  const result = applyVerifierReply(finding, reply(80));
  assert.equal(result.disposition, 'retain');
  assert.equal(result.finding.verified, true);
  assert.equal(result.finding.severity, 'high');
  assert.equal(result.finding.verification_protocol.semantic_verification, 'not_verified');
});
check('valid uncertain score keeps the legacy mapping', () => {
  const result = applyVerifierReply(finding, reply(40));
  assert.equal(result.finding.verified, 'uncertain');
  assert.equal(result.finding.severity, 'medium');
});
check('valid 39 moves to the historical unverified bucket', () => {
  const result = applyVerifierReply(finding, reply(39));
  assert.equal(result.disposition, 'unverified');
  assert.equal(result.finding.verified, false);
});
check('CRLF and terminal newline', () => {
  assert.equal(parseVerifierReply(reply(100).replace('\n', '\r\n') + '\r\n', id).score, 100);
});
check('cross-zone identity', () => {
  assert.equal(parseVerifierReply('BUG_ID: r2-xz-009\nSCORE: 0', 'r2-xz-009').score, 0);
});

const invalid = [
  ['missing score', `BUG_ID: ${id}`],
  ['missing identity', 'SCORE: 90'],
  ['wrong identity', 'BUG_ID: r1-z99-001\nSCORE: 90'],
  ['duplicate score', reply(90) + '\nSCORE: 10'],
  ['duplicate identity', reply(90) + `\nBUG_ID: ${id}`],
  ['negative score', reply(-1)],
  ['score above 100', reply(101)],
  ['decimal', reply('80.5')],
  ['leading zero', reply('080')],
  ['exponential', reply('8e1')],
  ['plus sign', reply('+80')],
  ['unicode digits', reply('８０')],
  ['NaN', reply('NaN')],
  ['null text', reply('null')],
  ['extra prose', reply(90) + '\nLooks good'],
  ['Markdown fence', '```\n' + reply(90) + '\n```'],
  ['empty reply', ''],
  ['null transport result', null],
  ['object instead of reply', { SCORE: 90 }],
  ['NUL', reply(90) + '\u0000'],
  ['oversized reply', reply(90) + 'x'.repeat(MAX_REPLY_BYTES)],
];
for (const [name, raw] of invalid) {
  check(name, () => {
    const result = applyVerifierReply(finding, raw);
    assert.equal(result.disposition, 'retain');
    assert.equal(result.finding.severity, 'high');
    assert.equal(result.finding.verification_score, null);
    assert.equal(result.finding.verified, null);
    assert.equal(result.finding.verification_protocol.status, 'unavailable');
    assert.ok(result.finding.verification_protocol.reason);
  });
}
check('unavailable is not a numeric neutral vote for any severity', () => {
  for (const severity of ['critical', 'high', 'medium', 'low']) {
    assert.equal(applyVerifierReply({ ...finding, severity }, '').finding.severity, severity);
  }
});
check('evidence and inputs remain intact', () => {
  const result = applyVerifierReply(finding, reply(80));
  result.finding.negative_evidence.complete = true;
  assert.deepEqual(finding, original);
});
check('raw text and digest retain exact CRLF bytes', () => {
  const raw = reply(80).replace('\n', '\r\n');
  const protocol = applyVerifierReply(finding, raw).finding.verification_protocol;
  assert.equal(protocol.raw_reply, raw);
  assert.equal(protocol.raw_reply_sha256, createHash('sha256').update(raw).digest('hex'));
});
check('oversize is bounded but fingerprinted', () => {
  const raw = 'x'.repeat(MAX_REPLY_BYTES + 1);
  const protocol = applyVerifierReply(finding, raw).finding.verification_protocol;
  assert.equal(protocol.raw_reply, null);
  assert.equal(protocol.raw_reply_bytes, MAX_REPLY_BYTES + 1);
  assert.equal(protocol.raw_reply_sha256, createHash('sha256').update(raw).digest('hex'));
});
check('no double downgrade from processing a projected result', () => {
  const projected = applyVerifierReply(finding, reply(50)).finding;
  assert.throws(() => applyVerifierReply(projected, reply(50)), /original unverified/);
});
check('replaying the same original produces the same projection', () => {
  assert.deepEqual(applyVerifierReply(finding, reply(50)), applyVerifierReply(finding, reply(50)));
});
check('invalid envelope and severity fail instead of losing a finding', () => {
  for (const input of [null, [], {}, { finding }, { finding, reply: '', extra: true }]) {
    assert.throws(() => consumeVerificationInput(input));
  }
  assert.throws(() => applyVerifierReply({ ...finding, severity: 'unknown' }, reply(80)));
  assert.throws(() => applyVerifierReply({ ...finding, id: 'bad\nid' }, reply(80)));
});
console.log(`PASS ${checks} verification protocol checks`);
