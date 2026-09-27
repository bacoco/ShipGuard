#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(here, "SKILL.md"), "utf8");
const phase = skill.match(/2bis\. \*\*Write the lane manifest\.\*\*[\s\S]*?```json\n([\s\S]*?)\n```/);

assert.ok(phase, "Phase 0 run.json example is missing");
const manifest = JSON.parse(phase[1]);

for (const lane of ["audit", "logic", "process"]) {
  assert.equal(manifest.lanes[lane].status, "pending", `${lane} pre-claims execution`);
  assert.match(manifest.lanes[lane].reason, /awaiting Phase/, `${lane} has no pending reason`);
}

assert.match(skill, /switch it to `running` immediately before invoking the lane/);
assert.match(skill, /use `ran` only after its\s+declared result exists and can be read/);
assert.match(skill, /never leave a completed\s+run with `pending` or `running`/);
assert.doesNotMatch(
  phase[1],
  /"(?:audit|logic|process)"\s*:\s*\{\s*"status"\s*:\s*"ran"/,
  "Phase 0 example contains a false execution receipt",
);

console.log("sg-ship run manifest smoke: ok");
