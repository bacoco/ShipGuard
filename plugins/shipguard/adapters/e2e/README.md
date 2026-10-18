# Optional tester-army/e2e adapter

Implements the first, explicitly opt-in slice of [ShipGuard #99](https://github.com/bacoco/ShipGuard/issues/99).
ShipGuard still owns scope, audits, visual review and the shipping decision. This adapter imports
**external execution evidence**; it neither replaces `agent-browser` nor changes existing skills.

## Boundaries

No npm dependencies in ShipGuard, no package installation, no automatic invocation, no code fixes,
no snapshot updates, no provider selection, no Jev and no hosted-service requirement. The initial
consumer supports **e2e 0.18.0, `report-1`, spec `0.1`, independent web tests only**. Other versions,
serial-group reports, exploration, mobile results and carried previous-run debt are refused rather
than guessed. These are deliberate first-PR limits, not missing-success fallbacks.

This is a validator of the fields consumed by this adapter, not a complete upstream JSON Schema
validator. Extra metadata remains in the original report. Unknown outcome states, missing critical
fields, inconsistent selected counts and missing verification cannot silently pass.

## Import an existing run (no runner or model needed)

```sh
node /path/to/ShipGuard/plugins/shipguard/adapters/e2e/adapter.mjs import \
  --project /path/to/application --report .e2e/report.json
```

The report path is resolved relative to `--project`. Local artifact paths are resolved relative to
the report's directory, i.e. upstream's output root. Import does not rerun tests or verify that an
old report matches the current checkout. Inspect the retained `source.vcs` and timestamp; no
current-commit coverage is inferred. Use run mode for newly produced evidence.

## Launch an existing, trusted suite

Install and pin e2e **in the target application's project**, using its normal dependency management,
not in ShipGuard. The launcher checks `node_modules/e2e/package.json` and calls its installed
`dist/cli/bin.js` directly through Node. No `npx`, downloaded binary or shell command is used.
The real runner requires Node 22.22.3+ on 22, or Node 24.8+; see upstream's runtime requirements.

```sh
node /path/to/ShipGuard/plugins/shipguard/adapters/e2e/adapter.mjs run \
  --project /path/to/application --config e2e.config.ts \
  --target web --test tests/cart.e2e.ts --test tests/login.e2e.ts \
  --timeout-ms 300000
```

Select existing test files, not arbitrary shell commands or globs. Run mode requires a POSIX host
so it can terminate its own process group on timeout/interruption. Import is independent of that
restriction. The default timeout is 300000 ms; accepted range is 100–3600000 ms.

The adapter forces `CI=1`, `E2E_TELEMETRY_DISABLED=1`, one worker, zero retries, strict replay and
trace retention. A fresh upstream output directory is reserved for each launch. A missing report,
process/report disagreement, stale timestamps, or interruption is never replaced by yesterday's
successful `.e2e/report.json`. Only this launch's process group is cleaned up.

**Strict replay does not mean zero model calls.** Missing recordings and model judgments can still
call a provider. The adapter does not implement another cache or weaken assertions. To prepare a
cache, use upstream's explicit recording workflow separately, with meaningful locator assertions.
A LiteLLM/OpenAI-compatible model belongs in the application's trusted e2e config; no particular
model, tools/image support, savings or connectivity has been validated by this PR.

## Results and exit codes

Every invocation creates a fresh private directory:

```text
visual-tests/_results/e2e/<random-uuid>/
  source-report.json       # original imported bytes, SHA-256 retained
  e2e-results.json         # execution outcomes, attempts, cache/model metadata, evidence index
  adapter-run.json         # adapter provenance and execution-only exit code
  artifacts/<sha256>.bin   # opaque, integrity-checked local artifact bytes
  upstream/               # run mode only: e2e's report, traces and original output
  runner.stdout.log       # run mode only, private, not printed into chat
  runner.stderr.log       # run mode only, private, not printed into chat
  adapter-error.json       # on failure, safe code only
```

The adapter **never writes or merges `visual-results.json`, `run.json` or other canonical lane
files**. `e2e-results.json` uses familiar summary/test fields but is NOT a drop-in visual result.
Do not rename it to bypass review. `PASS` means external execution passed its recorded checks;
`visual_review` always remains `not-performed`, `screenshot` remains null and `ship_ready` is false.
A captured screenshot is only `captured-not-reviewed`, never an assertion of visual correctness.
An absent/withheld screenshot is `unavailable`, without inventing its cause or a visual verdict.

| Adapter exit | Meaning within this external-execution lane |
|---|---|
| 0 | Selected external tests and recorded checks passed; **not permission to ship** |
| 1 | Product findings or flaky execution |
| 2 | Infrastructure, interruption, failed cleanup, report disagreement or broken artifact integrity |
| 3 | Unsupported/invalid declaration, stale replay, empty/partial coverage or absent recorded checks |

Precedence follows ShipGuard: `2 > 3 > 1 > 0`. Upstream exit 2 maps to 3; upstream 3/4/130 map to 2.
Structured error categories, attempt/step errors and cleanup also contribute. Flaky results fail
this lane even if upstream exited zero. Selected skipped tests are incomplete; explicitly
unselected tests stay outside this invocation's coverage. Setup-only runs cannot pass the lane.

Raw upstream attempts and cache/model metrics are retained unchanged; reported usage is not a
new measurement. All assertions, selectors, model verdicts and redaction claims still require
review. An execution with no recorded assertion is incomplete; use explicit locator assertions
or `agent.assert`, not an unobservable custom check, for this first adapter.

## Confidentiality and trust

Tests/configs and the installed runner execute with the host user's privileges. They can call
project scripts, contact services, read inherited credentials and write files: this adapter is
**not a sandbox**. Use a trusted checkout, synthetic accounts and isolated staging/network access.
Selecting files does not sandbox collection of other tests. No origin allowlist is added here.

Runner stdout/stderr retention is capped at 1 MiB each; excess bytes are drained and the
provenance marks `logs_truncated`. Raw reports and logs may contain confidential text. New bundles use mode 0700 and files 0600 on
POSIX; OS/ACL behavior still applies. Nothing is uploaded or published. Do not commit these output
bundles. Only complete-redaction artifacts with matching size/SHA-256 are copied; incomplete or
remote evidence is not fetched. Local paths are checked for traversal/symlinks and read with
bounded sizes. Artifacts remain `.bin` instead of executable HTML links. These checks are not a
concurrent-adversary filesystem sandbox: import a quiescent, trusted snapshot.

A `complete` redaction claim is upstream metadata, not proof that all sensitive content was removed.
Do not circumvent `Secret`-triggered pixel restrictions. Review evidence retention and authentication
before enabling real runs. Run-mode traces stay under `upstream/`; import copies report-listed
artifacts, not unlisted trace files. Keep the original output when those extra files are required.

## Tests and review

```sh
node plugins/shipguard/adapters/e2e/outcomes-smoke-test.mjs
node plugins/shipguard/adapters/e2e/adapter-smoke-test.mjs
node plugins/shipguard/adapters/e2e/runner-smoke-test.mjs
```

These standalone Node scripts use synthetic consumed-shape fixtures and a fake process, with no
network, browser, API key or model. They are **not** an upstream schema conformance or live-browser
benchmark. The fixture helper and fake runner are test-only; the adapter never imports them.

Before merge, another AI/reviewer must challenge the implementation against the then-current
ShipGuard and upstream source, execute the tests, and add counterexamples. Keep issue #99 open for
the real-browser/LiteLLM/authentication pilot, token/time measurements and an independent review.
Do not auto-merge. Precise assertions in the existing CLI, native-mobile integration and dashboard
promotion are separate changes; they are intentionally not slipped into this adapter PR.

## Verified source baseline

ShipGuard: `1776b55ba5c55f063264cd2a8b5a590f529939bf`.
Upstream: `06bb72653f9c8ff3377db9124b06e0b2af746c30`, inspected 2026-10-09.

- [Report contract](https://github.com/tester-army/e2e/blob/06bb72653f9c8ff3377db9124b06e0b2af746c30/packages/e2e/src/report/build.ts)
- [Report schema](https://github.com/tester-army/e2e/blob/06bb72653f9c8ff3377db9124b06e0b2af746c30/packages/e2e/schema/report-v1.schema.json)
- [Result/artifact records](https://github.com/tester-army/e2e/blob/06bb72653f9c8ff3377db9124b06e0b2af746c30/packages/e2e/src/run/records.ts)
- [Error taxonomy](https://github.com/tester-army/e2e/blob/06bb72653f9c8ff3377db9124b06e0b2af746c30/packages/e2e/src/internal/errors.ts)
- [CLI flags](https://e2e.tester.army/docs/reference/cli), [cache](https://e2e.tester.army/docs/cache), [security](https://e2e.tester.army/docs/security)
