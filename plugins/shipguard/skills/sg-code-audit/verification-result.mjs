#!/usr/bin/env node
// Phase 5.7 protocol validation, not a semantic correctness or delivery gate.
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAX_REPLY_BYTES = 4096;
export const MAX_INPUT_BYTES = 1024 * 1024;
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const ID = /^r\d+-(?:z\w+|xz)-\d{3}$/;

/** Parse the entire reply, rather than extracting one convenient SCORE line. */
export function parseVerifierReply(raw, expectedId) {
  if (typeof expectedId !== 'string' || expectedId.length > 128 || !ID.test(expectedId)) {
    throw new TypeError('Expected finding ID is invalid');
  }
  const unavailable = reason => ({ status: 'unavailable', score: null, reason });
  if (typeof raw !== 'string') return unavailable('reply_not_text');
  if (Buffer.byteLength(raw, 'utf8') > MAX_REPLY_BYTES) return unavailable('reply_too_large');
  // Accept LF/CRLF and trailing newlines only. Never coerce control characters,
  // Unicode look-alikes, Markdown fences or a second answer into a valid reply.
  const lines = raw.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length !== 2) return unavailable('expected_two_lines');
  const identity = /^BUG_ID: (.+)$/.exec(lines[0]);
  if (!identity) return unavailable('invalid_id_line');
  if (identity[1] !== expectedId) return unavailable('finding_id_mismatch');
  const score = /^SCORE: (0|[1-9][0-9]?|100)$/.exec(lines[1]);
  if (!score) return unavailable('invalid_score_line');
  return { status: 'parsed', score: Number(score[1]), reason: null };
}

/**
 * Consume the original, unverified finding captured for this dispatch.
 * Valid numeric replies retain the existing score policy. Invalid replies
 * cannot downgrade, remove or positively confirm a finding. Inputs are copied.
 */
export function applyVerifierReply(finding, raw) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)
      || !SEVERITIES.has(finding.severity)) {
    throw new TypeError('Expected an original finding with a canonical severity');
  }
  if (Object.hasOwn(finding, 'verification_protocol')
      || finding.verification_score != null || finding.verified != null) {
    throw new TypeError('Use the original unverified finding, not a previously projected result');
  }
  const parsed = parseVerifierReply(raw, finding.id);
  const bytes = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : null;
  const copy = structuredClone(finding);
  copy.verification_score = parsed.score;
  copy.verified = null;
  copy.verification_protocol = {
    status: parsed.status,
    reason: parsed.reason,
    raw_reply: typeof raw === 'string' && bytes <= MAX_REPLY_BYTES ? raw : null,
    raw_reply_bytes: bytes,
    raw_reply_sha256: typeof raw === 'string'
      ? createHash('sha256').update(raw, 'utf8').digest('hex') : null,
    semantic_verification: 'not_verified',
  };
  let disposition = 'retain';
  if (parsed.status === 'parsed') {
    if (parsed.score >= 80) copy.verified = true;
    else if (parsed.score >= 40) {
      copy.verified = 'uncertain';
      // Legacy policy for VALID replies only. Its broader evidence/score
      // semantics remain a separate, explicitly open question in issue #101.
      if (copy.severity === 'critical') copy.severity = 'high';
      else if (copy.severity === 'high') copy.severity = 'medium';
    } else {
      copy.verified = false;
      disposition = 'unverified';
    }
  }
  return { disposition, finding: copy };
}

export function consumeVerificationInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['finding', 'reply'].includes(key))
      || !Object.hasOwn(input, 'finding') || !Object.hasOwn(input, 'reply')) {
    throw new TypeError('Input must contain exactly finding and reply');
  }
  return applyVerifierReply(input.finding, input.reply);
}

async function main() {
  if (process.argv.length !== 2) throw new Error('Usage: node verification-result.mjs < input.json');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) throw new Error('Input exceeds 1 MiB');
    chunks.push(chunk);
  }
  // Fatal decoding prevents replacement characters from changing the reply
  // before its digest is recorded. The CLI never reads paths or executes data.
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  const result = consumeVerificationInput(JSON.parse(text));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  // This exit reports protocol availability, NEVER whether a project is clean.
  process.exitCode = result.finding.verification_protocol.status === 'unavailable' ? 3 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Do not echo malformed input, which can contain repository content.
    process.stderr.write('Verification input invalid or unreadable; retain the original finding.\n');
    process.exitCode = 2;
  });
}
