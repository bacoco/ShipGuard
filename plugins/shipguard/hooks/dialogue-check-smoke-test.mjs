#!/usr/bin/env node
// Deterministic protocol/fault fixtures only. No model calls or semantic evaluation.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeView, classify, validateController, outputFor } from './lib/dialogue-check.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const cli = join(root, 'dialogue-check.mjs');
const temp = mkdtempSync(join(tmpdir(), 'shipguard-dialogue-smoke-'));
const safeEnv = { ...process.env, SHIPGUARD_DIALOGUE_HOOKS: '', SHIPGUARD_DIALOGUE_TOOL_CHECKS: '',
  SHIPGUARD_DIALOGUE_CONTROLLER: '', SHIPGUARD_DIALOGUE_CONTROLLER_ACTIVE: '', SHIPGUARD_DIALOGUE_CONTEXT: '',
  SHIPGUARD_DIALOGUE_ENDPOINT: '', SHIPGUARD_DIALOGUE_MODEL: '', SHIPGUARD_DIALOGUE_API_KEY: '',
  SHIPGUARD_DIALOGUE_DEADLINE: '', SHIPGUARD_DIALOGUE_TIMEOUT_MS: '500' };
function run(input, env = {}) {
  const result = spawnSync(process.execPath, [cli], { input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...safeEnv, ...env }, encoding: 'utf8', timeout: 4000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
}
const on = { SHIPGUARD_DIALOGUE_HOOKS: '1' };
try {
  assert.equal(run('{broken'), null, 'disabled hooks must not consume input');
  assert.equal(run({}, { ...on, SHIPGUARD_DIALOGUE_CONTROLLER_ACTIVE: '1' }), null);
  assert.equal(run({ hook_event_name: 'SessionStart' }, on), null);
  assert.equal(run({ hook_event_name: 'PreToolUse', tool_input: {} }, on), null);
  assert.equal(classify('continue'), 'continuation');
  assert.match(classify('oui je confirme'), /unknown/);
  assert.match(classify('Peux-tu publier ?'), /unconfirmed/);
  const input = { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Protocol fixture: published.' };
  const context = { original_request: 'Protocol fixture: inspect only.', sources: [{ reference: 'fixture instruction', text: 'Protocol fixture: no publication performed.' }] };
  const view = makeView(input, context);
  const finding = { status: 'finding', message: 'Protocol fixture: unsupported completion', finding: {
    source: 'response', passage: 'published.', interpretations: ['branch pushed', 'main merged'],
    consequences: ['delivery may be overstated'], correction: 'Say only what the source establishes.',
    human_intent_missing: false, references: [{ source: 'context.sources.0.text', passage: 'no publication performed.' }] } };
  assert.equal(validateController(finding, view).status, 'finding');
  assert.throws(() => validateController({ ...finding, finding: { ...finding.finding, passage: 'invented' } }, view));
  assert.throws(() => validateController({ ...finding, finding: { ...finding.finding, references: [] } }, view));
  assert.equal(outputFor(input, view, finding).decision, 'block');
  assert.equal(outputFor({ ...input, stop_hook_active: true }, view, finding).decision, undefined);
  assert.equal(outputFor({ ...input, stop_hook_active: undefined }, view, finding).decision, undefined);
  assert.equal(validateController({ status: 'clear', message: 'fixture' }, makeView(input)).status, 'unknown');
  const original = JSON.stringify(input);
  outputFor(input, view, finding); assert.equal(JSON.stringify(input), original);
  const prompt = { hook_event_name: 'UserPromptSubmit', prompt: 'continue' };
  assert.match(run(prompt, on).hookSpecificOutput.additionalContext, /Lexical hint only: continuation/);
  assert.match(run('{invalid', on).systemMessage, /NOT VERIFIED/);
  assert.match(run('x'.repeat(256 * 1024 + 1), on).systemMessage, /NOT VERIFIED/);
  const contextPath = join(temp, 'selected.json'); writeFileSync(contextPath, JSON.stringify(context));
  const controllerPath = join(temp, 'controller.mjs');
  writeFileSync(controllerPath, 'let raw=""; for await (const c of process.stdin) raw+=c; const v=JSON.parse(raw); console.log(JSON.stringify(' + JSON.stringify(finding) + '));');
  const configured = { ...on, SHIPGUARD_DIALOGUE_CONTEXT: contextPath, SHIPGUARD_DIALOGUE_CONTROLLER: controllerPath };
  const corrected = run(input, configured);
  assert.equal(corrected.decision, 'block'); assert.match(corrected.reason, /NOT a new user request/);
  assert.equal(run({ ...input, stop_hook_active: true }, configured).decision, undefined);
  writeFileSync(controllerPath, 'console.log("bad JSON")');
  const failed = run(input, configured);
  assert.match(failed.systemMessage, /unavailable/);
  assert.equal(failed.decision, 'block', 'failure status must reach model context once');
  assert.match(failed.reason, /Do not retry the controller/);
  assert.equal(run({ ...input, stop_hook_active: true }, configured).decision, undefined);
  writeFileSync(controllerPath, 'setInterval(()=>{},1000)');
  assert.match(run(input, { ...configured, SHIPGUARD_DIALOGUE_TIMEOUT_MS: '50' }).systemMessage, /unavailable/);
  writeFileSync(controllerPath, 'process.exit(1)');
  assert.match(run(input, configured).systemMessage, /unavailable/);
  const expired = { ...on, SHIPGUARD_DIALOGUE_DEADLINE: '2000-01-01T00:00:00Z' };
  assert.equal(run(input, expired).continue, false);
  assert.equal(run(prompt, expired).continue, false);
  const pre = run({ hook_event_name: 'PreToolUse', tool_input: { command: 'fixture command' } }, { ...expired, SHIPGUARD_DIALOGUE_TOOL_CHECKS: '1' });
  assert.equal(pre.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(pre.continue, undefined, 'Codex does not support continue:false before tools');
  const post = run({ hook_event_name: 'PostToolUse', tool_response: { status: 'error', password: 'fixture-sensitive-value' } }, { ...on, SHIPGUARD_DIALOGUE_TOOL_CHECKS: '1' });
  assert.equal(post.decision, undefined); assert.equal(post.continue, undefined);
  assert.equal(post.hookSpecificOutput.updatedMCPToolOutput, undefined);
  assert.ok(!JSON.stringify(post).includes('fixture-sensitive-value'));
  for (const raw of ['Authorization: Basic fixture-basic-sensitive', 'Cookie: session=fixture-cookie-sensitive; other=fixture-second-cookie',
      'https://fixture-user:fixture-password@host/path', '{"password":"fixture-json-sensitive"}', '{"token":"fixture-token-sensitive"}',
      '{"Authorization":"Basic fixture-json-basic-sensitive"}', '-----BEGIN PRIVATE KEY-----\nfixture-private-key\n-----END PRIVATE KEY-----']) {
    const redacted = makeView({ hook_event_name: 'PostToolUse', tool_response: raw });
    assert.equal(redacted.coverage.redacted, true, 'text credential not declared redacted');
    assert.ok(!JSON.stringify(redacted).includes('fixture-'), 'text credential leaked to controller view');
  }
  const unsafe = outputFor(input, view, { status: 'unknown', message: 'password=fixture-sensitive-value' });
  assert.ok(!JSON.stringify(unsafe).includes('fixture-sensitive-value'));
  const manifest = JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8'));
  const missionCommand = 'node \"${CLAUDE_PLUGIN_ROOT}/skills/sg-mission-lock/scripts/inject-mission-lock.mjs\"';
  for (const event of ['SessionStart', 'UserPromptSubmit', 'SubagentStart']) {
    const group = { hooks: [{ type: 'command', command: missionCommand, timeout: 5 }] };
    if (event === 'SessionStart') group.matcher = 'startup|resume|clear|compact';
    assert.deepEqual(manifest.hooks[event][0], group, 'original mission hook declaration changed');
  }
  for (const event of ['UserPromptSubmit','PreToolUse','PostToolUse','Stop']) assert.ok(manifest.hooks[event].some(g => g.hooks.some(h => h.command.includes('/hooks/dialogue-check.mjs'))));
  assert.deepEqual(readdirSync(join(root, '../skills/grill-goal')), ['SKILL.md']);
  console.log('dialogue hook smoke: passed (protocol/fault fixtures; no model calls)');
} finally { rmSync(temp, { recursive: true, force: true }); }
