#!/usr/bin/env node
// A second pass: exercise the real CLI boundary and every admitted numeric score.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyVerifierReply, MAX_INPUT_BYTES } from './verification-result.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, 'verification-result.mjs');
const finding = {
  id: 'r2-z03a-002', severity: 'critical', category: 'security',
  verification_score: null, verified: null,
};
let checks = 0;
function check(name, run) {
  try { run(); checks++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
function invoke(input, args = []) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    input, encoding: 'utf8', timeout: 5000, maxBuffer: 2 * MAX_INPUT_BYTES,
  });
  assert.ifError(result.error);
  return result;
}
function payload(reply, extra = {}) { return JSON.stringify({ finding, reply, ...extra }); }

for (let score = 0; score <= 100; score++) {
  check(`admitted score ${score}`, () => {
    const result = applyVerifierReply(finding, `BUG_ID: ${finding.id}\nSCORE: ${score}`);
    assert.equal(result.finding.verification_score, score);
    assert.equal(result.finding.verification_protocol.status, 'parsed');
    assert.equal(result.disposition, score < 40 ? 'unverified' : 'retain');
    assert.equal(result.finding.severity, score >= 40 && score < 80 ? 'high' : 'critical');
  });
}
check('CLI missing score emits unavailable with exit 3', () => {
  const result = invoke(payload(`BUG_ID: ${finding.id}`));
  assert.equal(result.status, 3);
  const output = JSON.parse(result.stdout);
  assert.equal(output.finding.severity, 'critical');
  assert.equal(output.finding.verification_score, null);
  assert.equal(output.disposition, 'retain');
  assert.equal(result.stderr, '');
});
check('CLI valid reply emits mapped result with exit 0', () => {
  const result = invoke(payload(`BUG_ID: ${finding.id}\nSCORE: 80`));
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).finding.verified, true);
});
check('CLI rejects a reply for a different finding without losing this one', () => {
  const result = invoke(payload('BUG_ID: r2-z03a-003\nSCORE: 0'));
  assert.equal(result.status, 3);
  const output = JSON.parse(result.stdout);
  assert.equal(output.finding.id, finding.id);
  assert.equal(output.finding.severity, 'critical');
  assert.equal(output.disposition, 'retain');
});
check('CLI duplicates cannot choose the more favorable score', () => {
  const result = invoke(payload(`BUG_ID: ${finding.id}\nSCORE: 95\nSCORE: 0`));
  assert.equal(result.status, 3);
  assert.equal(JSON.parse(result.stdout).finding.verification_score, null);
});
check('CLI transport absence is unavailable, not a vote', () => {
  const result = invoke(payload(null));
  assert.equal(result.status, 3);
  assert.equal(JSON.parse(result.stdout).finding.verification_protocol.reason, 'reply_not_text');
});
check('CLI invalid JSON exposes no input bytes', () => {
  const result = invoke('{"secret":"do-not-echo-this",');
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.ok(!result.stderr.includes('do-not-echo-this'));
});
check('CLI closed input shape', () => {
  const result = invoke(payload('', { command: 'must never execute' }));
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});
check('CLI input limit', () => {
  const result = invoke(' '.repeat(MAX_INPUT_BYTES + 1));
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});
check('CLI fatal UTF-8 decoding', () => {
  const result = invoke(Buffer.from([0xff, 0xfe]));
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});
check('CLI extra arguments cannot cause path reads', () => {
  const result = invoke(payload(''), ['--input', '/not-a-real-source']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});
check('CLI works through a symlinked plugin path', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'shipguard-verifier-cli-'));
  try {
    const link = join(temporary, 'verification-result.mjs');
    symlinkSync(cli, link);
    const result = spawnSync(process.execPath, [link], {
      input: payload(`BUG_ID: ${finding.id}\nSCORE: 80`),
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).finding.verified, true);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
check('procedure calls shipped CLI and consumes unavailable receipts', () => {
  const procedure = readFileSync(join(here, 'references/verification.md'), 'utf8');
  assert.ok(procedure.includes('verification-result.mjs'));
  assert.ok(procedure.includes('Exit `3`'));
  assert.ok(procedure.includes('original unverified finding'));
  assert.ok(!procedure.includes('assign score `50`'));
  assert.ok(procedure.includes('Unavailable (protocol)'));
});
check('Codex adapter retains report-only and declares Node consumer', () => {
  const adapter = readFileSync(join(here, 'agents/openai.yaml'), 'utf8');
  assert.ok(adapter.includes('without changing source files'));
  assert.ok(adapter.includes('allow_implicit_invocation: false'));
  assert.ok(adapter.includes('verification-result.mjs'));
});
console.log(`PASS ${checks} CLI, exhaustive-score and consumer checks`);
