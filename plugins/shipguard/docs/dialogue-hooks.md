# Optional dialogue checks

ShipGuard 2.11.0 delivers the optional hook layer from #77. GrillGoal remains a standalone
SKILL.md; no hook, controller, interview, goal file or workflow is mandatory. The existing
mission-lock handler is preserved. The new command handlers are installed but are no-ops by default.

## Enable

Set this in the environment of a **new** Claude Code or Codex session:

```bash
export SHIPGUARD_DIALOGUE_HOOKS=1
```

This enables advisory UserPromptSubmit and Stop checks. Without a configured semantic controller,
input guidance is injected and the end-of-turn check reports **unknown**, not verified. Lexical
hints such as continuation or answer-with-unknown-referent never establish intent or authority.

Per-tool guidance is separately opt-in:

```bash
export SHIPGUARD_DIALOGUE_TOOL_CHECKS=1
```

PreToolUse asks the agent to relate the pending action to scope and existing authorization;
it grants no permission and does not change arguments. PostToolUse adds feedback while retaining
the raw result. It does not block, replace the tool response, undo side effects or relabel failures.
Normal authorization remains the host's responsibility. Disable by unsetting the corresponding
variables. No persistent setting is written by the hook.

## Optional semantic controller

To use an existing OpenAI-compatible chat-completions service, explicitly set its **complete URL**
and model name. There is no discovery, default model, default provider or fallback:

```bash
export SHIPGUARD_DIALOGUE_ENDPOINT='http://YOUR_HOST:YOUR_PORT/v1/chat/completions'
export SHIPGUARD_DIALOGUE_MODEL='YOUR_MODEL_NAME'
```

If that chosen service requires authentication, use `SHIPGUARD_DIALOGUE_API_KEY` in the session
environment. Never put credentials in the URL. No model service is installed or started by ShipGuard.
Alternatively set `SHIPGUARD_DIALOGUE_CONTROLLER` to an absolute path to your own Node `.js`/`.mjs`
controller; it receives the same JSON view on stdin and returns JSON on stdout. This explicitly
selected program executes with the user's environment/permissions; it is not sandboxed by the
hook. Choose it as you would any local executable. Only one controller is called per event.

`SHIPGUARD_DIALOGUE_TIMEOUT_MS` defaults to 2000, accepts 50..5000 ms, and bounds that call.
Timeouts, invalid JSON, nonzero exits, oversized output and invented source passages report
**unavailable**. There are no controller retries. A configured endpoint can add inference cost;
the release does not claim measured quality, savings or latency for any model.

## Context and original sources

The event supplies only the current prompt, pending tool input, raw tool result or final assistant
text, as applicable. The hook never reads `transcript_path`, walks the repository, exports broad
history or persists a conversation. If earlier decisions are necessary, optionally point
`SHIPGUARD_DIALOGUE_CONTEXT` at one absolute, explicitly selected JSON file (maximum 16 KiB):

- `original_request`: original user request as a string.
- `sources`: up to four `{ "reference": "path or source identifier", "text": "exact source excerpt" }` objects.

These supplied passages are source **claims**, not proof of human acceptance or permission.
No `confirmed`, budget or approval field in this document activates work. Context missing from
non-input events is explicitly uncovered, and a controller's `clear` becomes `unknown` when
necessary fields, redactions or truncation make the supplied view incomplete. A scoped `clear`
never means goal completion, safe execution or human agreement.

Known credential keys/patterns are redacted before controller delivery and feedback. Redaction
and truncation are reported; source quotes are validated against that declared view. This is a
bounded filter, not proof that arbitrary text contains no secrets. Supply only the excerpts needed.
Original input/result files remain untouched and remain with their owner.

## Controller result contract (1.0)

The supplied view contains `schema_version: "1.0"`, `event`, `prompt`, `response`, `tool_name`, `tool_input`, `tool_response`,
selected `context`, `coverage` and `passages` (path-to-exact-text map). Coverage names missing data,
redaction, truncation and `transmission: "not observable"`.

Return `{ "status": "clear | finding | unknown | unavailable", "message": "bounded explanation" }`.
Use one enum value, not the combined illustrative string. A finding additionally contains:

- `source`: a key in `passages`, and `passage`: its exact substring (1..400 characters).
- `interpretations`: two or three alternatives (each at most 180 characters).
- `consequences`: one to three concrete consequences (each at most 180 characters).
- `correction`: supported correction or targeted question (1..400 characters).
- `human_intent_missing`: boolean; when true, the controller does not select the human's answer.
- `references`: up to three `{ "source": "passages key", "passage": "exact supporting substring" }` objects.
  At least one is required to settle a correction without asking the human.

All feedback stays derived data. Extra controller fields cannot approve tools, alter arguments or
rewrite results. Structural validation proves only the cited passage's presence, not semantic truth.

At Stop, a grounded finding or unavailable check can request **one** targeted correction through `decision: "block"`. For an unavailable check, report that status and stop without retrying the controller or repeating a question.
The continuation explicitly states that it is hook-generated, with no new human agreement or
permission. If human intent is missing, ask the necessary question and stop; otherwise correct the
supported wording and affected notes within existing authority. No document is automatically rewritten.
When `stop_hook_active` is true, no controller is called and no second continuation is requested;
unresolved checks remain NOT VERIFIED. If the flag is unavailable, automatic correction is disabled.
Unknowns warn; an unavailable check permits only that one status correction. Necessary questions remain allowed. No display-only rewriting is used.

## Explicit deadline

Optionally set `SHIPGUARD_DIALOGUE_DEADLINE` to an ISO timestamp in the session environment.
This is an explicitly configured budget, never inferred from model output or a context document.
At expiration, UserPromptSubmit/Stop return `continue: false` with an incomplete-work reason.
When per-tool checks are enabled, PreToolUse denies new calls with the same reason. PostToolUse
retains the result and reports expiration; enforcement resumes at the next covered boundary.
A deadline expiring during a controller call is rechecked before delivery. It does not interrupt
an already-running model request, reverse an executed tool or cover host paths without hooks.
User interruption cancels the hook/controller; child execution is bounded and recursion suppressed.

## Engine coverage and evidence

References checked on 15 September 2026:
[Claude Code hooks](https://code.claude.com/docs/en/hooks) and
[Codex hooks](https://learn.chatgpt.com/docs/hooks).

| Path | Claude Code 2.1.263 | Codex CLI 0.154.0 | Release verification |
| --- | --- | --- | --- |
| UserPromptSubmit | additionalContext | additionalContext | Packaged definition + direct command protocol tests |
| PreToolUse | advisory context; deadline deny | advisory context; deadline deny | Protocol tests; opt-in separate from input/Stop |
| PostToolUse | context, raw result retained | context, raw result retained | Protocol tests; no output replacement |
| Stop | one correction continuation; explicit budget stop | one correction continuation; explicit budget stop | Protocol/recursion/deadline tests |
| Intermediate display, full request, all tool paths | No universal guarantee | No universal guarantee | Not covered |

These are implemented adapters and technical tests, **not** a claim that a live model obeyed them
or that every host session activated them. Hosts may skip hooks due to trust/settings. In Codex,
review and trust the new definitions in `/hooks`; do not bypass hook trust. Restart after updating
and enable the variables in that new session. The plugin does not modify trust records.

Model evaluations were explicitly cancelled by the maintainer. Technical protocol/fault tests and
package validation do not replace such evaluations and imply no superiority or behavioral guarantee.
