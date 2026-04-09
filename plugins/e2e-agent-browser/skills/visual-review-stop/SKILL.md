---
name: e2e-review-stop
description: Stop the E2E review HTTP server. Trigger on "e2e-review-stop", "stop review server", "arrete le serveur review", "stop html server".
context: conversation
---

# /e2e-review-stop

Stop the review page HTTP server.

## Instructions

```bash
node e2e-tests/build-review.mjs --stop
```

If no PID file exists, report "No server running."
