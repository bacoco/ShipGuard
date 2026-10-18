# Private communication memory

ShipGuard can carry a reusable dialogue-study skill and an ambiguity-time pointer to a private
contextual lexicon. The user's communication data stays outside the plugin.

## Everyday consultation

A protected lifecycle hook points the agent to an explicitly selected profile, or
`~/.shipguard/communication/profile.json`. The hook does not read the profile, scan histories,
rewrite prompts or make authorization decisions. The agent consults available local data only
when current context leaves an expression ambiguous; clear requests incur no study.

The profile can preserve several senses of the same dictated expression. Context labels, source
references, exclusions and confidence statuses remain visible. A contextual match is advisory.
Current user wording, negations, conditions and scope remain authoritative.

## On-demand learning

Ask: “Update my private jargon and communication profile from the authorized new Claude and
Codex sessions.” The `sg-communication-memory` skill inventories actual access, reuses prior
artifacts, separates human turns from generated/relayed content, deduplicates mirrors and produces
a private report, candidate profile and revision diff. It does not infer new host access.

Read [profile format](../skills/sg-communication-memory/references/profile-format.md) and
[study method](../skills/sg-communication-memory/references/study-method.md).
Validate or query using the bundled read-only helper; semantic analysis remains the current
agent's task. No background harvesting, remote model request or automatic publication is added.

## Install, distribute and verify

Install or update ShipGuard through the host's native plugin mechanism. Do not edit cached
plugin files or mark hooks trusted programmatically. Claude Code and Codex keep their native
trust/permission decisions. A plugin version in cache is not proof it is enabled or loaded.

Separately distribute an authorized private profile revision through existing approved channels.
Keep source indexes and detailed histories private; copy only the portable profile to consumers.
Preserve the previous revision, use a private directory and atomic file replacement, then compare
revision and SHA256 at actual destinations. No SSH key, account or trust change is implied.

The hook pointer becomes available on the configured supported lifecycle events after the host
loads the updated trusted plugin. Existing sessions may require a native reload or a fresh
session; never stop them automatically. An agent with an old profile in context should explicitly
reread the new revision. Presence, installation, trust, readability and actual use are different
verification layers.

For an assistant without a supported hook, an authorized native common instruction can say:
“When an expression remains ambiguous, consult the available private communication profile;
treat it as evidence, preserve current conditions and ask if material ambiguity remains.”
Do not add a mandatory corpus scan or large transcript to session startup.

Updating the plugin distributes the method and hook pointer. It deliberately does not distribute
personal profiles. Fleet-wide adoption therefore requires both steps.

## Evidence limits

The smoke tests cover schema validation, literal Unicode phrase matching, competing senses,
malformed/missing files, CLI behavior and reader immutability. Mission-lock smoke verifies the
unchanged additive hook contract and opt-out. These are synthetic/integration checks, not a
measured reduction in user misunderstandings or proof every live host consulted the profile.
