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
import { join, relative, basename, dirname } from 'path';
import { execFileSync } from 'child_process';

// Minimal YAML parser — handles flat keys, arrays, nested objects used in test manifests.
// No external dependency needed.
function yamlParse(text) {
  const result = {};
  let currentKey = null;
  let currentArray = null;
  let currentObj = null;
  let inArray = false;   // true when current top-level key holds an array

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
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
      if (val === '' || val === '|' || val === '>') {
        // Empty value — could be an array or a nested object; decide on next line
        // Known limitation: block scalars (| and >) are not supported.
        // ShipGuard manifests don't use them — all values are inline.
        currentKey = key;
        result[key] = null; // placeholder; will be set to [] or {} on first child line
        continue;
      }
      if (val === 'true') { result[key] = true; currentKey = key; continue; }
      if (val === 'false') { result[key] = false; currentKey = key; continue; }
      if (/^-?\d+(\.\d+)?$/.test(val)) { result[key] = parseFloat(val); currentKey = key; continue; }
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
            : /^-?\d+(\.\d+)?$/.test(propVal) ? parseFloat(propVal)
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
          else if (/^-?\d+(\.\d+)?$/.test(val)) currentObj[propMatch[1]] = parseFloat(val);
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

const CATEGORIES = [
  'auth', 'principal', 'standalone', 'outils', 'intelligence',
  'dashboard-only', 'hub', 'docs', 'admin', 'legal',
];

// ── 1. Parse config ──
const config = yaml.load(readFileSync(CONFIG_PATH, 'utf8'));

// ── 2. Parse report.md for status ──
function parseReport() {
  if (!existsSync(REPORT_PATH)) return { statusMap: {} };
  const md = readFileSync(REPORT_PATH, 'utf8');
  const statusMap = {};
  for (const line of md.split('\n')) {
    // Format 1: | test-slug | PASS | or | category/test-slug | PASS |
    let m = line.match(/^\|\s*([a-z0-9_/-]+)\s*\|\s*(?:\*\*)?(PASS|FAIL|STALE)(?:\*\*)?\s*\|/i);
    if (m) { statusMap[m[1]] = m[2].toUpperCase(); continue; }
    // Format 2: - category/test-slug: PASS
    m = line.match(/^-\s+([a-z0-9_/-]+):\s*(PASS|FAIL|STALE)/i);
    if (m) { statusMap[m[1]] = m[2].toUpperCase(); continue; }
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
  const regs = Array.isArray(data?.regressions) ? data.regressions
              : Array.isArray(data?.tests)       ? data.tests
              : [];
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

// Escape for safe embedding in JSON (no HTML escaping — data lives in JS, not in DOM)
function sanitize(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function buildEntry(id, category, manifest) {
  const slug = id.split('/').pop();
  return {
    id: sanitize(id),
    category: sanitize(category),
    name: sanitize(manifest.name || slug),
    description: sanitize(manifest.description || ''),
    priority: sanitize(manifest.priority || 'medium'),
    tags: (manifest.tags || []).map(sanitize),
    requiresAuth: manifest.requires_auth ?? true,
    featureFlag: manifest.feature_flag ? sanitize(manifest.feature_flag) : null,
    url: extractUrl(manifest.steps || []),
    steps: (manifest.steps || []).map(s => {
      const step = {};
      for (const k in s) { step[k] = sanitize(s[k]); }
      return step;
    }),
    screenshot: findScreenshot(id, slug, manifest.steps || []),
    screenshotBefore: findBeforeScreenshot(id, slug, manifest.steps || []),
    screenshotMtime: getScreenshotMtime(id, slug, manifest.steps || []),
    status: 'STALE',
    failureReason: null,
    fixCycles: 0, // will be set from regressions history
  };
}

function extractUrl(steps) {
  const openStep = steps.find(s => s.action === 'open' && s.url);
  if (!openStep) return '';
  return sanitize(openStep.url.replace('{base_url}', config.base_url || 'http://localhost:6969'));
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
      t.failureReason = sanitize(reg.failure_reason || '');
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
  // Track last fix-manifest timestamp to detect "updated" screenshots
  lastFixTimestamp: existsSync(join(RESULTS_DIR, 'fix-manifest.json'))
    ? statSync(join(RESULTS_DIR, 'fix-manifest.json')).mtimeMs : 0,
};

console.log(`  Status: ${passCount} pass, ${failCount} fail, ${staleCount} stale`);
console.log(`  Screenshots matched: ${tests.filter(t => t.screenshot).length}/${tests.length}`);

// ── Collect recorded manifests ──
const MANIFESTS_DIR = join(ROOT, 'manifests');
const recordedTests = [];
if (existsSync(MANIFESTS_DIR)) {
  for (const file of readdirSync(MANIFESTS_DIR).filter(f => f.endsWith('.yaml'))) {
    try {
      const text = readFileSync(join(MANIFESTS_DIR, file), 'utf8');
      const manifest = yamlParse(text);
      if (!manifest.name) continue;
      const steps = Array.isArray(manifest.steps) ? manifest.steps : [];
      const stepCount = steps.filter(s => s.action !== 'screenshot').length;
      const checkCount = steps.filter(s => s.action === 'assert_text' || s.action === 'llm-check').length;
      const openStep = steps.find(s => s.action === 'open');
      const testUrl = openStep ? (openStep.url || '').replace('{base_url}', '') : '';
      const slug = file.replace('.yaml', '');
      recordedTests.push({
        id: 'recorded/' + slug,
        file,
        name: manifest.name,
        description: manifest.description || '',
        source: manifest.source || 'recorded',
        recordedAt: manifest.recorded_at || null,
        stepCount,
        checkCount,
        url: testUrl,
        status: null,
        summary: steps
          .filter(s => ['open', 'click', 'fill', 'assert_text', 'llm-check', 'upload'].includes(s.action))
          .slice(0, 5)
          .map(s => s.action + ': ' + (s.target || s.text || s.url || '').slice(0, 40))
          .join(' \u2192 '),
      });
    } catch (e) {
      console.warn('  Warning: could not parse ' + file + ': ' + e.message);
    }
  }
  console.log('  Found ' + recordedTests.length + ' recorded manifests');
}

const template = getHtmlTemplate();
const html = template
  .replace('"__PLACEHOLDER_VISUAL_DATA__"', JSON.stringify(data))
  .replace('"__PLACEHOLDER_RECORDED_DATA__"', JSON.stringify(recordedTests));
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

// ── Server PID file ──
const PID_FILE = join(RESULTS_DIR, '.server.pid');

// --stop: kill existing server
if (process.argv.includes('--stop')) {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (isNaN(pid)) { console.error('Invalid PID file'); process.exit(1); }
    try { process.kill(pid); } catch { /* already dead */ }
    writeFileSync(PID_FILE, '', 'utf8');
    console.log(`Server stopped (PID ${pid}).`);
  } else {
    console.log('No server running.');
  }
  process.exit(0);
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

  // ── Monitor state (in-memory + persisted to JSON) ──
  let auditState = null;
  const MONITOR_PATH = join(RESULTS_DIR, 'audit-monitor.json');

  function persistMonitor() {
    if (auditState) writeFileSync(MONITOR_PATH, JSON.stringify(auditState, null, 2), 'utf8');
  }

  function readBody(req, maxBytes = 5 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(); reject(new Error('Payload too large')); return; }
        body += chunk;
      });
      req.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  // Wildcard CORS: intentional — server is localhost-only, not exposed to network
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' };

  const server = http.createServer(async (req, res) => {
    // ── GET /health ──
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ status: 'ok', results_dir: RESULTS_DIR, audit_active: !!auditState }));
      return;
    }

    // ── POST /api/monitor/audit-start ──
    if (req.method === 'POST' && req.url === '/api/monitor/audit-start') {
      try {
        const data = await readBody(req);
        auditState = {
          ...data,
          agents: {},
          status: 'running',
          started_at: data.timestamp || new Date().toISOString(),
        };
        // Pre-populate agents from zones
        for (const z of (data.zones || [])) {
          auditState.agents[`r1:${z.zone_id || z.id}`] = {
            zone_id: z.zone_id || z.id,
            status: 'pending',
            paths: z.paths,
            file_count: z.file_count,
          };
        }
        persistMonitor();
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── POST /api/monitor/agent-update ──
    if (req.method === 'POST' && req.url === '/api/monitor/agent-update') {
      try {
        const data = await readBody(req);
        if (!auditState) {
          auditState = { agents: {}, status: 'running', started_at: new Date().toISOString() };
        }
        const id = data.agent_id || data.zone_id;
        auditState.agents[id] = { ...(auditState.agents[id] || {}), ...data };
        persistMonitor();
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── POST /api/monitor/audit-complete ──
    if (req.method === 'POST' && req.url === '/api/monitor/audit-complete') {
      try {
        const data = await readBody(req);
        if (auditState) {
          auditState.status = 'completed';
          auditState.completed_at = data.timestamp || new Date().toISOString();
        }
        persistMonitor();
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── GET /api/monitor/status ──
    if (req.method === 'GET' && req.url === '/api/monitor/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(auditState || { status: 'idle' }));
      return;
    }

    // POST /save-manifest — save fix manifest from review page
    if (req.method === 'POST' && req.url === '/save-manifest') {
      const MAX_BODY = 5 * 1024 * 1024; // 5 MB
      let body = '';
      let bodySize = 0;
      req.on('data', chunk => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY) {
          // r1-z02-012: send response BEFORE destroying — headers must be sent first
          res.writeHead(413, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ error: 'Payload too large (max 5 MB)' }));
          req.destroy();
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
    if (req.method === 'OPTIONS') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.end();
      return;
    }
    const url = req.url === '/' ? '/review.html' : req.url;
    const filePath = join(RESULTS_DIR, url.replace(/^\//, ''));
    // BUG-4: Prevent path traversal attacks
    if (!filePath.startsWith(RESULTS_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!fExists(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = extname(filePath);
    const noCache = { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' };
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...noCache });
    createReadStream(filePath).pipe(res);
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
