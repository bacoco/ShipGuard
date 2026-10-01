#!/usr/bin/env node
// Deterministic source/coverage tests; no inference and no semantic-quality claim.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshot, parseCriteria, loadGoalInputs, inputChanges, MAX_BYTES } from './goal-input.mjs';
import { guardDecision } from './evidence-guard.mjs';
import { guardGoalDecision } from './goal-coverage.mjs';
const root = mkdtempSync(join(tmpdir(), 'sg-goal-unit-'));
let cases = 0;
function test(name, fn) { fn(); cases++; console.log('ok', name); }
const request = join(root, 'request.md'), goal = join(root, 'goal.md'), source = join(root, 'app.js');
const original = 'Keep SSO and denied access.\n';
const markdown = '# Goal\n\n## Success criteria\n### SG-R1 — Keep SSO\nUse the existing identity provider.\n### SG-R2 — Denied access\nAn unauthorized user stays denied.\n\n## Progress\nNever weaken the criteria.\n';
writeFileSync(request, original); writeFileSync(goal, markdown); writeFileSync(source, 'const sso = true;\nconst allowUnknown = false;\n');
const inputs = loadGoalInputs(request, goal);
const a = { path: 'app.js', start: 1, end: 1, excerpt: 'const sso = true;' };
const b = { path: 'app.js', start: 2, end: 2, excerpt: 'const allowUnknown = false;' };
const reads = [{ path: 'app.js', start: 1, end: 2 }];
const result = {
  decision: 'none', comparison: 'Two separate static comparisons; execution not performed', evidence: [a],
  goal_alignment: { status: 'consistent', comparison: 'The two supplied criteria correspond to the two requested constraints.' },
  goal_coverage: [a, b].map((cite, i) => ({ id: `SG-R${i + 1}`, status: 'analyzed', comparison: 'Inspect the returned value, not just a name.', verification: 'Proposed allowed/denied scenario; not run.', evidence: [cite] })),
};
const copy = () => structuredClone(result);
const check = value => guardGoalDecision(root, value, reads, inputs);
try {
  test('snapshot retains exact request bytes', () => assert.equal(inputs.request.text, original));
  test('snapshot preserves a UTF-8 BOM instead of silently dropping bytes', () => {
    const bom = join(root, 'bom.md'); writeFileSync(bom, '\uFEFF' + original);
    assert.equal(snapshot(bom).text, '\uFEFF' + original);
  });
  test('BOM on first section heading is accepted without rewriting text', () => {
    assert.equal(parseCriteria('\uFEFF## Success criteria\n### SG-R1 — SSO\nKeep SSO.').length, 1);
  });
  test('two frozen criteria with source locations', () => {
    assert.equal(inputs.criteria.length, 2); assert.equal(inputs.criteria[0].start, 4);
    assert.equal(inputs.criteria[1].end, 8); assert.ok(Object.isFrozen(inputs.criteria));
  });
  test('legacy path is exactly unchanged', () => assert.deepEqual(guardGoalDecision(root, result, reads), guardDecision(root, result, reads)));
  test('reproduce missing-criterion gap in original guard', () => {
    const value = copy(); value.goal_coverage.pop();
    assert.equal(guardDecision(root, value, reads).status, 'completed');
    assert.equal(check(value).status, 'partial'); assert.ok(check(value).errors.includes('GOAL_CRITERION_MISSING:SG-R2'));
  });
  test('covered citations do not prove semantics or grant authority', () => {
    const verdict = check(result);
    assert.equal(verdict.status, 'completed'); assert.equal(verdict.goal_review.coverage_status, 'complete');
    assert.equal(verdict.semantic_verification, 'not verified'); assert.equal(verdict.goal_review.authority_effect, 'none');
  });
  test('counterexample: wrong semantics can still have valid provenance', () => {
    const value = copy(); value.goal_coverage[1].comparison = 'Removing all denials is beneficial.';
    assert.equal(check(value).status, 'completed'); assert.equal(check(value).semantic_verification, 'not verified');
  });
  test('missing whole coverage is partial', () => { const v = copy(); delete v.goal_coverage; assert.equal(check(v).decision, 'undetermined'); });
  test('duplicate ID cannot stand in for omitted criterion', () => { const v = copy(); v.goal_coverage[1].id = 'SG-R1'; assert.equal(check(v).status, 'partial'); });
  test('invented criterion ID rejected', () => { const v = copy(); v.goal_coverage[1].id = 'SG-R99'; assert.equal(check(v).status, 'partial'); });
  test('unread citation rejected per criterion', () => assert.equal(guardGoalDecision(root, result, [{ path: 'app.js', start: 1, end: 1 }], inputs).status, 'partial'));
  test('fabricated excerpt rejected per criterion', () => { const v = copy(); v.goal_coverage[1].evidence[0].excerpt = 'allow all'; assert.equal(check(v).status, 'partial'); });
  test('no evidence for analyzed criterion rejected', () => { const v = copy(); v.goal_coverage[1].evidence = []; assert.equal(check(v).status, 'partial'); });
  test('unknown alignment cannot pass', () => { const v = copy(); v.goal_alignment.status = 'unknown'; assert.equal(check(v).status, 'partial'); });
  test('conflicting alignment cannot pass', () => { const v = copy(); v.goal_alignment.status = 'conflict'; assert.equal(check(v).status, 'partial'); });
  test('missing alignment cannot pass', () => { const v = copy(); delete v.goal_alignment; assert.equal(check(v).status, 'partial'); });
  test('unresolved row remains visible without invented evidence', () => {
    const v = copy(); v.goal_coverage[1].status = 'unresolved'; v.goal_coverage[1].evidence = [];
    const verdict = check(v); assert.equal(verdict.status, 'partial'); assert.equal(verdict.goal_review.criteria[1].analysis_claim.status, 'unresolved');
  });
  test('conflict remains partial despite valid quotations', () => { const v = copy(); v.goal_coverage[1].status = 'conflict'; assert.equal(check(v).status, 'partial'); });
  test('proposed verification must be present', () => { const v = copy(); v.goal_coverage[1].verification = ''; assert.equal(check(v).status, 'partial'); });
  test('malformed evidence is handled, not thrown', () => { const v = copy(); v.goal_coverage[1].evidence = [null]; assert.equal(check(v).status, 'partial'); });
  test('extra approval fields confer no authority', () => {
    const v = copy(); v.goal_coverage[0].approved = true; v.goal_alignment.permissionDecision = 'allow';
    const verdict = check(v); assert.equal(verdict.goal_review.authority_effect, 'none'); assert.equal(verdict.goal_review.criteria[0].analysis_claim.approved, undefined);
  });
  test('legacy goal is not silently converted', () => assert.throws(() => parseCriteria('# Goal\nJust make it good.')));
  test('duplicate section rejected', () => assert.throws(() => parseCriteria(markdown + '\n## Success criteria\n')));
  test('duplicate heading rejected', () => assert.throws(() => parseCriteria(markdown.replace('SG-R2', 'SG-R1'))));
  test('unnumbered criterion is not ignored', () => assert.throws(() => parseCriteria(markdown.replace('### SG-R2 — Denied access', '### Denied access'))));
  test('unnumbered preamble is not ignored', () => assert.throws(() => parseCriteria(markdown.replace('## Success criteria\n', '## Success criteria\nDo not forget security.\n'))));
  test('empty criterion rejected', () => assert.throws(() => parseCriteria(markdown.replace('Use the existing identity provider.\n', ''))));
  test('criterion outside designated section rejected', () => assert.throws(() => parseCriteria(markdown + '\n### SG-R3 — Extra\nBody')));
  test('nested heading stays within criterion', () => assert.equal(parseCriteria(markdown.replace('Use the existing', '#### Conditions\nUse the existing')).length, 2));
  test('fenced example is not a real criterion', () => {
    const block = '```md\n### SG-R99 — Example\nNot a requirement.\n```\n';
    assert.equal(parseCriteria(markdown.replace('An unauthorized', block + 'An unauthorized')).length, 2);
  });
  test('tilde fence and CRLF supported', () => assert.equal(parseCriteria(markdown.replace('Use the existing', '~~~js\n### SG-R99 — Example\n~~~\nUse the existing').replace(/\n/g, '\r\n')).length, 2));
  test('unclosed fence rejected', () => assert.throws(() => parseCriteria(markdown + '\n```\n')));
  test('criterion count transport limit rejects, never truncates', () => {
    const doc = '## Success criteria\n' + Array.from({ length: 17 }, (_, i) => `### SG-R${i + 1} — C\nBody\n`).join(''); assert.throws(() => parseCriteria(doc));
  });
  test('oversized input rejected', () => { writeFileSync(join(root, 'large'), 'x'.repeat(MAX_BYTES + 1)); assert.throws(() => snapshot(join(root, 'large'))); });
  test('malformed UTF-8 rejected', () => { writeFileSync(join(root, 'binary'), Buffer.from([0xc3, 0x28])); assert.throws(() => snapshot(join(root, 'binary'))); });
  test('NUL rejected', () => { writeFileSync(join(root, 'nul'), 'x\0y'); assert.throws(() => snapshot(join(root, 'nul'))); });
  test('directory rejected', () => assert.throws(() => snapshot(root)));
  test('missing input rejected', () => assert.throws(() => snapshot(join(root, 'missing'))));
  test('goal revision invalidates report without replacing snapshot', () => {
    writeFileSync(goal, markdown.replace('Keep SSO', 'Remove SSO')); assert.equal(check(result).status, 'partial');
    assert.ok(inputChanges(inputs).includes('GOAL_CHANGED')); assert.equal(inputs.goal.text, markdown); writeFileSync(goal, markdown);
  });
  test('request revision invalidates report', () => { writeFileSync(request, original + 'New requirement.'); assert.ok(check(result).errors.includes('REQUEST_CHANGED')); writeFileSync(request, original); });
  test('unavailable input is not unchanged', () => { rmSync(goal); assert.equal(check(result).goal_review.inputs_unchanged, false); writeFileSync(goal, markdown); });
  test('symlink retarget with identical content changes selected identity', () => {
    writeFileSync(join(root, 'other.md'), markdown); symlinkSync(goal, join(root, 'link.md'));
    const linked = loadGoalInputs(request, join(root, 'link.md')); rmSync(join(root, 'link.md')); symlinkSync(join(root, 'other.md'), join(root, 'link.md'));
    assert.ok(inputChanges(linked).includes('GOAL_CHANGED'));
  });
  test('citation path outside repository rejected', () => {
    mkdirSync(join(root, 'nested')); const v = copy(); v.evidence = [{ ...a, path: '../app.js' }];
    assert.equal(guardGoalDecision(join(root, 'nested'), v, reads, inputs).status, 'partial');
  });
  console.log(`${cases} goal coverage checks passed; semantic effectiveness NOT VERIFIED`);
} finally { rmSync(root, { recursive: true, force: true }); }
