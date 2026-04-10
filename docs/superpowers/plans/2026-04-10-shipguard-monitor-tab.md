# ShipGuard Monitor Tab — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Monitor" tab to the ShipGuard review dashboard showing real-time audit progress (Gantt timeline, tokens, cost, bugs per zone).

**Architecture:** sg-code-audit POSTs lifecycle events to 3 new endpoints on the existing build-review.mjs HTTP server. The review HTML fetches `GET /api/monitor` to render a Gantt chart with live polling. Monitor data is runtime-only (not injected at build time like audit data).

**Tech Stack:** Node.js (build-review.mjs HTTP server), vanilla HTML/CSS/JS (review template), Markdown (SKILL.md)

**Spec:** `docs/specs/2026-04-10-shipguard-monitor-design.md`

---

### Task 1: Monitor state + helper functions in build-review.mjs

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-review/build-review.mjs` (insert after `const CONFIG_PATH = ...`, before `// ── Early exit: --stop ...`)

- [ ] **Step 1: Add monitor state variable and helpers**

Insert this block after the `const CONFIG_PATH = ...` line and before `// ── Early exit: --stop just kills the server`:

```javascript
// ── Monitor state (in-memory, written to monitor-data.json on each update) ──
const MONITOR_PATH = join(RESULTS_DIR, 'monitor-data.json');
let monitorState = null;

// Load previous monitor data from disk (survives server restart)
function loadMonitorFromDisk() {
  if (existsSync(MONITOR_PATH)) {
    try { monitorState = JSON.parse(readFileSync(MONITOR_PATH, 'utf8')); }
    catch { monitorState = null; }
  }
}
loadMonitorFromDisk();

function writeMonitorData() {
  if (!monitorState) return;
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(MONITOR_PATH, JSON.stringify(monitorState, null, 2), 'utf8');
}

function recalcTotals() {
  if (!monitorState) return;
  const agents = monitorState.agents;
  let tokens = 0, cost = 0, toolUses = 0, bugs = 0, files = 0;
  for (const a of agents) {
    tokens += a.tokens?.total || 0;
    cost += a.estimated_cost_usd || 0;
    toolUses += a.tool_uses || 0;
    bugs += a.bugs_found || 0;
    files += a.files_audited || 0;
  }
  const now = Date.now();
  const startMs = new Date(monitorState.started_at).getTime();
  monitorState.totals = {
    tokens,
    estimated_cost_usd: Math.round(cost * 100) / 100,
    tool_uses: toolUses,
    bugs_found: bugs,
    files_audited: files,
    wall_clock_ms: monitorState.ended_at
      ? new Date(monitorState.ended_at).getTime() - startMs
      : now - startMs,
  };
}

function parseJsonBody(req, res, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        reject(null);
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON: ' + e.message }));
        reject(null);
      }
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-review/build-review.mjs
git commit -m "feat(monitor): add monitor state + helpers to build-review.mjs"
```

---

### Task 2: Add 5 API routes to the HTTP server in build-review.mjs

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-review/build-review.mjs` — inside the `http.createServer` callback

- [ ] **Step 1: Add all 5 monitor routes**

Insert this block right after the existing `POST /save-manifest` handler (after its closing `return;`) and before the `if (req.method === 'OPTIONS')` handler:

```javascript
    // ── GET /health ──
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ status: 'ok', results_dir: resolve(RESULTS_DIR) }));
      return;
    }

    // ── GET /api/monitor ──
    if (req.method === 'GET' && req.url === '/api/monitor') {
      // Fallback: reload from disk if in-memory state was lost (server restart)
      if (!monitorState) loadMonitorFromDisk();
      if (!monitorState) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'No monitor data' }));
      } else {
        recalcTotals();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(monitorState));
      }
      return;
    }

    // ── POST /api/monitor/audit-start ──
    if (req.method === 'POST' && req.url === '/api/monitor/audit-start') {
      try {
        const data = await parseJsonBody(req, res, 1024 * 1024);
        if (!data) return;
        monitorState = {
          status: 'running',
          mode: data.mode || 'standard',
          round_count: data.round_count || 1,
          scope_mode: data.scope_mode || 'full',
          scope_ref: data.scope_ref || null,
          started_at: data.timestamp || new Date().toISOString(),
          ended_at: null,
          agents: (data.zones || []).map(z => ({
            agent_id: 'r1:' + z.zone_id,
            zone_id: z.zone_id,
            paths: z.paths || [],
            file_count: z.file_count || 0,
            status: 'pending',
            round: 1,
            started_at: null,
            ended_at: null,
            duration_ms: 0,
            tokens: { total: 0, input: 0, output: 0 },
            estimated_cost_usd: 0,
            tool_uses: 0,
            bugs_found: 0,
            files_audited: 0,
            error: null,
            overflow_into: null,
          })),
          totals: { tokens: 0, estimated_cost_usd: 0, tool_uses: 0, bugs_found: 0, files_audited: 0, wall_clock_ms: 0 },
        };
        writeMonitorData();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch { /* parseJsonBody already sent error response */ }
      return;
    }

    // ── POST /api/monitor/agent-update ──
    if (req.method === 'POST' && req.url === '/api/monitor/agent-update') {
      try {
        const data = await parseJsonBody(req, res, 1024 * 1024);
        if (!data) return;
        if (!monitorState) {
          res.writeHead(409, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'No audit in progress' }));
          return;
        }
        const agentId = data.agent_id;
        let agent = monitorState.agents.find(a => a.agent_id === agentId);
        if (!agent) {
          // New agent (e.g. overflow child) — add it
          agent = {
            agent_id: agentId,
            zone_id: data.zone_id || agentId,
            paths: data.paths || [],
            file_count: data.file_count || 0,
            status: 'pending',
            round: data.round || 1,
            started_at: null, ended_at: null, duration_ms: 0,
            tokens: { total: 0, input: 0, output: 0 },
            estimated_cost_usd: 0, tool_uses: 0, bugs_found: 0, files_audited: 0,
            error: null, overflow_into: null,
          };
          monitorState.agents.push(agent);
        }
        // Update fields from payload
        agent.agent_id = agentId;
        if (data.zone_id) agent.zone_id = data.zone_id;
        if (data.status) agent.status = data.status;
        if (data.round) agent.round = data.round;
        if (data.started_at) agent.started_at = data.started_at;
        if (data.ended_at) agent.ended_at = data.ended_at;
        if (data.duration_ms) agent.duration_ms = data.duration_ms;
        if (data.tokens) agent.tokens = data.tokens;
        if (data.estimated_cost_usd != null) agent.estimated_cost_usd = data.estimated_cost_usd;
        if (data.tool_uses != null) agent.tool_uses = data.tool_uses;
        if (data.bugs_found != null) agent.bugs_found = data.bugs_found;
        if (data.files_audited != null) agent.files_audited = data.files_audited;
        if (data.error !== undefined) agent.error = data.error;
        if (data.overflow_into) agent.overflow_into = data.overflow_into;
        recalcTotals();
        writeMonitorData();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch { /* parseJsonBody already sent error response */ }
      return;
    }

    // ── POST /api/monitor/audit-complete ──
    if (req.method === 'POST' && req.url === '/api/monitor/audit-complete') {
      try {
        const data = await parseJsonBody(req, res, 1024 * 1024);
        if (!data) return;
        if (!monitorState) {
          res.writeHead(409, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'No audit in progress' }));
          return;
        }
        monitorState.status = data.status || 'completed';
        monitorState.ended_at = data.timestamp || new Date().toISOString();
        recalcTotals();
        writeMonitorData();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch { /* parseJsonBody already sent error response */ }
      return;
    }
```

- [ ] **Step 2: Update OPTIONS handler to include monitor paths**

The existing OPTIONS handler already returns `Access-Control-Allow-Methods: 'GET,POST'` which covers all monitor routes. No change needed.

- [ ] **Step 3: Test manually with curl**

```bash
# Start server
node plugins/shipguard/skills/sg-visual-review/build-review.mjs --serve &
sleep 1

# Test health
curl -s http://localhost:8888/health | jq .

# Test monitor 404 (no audit yet)
curl -s -o /dev/null -w "%{http_code}" http://localhost:8888/api/monitor
# Expected: 404

# Test audit-start
curl -s -X POST http://localhost:8888/api/monitor/audit-start \
  -H 'Content-Type: application/json' \
  -d '{"mode":"standard","round_count":1,"zones":[{"zone_id":"z01","paths":["src/"],"file_count":10}],"timestamp":"2026-04-10T14:30:00Z"}'

# Test agent-update
curl -s -X POST http://localhost:8888/api/monitor/agent-update \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"r1:z01","zone_id":"z01","status":"started","round":1,"started_at":"2026-04-10T14:30:02Z"}'

# Test GET monitor
curl -s http://localhost:8888/api/monitor | jq .

# Test audit-complete
curl -s -X POST http://localhost:8888/api/monitor/audit-complete \
  -H 'Content-Type: application/json' \
  -d '{"status":"completed","timestamp":"2026-04-10T14:35:00Z"}'

# Verify final state
curl -s http://localhost:8888/api/monitor | jq .status
# Expected: "completed"

# Stop server
node plugins/shipguard/skills/sg-visual-review/build-review.mjs --stop
```

- [ ] **Step 4: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-review/build-review.mjs
git commit -m "feat(monitor): add 5 monitor API routes to build-review.mjs server"
```

---

### Task 3: Monitor tab CSS in _review-template.html

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-review/_review-template.html`

- [ ] **Step 1: Add Monitor CSS**

Insert after the `.empty{...}` rule and before the `/* Tab switcher */` comment:

```css
/* Monitor tab */
#monitor-toolbar{display:none;gap:12px;padding:12px 24px;align-items:center;flex-wrap:wrap}
#monitor-layout{display:none;padding:20px;min-height:calc(100vh - 120px)}
.monitor-stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.monitor-stat{padding:8px 16px;border-radius:var(--radius);background:var(--card);border:1px solid var(--border);text-align:center;min-width:120px}
.monitor-stat-value{font-size:22px;font-weight:700;color:var(--fg)}
.monitor-stat-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:2px}

/* Gantt chart */
.gantt{position:relative;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;overflow-x:auto}
.gantt-row{display:flex;align-items:center;gap:12px;margin-bottom:6px;min-height:28px}
.gantt-label{width:200px;flex-shrink:0;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gantt-label-zone{color:var(--primary);font-weight:600;margin-right:4px}
.gantt-track{flex:1;position:relative;height:24px;background:var(--secondary);border-radius:4px;overflow:visible}
.gantt-bar{position:absolute;top:0;height:100%;border-radius:4px;min-width:4px;transition:width .3s ease}
.gantt-bar-completed{background:var(--pass)}
.gantt-bar-running{background:var(--primary);animation:gantt-pulse 1.5s ease-in-out infinite}
.gantt-bar-failed{background:var(--fail)}
.gantt-bar-overflow{background:var(--stale)}
.gantt-bar-pending{background:var(--border)}
@keyframes gantt-pulse{0%,100%{opacity:1}50%{opacity:.5}}
.gantt-right{width:120px;flex-shrink:0;font-size:11px;color:var(--muted);text-align:right;white-space:nowrap}
.gantt-overflow-icon{color:var(--stale);font-size:13px;margin-left:4px}
.gantt-legend{display:flex;gap:16px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
.gantt-legend-item{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)}
.gantt-legend-dot{width:10px;height:10px;border-radius:2px}

/* Monitor footer */
.monitor-footer{margin-top:16px;padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);font-size:13px;color:var(--muted);display:flex;justify-content:space-between;align-items:center}
.monitor-footer-link{color:var(--primary);cursor:pointer;text-decoration:underline}
.monitor-footer-link:hover{color:var(--fg)}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-review/_review-template.html
git commit -m "feat(monitor): add Monitor tab CSS to review template"
```

---

### Task 4: Monitor tab HTML structure in _review-template.html

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-review/_review-template.html`

- [ ] **Step 1: Add Monitor tab button**

In the `#header-tabs` div, add the third button after the Code Audit button:

Replace:
```html
    <button class="tab-btn" id="tab-audit" onclick="switchTab('audit')">Code Audit</button>
  </div>
```
With:
```html
    <button class="tab-btn" id="tab-audit" onclick="switchTab('audit')">Code Audit</button>
    <button class="tab-btn" id="tab-monitor" onclick="switchTab('monitor')" style="display:none">Monitor</button>
  </div>
```

- [ ] **Step 2: Add Monitor toolbar and layout containers**

Insert after the `#audit-layout` closing `</div>` and before `<div id="action-bar">`:

```html

<div id="monitor-toolbar" style="display:none">
  <div class="monitor-stats" id="monitor-stats"></div>
</div>

<div id="monitor-layout" style="display:none">
  <div class="gantt" id="monitor-gantt"></div>
  <div class="monitor-footer" id="monitor-footer"></div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-review/_review-template.html
git commit -m "feat(monitor): add Monitor tab HTML structure"
```

---

### Task 5: Monitor tab JavaScript in _review-template.html

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-review/_review-template.html`

- [ ] **Step 1: Update switchTab function**

Replace the entire `function switchTab(tab) { ... }` block (find it by searching `function switchTab`) with:

```javascript
  function switchTab(tab) {
    activeTab = tab;
    var layout = document.getElementById('layout');
    var toolbar = document.getElementById('toolbar');
    var auditLayout = document.getElementById('audit-layout');
    var auditToolbar = document.getElementById('audit-toolbar');
    var monitorLayout = document.getElementById('monitor-layout');
    var monitorToolbar = document.getElementById('monitor-toolbar');
    var actionBar = document.getElementById('action-bar');
    var tabVisual = document.getElementById('tab-visual');
    var tabAudit = document.getElementById('tab-audit');
    var tabMonitor = document.getElementById('tab-monitor');
    // Hide all
    layout.style.display = 'none';
    toolbar.style.display = 'none';
    auditLayout.style.display = 'none';
    auditToolbar.style.display = 'none';
    monitorLayout.style.display = 'none';
    monitorToolbar.style.display = 'none';
    actionBar.style.display = 'none';
    tabVisual.classList.remove('active');
    tabAudit.classList.remove('active');
    tabMonitor.classList.remove('active');
    if (tab === 'visual') {
      layout.style.display = 'flex';
      toolbar.style.display = 'flex';
      actionBar.style.display = '';
      tabVisual.classList.add('active');
      renderStats();
    } else if (tab === 'audit') {
      auditLayout.style.display = 'block';
      auditToolbar.style.display = 'flex';
      tabAudit.classList.add('active');
      renderAuditStats();
    } else if (tab === 'monitor') {
      monitorLayout.style.display = 'block';
      monitorToolbar.style.display = 'flex';
      tabMonitor.classList.add('active');
      renderMonitorTab();
    }
  }
```

- [ ] **Step 2: Add monitor state variables and all monitor functions**

Insert before the `// ── Init ──` comment (near end of file):

```javascript
  // ── Monitor tab ──
  var monitorData = null;
  var monitorPollTimer = null;

  function fmtDuration(ms) {
    if (!ms || ms <= 0) return '0s';
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m > 0 ? m + 'm ' + s + 's' : s + 's';
  }

  function fmtTokens(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return String(n);
  }

  function renderMonitorStats() {
    var el = document.getElementById('monitor-stats');
    el.textContent = '';
    if (!monitorData) return;
    var t = monitorData.totals || {};
    var items = [
      [fmtDuration(t.wall_clock_ms), 'Duration'],
      [fmtTokens(t.tokens), 'Tokens'],
      ['~$' + (t.estimated_cost_usd || 0).toFixed(2), 'Est. Cost'],
      [String(t.bugs_found || 0), 'Bugs Found'],
      [String((monitorData.agents || []).length), 'Agents'],
    ];
    items.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'monitor-stat';
      div.innerHTML = '<div class="monitor-stat-value">' + item[0] + '</div><div class="monitor-stat-label">' + item[1] + '</div>';
      el.appendChild(div);
    });
    // Also update header stats when on monitor tab
    var headerStats = document.getElementById('stats');
    headerStats.textContent = '';
    [
      ['stat-total', fmtDuration(t.wall_clock_ms)],
      ['stat-pass', fmtTokens(t.tokens) + ' tokens'],
      ['stat-rate', '~$' + (t.estimated_cost_usd || 0).toFixed(2)],
      ['stat-fail', (t.bugs_found || 0) + ' bugs'],
    ].forEach(function(s) {
      var span = document.createElement('span');
      span.className = 'stat ' + s[0];
      span.textContent = s[1];
      headerStats.appendChild(span);
    });
  }

  function renderGantt() {
    var container = document.getElementById('monitor-gantt');
    container.textContent = '';
    if (!monitorData || !monitorData.agents || !monitorData.agents.length) {
      container.innerHTML = '<div class="empty">No agent data yet.</div>';
      return;
    }
    var agents = monitorData.agents;
    var auditStart = new Date(monitorData.started_at).getTime();
    var now = Date.now();
    var auditEnd = monitorData.ended_at ? new Date(monitorData.ended_at).getTime() : now;
    var totalSpan = Math.max(auditEnd - auditStart, 1000); // at least 1s to avoid div/0

    agents.forEach(function(a) {
      var row = document.createElement('div');
      row.className = 'gantt-row';

      // Label: zone_id + first path
      var label = document.createElement('div');
      label.className = 'gantt-label';
      var pathText = (a.paths && a.paths[0]) ? a.paths[0] : '';
      label.innerHTML = '<span class="gantt-label-zone">' + (a.zone_id || a.agent_id || '?') + '</span> ' + pathText;
      row.appendChild(label);

      // Track + bar
      var track = document.createElement('div');
      track.className = 'gantt-track';
      var bar = document.createElement('div');
      // Map API status "started" → CSS class "running" (animated pulse)
      var barStatus = a.status === 'started' ? 'running' : (a.status || 'pending');
      bar.className = 'gantt-bar gantt-bar-' + barStatus;
      var barStart = a.started_at ? new Date(a.started_at).getTime() - auditStart : 0;
      var barEnd = a.ended_at ? new Date(a.ended_at).getTime() - auditStart : (a.status === 'started' ? now - auditStart : barStart);
      var leftPct = Math.max(0, (barStart / totalSpan) * 100);
      var widthPct = Math.max(0.5, ((barEnd - barStart) / totalSpan) * 100);
      bar.style.left = leftPct + '%';
      bar.style.width = Math.min(widthPct, 100 - leftPct) + '%';
      track.appendChild(bar);

      // Overflow icon
      if (a.status === 'overflow') {
        var icon = document.createElement('span');
        icon.className = 'gantt-overflow-icon';
        icon.textContent = ' \u26A1';
        icon.title = 'Context overflow \u2014 re-split into ' + (a.overflow_into || []).join(', ');
        track.appendChild(icon);
      }
      row.appendChild(track);

      // Right label: bugs + cost
      var right = document.createElement('div');
      right.className = 'gantt-right';
      if (a.status === 'completed' || a.status === 'failed' || a.status === 'overflow') {
        right.textContent = (a.bugs_found || 0) + ' bugs  $' + (a.estimated_cost_usd || 0).toFixed(2);
      } else if (a.status === 'started') {
        right.textContent = 'running\u2026';
      } else {
        right.textContent = 'pending';
      }
      row.appendChild(right);

      container.appendChild(row);
    });

    // Legend
    var legend = document.createElement('div');
    legend.className = 'gantt-legend';
    [
      ['var(--primary)', 'running'],
      ['var(--pass)', 'completed'],
      ['var(--fail)', 'failed'],
      ['var(--stale)', 'overflow'],
    ].forEach(function(item) {
      var el = document.createElement('div');
      el.className = 'gantt-legend-item';
      el.innerHTML = '<span class="gantt-legend-dot" style="background:' + item[0] + '"></span>' + item[1];
      legend.appendChild(el);
    });
    container.appendChild(legend);
  }

  function renderMonitorFooter() {
    var el = document.getElementById('monitor-footer');
    if (!monitorData) { el.textContent = ''; return; }
    var agents = monitorData.agents || [];
    var completed = agents.filter(function(a) { return a.status === 'completed'; }).length;
    var failed = agents.filter(function(a) { return a.status === 'failed'; }).length;
    var total = agents.length;
    var text = '';
    if (monitorData.status === 'running') {
      text = 'Audit in progress \u2014 ' + completed + '/' + total + ' agents completed';
    } else if (monitorData.status === 'completed') {
      text = 'Completed \u2014 ' + total + ' agents, ' + (monitorData.round_count || 1) + ' round(s), ' + fmtDuration(monitorData.totals?.wall_clock_ms);
    } else if (monitorData.status === 'failed') {
      text = 'Audit failed \u2014 ' + completed + ' completed, ' + failed + ' failed';
    }
    el.textContent = '';
    var span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    // Link to Code Audit tab if audit data exists
    if (D.audit) {
      var link = document.createElement('span');
      link.className = 'monitor-footer-link';
      link.textContent = 'View Code Audit results \u2192';
      link.addEventListener('click', function() { switchTab('audit'); });
      el.appendChild(link);
    }
  }

  function renderMonitorTab() {
    renderMonitorStats();
    renderGantt();
    renderMonitorFooter();
  }

  function pollMonitor() {
    fetch('/api/monitor').then(function(r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function(data) {
      if (!data) return;
      monitorData = data;
      if (activeTab === 'monitor') renderMonitorTab();
      // Stop polling when audit is done
      if (data.status !== 'running' && monitorPollTimer) {
        clearInterval(monitorPollTimer);
        monitorPollTimer = null;
      }
    }).catch(function() { /* server unreachable — ignore */ });
  }

  var monitorDiscoveryTimer = null;

  function activateMonitorTab(data) {
    monitorData = data;
    document.getElementById('tab-monitor').style.display = '';
    document.getElementById('header-tabs').classList.add('visible');
    // Stop discovery polling once tab is active
    if (monitorDiscoveryTimer) { clearInterval(monitorDiscoveryTimer); monitorDiscoveryTimer = null; }
    // Start live polling if audit is still running
    if (data.status === 'running' && !monitorPollTimer) {
      monitorPollTimer = setInterval(pollMonitor, 3000);
    }
  }

  function probeMonitor() {
    fetch('/api/monitor').then(function(r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function(data) {
      if (data) activateMonitorTab(data);
    }).catch(function() { /* server unreachable — keep trying */ });
  }

  function initMonitorTab() {
    // Probe once immediately
    fetch('/api/monitor').then(function(r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function(data) {
      if (data) {
        activateMonitorTab(data);
      } else {
        // No data yet — keep probing every 5s (page may be open before audit starts)
        monitorDiscoveryTimer = setInterval(probeMonitor, 5000);
      }
    }).catch(function() {
      // Server not reachable — probe periodically in case it starts later
      monitorDiscoveryTimer = setInterval(probeMonitor, 5000);
    });
  }
```

- [ ] **Step 3: Update init line**

Replace the init line (search for `renderStats(); renderFilters(); renderSidebar();`):

```javascript
  renderStats(); renderFilters(); renderSidebar(); renderGrid(); initAnnotation(); initAuditTab();
```

With:

```javascript
  renderStats(); renderFilters(); renderSidebar(); renderGrid(); initAnnotation(); initAuditTab(); initMonitorTab();
```

- [ ] **Step 4: Test by opening the review page with the server running and verifying the Monitor tab appears after POSTing audit-start**

```bash
# Start server + POST audit data (reuse curl commands from Task 2 Step 3)
node visual-tests/build-review.mjs --serve &
sleep 1
curl -s -X POST http://localhost:8888/api/monitor/audit-start \
  -H 'Content-Type: application/json' \
  -d '{"mode":"standard","round_count":1,"zones":[{"zone_id":"z01","paths":["src/routes/"],"file_count":28},{"zone_id":"z02","paths":["src/hooks/"],"file_count":22}],"timestamp":"2026-04-10T14:30:00Z"}'
# Open http://localhost:8888 — Monitor tab should appear
# Post some agent updates to see Gantt bars
curl -s -X POST http://localhost:8888/api/monitor/agent-update \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"r1:z01","zone_id":"z01","status":"completed","round":1,"started_at":"2026-04-10T14:30:02Z","ended_at":"2026-04-10T14:33:15Z","duration_ms":193000,"tokens":{"total":42526,"input":28000,"output":14526},"estimated_cost_usd":0.12,"tool_uses":23,"bugs_found":4,"files_audited":18}'
curl -s -X POST http://localhost:8888/api/monitor/agent-update \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"r1:z02","zone_id":"z02","status":"running","round":1,"started_at":"2026-04-10T14:30:05Z"}'
# Refresh page — should see 2 Gantt bars (1 green completed, 1 pulsing running)
node visual-tests/build-review.mjs --stop
```

- [ ] **Step 5: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-review/_review-template.html
git commit -m "feat(monitor): add Monitor tab JS (Gantt, stats, polling, switchTab)"
```

---

### Task 6: Update sg-code-audit/SKILL.md — Phase 0 + lifecycle POSTs

**Files:**
- Modify: `plugins/shipguard/skills/sg-code-audit/SKILL.md`

- [ ] **Step 1: Add Phase 0 — Monitor Setup**

Insert before `## Phase 1 — Parse Arguments`:

```markdown
## Phase 0 — Monitor Setup

Detect or start the review server for real-time audit monitoring. This is optional — if the user declines or the server can't start, the audit proceeds normally.

### Step 1: Check for existing server

```bash
curl -s --max-time 2 http://localhost:8888/health
```

- **200 OK:** Parse the response JSON. Compare `results_dir` against the current project's `results_dir`.
  - If they match → set `monitor_active = true`, `monitor_url = "http://localhost:8888"`. Print: `Monitor: connected to existing server.`
  - If they differ → another project's server is running. Try ports 8889, 8890 with `--port=` (same health check + results_dir comparison). If none match, treat as "not running" and pick the first free port for Step 2.
- **Connection refused / timeout:** Server not running. Go to Step 2.

### Step 2: Ask user

If no matching server found:

> "Voulez-vous suivre l'avancement de l'audit en temps réel dans un tableau de bord ? (oui/non)"

- **oui:**
  1. Check if `visual-tests/build-review.mjs` exists. If not, bootstrap from the plugin directory:
     ```bash
     mkdir -p visual-tests/_results/screenshots
     cp ~/.claude/plugins/shipguard/skills/sg-visual-review/build-review.mjs visual-tests/
     cp ~/.claude/plugins/shipguard/skills/sg-visual-review/_review-template.html visual-tests/
     ```
     Also create a minimal `visual-tests/_config.yaml` if it doesn't exist (required by the build script):
     ```bash
     cat > visual-tests/_config.yaml << 'EOF'
     base_url: http://localhost:3000
     EOF
     ```
  2. Pick port: use 8888 if free, otherwise the first free port found in Step 1.
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
- **non:** Set `monitor_active = false`.

### Step 3: Store monitor state

Store `monitor_active` (boolean) and `monitor_url` (string) as working variables for subsequent phases.

---
```

- [ ] **Step 2: Add monitor POST calls to Phase 4 (Dispatch)**

At the end of Phase 4 (after the "Print to user" line at the end of the Dispatch section), insert:

```markdown

### Monitor: report agent starts

If `monitor_active` is true:

1. **Once before the round loop** (after Phase 3 zones are known, before the first Phase 4 iteration), POST audit-start. Do NOT re-post on subsequent rounds (deep/paranoid mode) — `audit-start` resets all state.
   ```
   POST {monitor_url}/api/monitor/audit-start
   Body: {"mode": "{mode}", "round_count": {round_count}, "agent_count": {agent_count},
          "zones": [{zone objects with zone_id, paths, file_count}],
          "scope_mode": "{scope_mode}", "scope_ref": "{scope_ref}",
          "timestamp": "{ISO 8601 now}"}
   ```
   If the POST fails, set `monitor_active = false` and continue silently.

2. After dispatching each agent (every round), POST agent-started:
   ```
   POST {monitor_url}/api/monitor/agent-update
   Body: {"agent_id": "r{round}:{zone_id}", "zone_id": "{zone_id}", "status": "started",
          "round": {round}, "started_at": "{ISO 8601 now}"}
   ```
```

- [ ] **Step 3: Add monitor POST calls to Phase 5 (Collect)**

In Phase 5, after "On agent completion" step 3 (success case), add:

```markdown

### Monitor: report agent completion

If `monitor_active` is true, after processing each agent's result:

- **Success:** POST agent-update with completion data:
  ```
  POST {monitor_url}/api/monitor/agent-update
  Body: {"agent_id": "r{round}:{zone_id}", "zone_id": "{zone_id}", "status": "completed",
         "round": {round}, "started_at": "{original}", "ended_at": "{ISO 8601 now}",
         "duration_ms": {from agent result footer or elapsed time},
         "tokens": {"total": {total_tokens}, "input": {input_tokens}, "output": {output_tokens}},
         "estimated_cost_usd": {calculated from tokens — sonnet: $3/$15 per 1M in/out},
         "tool_uses": {from agent result footer}, "bugs_found": {from zone JSON},
         "files_audited": {from zone JSON}}
  ```
  Extract `total_tokens`, `tool_uses`, and `duration_ms` from the Agent tool's result footer. If input/output split is unavailable, estimate 60/40 ratio from total.

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

All monitor POSTs are wrapped in try/catch. If any POST fails, set `monitor_active = false` — never crash the audit for monitoring.
```

- [ ] **Step 4: Add monitor POST call to Phase 6 (Aggregate)**

At the end of Phase 6 Step 5 (after "Print summary"), add:

```markdown

### Monitor: report audit complete

If `monitor_active` is true:

```
POST {monitor_url}/api/monitor/audit-complete
Body: {"status": "completed", "timestamp": "{ISO 8601 now}"}
```

Print: `Monitor: audit complete — view results at {monitor_url}`
```

- [ ] **Step 5: Commit**

```bash
git add plugins/shipguard/skills/sg-code-audit/SKILL.md
git commit -m "feat(monitor): add Phase 0 + lifecycle POSTs to sg-code-audit skill"
```

---

### Task 7: Update sg-visual-review/SKILL.md

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-review/SKILL.md`

- [ ] **Step 1: Add Monitor tab mention**

In the "What It Does" section, after "Step 1: Build the Review Page", add a note at the end of the "This script:" numbered list:

```markdown
6. If monitor-data.json exists in `_results/`, a "Monitor" tab appears showing the Gantt timeline of the last audit
```

- [ ] **Step 2: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-review/SKILL.md
git commit -m "docs(monitor): mention Monitor tab in sg-visual-review SKILL.md"
```
