# ShipGuard 2.16.0 — consolidated main

This release consolidates the previously separate branches into main, following 2.15.0's private
communication-memory release. It carries the generic methods; no personal profile or transcript
is included.

## Integrated capabilities

- Goal-linked pre-review covers each supplied criterion or reports partial evidence. A supplied goal
  does not grant execution authority. See ../skills/sg-pre-review/references/goal-coverage.md.
- Verifier protocol hardening retains findings when replies are malformed or mismatched. This does
  not resolve every concern in issue 101: the legacy mapping for valid numeric scores is preserved.
- The optional E2E adapter imports or runs explicitly selected evidence without manufacturing a
  visual verdict or ship-ready result. Reports and artifacts stay separate from canonical results.
- Prompt audit in sg-improve inventories explicitly selected sources and returns evidence-bound
  proposals only. Protected instructions/hooks are flag-only, and partial review emits no patch.
- Optional dialogue reviews ground concerns in selected sources, distinguish proposals from actual
  execution and avoid repeated clarification. They stay separate from proportional mission-lock.
- The Jev controller document is a design proposal, not an implemented adapter or live integration.
- Private communication memory studies jargon, friction, repairs and progress since the last study;
  its data distribution remains separate from native plugin updates.

## Integration and validation limits

The older source-check branch's fixed-baseline workflow overlapped with the newer verifier branch.
The newer workflow was retained rather than reverting it to a historical fixed commit.
That branch-specific historical workflow is not a current main release gate.

Independent review identified a FIFO open that could block before regular-file validation in the
E2E importer. The reader now uses a nonblocking open; a bounded subprocess test checks rejection.
Prompt-audit checks cover immutable sources, exact evidence, partial coverage, changed inventories,
protected surfaces, unavailable paths and read-only CLI behavior.
Validation on the consolidated tree: 24 smoke scripts passed, including the focused rerun after
correcting a macOS canonical-path assertion in the fake-runner test. No live model calls were used.
Use the repository's dependency-free smoke scripts. Synthetic and local integration checks do not
measure live model quality, comprehension gains or universal host adoption.

## Native fleet updates

Refresh only the shipguard marketplace, then update/reinstall the existing plugin with its current
scope/profile. Preserve accounts, enabled state, trust decisions and active sessions.
A marketplace pinned to an old commit intentionally stays there on upgrade. When a latest-main
update is authorized, re-register that same source using the native marketplace commands with
ref main; retain the previous configuration for rollback. Never edit cached plugin files.
A successful install is not proof of loading in a running session. Native hook review remains human.

### Preserve hook paths for running Codex sessions

The native Codex installer can prune old version directories even while open sessions still invoke
their hook scripts. A missing cached script can therefore produce repeated hook exit-code 1 errors.
Before an authorized update, record the running sessions, version directories (including aliases)
and each version's hooks/hooks.json. Keep this operational inventory private.

Compare the old hook definitions with the incoming version before installation. If they differ,
do not create compatibility links: arrange any necessary session restart with the user. If they
are identical and the installation removes an old version directory, an authorized temporary
symlink from that exact version name to the new version preserves the existing hook paths.
Recheck the installed definitions and both script entry points through every restored path.
Do not modify cached scripts, hook trust records, or authentication to make an update pass.
A compatibility link does not reload a running conversation's skills or prove native approval.
Remove temporary aliases only after the sessions using them have been restarted.
