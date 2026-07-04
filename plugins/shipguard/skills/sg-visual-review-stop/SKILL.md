---
name: sg-visual-review-stop
description: Use when the ShipGuard review dashboard server should be shut down after a review session — stops the sg-visual-review HTTP server via its PID file, with a port-based fallback.
context: conversation
---

# /sg-visual-review-stop

Stop the review page HTTP server.

## Instructions

```bash
node visual-tests/build-review.mjs --stop
```

`--stop` short-circuits: it only reads `visual-tests/_results/.server.pid`, kills that process, and removes the PID file — no rebuild, no config parsing.

If no PID file exists, report "No server running."

CLI equivalent: `node visual-tests/shipguard.mjs stop --all` — stops the app-under-test server (started by `shipguard serve`/`run`) AND the review server in one command.

If `--stop` exits with a non-zero code, fall back to killing by port. The PID file contains two lines: `<pid>` then `<port>`.

```bash
# Read the port from line 2 of the PID file; default to 8888 if missing
port=$(sed -n '2p' visual-tests/_results/.server.pid 2>/dev/null)
[ -z "$port" ] && port=8888
lsof -ti:"$port" | xargs -r kill
```

Print a warning if fallback was needed: "Warning: --stop failed, used lsof fallback to kill process on port {port}."
