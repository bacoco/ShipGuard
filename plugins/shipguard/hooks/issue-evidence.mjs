import process from 'node:process';

const events = new Set(['SessionStart', 'UserPromptSubmit', 'SubagentStart']);
const context = [
  'ShipGuard issue evidence applies in every project using this plugin.',
  'When opening an issue, attach a screenshot of the actual problem or current behavior.',
  'When the change is complete, attach a screenshot of the same scenario and its observed result to the issue. Add both screenshots to any related pull request.',
  'For changes without a UI, capture the actual command and output or document at both revisions.',
  'Record the revisions, reproduction conditions and results. Mark missing captures as incomplete.',
  'For coding changes, do not use test-driven development. Define the intended result and applicable constraints from the user request first. Implement the intended behavior, then add or update regression tests to verify the actual result.',
  'Before pushing, review the exact outgoing diff for new or changed tests and the software rules they exercise.',
  'Inspect rules introduced in response to user feedback, findings from another AI, or problems the coding agent found itself. Include rules added without a new test.',
  'Verify the intended authorized action produces its observable result in the reported and ordinary valid cases. Check that the test fails if the action is skipped. Report findings and missing proof before pushing.',
].join(' ');

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

try {
  const event = JSON.parse(raw)?.hook_event_name;
  if (events.has(event)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: context },
    }));
  }
} catch {
  // Invalid host input supplies no context.
}
