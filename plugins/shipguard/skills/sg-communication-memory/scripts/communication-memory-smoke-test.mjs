#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { validateProfile, lookup, loadProfile } from "./communication-memory.mjs";

const entry = (id, meaning, contexts, status = "corroborated") => ({
  id, variants: ["ledger", "livré"], meaning, contexts,
  exclusions: ["not enough context to choose automatically"], status, sources: ["synthetic-case"]
});
const profile = {
  schemaVersion: 1, revision: "test-1", updatedAt: "2026-01-01T00:00:00Z",
  entries: [entry("accounting", "Accounting application", ["project:accounts"]),
    entry("notebook", "Paper notebook", ["project:writing"], "hypothesis")],
  communication: [{ id: "order", observation: "Keep before/after constraints.", status: "confirmed", sources: ["synthetic-order"] }]
};
assert.equal(validateProfile(profile), profile);
for (const text of ["LEDGER", "ledger, before anything else", "Le LIVRE\u0301"]) {
  const result = lookup(profile, text, "project:accounts");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].contextLabelMatch, true);
  assert.equal(result.candidates[1].contextLabelMatch, false);
  assert.equal(result.candidates[1].status, "hypothesis");
}
for (const text of ["pledger", "ledgers", "unrelated", "xxlivré"]) assert.equal(lookup(profile, text).candidates.length, 0);
const accent = structuredClone(profile); accent.entries = [{ ...accent.entries[0], variants: ["x"] }];
assert.equal(lookup(accent, "x\u0301").candidates.length, 0);
const saved = JSON.stringify(profile);
lookup(profile, "Do not modify the ledger until approved", "project:writing");
assert.equal(JSON.stringify(profile), saved, "lookup never mutates the profile");
for (const mutate of [
  p => p.schemaVersion = 2, p => p.entries.push(p.entries[0]),
  p => p.entries[0].status = "certain", p => p.entries[0].sources = [],
  p => p.entries[0].variants = [".*"], p => p.entries[0].commands = ["delete"],
  p => p.updatedAt = "yesterday", p => p.entries[0].meaning = "",
]) {
  const p = structuredClone(profile); mutate(p);
  // Regex-like text is literal data, not executable matching instructions.
  if (p.entries[0].variants[0] === ".*") { assert.equal(lookup(p, "ledger").candidates.length, 1); }
  else assert.throws(() => validateProfile(p));
}
const root = mkdtempSync(join(tmpdir(), "sg-communication-"));
try {
  const file = join(root, "profile.json");
  writeFileSync(file, saved);
  assert.deepEqual(loadProfile(file), profile);
  const before = readdirSync(root);
  const script = fileURLToPath(new URL("./communication-memory.mjs", import.meta.url));
  for (const args of [["validate", file], ["lookup", file, "ledger"], ["lookup", file, "ledger", "project:accounts"]]) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr); JSON.parse(r.stdout);
  }
  assert.equal(readFileSync(file, "utf8"), saved);
  assert.deepEqual(readdirSync(root), before);
  writeFileSync(file, "{bad");
  assert.throws(() => loadProfile(file));
  assert.equal(spawnSync(process.execPath, [script, "validate", file]).status, 1);
  writeFileSync(file, " ".repeat(128 * 1024 + 1));
  assert.throws(() => loadProfile(file));
  assert.throws(() => loadProfile(root));
  assert.throws(() => loadProfile(join(root, "missing")));
} finally { rmSync(root, { recursive: true, force: true }); }
console.log("communication-memory smoke: ok (synthetic data and read-only CLI)");
