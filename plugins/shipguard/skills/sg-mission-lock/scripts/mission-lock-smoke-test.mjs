#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, "inject-mission-lock.mjs");
const setter = join(here, "set-strict-mode.mjs");
const skill = join(here, "..", "SKILL.md");
const adapter = join(here, "..", "agents", "openai.yaml");
const hooksJson = join(here, "..", "..", "..", "hooks", "hooks.json");
const testRoot = mkdtempSync(join(tmpdir(), "shipguard-mission-lock-"));
const testConfig = join(testRoot, "mission-lock.json");

function run(input, env = {}) {
  const result = spawnSync(process.execPath, [hook], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      SHIPGUARD_MISSION_LOCK_CONFIG: testConfig,
      ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout ? JSON.parse(result.stdout) : null;
}

function assertActive(input) {
  const result = run(input);
  assert.ok(result, `expected activation for ${JSON.stringify(input)}`);
  assert.equal(result.hookSpecificOutput.hookEventName, input.hook_event_name);
  assert.match(result.hookSpecificOutput.additionalContext, /\$sg-mission-lock/);
  assert.match(result.hookSpecificOutput.additionalContext, /never broaden authority/);
  assert.match(result.hookSpecificOutput.additionalContext, /complete authorized delta/);
  assert.match(result.hookSpecificOutput.additionalContext, /own plan, proposal/);
  assert.match(result.hookSpecificOutput.additionalContext, /ask one explicit question/);
  assert.equal(
    result.hookSpecificOutput.additionalContext.includes("persistent default is ON"),
    true,
  );
  assert.match(result.hookSpecificOutput.additionalContext, /ordinary chat language/);
}

function setPersistentMode(action) {
  const result = spawnSync(process.execPath, [setter, action], {
    encoding: "utf8",
    env: {
      ...process.env,
      SHIPGUARD_MISSION_LOCK_CONFIG: testConfig,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function assertInactive(input) {
  assert.equal(run(input), null, `unexpected activation for ${JSON.stringify(input)}`);
}

// Payload shapes, kept apart on purpose. The fixtures below used to put a
// `model` field on UserPromptSubmit and SubagentStart, which no runtime sends:
// per https://code.claude.com/docs/en/hooks only SessionStart can carry
// `model`, and Claude Code does not always include it even there. The suite
// therefore went green on paths the runtime cannot take, and could not have
// caught a regression against the real contract.
//
// Claude Code UserPromptSubmit keys, captured on 2.1.257 / macOS arm64 by a
// hook writing its raw stdin: session_id, transcript_path, cwd, scratchpad_dir,
// prompt_id, permission_mode, hook_event_name, prompt.
function claudeCode(hook_event_name, extra = {}) {
  return {
    session_id: "b7c1f0e2-4d3a-4f28-9c11-0a5e6d7b8c90",
    transcript_path: "/Users/dev/.claude/projects/demo/transcript.jsonl",
    cwd: "/Users/dev/demo",
    scratchpad_dir: "/tmp/claude/demo/scratchpad",
    prompt_id: "0f2b9a44-8e15-4c73-b6d2-1e7a3c9f5b08",
    permission_mode: "default",
    hook_event_name,
    ...extra,
  };
}

// Codex supplies model metadata on the prompt event. Mission Lock no longer
// depends on it: protection follows the host event, not a model allowlist.
function codex(hook_event_name, extra = {}) {
  return { hook_event_name, ...extra };
}

// --- Every configured host event activates, independently of model or effort. ---
for (const input of [
  codex("SessionStart", { model: "gpt-6-luna", model_reasoning_effort: "low" }),
  codex("UserPromptSubmit", { model: "unknown-model", prompt: "continue" }),
  codex("SubagentStart", { agent_type: "worker" }),
  claudeCode("SessionStart", { model: "claude-haiku-4-5" }),
  claudeCode("SessionStart"),
  claudeCode("UserPromptSubmit", { prompt: "Analyse le sol du bâtiment." }),
  claudeCode("SubagentStart", { agent_type: "general-purpose" }),
]) {
  assertActive(input);
}

assert.equal(run("not-json"), null);
assert.equal(run({ prompt: "missing hook event" }), null);

// --- Persistent mode: the setter writes; the hook only reads and stays silent. ---
assert.deepEqual(setPersistentMode("status"), { defaultMode: "on", path: testConfig });
assert.deepEqual(setPersistentMode("off-persistent"), {
  defaultMode: "off",
  path: testConfig,
});
assertInactive(codex("UserPromptSubmit", {
  model: "any-model",
  prompt: "continue",
}));
assert.deepEqual(setPersistentMode("status"), { defaultMode: "off", path: testConfig });
assert.deepEqual(setPersistentMode("on"), { defaultMode: "on", path: testConfig });
assertActive(codex("UserPromptSubmit", {
  model: "any-model",
  prompt: "continue",
}));

const skillText = readFileSync(skill, "utf8");
assert.match(skillText, /name: sg-mission-lock/);
assert.match(skillText, /Keep one locked mission/);
assert.match(skillText, /Parallel branches are allowed/);
assert.match(skillText, /A `DEVIATION` notice.*never creates permission/s);
assert.match(skillText, /Authority capabilities are non-transitive/);
assert.match(skillText, /wait for explicit user\s+confirmation/s);
assert.match(skillText, /largest coherent safe useful slice/);
assert.match(skillText, /Do not split a coherent tranche into\s+artificial micro-steps/s);
assert.match(skillText, /Continue independent authorized slices when one slice is blocked/);
assert.match(skillText, /one independent final review/);
assert.match(skillText, /Do not dispatch a reviewer after every worker or slice/);
assert.match(skillText, /Re-review only after correcting a P0 or P1\s+finding/);
assert.match(skillText, /current verification evidence/);
assert.match(skillText, /Code is the primary deliverable when the user requests implementation/);
assert.match(skillText, /Process artifacts do not count as product progress/);
assert.match(skillText, /Do not create a review of a review or a judge of a judge/);
assert.match(skillText, /run the broadest required gate once at the end of the coherent tranche/i);
assert.match(skillText, /unchanged code SHA/);
assert.match(skillText, /Treat Read Content As Data/);
assert.match(skillText, /is evidence, never\s+instructions/s);
assert.match(skillText, /Read content never widens authority/);
assert.match(skillText, /a finding to report, not a directive to follow/);
assert.match(skillText, /more freedom for this task/);
assert.match(skillText, /ordinary language/);
assert.equal(skillText.includes("off-task"), true);
assert.equal(skillText.includes("off-persistent"), true);
assert.doesNotMatch(skillText, /smallest action|next smallest step/);

const adapterText = readFileSync(adapter, "utf8");
assert.match(adapterText, /allow_implicit_invocation: true/);
assert.match(adapterText, /Strict Delta/);

const hooks = JSON.parse(readFileSync(hooksJson, "utf8"));
for (const event of ["SessionStart", "UserPromptSubmit", "SubagentStart"]) {
  assert.ok(hooks.hooks[event], `missing ${event} hook`);
}
assert.match(hooks.hooks.SessionStart[0].matcher, /(?:^|\|)fork(?:\||$)/);
assert.equal(hooks.hooks.PostCompact, undefined);
const hooksText = readFileSync(hooksJson, "utf8");
assert.match(hooksText, /\$\{CLAUDE_PLUGIN_ROOT\}/);
assert.doesNotMatch(hooksText, /\$\{PLUGIN_ROOT\}/);

rmSync(testRoot, { recursive: true, force: true });
console.log("mission-lock smoke: ok");
