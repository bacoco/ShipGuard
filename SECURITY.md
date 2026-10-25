# Security policy — draft

**Not ready for merge: maintainers must confirm supported versions and choose a
private vulnerability reporting channel.**

## Supported versions

The plugin manifests identify version **2.18.0**, also the latest GitHub release
at the time of this draft (2026-10-25). This identifies the current release; it
does not establish a security maintenance commitment. The supported-version
range and any backport policy remain to be confirmed before merge.

## Local data access and storage

Depending on the invoked skill and authorized scope, ShipGuard reads project
source, Git diffs/history, test configuration, prior findings and project
learnings. Visual workflows also inspect browser pages and capture screenshots.

- **Inside the target project:** `visual-tests/_results/` holds findings, reports,
  screenshots and review artifacts; `visual-tests/manifests/` holds recorded test
  steps. Project learnings and mistakes live under the project's `.shipguard/`.
  Requested fix workflows can edit project source. These project files are
  distinct from user-level state.
- **Outside the repository:** the persistent mission-protection preference
  defaults to `~/.shipguard/mission-lock.json`. Its settings helper writes it;
  the mission hook only reads it and does not log prompts. The optional private
  communication profile defaults to `~/.shipguard/communication/profile.json`;
  consultation is read-only. Authorized dialogue studies keep detailed reports
  and source indexes in a separate private archive, outside repositories and
  plugin caches. Distributing the plugin does not distribute personal profiles.
- **Browser authentication:** recording can read a selected cookies/localStorage
  file with `--storage` and write one with `--save-storage`. Recordings, screenshots,
  reports and authentication files can contain sensitive data; inspect them
  before committing or sharing them. Browser tooling can also write runtime
  files outside the workspace.

Sources: [project conventions](CLAUDE.md),
[recorder](plugins/shipguard/skills/sg-record/SKILL.md),
[mission preference helper](plugins/shipguard/skills/sg-mission-lock/scripts/strict-mode.mjs),
[mission hook](plugins/shipguard/skills/sg-mission-lock/scripts/inject-mission-lock.mjs),
[private communication memory](plugins/shipguard/docs/communication-memory.md),
and [sandbox notes](plugins/shipguard/docs/sandbox.md).

## Reporting a vulnerability — decision required

GitHub private vulnerability reporting is disabled for this repository, verified
through the GitHub API on 2026-10-25. No private reporting channel is designated
by this draft. **Maintainers must choose and document a private channel before
merging this policy.** Do not put vulnerability details, secrets or personal data
in public issues or pull requests.
