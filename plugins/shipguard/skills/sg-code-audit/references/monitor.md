# Monitor Reference — Server Setup and POST Payloads

Referenced from SKILL.md Phase 0 (setup) and Phases 3.5, 4, 5, 5.6, and 6 (POST payloads). The monitor is optional — if the user declines or the server can't start, the audit proceeds normally.

**Failure policy (applies to every POST below):** all monitor POSTs are wrapped in try/catch. If any POST fails, set `monitor_active = false` and continue silently — never crash the audit for monitoring.

## Phase 0 — Monitor Setup

### Step 1: Check for existing server

Before making any health check calls, determine `results_dir` early: it is always `visual-tests/_results/` (run `mkdir -p visual-tests/_results` if it doesn't exist). Use this value to compare against health check responses below.

```bash
curl -s --max-time 2 http://localhost:8888/health
```

- **200 OK:** Parse the response JSON. Compare `results_dir` against `visual-tests/_results/`.
  - If they match → set `monitor_active = true`, `monitor_url = "http://localhost:8888"`. Print: `Monitor: connected to existing server.`
  - If they differ → another project's server is running. Try ports 8889, 8890 with `--port=` (same health check + results_dir comparison). If none match, treat as "not running" and go to Step 2.
- **Connection refused / timeout:** Server not running. Go to Step 2.

### Step 2: Monitor decision

If no matching server found:

**Default: monitor OFF.** Most solo developers don't need a real-time dashboard for a 10-minute audit.

- If `--monitor` flag was passed → proceed to start the server (skip the question)
- If mode is `deep` or `paranoid` (estimated >15 min) → ask the user:
  > "This audit may take 15+ min. Monitor progress in a dashboard? (yes/no)"
- Otherwise → set `monitor_active = false`, skip silently

- **yes:**
  1. Check if `visual-tests/build-review.mjs` exists. If not, bootstrap from the installed ShipGuard plugin directory. Resolve `SHIPGUARD_PLUGIN_ROOT` from this skill path (`$SHIPGUARD_PLUGIN_ROOT/skills/sg-code-audit/SKILL.md`), then copy from the sibling `sg-visual-review` skill:
     ```bash
     mkdir -p visual-tests/_results/screenshots
     if [ -f "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/build-review.mjs" ]; then
       cp "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/build-review.mjs" visual-tests/
       cp "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-review/_review-template.html" visual-tests/
     else
       echo "Plugin files not found — skipping bootstrap"
     fi
     ```
     Also create a minimal `visual-tests/_config.yaml` if it doesn't exist (required by the build script):
     ```bash
     cat > visual-tests/_config.yaml << 'EOF'
     base_url: http://localhost:3000
     EOF
     ```
  2. Pick port: use 8888 if free. If 8888 is occupied by another project's server, try 8889 then 8890. Use the first port that either returns a matching `results_dir` or is not listening.
  3. Start server:
     ```bash
     node visual-tests/build-review.mjs --serve --port={port}
     ```
  4. Wait for health check (retry 3x, 1s apart):
     ```bash
     curl -s --max-time 2 http://localhost:{port}/health
     ```
  5. If healthy → `monitor_active = true`, `monitor_url = "http://localhost:{port}"`. Print: `Monitor: server started at http://localhost:{port}`
  6. If not → `monitor_active = false`. Print: `Monitor: server failed to start — proceeding without monitoring.`
- **no:** Set `monitor_active = false`. Set `monitor_url = null`.

### Step 3: Store monitor state

Store `monitor_active` (boolean) and `monitor_url` (string) as working variables for subsequent phases.

## POST payloads

### audit-start (Phase 3.5)

Sent **once**, after zones are known and before the round loop begins. Must NOT be repeated on subsequent rounds.

```
POST {monitor_url}/api/monitor/audit-start
Body: {"mode": "{mode}", "round_count": {round_count}, "agent_count": {agent_count},
       "zones": [{zone objects with zone_id, paths, file_count}],
       "scope_mode": "{scope_mode}", "scope_ref": "{scope_ref}",
       "timestamp": "{ISO 8601 now}"}
```

If the POST fails, set `monitor_active = false` and continue silently.

**Note on overflow children:** Re-split child zones are dynamically added to the monitor via `agent-update` with `status: started` (see Phase 5). The server creates new agent entries for unknown `agent_id`s automatically — no pre-registration is needed here.

Do NOT re-POST audit-start on round 2 or round 3 — it resets all monitor state.

### agent-started (Phase 4)

After dispatching each agent (every round):

```
POST {monitor_url}/api/monitor/agent-update
Body: {"agent_id": "r{round}:{zone_id}", "zone_id": "{zone_id}", "status": "started",
       "round": {round}, "started_at": "{ISO 8601 now}"}
```

### agent completion (Phase 5)

After processing each agent's result:

- **Success:** POST agent-update with completion data:
  ```
  POST {monitor_url}/api/monitor/agent-update
  Body: {"agent_id": "r{round}:{zone_id}", "zone_id": "{zone_id}", "status": "completed",
         "round": {round}, "started_at": "{original}", "ended_at": "{ISO 8601 now}",
         "duration_ms": {from agent result footer or elapsed time},
         "tokens": {"total": {total_tokens}, "input": {input_tokens}, "output": {output_tokens}},
         "estimated_cost_usd": {calculated from tokens — sonnet: $3/$15, opus: $5/$25 per 1M in/out},
         "tool_uses": {from agent result footer}, "bugs_found": {from zone JSON},
         "files_audited": {from zone JSON}}
  ```
  Extract `total_tokens`, `tool_uses`, and `duration_ms` from the Agent tool's result footer. If input/output split is unavailable, estimate 60/40 ratio from total.

  **Note:** Cost estimation uses the model specified in the agent dispatch. In `auto` mode, audit agents run on opus. Adjust the pricing table accordingly when the `--model` flag overrides the default — and update these prices when model prices change.

- **Context overflow:** POST overflow + started for children:
  ```
  POST {monitor_url}/api/monitor/agent-update
  Body: {"agent_id": "r{round}:{zone_id}", "status": "overflow",
         "error": "context overflow — re-splitting", "overflow_into": ["{child_id_a}", "{child_id_b}"]}
  POST {monitor_url}/api/monitor/agent-update
  Body: {"agent_id": "r{round}:{child_id_a}", "zone_id": "{child_id_a}", "status": "started", ...}
  POST {monitor_url}/api/monitor/agent-update
  Body: {"agent_id": "r{round}:{child_id_b}", "zone_id": "{child_id_b}", "status": "started", ...}
  ```

- **Error:** POST agent-update with `status: "failed"` and `error: "{error message}"`.

### flow tracer (Phase 5.6)

POST agent-update for flow tracers with `zone_id: "cross-zone"` and `agent_id: "r{round}:cross-zone"` — same started/completed/failed payloads as zone agents above.

### audit-complete (Phase 6)

```
POST {monitor_url}/api/monitor/audit-complete
Body: {"status": "completed", "timestamp": "{ISO 8601 now}"}
```

Print: `Monitor: audit complete — view results at {monitor_url}`
