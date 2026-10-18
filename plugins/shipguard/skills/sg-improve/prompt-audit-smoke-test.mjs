#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { inventory } from "./scripts/prompt-audit-input.mjs";
import { review } from "./scripts/prompt-audit-review.mjs";

const root = mkdtempSync(join(tmpdir(), "sg-prompt-audit-"));
let count = 0;
function check(name, fn) { fn(); console.log("ok " + (++count) + " - " + name); }
try {
  const guide = "Keep the requested scope.\n";
  const evidence = "The original requirement defines the scope.\n";
  writeFileSync(join(root, "guide.md"), guide);
  writeFileSync(join(root, "evidence.md"), evidence);
  writeFileSync(join(root, "AGENTS.md"), guide);
  const request = { operation: "inventory", root, files: ["guide.md", "evidence.md"],
    target: { model: "synthetic-model", host: "synthetic-host", effort: "unknown" } };
  const receipt = inventory(request).receipt;
  const finding = { id: "scope", path: "guide.md", start: 1, end: 1, excerpt: guide.trimEnd(),
    pattern: "instruction-conflict", basis: "repository", confidence: "high", reason: "Synthetic proposal",
    action: "rewrite", evidence: [{ path: "evidence.md", start: 1, end: 1, excerpt: evidence.trimEnd() }],
    replacement: "Preserve the explicitly requested scope.\n", protected_contract: "Keep authority unchanged",
    verification_plan: "Compare behavior under the same request" };
  const proposal = (input = request, f = finding) => ({ ...input, operation: "review", review: {
    inventory_id: inventory(input).receipt.inventory_id,
    coverage: input.files.map(path => ({ path, status: "reviewed", reason: "Selected synthetic source examined" })),
    findings: [structuredClone(f)],
  }});
  const beforeFiles = readdirSync(root);
  check("inventory exposes unknown semantic verification and protected metadata", () => {
    assert.equal(receipt.status, "unreviewed");
    assert.equal(receipt.semantic_verification, "not verified");
    assert.equal(receipt.authority_effect, "none");
    assert.equal(inventory({ ...request, files: ["AGENTS.md"] }).receipt.files[0].protected, true);
  });
  check("evidence-bound review returns proposal only and leaves sources untouched", () => {
    const result = review(proposal());
    assert.equal(result.status, "proposal-ready");
    assert.match(result.proposed_diff, /Preserve the explicitly requested scope/);
    assert.equal(result.findings[0].fix_tier, "human-only");
    assert.equal(readFileSync(join(root, "guide.md"), "utf8"), guide);
    assert.deepEqual(readdirSync(root), beforeFiles);
  });
  check("partial declared coverage emits no patch", () => {
    const p = proposal(); p.review.coverage[1].status = "unknown";
    const r = review(p); assert.equal(r.status, "partial"); assert.equal(r.proposed_diff, "");
  });
  check("changed inventory cannot reuse the previous review identity", () => {
    const p = proposal(); writeFileSync(join(root, "guide.md"), "Changed source.\n");
    try { const r = review(p); assert.equal(r.status, "partial"); assert.equal(r.proposed_diff, ""); }
    finally { writeFileSync(join(root, "guide.md"), guide); }
  });
  check("fabricated excerpt cannot produce a patch", () => {
    const p = proposal(); p.review.findings[0].excerpt = "invented";
    const r = review(p); assert.equal(r.status, "partial"); assert.equal(r.proposed_diff, "");
  });
  check("protected instructions are flag-only", () => {
    const input = { ...request, files: ["AGENTS.md", "evidence.md"] };
    const f = { ...finding, path: "AGENTS.md" };
    assert.equal(review(proposal(input, f)).status, "partial");
    const flag = { ...f, action: "flag" }; delete flag.replacement;
    const r = review(proposal(input, flag));
    assert.equal(r.status, "reviewed-no-patch"); assert.equal(r.proposed_diff, "");
  });
  check("sensitive and missing sources remain unavailable", () => {
    const r = inventory({ ...request, files: [".env", "absent.md"] }).receipt;
    assert.equal(r.status, "partial"); assert.ok(r.files.every(f => f.status === "not-read"));
  });
  check("CLI is read-only and refuses malformed requests", () => {
    const script = fileURLToPath(new URL("./prompt-audit.mjs", import.meta.url));
    const r = spawnSync(process.execPath, [script], { input: JSON.stringify(request), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).status, "unreviewed");
    assert.equal(spawnSync(process.execPath, [script], { input: "{bad", encoding: "utf8" }).status, 1);
    assert.equal(readFileSync(join(root, "guide.md"), "utf8"), guide);
    assert.deepEqual(readdirSync(root), beforeFiles);
  });
} finally { rmSync(root, { recursive: true, force: true }); }
console.log("PASS " + count + " prompt-audit checks");
