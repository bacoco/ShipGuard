# Security policy

## Supported versions

Only the latest published GitHub release is supported for security fixes. When
a new release is published, it becomes the only supported version. Older
versions receive no backported security fixes; upgrade to the latest release.

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

## Reporting a vulnerability

GitHub private vulnerability reporting is enabled for this repository. To report
a vulnerability privately, open the repository's
[GitHub Security Advisories page](https://github.com/bacoco/ShipGuard/security/advisories)
and click **Report a vulnerability**. Do not put vulnerability details, secrets
or personal data in public issues or pull requests.
