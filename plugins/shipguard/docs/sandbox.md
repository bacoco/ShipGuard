# ShipGuard Sandbox Notes

ShipGuard can run in Codex, Claude, and local shells. Some actions are legitimate but often blocked by sandbox defaults.

| Action | Why it may be blocked | Workaround |
|--------|------------------------|------------|
| `agent-browser` | Browser daemon/socket may write outside the workspace | Allow the socket path or configure it under `/tmp` when supported |
| `node visual-tests/build-review.mjs --serve` | Opens a local HTTP port | Bind stays on `127.0.0.1` by default; allow local port access |
| `node visual-tests/review-smoke-test.mjs` / `monitor-smoke-test.mjs` | Starts a temporary server on `127.0.0.1` | Use `--port=<port>` or `SHIPGUARD_SMOKE_PORT`; `listen EPERM` means the sandbox denied local bind |
| `curl` or browser POST to localhost | Local network calls can be blocked | Allow loopback network for `POST /save-manifest` and monitor smoke tests |
| `gh api` / `gh issue` | Needs GitHub network and auth | Grant network explicitly or use `--offline` / `--dry-run` modes |
| `npm install`, `npx playwright install` | Needs network and writes dependencies | Ask before network install; prefer bounded local checks first |
| Python bytecode cache | Python may write `__pycache__` outside expected paths | Set `PYTHONPYCACHEPREFIX=/tmp/shipguard-pycache` |
| Git writes / GitHub publish | Modifies repo history or remote state | Use dry-run/report-only first when reviewing destructive paths |

Treat sandbox errors as environment constraints, not product failures. Report the blocked action, the permission needed, and the safest non-network fallback.
