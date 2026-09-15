#!/usr/bin/env node
// Real repository source; provenance/safety checks, not agent effectiveness.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardDecision, validateEvidence } from './evidence-guard.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const excerpt = readFileSync(resolve(root, 'evidence-guard.mjs'), 'utf8').split('\n')[0];
const citation = { path: 'evidence-guard.mjs', start: 1, end: 1, excerpt };
const reads = [{ path: 'evidence-guard.mjs', start: 1, end: 1 }];
const result = { decision: 'none', comparison: 'Agent claim, not semantic proof', evidence: [citation] };
assert.deepEqual(validateEvidence(root, [citation], reads), []);
assert.equal(guardDecision(root, result, reads).semantic_verification, 'not verified');
assert.equal(guardDecision(root, { ...result, evidence: [] }, reads).decision, 'undetermined');
assert.equal(guardDecision(root, { ...result, evidence: [] }, reads).status, 'partial');
assert.equal(guardDecision(root, result, []).status, 'partial');
assert.equal(guardDecision(root, { ...result, evidence: [{ ...citation, excerpt: excerpt.slice(1) }] }, reads).status, 'partial');
assert.ok(validateEvidence(root, [{ ...citation, path: '../sg-logic-audit/SKILL.md' }], reads).some(e => /outside/.test(e)));
assert.ok(validateEvidence(root, [{ ...citation, end: 9 }], reads).length);
assert.equal(guardDecision(root, { ...result, decision: 'undetermined' }, reads).status, 'partial');
console.log('evidence guard smoke test passed (provenance only; semantics not verified)');
