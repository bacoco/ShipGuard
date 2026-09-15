#!/usr/bin/env node
// Packaging and reference integrity only; not evidence of agent effectiveness.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(resolve(root, 'SKILL.md'), 'utf8');
assert.match(skill, /^---\nname: sg-pre-review\ndescription: .+\n---\n/);
const adapter = readFileSync(resolve(root, 'agents/openai.yaml'), 'utf8');
assert.match(adapter, /allow_implicit_invocation: false/);
assert.match(adapter, /default_prompt: .*\$sg-pre-review/);
const links = [...skill.matchAll(/\]\(([^)]+\.md)\)/g)];
assert.ok(links.length > 0);
for (const [, target] of links) assert.ok(existsSync(resolve(root, target)), `Missing reference: ${target}`);
console.log('pre-review smoke test passed (packaging only; behavior not verified)');
