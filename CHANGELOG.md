# Changelog

## 2.18.3 — 2026-10-30

Changes since [2.18.2](https://github.com/bacoco/ShipGuard/releases/tag/v2.18.2),
covering `v2.18.2..74e7b239474210583d841666cbc068485c3c7380`.

### Changes

- docs(sg-pre-review): state endpoint transport policy (`acc69ad`)
- fix(sg-pre-review): restrict endpoint transport and refuse redirects (`1311b33`)

Validation : validé macOS/Linux ; Windows simulé, non validé sur machine réelle.

## 2.18.2 — 2026-10-30

Changes since [2.18.1](https://github.com/bacoco/ShipGuard/releases/tag/v2.18.1),
covering `v2.18.1..7c10d22e7c5bf4c9c12246ef3870105eabfcb229`.

### Changes

- Reject unparseable review authorities without crashing (`ecab3b6`)
- Preserve failed auth export status when no steps remain (`4559648`)
- Assert Windows export keeps existing permissions (`2099291`)
- Preserve Windows auth export and fail unsafe POSIX files (`72ee1a9`)
- fix: secure recorder state export (`448699b`)
- docs: clarify HTTPS and loopback endpoint examples (`4e80b15`)
- fix: constrain optional controller transport (`f8a1409`)
- Constrain crawl redirects to the selected origin (`c43cc91`)
- fix(review): reject scheme-relative evidence hosts (`d38eecc`)
- fix(review): validate evidence link destinations (`de31bc6`)
- fix: confine review static reads to the physical results root (`267abaf`)
- Require trusted request origins and review session proof (`3d3190c`)
- fix(record): restore default TLS verification (`bbfe6a8`)
- fix(cli): bound PNG screenshot decompression (#195) (`859a289`)
- Limit historical crawl labels to older retained evidence (Refs #190) (`8a80a43`)
- fix(review): keep keyboard focus inside screenshot viewer (`f1019ee`)
- Fix review banner counts after manifest removal (Refs #189) (`787eab3`)
- Mark retained crawl findings as historical (Refs #190) (`7ec4c03`)
- fix(cli): accept structurally valid JPEG screenshots (#195) (`6011497`)
- fix(review): make visual and recorded controls keyboard accessible (`32e4696`)
- Bound cumulative crawler resource checks (Refs #197) (`76026b7`)
- fix(cli): reject invalid PNG screenshot evidence (#195) (`1b764f6`)
- fix(review): discover yml and root-level manifests (`d5af1d9`)
- fix(tests): include recorder converter tests in smoke suite (`c4605b2`)
- fix(cli): decode recorder YAML escapes (#193) (`4ba5f9b`)
- fix(review): retain observed stale findings and classify errors (`7692347`)
- fix(cli): propagate review server startup failure (`2e48181`)
- fix(record): preserve recorded upload selector (#192) (`4a49b1c`)

## 2.18.1 — 2026-10-26

Changes since [2.18.0](https://github.com/bacoco/ShipGuard/releases/tag/v2.18.0),
covering `v2.18.0..0cfbf19523ddf5001c2b0d9caa8c5e0f6fc176a2`.

### Changes

- docs: show ShipGuard paths by user task (`c69678c`)
- docs: clarify Git retention and browser preflight capabilities (`389c08c`)
- docs(sg-visual-run): distinguish cleanup outcomes (`c57329f`)
- fix(sg-visual-run): scope browser cleanup to owned session (`3a7d6b5`)
- Add private-data-free smoke summary and sourced usage reporting (`4c8f136`)
- docs: finalize security support and private reporting policy (`58a42d7`)
- docs: draft security policy for issue #179 (`fdf8c8f`)
- docs: mark historical plans and specs without claiming completion (Refs #175) (`de67fd8`)
- fix: restrict smoke discovery to Git-tracked directories (`b792a8f`)
- fix(release): require previous tag to match canonical version (`7a6a2a4`)
- fix: preserve literal commit subjects in release changelog (`1249f20`)
- docs: restore plugin README audit contract references (`53f95ab`)
- docs: correct two historical specification statuses (`c9bd0a0`)
- docs: require origin/main as new branch base (`ae9c983`)
- chore: remove temporary issue 101 baseline files (refs #164) (`a2e4584`)
- docs: specify merge verification and cross-family review (`5654b12`)
- Keep recorder browser smoke output in a temporary directory (`34c72bf`)
- feat: add explicit release preparation (Refs #158) (`ece02be`)
- docs: make root README canonical (`0281098`)
- test: add repository consistency check (`d148419`)
- test: add smoke suite launcher (`541b014`)
- docs: analyse des processus ShipGuard du 25 octobre 2026 (`8473bff`)
- docs: align host summary and conclude issue 91 (Refs #91) (`9a091e3`)
- docs: conclude bounded instruction study (Refs #91) (`68bb732`)

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
