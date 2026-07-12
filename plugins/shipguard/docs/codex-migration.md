# ShipGuard Codex Migration

Use this when a machine still has an older local Codex adapter such as `shipguard-codex@personal`, or when Claude and Codex point at different marketplace sources.

## 1. Inspect Current Installs

```bash
codex plugin list
claude plugin list
```

If both `shipguard-codex@personal` and `shipguard@shipguard` appear, keep `shipguard@shipguard` and remove the old adapter.

## 2. Remove Old Codex Adapter

```bash
codex plugin remove shipguard-codex@personal
```

If your Codex CLI uses a different remove command, run:

```bash
codex plugin --help
```

Then remove the stale adapter name shown by `codex plugin list`.

If removal fails with an error such as:

```text
failed to remove existing plugin cache entry: Operation not permitted
```

rerun with permission to modify the Codex plugin cache. The remove command updates local config and deletes the cached plugin entry, so sandboxes may block it even though it is only local cleanup.

After removal, verify:

```bash
codex plugin list
```

`shipguard-codex@personal` should be absent or listed as not installed. `shipguard@shipguard` should remain installed.

## 3. Install Official ShipGuard Entry

```bash
codex plugin marketplace add bacoco/shipguard
codex plugin add shipguard@shipguard
codex plugin list
```

The expected entry is `shipguard@shipguard` at the current plugin version.

### Trust the mission-lock hook

Codex requires explicit trust for plugin hooks. Open `/hooks`, review the ShipGuard hook, trust its
current definition, and start a new thread. The hook is read-only and stateless: it injects mission
guidance only for `gpt-5.6` / `gpt-5.6-sol` or prompts that explicitly name that model.

If the hook is not trusted, `/sg-mission-lock` remains available, but automatic model-aware
activation is not guaranteed.

## 4. Refresh Claude

If Claude Code does not have ShipGuard yet, install it from the marketplace:

```bash
claude plugin marketplace add bacoco/shipguard
claude plugin install shipguard@shipguard
```

If it is already installed that way, update it:

```bash
claude plugin update shipguard@shipguard
claude plugin list
```

Restart Claude Code after updating. Claude and Codex use separate plugin caches, so updating one side does not refresh the other.

## 5. Validate

The smoke-test scripts ship inside the plugin; they only appear under `visual-tests/` after the `sg-visual-review` bootstrap copies them into a project. On a fresh install, run them straight from the plugin:

```bash
node "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/review-smoke-test.mjs" --port=23101
node "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/monitor-smoke-test.mjs" --port=23102
node "$SHIPGUARD_PLUGIN_ROOT/skills/sg-mission-lock/scripts/mission-lock-smoke-test.mjs"
```

Or run `/sg-visual-review` once in your project (the bootstrap copies the scripts), then:

```bash
node visual-tests/review-smoke-test.mjs --port=23101
node visual-tests/monitor-smoke-test.mjs --port=23102
```

If local ports are blocked, rerun with another `--port` or grant loopback bind permission in the sandbox.
