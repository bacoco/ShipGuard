#!/usr/bin/env node
// Contract fixtures, not a model-quality evaluation. No network, subprocesses or file mutations.
import assert from 'node:assert/strict';
import { makeView, validateController, outputFor } from './lib/dialogue-check.mjs';
let checks = 0;
function test(name, fn) {
  try { fn(); checks++; } catch (error) { error.message = name + ': ' + error.message; throw error; }
}
const input = { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: '65 active clients.' };
const context = { original_request: 'Count the union: 40 subscribers, 25 logged in, 18 overlap.', sources: [] };
const view = makeView(input, context);
const fixture = { status: 'finding', message: 'Fixture: arithmetic correction.', finding: {
  action: 'correct', basis: 'fact', source: 'response', passage: '65',
  interpretations: ['union', 'intersection'], consequences: ['different count'], correction: 'The union is 47.',
  human_intent_missing: false, references: [{ source: 'context.original_request', passage: '40 subscribers, 25 logged in, 18 overlap.' }] } };
const changed = updates => ({ ...fixture, finding: { ...fixture.finding, ...updates } });
const classify = (result, selectedView = view) => validateController(result, selectedView);
test('corrective evidence yields one targeted correction', () => {
  const check = classify(fixture);
  assert.equal(check.action, 'correct'); assert.equal(check.finding.basis, 'fact');
  const out = outputFor(input, view, check);
  assert.equal(out.decision, 'block'); assert.match(out.reason, /preserving valid content/);
  assert.equal(out.hookSpecificOutput, undefined);
});
test('clear preserves a sufficient answer without another turn', () => {
  const goodInput = { ...input, last_assistant_message: '47 active clients.' };
  const goodView = makeView(goodInput, context);
  const check = classify({ status: 'clear', message: 'Fixture: sufficient answer.' }, goodView);
  assert.equal(check.action, 'keep'); assert.equal(outputFor(goodInput, goodView, check).decision, undefined);
});
test('unknown never forces revision', () => {
  const check = classify({ status: 'unknown', message: 'Fixture: insufficient evidence.' });
  assert.equal(check.action, 'unverified'); assert.equal(outputFor(input, view, check).decision, undefined);
});
test('self-citation cannot settle a correction', () => {
  const check = classify(changed({ references: [{ source: 'response', passage: '65' }] }));
  assert.equal(check.status, 'unknown'); assert.equal(outputFor(input, view, check).decision, undefined);
});
test('one user reference does not launder a self-citation', () => {
  assert.equal(classify(changed({ references: [...fixture.finding.references, { source: 'response', passage: '65' }] })).status, 'unknown');
});
for (const origin of ['assistant', 'summary', 'unknown', undefined]) test('derived/unattributed source cannot settle: ' + origin, () => {
  const selected = makeView(input, { ...context, sources: [{ reference: 'note', text: 'Use 47.', ...(origin ? { origin } : {}) }] });
  assert.equal(classify(changed({ references: [{ source: 'context.sources.0.text', passage: 'Use 47.' }] }), selected).status, 'unknown');
});
for (const origin of ['user', 'tool', 'document']) test('declared source can support a factual correction: ' + origin, () => {
  const selected = makeView(input, { ...context, sources: [{ reference: 'selected source', text: 'Use 47.', origin }] });
  assert.equal(classify(changed({ references: [{ source: 'context.sources.0.text', passage: 'Use 47.' }] }), selected).action, 'correct');
});
for (const origin of ['tool', 'document']) test('fact evidence cannot settle human intent: ' + origin, () => {
  const selected = makeView(input, { ...context, sources: [{ reference: 'selected source', text: 'Use 47.', origin }] });
  assert.equal(classify(changed({ basis: 'intent', references: [{ source: 'context.sources.0.text', passage: 'Use 47.' }] }), selected).status, 'unknown');
});
test('source label is not the supporting passage', () => {
  const selected = makeView(input, { ...context, sources: [{ reference: 'Use 47.', text: 'Some text.', origin: 'user' }] });
  assert.equal(classify(changed({ references: [{ source: 'context.sources.0.reference', passage: 'Use 47.' }] }), selected).status, 'unknown');
});
test('a Stop finding must target the response', () => {
  assert.equal(classify(changed({ source: 'context.original_request', passage: 'Count the union' })).status, 'unknown');
});
test('invented quotes and missing corrective references are protocol failures', () => {
  assert.throws(() => classify(changed({ passage: 'invented quote' })));
  assert.throws(() => classify(changed({ references: [] })));
});
const question = 'Does active mean subscribed, logged in, both, or either?';
const ask = changed({ action: 'ask', basis: 'intent', human_intent_missing: true, references: [],
  correction: 'Clarify the definition.', question });
const ambiguousContext = { original_request: 'How many active clients: 40 subscribed, 25 logged in, 18 overlap?', sources: [] };
test('clarification has its own user-facing question and stops for the real user', () => {
  const ambiguous = makeView(input, ambiguousContext), check = classify(ask, ambiguous);
  assert.equal(check.action, 'ask'); assert.equal(check.finding.question, question);
  const out = outputFor(input, ambiguous, check);
  assert.equal(out.decision, 'block'); assert.match(out.reason, /Stop for the real user answer/);
});
test('the complete response already asks the question: wait without duplicate block', () => {
  const pending = { ...input, last_assistant_message: '  ' + question.replaceAll(' ', '  ') + '\n' };
  const pendingView = makeView(pending, ambiguousContext);
  const check = classify({ ...ask, finding: { ...ask.finding, passage: 'active' } }, pendingView);
  assert.equal(check.status, 'unknown'); assert.equal(check.action, 'wait');
  assert.equal(outputFor(pending, pendingView, check).decision, undefined);
});
test('a truncated response cannot establish that the complete response is the question', () => {
  const pending = { ...input, last_assistant_message: question + ' '.repeat(4096) + 'I will use 47 without waiting.' };
  const pendingView = makeView(pending, ambiguousContext);
  assert.equal(pendingView.coverage.truncated, true);
  assert.equal(pendingView.response.trim(), question);
  const check = classify({ ...ask, finding: { ...ask.finding, passage: 'active' } }, pendingView);
  assert.equal(check.status, 'unknown'); assert.equal(check.action, 'unverified');
  assert.doesNotMatch(check.message, /exactly the proposed question/);
  assert.equal(outputFor(pending, pendingView, check).decision, undefined);
});
test('a short complete question still waits when only selected context is truncated', () => {
  const pending = { ...input, last_assistant_message: question };
  const pendingView = makeView(pending, { ...ambiguousContext,
    sources: [{ reference: 'long source', text: 'x'.repeat(5000), origin: 'document' }] });
  assert.equal(pendingView.coverage.truncated, true);
  const check = classify({ ...ask, finding: { ...ask.finding, passage: 'active' } }, pendingView);
  assert.equal(check.action, 'wait');
  assert.equal(outputFor(pending, pendingView, check).decision, undefined);
});
test('a complete question at the string cap still waits without reported truncation', () => {
  const pending = { ...input, last_assistant_message: question.padEnd(4096) };
  const pendingView = makeView(pending, ambiguousContext);
  assert.equal(pendingView.coverage.truncated, false);
  assert.equal(classify({ ...ask, finding: { ...ask.finding, passage: 'active' } }, pendingView).action, 'wait');
});
test('aggregate truncation cannot prove completeness of a response at the string cap', () => {
  const pending = { ...input, last_assistant_message: question.padEnd(4096) };
  const pendingView = makeView(pending, { ...ambiguousContext,
    sources: [{ reference: 'long source', text: 'x'.repeat(5000), origin: 'document' }] });
  assert.equal(pendingView.coverage.truncated, true);
  assert.equal(classify({ ...ask, finding: { ...ask.finding, passage: 'active' } }, pendingView).action, 'unverified');
});
test('a nonmatching truncated response can still receive one grounded clarification', () => {
  const pending = { ...input, last_assistant_message: '65 active clients.' + ' '.repeat(4096) };
  const pendingView = makeView(pending, ambiguousContext);
  assert.equal(pendingView.coverage.truncated, true);
  const check = classify(ask, pendingView);
  assert.equal(check.action, 'ask');
  assert.equal(outputFor(pending, pendingView, check).decision, 'block');
});
test('a quoted example is not mistaken for the whole question', () => {
  const quoted = { ...input, last_assistant_message: 'Example only: "' + question + '"' };
  const quotedView = makeView(quoted, ambiguousContext);
  assert.equal(classify({ ...ask, finding: { ...ask.finding, passage: 'active' } }, quotedView).action, 'ask');
});
test('missing original request cannot ground a fresh clarification', () => {
  assert.equal(classify(ask, makeView(input)).status, 'unknown');
});
test('action, basis and question must be consistent', () => {
  assert.throws(() => classify(changed({ action: 'ask' })));
  assert.throws(() => classify({ ...ask, finding: { ...ask.finding, action: 'correct' } }));
  assert.throws(() => classify(changed({ action: 'keep' })));
  assert.throws(() => classify({ ...ask, finding: { ...ask.finding, basis: 'fact' } }));
  assert.throws(() => classify(changed({ basis: 'unknown' })));
  assert.throws(() => classify(changed({ question })));
});
test('legacy findings normalize without granting new provenance', () => {
  const legacy = changed({ action: undefined, basis: undefined });
  assert.equal(classify(legacy).action, 'correct');
  const legacyAsk = { ...ask, finding: { ...ask.finding, action: undefined, basis: undefined, question: undefined, correction: question } };
  assert.equal(classify(legacyAsk).finding.question, question);
  const selected = makeView(input, { ...context, sources: [{ reference: 'tool', text: 'Use 47.', origin: 'tool' }] });
  assert.equal(classify(changed({ basis: undefined, references: [{ source: 'context.sources.0.text', passage: 'Use 47.' }] }), selected).status, 'unknown');
});
test('clear is downgraded for known missing, redacted or truncated coverage', () => {
  for (const selected of [makeView(input), makeView(input, { ...context, original_request: 'x'.repeat(5000) }),
      makeView(input, { ...context, original_request: 'password=fixture-only' })]) {
    assert.equal(classify({ status: 'clear', message: 'Fixture.' }, selected).status, 'unknown');
  }
});
test('a local evidenced error may remain visible in partial context', () => {
  const selected = makeView(input, { ...context, original_request: '', sources: [{ reference: 'calculation', text: 'Use 47.', origin: 'tool' }] });
  assert.equal(classify(changed({ references: [{ source: 'context.sources.0.text', passage: 'Use 47.' }] }), selected).action, 'correct');
});
test('proposed tool arguments are not independent evidence', () => {
  const toolInput = { hook_event_name: 'PreToolUse', tool_input: { command: 'publish now' } };
  const selected = makeView(toolInput, context);
  const result = changed({ source: 'tool_input.command', passage: 'publish', references: [{ source: 'tool_input.command', passage: 'publish' }] });
  assert.equal(classify(result, selected).status, 'unknown');
});
test('raw tool observations can support fact corrections but not intent', () => {
  const toolInput = { hook_event_name: 'PostToolUse', tool_response: { status: 'failed', detail: 'No publication.' } };
  const selected = makeView(toolInput, context);
  const result = changed({ source: 'tool_response.status', passage: 'failed', references: [{ source: 'tool_response.detail', passage: 'No publication.' }] });
  assert.equal(classify(result, selected).action, 'correct');
  assert.equal(classify({ ...result, finding: { ...result.finding, basis: 'intent' } }, selected).status, 'unknown');
  const out = outputFor(toolInput, selected, classify(result, selected));
  assert.equal(out.decision, undefined); assert.equal(out.hookSpecificOutput.updatedToolOutput, undefined);
});
test('reentry and missing host flag never create another correction', () => {
  for (const flag of [true, undefined]) assert.equal(outputFor({ ...input, stop_hook_active: flag }, view, classify(fixture)).decision, undefined);
});
test('the hook does not mutate the request, response or selected context', () => {
  const before = JSON.stringify({ input, context });
  outputFor(input, view, classify(fixture));
  assert.equal(JSON.stringify({ input, context }), before);
  assert.equal(view.schema_version, '1.1');
});
console.log('dialogue review smoke: ' + checks + ' contract cases passed (no model calls)');
