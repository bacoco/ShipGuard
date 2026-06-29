---
name: sg-visual-review-stop
description: Stop the ShipGuard visual review HTTP server.
context: conversation
---

# /sg-visual-review-stop

Stop the review page HTTP server.

## Instructions

```bash
node visual-tests/build-review.mjs --stop
```

If no PID file exists, report "No server running."

If `--stop` exits with a non-zero code or the PID file contains an invalid PID, fall back to:

```bash
# Read the port from _results/.server.pid if present, otherwise default to 8888
port=$(grep -m1 'port' visual-tests/_results/.server.pid 2>/dev/null | awk '{print $2}' || echo 8888)
lsof -ti:${port} | xargs kill 2>/dev/null
```

Print a warning if fallback was needed: "Warning: --stop failed, used lsof fallback to kill process on port {port}."
