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

function assertActiveWithForce(input) {
  const result = run(input, { SHIPGUARD_MISSION_LOCK_ALL_MODELS: "1" });
  assert.ok(result, `expected forced activation for ${JSON.stringify(input)}`);
  assert.equal(result.hookSpecificOutput.hookEventName, input.hook_event_name);
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

// Codex is where model-based activation is the documented mechanism, and Codex
// is what supplies `model` on the prompt event. Anything asserting activation
// from a model name on UserPromptSubmit belongs here, not in claudeCode().
function codex(hook_event_name, extra = {}) {
  return { hook_event_name, ...extra };
}

// --- Codex: model-based activation, on the runtime that supplies `model`. ---
for (const effort of ["standard", "ultra"]) {
  assertActive(codex("UserPromptSubmit", {
    model: "gpt-5.6-sol",
    model_reasoning_effort: effort,
    prompt: "continue",
  }));
}
assertActive(codex("UserPromptSubmit", { model: "gpt-5.6-sol" }));

for (const model of ["gpt-6-astra", "gpt-6-sol", "gpt-6-astra-2026-09-01"]) {
  for (const effort of ["high", "xhigh", "max", "ultra"]) {
    assertActive(codex("UserPromptSubmit", {
      model,
      model_reasoning_effort: effort,
      prompt: "continue",
    }));
  }
  for (const effort of ["low", "medium", "standard"]) {
    assertInactive(codex("UserPromptSubmit", {
      model,
      model_reasoning_effort: effort,
      prompt: "continue",
    }));
  }
}
assertInactive(codex("UserPromptSubmit", {
  model: "gpt-6-luna",
  model_reasoning_effort: "ultra",
  prompt: "continue",
}));
assertInactive(codex("UserPromptSubmit", {
  model: "gpt-6-astra",
  prompt: "continue",
}));
assertInactive(codex("UserPromptSubmit", {
  model: "gpt-6-astra-20preview",
  model_reasoning_effort: "ultra",
  prompt: "continue",
}));

// --- Claude Code: SessionStart is the one event that can carry `model`. ---
assertActive(claudeCode("SessionStart", { model: "gpt-5.6" }));
assertActive(claudeCode("SessionStart", { model: "gpt-5.6-sol" }));
assertActive(claudeCode("SessionStart", { model: "gpt-5.6-sol-2026-07-01" }));
assertInactive(claudeCode("SessionStart", { model: "gpt-5.6-solar" }));
assertInactive(claudeCode("SessionStart", { model: "gpt-5.5" }));
assertActive(claudeCode("SessionStart", { model: "claude-opus-5" }));
assertActive(claudeCode("SessionStart", { model: "claude-opus-5-1" }));
assertActive(claudeCode("SessionStart", { model: "claude-opus-5-5" }));
assertActive(claudeCode("SessionStart", { model: "claude-opus-5-5-2026-09-01" }));
assertActive(claudeCode("SessionStart", { model: "claude-fable-5" }));
assertActive(claudeCode("SessionStart", { model: "claude-fable-5-1" }));
assertActive(claudeCode("SessionStart", { model: "claude-fable-5-2" }));
assertInactive(claudeCode("SessionStart", { model: "claude-opus-4-7" }));
assertInactive(claudeCode("SessionStart", { model: "claude-fable-4-9" }));
assertInactive(claudeCode("SessionStart", { model: "claude-fable-5-0" }));
// `model` is optional even on SessionStart, so its absence must not activate.
assertInactive(claudeCode("SessionStart"));

// --- Claude Code: the two events that never carry `model`. ---
// Real shape, no model. Activation here can only come from the prompt text,
// which is exactly what the README promises and what the old fixtures skipped.
assertActive(claudeCode("UserPromptSubmit", { prompt: "Use GPT 5.6 Sol for this review." }));
assertActive(claudeCode("UserPromptSubmit", { prompt: "Passe à Sol Ultra." }));
assertActive(claudeCode("UserPromptSubmit", { prompt: "Sol c'est toi, relis la mission." }));
assertActive(claudeCode("UserPromptSubmit", { prompt: "Use GPT-6 Astra at high effort." }));
assertActive(claudeCode("UserPromptSubmit", { prompt: "Passe à Claude Opus 5.5." }));
assertActive(claudeCode("UserPromptSubmit", { prompt: "Use Opus 5 for this task." }));
assertActive(claudeCode("UserPromptSubmit", { prompt: "Passe au modèle Fable 5.1." }));
assertActive(claudeCode("UserPromptSubmit", { prompt: "Use the latest Fable 5 model." }));
assertInactive(claudeCode("UserPromptSubmit", { prompt: "Use Fable 5.0 for this task." }));

assertInactive(claudeCode("UserPromptSubmit", { prompt: "Analyse le sol du bâtiment." }));
assertInactive(claudeCode("UserPromptSubmit", { prompt: "Sol is a musical note." }));
assertInactive(claudeCode("UserPromptSubmit", {
  prompt: "Construis un modèle sol pour cette étude géotechnique.",
}));
// Ordinary French where "ultra" qualifies the adjective after "sol", and where
// "agent sol" is a soil-treatment agent — neither designates an agent.
assertInactive(claudeCode("UserPromptSubmit", {
  prompt: "Revêtement de sol ultra résistant pour le hall.",
}));
assertInactive(claudeCode("UserPromptSubmit", {
  prompt: "Le carrelage sol ultra plat est posé.",
}));
assertInactive(claudeCode("UserPromptSubmit", {
  prompt: "Un agent sol du rapport géotechnique est erroné.",
}));

// SubagentStart carries neither `model` nor `prompt`, so nothing can activate
// it on Claude Code except the documented opt-in below.
assertInactive(claudeCode("SubagentStart", { agent_type: "general-purpose" }));

// --- The SHIPGUARD_MISSION_LOCK_ALL_MODELS opt-in, on real payloads. ---
assertActiveWithForce(claudeCode("SessionStart", { model: "claude-opus-4-6" }));
assertActiveWithForce(claudeCode("UserPromptSubmit", { prompt: "continue" }));
assertActiveWithForce(claudeCode("SubagentStart", { agent_type: "general-purpose" }));
assert.equal(run("not-json"), null);

// --- Persistent mode: the setter writes; the hook only reads and stays silent. ---
assert.deepEqual(setPersistentMode("status"), { defaultMode: "on", path: testConfig });
assert.deepEqual(setPersistentMode("off-persistent"), {
  defaultMode: "off",
  path: testConfig,
});
assertInactive(codex("UserPromptSubmit", {
  model: "gpt-5.6-sol",
  prompt: "continue",
}));
assert.deepEqual(setPersistentMode("status"), { defaultMode: "off", path: testConfig });
assert.deepEqual(setPersistentMode("on"), { defaultMode: "on", path: testConfig });
assertActive(codex("UserPromptSubmit", {
  model: "gpt-5.6-sol",
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
assert.equal(hooks.hooks.PostCompact, undefined);
const hooksText = readFileSync(hooksJson, "utf8");
assert.match(hooksText, /\$\{CLAUDE_PLUGIN_ROOT\}/);
assert.doesNotMatch(hooksText, /\$\{PLUGIN_ROOT\}/);

rmSync(testRoot, { recursive: true, force: true });
console.log("mission-lock smoke: ok");
