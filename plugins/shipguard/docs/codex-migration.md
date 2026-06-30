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

## 4. Refresh Claude

```bash
claude plugin update shipguard@shipguard
claude plugin list
```

Restart Claude Code after updating. Claude and Codex use separate plugin caches, so updating one side does not refresh the other.

## 5. Validate

```bash
node visual-tests/review-smoke-test.mjs --port=23101
node visual-tests/monitor-smoke-test.mjs --port=23102
```

If local ports are blocked, rerun with another `--port` or grant loopback bind permission in the sandbox.
