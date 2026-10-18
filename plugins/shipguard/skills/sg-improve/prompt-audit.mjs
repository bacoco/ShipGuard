#!/usr/bin/env node
// JSON stdin -> inventory or validated report + proposed diff on stdout. No filesystem writes.
import { inventory, MAX_REQUEST_BYTES } from './scripts/prompt-audit-input.mjs';
import { review } from './scripts/prompt-audit-review.mjs';

let timer;
try {
  if (process.argv.length !== 2) throw new Error('No CLI flags supported; supply one JSON request on stdin');
  timer = setTimeout(() => {
    process.stderr.write('prompt-audit: stdin deadline exceeded\n');
    process.exit(1);
  }, 10000);
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > MAX_REQUEST_BYTES) throw new Error('request size limit exceeded');
    chunks.push(chunk);
  }
  clearTimeout(timer);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  let request;
  try { request = JSON.parse(text); } catch { throw new Error('invalid JSON request'); }
  const result = request?.operation === 'review' ? review(request) : inventory(request).receipt;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'partial') process.exitCode = 1;
} catch (error) {
  clearTimeout(timer);
  process.stderr.write(`prompt-audit: ${error.code ? 'input unavailable' : error.message}\n`);
  process.exitCode = 1;
}
