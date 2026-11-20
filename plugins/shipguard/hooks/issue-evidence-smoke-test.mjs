import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(readFileSync(new URL('./hooks.json', import.meta.url), 'utf8'));
const hookPath = fileURLToPath(new URL('./issue-evidence.mjs', import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), 'shipguard-issue-evidence-'));
const project = join(fixture, 'external-project');
const config = join(fixture, 'mission-lock.json');
const events = ['SessionStart', 'UserPromptSubmit', 'SubagentStart'];
const command = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/issue-evidence.mjs"';
try {
  mkdirSync(project);
  writeFileSync(config, '{"defaultMode":"off"}');
  for (const event of new Set([...events, ...Object.keys(manifest.hooks)])) {
    const groups = manifest.hooks[event] ?? [];
    const matchingGroups = groups.filter(group => group.hooks.some(hook => hook.command === command));
    assert.equal(matchingGroups.length, events.includes(event) ? 1 : 0, event);
    if (!matchingGroups.length) continue;
    assert.equal(matchingGroups[0].hooks.length, 1, event);
    assert.equal(matchingGroups[0].matcher, groups[0].matcher, event);
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: project,
      input: JSON.stringify({ hook_event_name: event, cwd: project }),
      encoding: 'utf8',
      env: { ...process.env, SHIPGUARD_MISSION_LOCK_CONFIG: config },
    });
    assert.equal(result.status, 0, result.stderr);
    const { hookSpecificOutput } = JSON.parse(result.stdout);
    assert.equal(hookSpecificOutput.hookEventName, event);
    const context = hookSpecificOutput.additionalContext;
    assert.match(context, /every project using this plugin/);
    assert.match(context, /When opening an issue, attach a screenshot/);
    assert.match(context, /same scenario and its observed result to the issue\. Add both screenshots/);
    assert.match(context, /command and output or document at both revisions/);
    assert.match(context, /Mark missing captures as incomplete/);
    assert.match(context, /Before pushing, review the exact outgoing diff for new or changed tests and the software rules they exercise/);
    assert.match(context, /an independent AI tries edge cases and reports findings, inspect how the coding AI responded, including rules added without a new test/);
    assert.match(context, /observable result in the reported and ordinary valid cases\. Check that the test fails if the action is skipped\. Report findings and missing proof before pushing/);
  }
  assert.deepEqual(readdirSync(project), []);
  assert.equal(readFileSync(config, 'utf8'), '{"defaultMode":"off"}');
  for (const input of ['invalid JSON', JSON.stringify({ hook_event_name: 'Stop' })]) {
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: project, input, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  }
  console.log('The packaged hook supplies screenshot and pre-push test-audit instructions in another project even with Mission Lock off, without writing files.');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
