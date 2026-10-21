# Changelog

## 2.18.0 — 2026-10-21

Changes since [2.17.0](https://github.com/bacoco/ShipGuard/releases/tag/v2.17.0),
covering main through `3d647c56b43498ff82e587d233af2d8012182f98`.
This minor version adds an explicit Codex report-only dispatch contract alongside review fixes.

### Added

- Define Codex report-only dispatch for `sg-code-audit`: host capability/permission preflight, inherited authorized model, assigned linked worktrees, native completion tracking and collection of original retained JSON; preserve Claude dispatch and canonical JSON/TOON contracts (#141, PR #147).

### Fixed

- Review server: reject invalid PID text before any signal in stop/replacement paths; require a strictly positive safe decimal integer while preserving the PID/port format (#143, PR #145).
- Review YAML: preserve quoted strings, including leading zeros, spaces and `#`; explicitly reject unsupported blocks, tags, anchors, aliases, multiline quoted strings and escapes with file/line diagnostics before writing the report (#144, PR #146).

### Validation limits

- Codex `--fix` is explicitly refused; report-only dispatch and inherited-model policy are the supported contract. Native Codex acceptance testing remains to be performed after installation; repository smoke tests do not prove native host execution (#141, PR #147).
- The review parser remains a dependency-free YAML subset; unsupported forms are rejected rather than interpreted. Numeric PID validation does not establish process identity if a valid PID has been reused (#144, PR #146; #143, PR #145).

### Distribution

- Claude Code and Codex plugin manifests identify this content as 2.18.0; both marketplace catalogs continue to resolve `./plugins/shipguard` without separate version fields. This preparation does not install/update plugins, change hook trust or reload sessions (#148).

## 2.17.0 — 2026-10-21

Changes since [2.16.1](https://github.com/bacoco/ShipGuard/releases/tag/v2.16.1),
covering main through `70f0a58937d81434dcd98edffa6501c5f1e9ee90`.
This minor version includes new recording/replay and tool-copy capabilities alongside fixes.

### Added

- Record and replay native browser back/forward actions, including the recorder toolbar controls;
  distinguish manual history navigation from navigation triggered by recorded page actions (#138).
- Detect stale project copies of ShipGuard tools and support explicit refresh with rollback;
  preserve copy permissions during refresh and rollback (#115).
- Prepare complex or unfamiliar tasks conditionally in mission-lock and grill-goal: reuse prior
  preparation, consider relevant methods, data and authorized tools, and choose evidence that can
  expose an insufficient result. Simple tasks remain direct (`72755d2`).

### Fixed

- Audit evidence: reject inconsistent verifier results, bound source reads, retain ignored zone
  artifacts before completion, and reject foreign run events in the monitor (#120, #113, #138).
- E2E assertions: reject incomplete agent evidence rather than treating it as verified (#99).
- CLI: avoid duplicate findings for linked HTTP errors; preserve execution, capture, lifecycle and
  exit outcomes, including native back/forward replay (#117, #138).
- Recorder: expose integration-generator errors; preserve absolute URLs outside the configured
  base, body clicks that dismiss content, captured actions, document navigation and replay scope;
  avoid duplicating history traversal caused by recorded page actions (#114, #122, #121, #138).
- Review dashboard: distinguish static audit results from runtime verification, show exact run
  evidence, and clear completed review intent (#124, #138).
- Dialogue checks: keep equality unverified when question evidence is truncated (#106).
- Model scope probes: require an explicit user request; never select them implicitly (#116).
- Correct the prompt-audit documentation's stated behavior and limits (#91).

### Distribution

- Claude Code and Codex plugin manifests now identify this content as 2.17.0. Both marketplace
  catalogs continue to resolve `./plugins/shipguard`, where those manifests carry the version;
  neither catalog has a separate version field. There is no npm package or package manifest.
- This release preparation changes only version metadata and documentation. It does not install
  or update plugins on machines, change hook trust, or reload running sessions.

## 2.16.1 — 2026-10-18

- Route corrections, independent requests and deferred ideas separately during active work;
  clarify material ambiguity before dependent delegation and preserve explicit pause/cancellation
  (#112).
- Publish a distinct plugin version after 2.16.0 without moving the existing tag.

See the [2.16.1 release](https://github.com/bacoco/ShipGuard/releases/tag/v2.16.1)
and the [2.16.0 consolidation notes](plugins/shipguard/docs/consolidation-2.16.0.md)
for earlier changes and validation limits.
