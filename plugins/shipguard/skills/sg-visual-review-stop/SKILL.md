---
name: sg-visual-review-stop
description: Stop the Visual review HTTP server. Trigger on "sg-visual-review-stop", "visual-review-stop", "stop review server", "stop html server".
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
lsof -ti:8888 | xargs kill 2>/dev/null
```

Print a warning if fallback was needed: "Warning: --stop failed, used lsof fallback to kill process on port 8888."
