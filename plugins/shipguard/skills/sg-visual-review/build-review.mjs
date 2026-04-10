#!/usr/bin/env node
/**
 * build-review.mjs — Generate a self-contained HTML review page
 * from Visual test manifests, report, and screenshots.
 *
 * Usage: node visual-tests/build-review.mjs
 * Output: visual-tests/_results/review.html
 *
 * Security note: All data is generated at build time from trusted local
 * YAML files and report.md. The HTML is a static artifact with no user
 * input at runtime. innerHTML is used for rendering pre-sanitized,
 * build-time-escaped strings only.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, relative, basename, dirname, resolve, isAbsolute as pathIsAbsolute } from 'path';
import { execFileSync } from 'child_process';

// Minimal YAML parser — handles flat keys, arrays, nested objects, and multiline blocks.
// No external dependency needed.
// Known limitations: no anchors/aliases, no flow mappings, no nested arrays beyond steps.
function yamlParse(text) {
  const result = {};
  let currentKey = null;
  let currentArray = null;
  let currentObj = null;
  let inArray = false;   // true when current top-level key holds an array
  let inMultiline = null; // 'literal' (|) or 'folded' (>) or null
  let multilineLines = [];

  function flushMultiline() {
    if (inMultiline && currentKey) {
      const sep = inMultiline === 'literal' ? '\n' : ' ';
      result[currentKey] = multilineLines.join(sep).trim();
    }
    inMultiline = null;
    multilineLines = [];
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');

    // Collect multiline block content
    if (inMultiline) {
      if (line.match(/^\s+/) && !line.match(/^[a-z_]/i)) {
        multilineLines.push(line.replace(/^\s+/, ''));
        continue;
      } else {
        flushMultiline();
        // fall through to process this line normally
      }
    }

    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Top-level key: value
    const kvMatch = line.match(/^([a-z_][a-z0-9_-]*):\s*(.*)$/i);
    if (kvMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      inArray = false;
      currentArray = null;
      currentObj = null;
      const [, key, rawVal] = kvMatch;
      const val = rawVal.replace(/^["']|["']$/g, '').trim();

      if (key === 'tags' && val.startsWith('[')) {
        result[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        currentKey = key;
        continue;
      }
      if (val === '|' || val === '>') {
        currentKey = key;
        inMultiline = val === '|' ? 'literal' : 'folded';
        multilineLines = [];
        continue;
      }
      if (val === '') {
        // Empty value — could be an array or a nested object; decide on next line
        currentKey = key;
        result[key] = null; // placeholder; will be set to [] or {} on first child line
        continue;
      }
      if (val === 'true') { result[key] = true; currentKey = key; continue; }
      if (val === 'false') { result[key] = false; currentKey = key; continue; }
      if (/^\d+$/.test(val)) { result[key] = parseInt(val); currentKey = key; continue; }
      result[key] = val;
      currentKey = key;
      continue;
    }

    // Indented line under currentKey
    if (currentKey !== null) {
      // Array item: line starts with optional whitespace + "- "
      const arrayItemMatch = line.match(/^(\s+)-\s+(.*)/);
      if (arrayItemMatch) {
        // First array item — promote placeholder to array if needed
        if (!Array.isArray(result[currentKey])) {
          result[currentKey] = [];
          inArray = true;
          currentArray = result[currentKey];
        }
        const rest = arrayItemMatch[2];
        // Check if item leads with a key (e.g. "- action: foo" or "- test: bar")
        const leadKeyMatch = rest.match(/^([a-z_][a-z0-9_-]*):\s*(.*)/i);
        if (leadKeyMatch) {
          const propVal = leadKeyMatch[2].replace(/^["']|["']$/g, '').trim();
          currentObj = {};
          currentObj[leadKeyMatch[1]] = propVal === '' ? null
            : propVal === 'true' ? true
            : propVal === 'false' ? false
            : /^\d+$/.test(propVal) ? parseInt(propVal)
            : propVal;
          currentArray.push(currentObj);
        } else {
          // Plain scalar array item (e.g. "- foo")
          const scalarVal = rest.replace(/^["']|["']$/g, '').trim();
          currentArray.push(scalarVal);
          currentObj = null;
        }
        continue;
      }

      // Property of current array object
      if (inArray && currentObj && typeof currentObj === 'object') {
        const propMatch = line.match(/^\s+([a-z_][a-z0-9_-]*):\s*(.+)/i);
        if (propMatch) {
          const val = propMatch[2].replace(/^["']|["']$/g, '').trim();
          if (val === 'true') currentObj[propMatch[1]] = true;
          else if (val === 'false') currentObj[propMatch[1]] = false;
          else if (/^\d+$/.test(val)) currentObj[propMatch[1]] = parseInt(val);
          else currentObj[propMatch[1]] = val;
          continue;
        }
      }

      // Nested key under current top-level key (e.g., data:, credentials:)
      if (!inArray) {
        if (result[currentKey] === null) result[currentKey] = {}; // promote placeholder
        if (typeof result[currentKey] === 'object' && !Array.isArray(result[currentKey])) {
          const nestedMatch = line.match(/^\s+([a-z_][a-z0-9_-]*):\s*(.+)/i);
          if (nestedMatch) {
            const val = nestedMatch[2].replace(/^["']|["']$/g, '').trim();
            result[currentKey][nestedMatch[1]] = val;
          }
        }
      }
    }
  }
  flushMultiline();
  return result;
}

const yaml = { load: yamlParse };

const ROOT = dirname(new URL(import.meta.url).pathname);
const RESULTS_DIR = join(ROOT, '_results');
const SCREENSHOTS_DIR = join(RESULTS_DIR, 'screenshots');
const REPORT_PATH = join(RESULTS_DIR, 'report.md');
const REGRESSIONS_PATH = join(ROOT, '_regressions.yaml');
const CONFIG_PATH = join(ROOT, '_config.yaml');
const OUTPUT_PATH = join(RESULTS_DIR, 'review.html');

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

// ── Early exit: --stop just kills the server, no build needed ──
const PID_FILE = join(RESULTS_DIR, '.server.pid');
if (process.argv.includes('--stop')) {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid); } catch { /* already dead */ }
      console.log(`Server stopped (PID ${pid}).`);
    } else {
      console.log('Invalid PID in .server.pid — ignoring.');
    }
    writeFileSync(PID_FILE, '', 'utf8');
  } else {
    console.log('No server running.');
  }
  process.exit(0);
}

const CATEGORIES = readdirSync(ROOT, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('_') && e.name !== 'node_modules')
  .map(e => e.name);

// ── 1. Parse config ──
const config = yaml.load(readFileSync(CONFIG_PATH, 'utf8'));

// ── 2. Parse report.md for status ──
function parseReport() {
  if (!existsSync(REPORT_PATH)) return { statusMap: {} };
  const md = readFileSync(REPORT_PATH, 'utf8');
  const statusMap = {};
  for (const line of md.split('\n')) {
    // Format 1: | test-slug | PASS | (supports / in slugs)
    let m = line.match(/^\|\s*([a-z0-9_/-]+)\s*\|\s*(?:\*\*)?(PASS|FAIL)(?:\*\*)?\s*\|/i);
    if (m) { statusMap[m[1]] = m[2].toUpperCase(); continue; }
    // Format 2: - category/test-slug: PASS
    m = line.match(/^-\s+([a-z0-9_/-]+):\s*(PASS|FAIL|STALE)/i);
    if (m) { statusMap[m[1]] = m[2].toUpperCase(); continue; }
    // Format 3: | category/slug — Description | PASS | ... | (table with description)
    m = line.match(/^\|\s*([a-z0-9_/-]+)\s*[—–-]\s/i);
    if (m) { const sm = line.match(/\b(PASS|FAIL|STALE|ERROR)\b/i); if (sm) { statusMap[m[1]] = sm[1].toUpperCase(); continue; } }
  }
  const summaryMatch = md.match(/Tests:\s*(\d+)\s*run,\s*(\d+)\s*pass,\s*(\d+)\s*fail/);
  const dateMatch = md.match(/# Visual Report — (\S+ \S+)/);
  return {
    statusMap,
    total: summaryMatch ? parseInt(summaryMatch[1]) : 0,
    pass: summaryMatch ? parseInt(summaryMatch[2]) : 0,
    fail: summaryMatch ? parseInt(summaryMatch[3]) : 0,
    lastRun: dateMatch ? dateMatch[1] : 'unknown',
  };
}

// ── 3. Parse regressions ──
function parseRegressions() {
  if (!existsSync(REGRESSIONS_PATH)) return {};
  const data = yaml.load(readFileSync(REGRESSIONS_PATH, 'utf8'));
  const map = {};
  // Support both `regressions:` and `tests:` as the top-level array key
  // Also handle object shape from minimal YAML parser (normalize to array)
  const raw = data?.regressions ?? data?.tests;
  let regs = [];
  if (Array.isArray(raw)) {
    regs = raw;
  } else if (raw && typeof raw === 'object') {
    regs = Object.entries(raw).map(([key, val]) => {
      if (typeof val === 'object' && val !== null) return { test: val.test || key, failure_reason: val.failure_reason || '' };
      return { test: key, failure_reason: String(val || '') };
    });
  }
  for (const r of regs) {
    if (r && r.test) map[r.test] = r;
  }
  return map;
}

// ── 4. Walk test directories ──
function collectTests() {
  const tests = [];
  for (const cat of CATEGORIES) {
    const catDir = join(ROOT, cat);
    if (!existsSync(catDir)) continue;
    walkDir(catDir, cat, tests);
  }
  return tests;
}

function walkDir(dir, category, tests) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walkDir(join(dir, entry.name), category, tests);
    } else if (entry.name.endsWith('.yaml')) {
      try {
        const fullPath = join(dir, entry.name);
        const manifest = yaml.load(readFileSync(fullPath, 'utf8'));
        if (!manifest || manifest.deprecated) continue;
        const relPath = relative(ROOT, fullPath).replace('.yaml', '');
        tests.push(buildEntry(relPath, category, manifest));
      } catch (e) {
        console.warn(`  WARN: Failed to parse ${join(dir, entry.name)}: ${e.message}`);
      }
    }
  }
}

function buildEntry(id, category, manifest) {
  const slug = id.split('/').pop();
  return {
    id,
    category,
    name: manifest.name || slug,
    description: manifest.description || '',
    priority: manifest.priority || 'medium',
    tags: manifest.tags || [],
    requiresAuth: manifest.requires_auth ?? true,
    featureFlag: manifest.feature_flag || null,
    url: extractUrl(manifest.steps || []),
    steps: manifest.steps || [],
    screenshot: findScreenshot(id, slug, manifest.steps || []),
    screenshotBefore: findBeforeScreenshot(id, slug, manifest.steps || []),
    screenshotMtime: getScreenshotMtime(id, slug, manifest.steps || []),
    status: 'STALE',
    failureReason: null,
    fixCycles: 0,
  };
}

function extractUrl(steps) {
  const openStep = steps.find(s => s.action === 'open' && s.url);
  if (!openStep) return '';
  return openStep.url.replace('{base_url}', config.base_url || 'http://localhost:3000');
}

function getScreenshotMtime(id, slug, steps) {
  const candidates = [`${slug}.png`, id.replace(/\//g, '-') + '.png'];
  for (const s of steps) { if (s.screenshot) candidates.push(s.screenshot); }
  for (const c of candidates) {
    const p = join(SCREENSHOTS_DIR, c);
    if (existsSync(p)) return statSync(p).mtimeMs;
  }
  return 0;
}

function findBeforeScreenshot(id, slug, steps) {
  const candidates = [`${slug}-before.png`, id.replace(/\//g, '-') + '-before.png'];
  for (const s of steps) {
    if (s.screenshot) candidates.push(s.screenshot.replace('.png', '-before.png'));
  }
  for (const c of candidates) {
    if (existsSync(join(SCREENSHOTS_DIR, c))) return `screenshots/${c}`;
  }
  return null;
}

function findScreenshot(id, slug, steps) {
  const candidates = [
    `${slug}.png`,
    id.replace(/\//g, '-') + '.png',
  ];
  for (const s of steps) {
    if (s.screenshot) candidates.push(s.screenshot);
  }
  for (const c of candidates) {
    if (existsSync(join(SCREENSHOTS_DIR, c))) return `screenshots/${c}`;
  }
  return null;
}

// ── 5. Merge status from report ──
function mergeStatus(tests, report, regressions) {
  for (const t of tests) {
    const slug = t.id.split('/').pop();
    // Match by full path first, then by slug
    if (report.statusMap[t.id]) {
      t.status = report.statusMap[t.id];
    } else if (report.statusMap[slug]) {
      t.status = report.statusMap[slug];
    }
    const reg = regressions[t.id] || regressions[slug];
    if (reg) {
      t.failureReason = reg.failure_reason || '';
      if (t.status === 'STALE') t.status = 'FAIL';
      // consecutive_passes === 0 means currently broken = at least 1 fix cycle attempted
      if (typeof reg.consecutive_passes === 'number' && reg.consecutive_passes === 0) {
        t.fixCycles = Math.max(1, t.fixCycles);
      }
    }
  }
}

// ── 6. Read HTML template ──
function getHtmlTemplate() {
  // The template is a separate file for clarity
  return readFileSync(join(ROOT, '_review-template.html'), 'utf8');
}

// ── Main ──
console.log('Building Visual review page...');

mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const report = parseReport();
const regressions = parseRegressions();
const tests = collectTests();

console.log(`  Found ${tests.length} test manifests`);

mergeStatus(tests, report, regressions);

const passCount = tests.filter(t => t.status === 'PASS').length;
const failCount = tests.filter(t => t.status === 'FAIL').length;
const staleCount = tests.filter(t => t.status === 'STALE').length;

// ── Load audit results if present ──
const auditResultsPath = join(RESULTS_DIR, 'audit-results.json');
let auditData = null;
if (existsSync(auditResultsPath)) {
  try {
    auditData = JSON.parse(readFileSync(auditResultsPath, 'utf8'));
    const bugCount = Array.isArray(auditData.bugs) ? auditData.bugs.length : 0;
    console.log(`  Audit results: ${bugCount} bug(s) loaded from audit-results.json`);
  } catch (e) {
    console.warn(`  WARN: Failed to parse audit-results.json: ${e.message}`);
  }
}

const data = {
  generated: new Date().toISOString(),
  summary: {
    total: tests.length,
    pass: passCount,
    fail: failCount,
    stale: staleCount,
    passRate: tests.length > 0 ? (passCount / tests.length) * 100 : 0,
    lastRun: report.lastRun || new Date().toISOString().split('T')[0],
  },
  categories: CATEGORIES.filter(c => tests.some(t => t.category === c)),
  tests,
  audit: auditData,
  // Track last fix-manifest timestamp to detect "updated" screenshots
  lastFixTimestamp: existsSync(join(RESULTS_DIR, 'fix-manifest.json'))
    ? statSync(join(RESULTS_DIR, 'fix-manifest.json')).mtimeMs : 0,
};

console.log(`  Status: ${passCount} pass, ${failCount} fail, ${staleCount} stale`);
console.log(`  Screenshots matched: ${tests.filter(t => t.screenshot).length}/${tests.length}`);

const template = getHtmlTemplate();
const html = template.replace('"__PLACEHOLDER_VISUAL_DATA__"', JSON.stringify(data));
writeFileSync(OUTPUT_PATH, html, 'utf8');

console.log(`  Output: ${OUTPUT_PATH}`);

// ── Generate thumbnails (macOS sips, no dependency) ──
const THUMBS_DIR = join(RESULTS_DIR, 'thumbs');
if (!process.argv.includes('--stop')) {
  mkdirSync(THUMBS_DIR, { recursive: true });
  let thumbCount = 0;
  for (const t of tests) {
    if (!t.screenshot) continue;
    const src = join(RESULTS_DIR, t.screenshot);
    const thumbName = t.screenshot.replace('screenshots/', '');
    const dest = join(THUMBS_DIR, thumbName);
    if (!existsSync(src)) continue;
    if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(src).mtimeMs) { thumbCount++; continue; }
    try {
      // macOS: sips (built-in). Linux: convert (ImageMagick) or cp as fallback.
      if (process.platform === 'darwin') {
        execFileSync('sips', ['-Z', '400', src, '--out', dest], { stdio: 'pipe' });
      } else {
        try {
          execFileSync('convert', [src, '-resize', '400x>', dest], { stdio: 'pipe' });
        } catch {
          execFileSync('cp', [src, dest], { stdio: 'pipe' }); // no resize, just copy
        }
      }
      thumbCount++;
    } catch { /* thumbnail generation failed — grid uses full images */ }
  }
  console.log(`  Thumbnails: ${thumbCount}/${tests.filter(t => t.screenshot).length}`);
}

// --serve: start HTTP server with PID file
if (process.argv.includes('--serve')) {
  if (existsSync(PID_FILE)) {
    const oldPid = readFileSync(PID_FILE, 'utf8').trim();
    if (oldPid) try { process.kill(parseInt(oldPid)); } catch { /* already dead */ }
  }

  const http = await import('http');
  const { createReadStream, existsSync: fExists } = await import('fs');
  const { extname } = await import('path');

  const MIME = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript' };
  const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '8888');

  const server = http.createServer(async (req, res) => {
    // POST /save-manifest — save fix manifest from review page
    if (req.method === 'POST' && req.url === '/save-manifest') {
      const MAX_BODY = 5 * 1024 * 1024; // 5 MB
      let body = '';
      let bodySize = 0;
      req.on('data', chunk => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY) {
          req.destroy();
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large (max 5 MB)' }));
          return;
        }
        body += chunk;
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const manifestPath = join(RESULTS_DIR, 'fix-manifest.json');
          writeFileSync(manifestPath, JSON.stringify(data, null, 2), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, path: manifestPath }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
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

    if (req.method === 'OPTIONS') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.end();
      return;
    }
    const rawUrl = req.url === '/' ? '/review.html' : req.url;
    let decoded;
    try { decoded = decodeURIComponent(rawUrl); } catch { res.writeHead(400); res.end('Bad request'); return; }
    if (decoded.includes('\0')) { res.writeHead(400); res.end('Bad request'); return; }
    const root = resolve(RESULTS_DIR);
    const resolved = resolve(RESULTS_DIR, '.' + decoded);
    const rel = relative(root, resolved);
    if (rel.startsWith('..') || pathIsAbsolute(rel)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!fExists(resolved)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = extname(resolved);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    createReadStream(resolved).pipe(res);
  });

  server.listen(PORT, () => {
    writeFileSync(PID_FILE, String(process.pid), 'utf8');
    console.log(`  Server: http://localhost:${PORT} (PID ${process.pid})`);
    console.log('  Stop: node visual-tests/build-review.mjs --stop');
  });
} else {
  console.log('  Tip: --serve to start, --stop to stop');
  console.log('Done.');
}
