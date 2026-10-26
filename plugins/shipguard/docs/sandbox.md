# ShipGuard Sandbox Notes

ShipGuard can run in Codex, Claude, and local shells. Some actions are legitimate but often blocked by sandbox defaults.

| Action | Why it may be blocked | Workaround |
|--------|------------------------|------------|
| `agent-browser` | Browser daemon/socket may write outside the workspace | Allow the socket path or configure it under `/tmp` when supported |
| `sg-code-audit` artifact retention | Its linked worktree index and shared Git object store may be outside the writable JSON directory | Resolve `git rev-parse --path-format=absolute --git-path index` and `--git-path objects` in the assigned worktree; check authorization for those exact paths. Do not probe by writing to Git or widen permissions automatically. A refusal means incomplete artifact transport, not a new canonical audit report. |
| `sg-record --check` | Its own Node Playwright package and headed Chromium launch may be unavailable | Use its `PLAYWRIGHT_MISSING`, `CHROMIUM_MISSING`, and `GUI_LAUNCH_FAILED` diagnostics; an `agent-browser` version check does not cover the recorder. |
| `sg-visual-run` / CLI visual run | `agent-browser --version` can succeed while browser launch or its socket fails | Test the run's owned browser session; report launch failure as visual infrastructure, without treating a static audit as browser-dependent. |
| Recorder navigation smoke test only | The internal test uses `agent-browser get cdp-url` for its CDP witness | Explain this prerequisite only for that test; it is not a general recorder, visual-run, or static-audit requirement. |
| `node visual-tests/build-review.mjs --serve` | Opens a local HTTP port | Bind stays on `127.0.0.1` by default; allow local port access |
| `node visual-tests/review-smoke-test.mjs` / `monitor-smoke-test.mjs` | Starts a temporary server on `127.0.0.1` | Use `--port=<port>` or `SHIPGUARD_SMOKE_PORT`; `listen EPERM` means the sandbox denied local bind |
| `curl` or browser POST to localhost | Local network calls can be blocked | Allow loopback network for `POST /save-manifest` and monitor smoke tests |
| `gh api` / `gh issue` | Needs GitHub network and auth | Grant network explicitly or use `--offline` / `--dry-run` modes |
| `npm install`, `npx playwright install` | Needs network and writes dependencies | Ask before network install; prefer bounded local checks first |
| Python bytecode cache | Python may write `__pycache__` outside expected paths | Set `PYTHONPYCACHEPREFIX=/tmp/shipguard-pycache` |
| Git writes / GitHub publish | Modifies repo history or remote state | Use dry-run/report-only first when reviewing destructive paths |

Treat sandbox errors as environment constraints, not product failures. Report the blocked action, the permission needed, and the safest non-network fallback.
