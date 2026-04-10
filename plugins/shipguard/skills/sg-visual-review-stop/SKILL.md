---
name: visual-review-stop
description: Stop the Visual review HTTP server. Trigger on "visual-review-stop", "stop review server", "stop html server".
context: conversation
---

# /visual-review-stop

Stop the review page HTTP server.

## Instructions

```bash
node visual-tests/build-review.mjs --stop
```

If no PID file exists, report "No server running."
