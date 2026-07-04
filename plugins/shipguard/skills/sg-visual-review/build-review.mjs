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
 * input at runtime. Data is escaped once at the serialization boundary
 * (embedJson) when inlined into the template; the template renders
 * dynamic strings via textContent only.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, unlinkSync } from 'fs';
import { join, relative, basename, dirname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
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

const ROOT = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(ROOT, '_results');
const SCREENSHOTS_DIR = join(RESULTS_DIR, 'screenshots');
const VISUAL_RESULTS_PATH = join(RESULTS_DIR, 'visual-results.json');
const REPORT_PATH = join(RESULTS_DIR, 'report.md');
const PROCESS_RESULTS_PATH = join(RESULTS_DIR, 'process-results.json');
const REGRESSIONS_PATH = join(ROOT, '_regressions.yaml');
const CONFIG_PATH = join(ROOT, '_config.yaml');
const OUTPUT_PATH = join(RESULTS_DIR, 'review.html');
const CHANGE_REPORTS_DIR = join(RESULTS_DIR, 'change-reports');
const PERSONA_REPORTS_DIR = join(RESULTS_DIR, 'persona-reports');
const PID_FILE = join(RESULTS_DIR, '.server.pid');
const FINDINGS_PATH = join(RESULTS_DIR, 'findings.json');
const CRAWL_RESULTS_PATH = join(RESULTS_DIR, 'crawl-results.json');
const RUN_JSON_PATH = join(RESULTS_DIR, 'run.json');
const FIX_MANIFEST_PATH = join(RESULTS_DIR, 'fix-manifest.json');
const AUDIT_RESULTS_PATH = join(RESULTS_DIR, 'audit-results.json');

// Check whether a PID refers to a live process (EPERM = alive but not ours)
function pidExists(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return !!e && e.code === 'EPERM'; }
}

// ── --stop: short-circuit before any config parse / build / persona work ──
if (process.argv.includes('--stop')) {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').split('\n')[0].trim(), 10);
    if (isNaN(pid)) {
      console.error('Invalid PID file. If a server is still running, kill it by port (see /sg-visual-review-stop).');
      process.exit(1);
    }
    if (pidExists(pid)) {
      try { process.kill(pid); } catch { /* died in between */ }
      console.log(`Server stopped (PID ${pid}).`);
    } else {
      console.log(`No server process with PID ${pid} — cleaning up stale PID file.`);
    }
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  } else {
    console.log('No server running.');
  }
  process.exit(0);
}

// Dynamically discover test categories by scanning subdirectories (fixes #20)
const CATEGORIES = readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.')
    && d.name !== 'lib' && d.name !== 'node_modules' && d.name !== 'manifests')
  .map(d => d.name)
  .sort();

// ── 1. Parse config ──
if (!existsSync(CONFIG_PATH)) {
  console.error('Error: visual-tests/_config.yaml missing — run /sg-visual-discover first.');
  process.exit(1);
}
const config = yaml.load(readFileSync(CONFIG_PATH, 'utf8'));

function normalizeStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (['PASS', 'FAIL', 'ERROR', 'STALE', 'SKIPPED'].includes(status)) return status;
  return 'STALE';
}

function normalizeTestId(value) {
  let id = String(value || '').replace(/\\/g, '/').trim();
  if (!id) return '';
  id = id.replace(/^.*?visual-tests\//, '');
  id = id.replace(/\.ya?ml$/i, '');
  id = id.replace(/^\/+/, '');
  return id;
}

// ── 2. Parse visual-results.json first, then report.md as a legacy fallback ──
function parseVisualResults() {
  if (!existsSync(VISUAL_RESULTS_PATH)) return { statusMap: {}, source: 'missing' };
  try {
    const raw = JSON.parse(readFileSync(VISUAL_RESULTS_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object') throw new Error('expected JSON object');
    if (raw.tests != null && !Array.isArray(raw.tests)) throw new Error('tests must be an array');

    const statusMap = {};
    const durationMap = {};
    const slugOwners = {}; // slug -> Set of full ids, to detect ambiguous slug-only matches (B19)
    for (const test of raw.tests || []) {
      if (!test || typeof test !== 'object') continue;
      const status = normalizeStatus(test.status);
      const duration = Number.isFinite(test.duration_ms) ? test.duration_ms : null;
      const keys = [
        normalizeTestId(test.id),
        normalizeTestId(test.manifest),
      ].filter(Boolean);
      for (const key of keys) {
        statusMap[key] = status;
        if (duration != null) durationMap[key] = duration;
        const slug = key.split('/').pop();
        if (slug) {
          if (slug !== key) (slugOwners[slug] = slugOwners[slug] || new Set()).add(key);
          statusMap[slug] = status;
          if (duration != null) durationMap[slug] = duration;
        }
      }
    }
    const ambiguousSlugs = Object.keys(slugOwners).filter(slug => slugOwners[slug].size > 1);

    const summary = raw.summary && typeof raw.summary === 'object' ? raw.summary : {};
    return {
      source: 'json',
      statusMap,
      durationMap,
      ambiguousSlugs,
      runTimestamp: raw.timestamp || null,
      run_id: raw.run_id || null,
      scope: raw.scope && typeof raw.scope === 'object' ? raw.scope : null,
      total: Number.isFinite(summary.total) ? summary.total : (raw.tests || []).length,
      pass: Number.isFinite(summary.pass) ? summary.pass : 0,
      fail: Number.isFinite(summary.fail) ? summary.fail : 0,
      error: Number.isFinite(summary.error) ? summary.error : 0,
      stale: Number.isFinite(summary.stale) ? summary.stale : 0,
      skipped: Number.isFinite(summary.skipped) ? summary.skipped : 0,
      durationMs: Number.isFinite(summary.duration_ms) ? summary.duration_ms : null,
      lastRun: raw.timestamp || raw.generated_at || null,
      baseUrl: raw.base_url || null,
    };
  } catch (e) {
    return {
      statusMap: {},
      source: 'invalid',
      error: `visual-results.json is invalid: ${e.message}`,
    };
  }
}

function parseReport() {
  if (!existsSync(REPORT_PATH)) return { statusMap: {} };
  const md = readFileSync(REPORT_PATH, 'utf8');
  const statusMap = {};
  for (const line of md.split('\n')) {
    // Format 1: | test-slug | PASS | or | category/test-slug | PASS |
    let m = line.match(/^\|\s*([a-z0-9_/-]+)\s*\|\s*(?:\*\*)?(PASS|FAIL|ERROR|STALE|SKIPPED)(?:\*\*)?\s*\|/i);
    if (m) { statusMap[m[1]] = normalizeStatus(m[2]); continue; }
    // Format 2: - category/test-slug: PASS
    m = line.match(/^-\s+([a-z0-9_/-]+):\s*(PASS|FAIL|ERROR|STALE|SKIPPED)/i);
    if (m) { statusMap[m[1]] = normalizeStatus(m[2]); continue; }
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

function mergeStatusSources(visualResults, markdownReport) {
  const statusMap = { ...(markdownReport.statusMap || {}) };
  for (const [key, status] of Object.entries(visualResults.statusMap || {})) {
    statusMap[key] = status;
  }
  return {
    ...markdownReport,
    ...Object.fromEntries(Object.entries(visualResults).filter(([, value]) => value !== null && value !== undefined)),
    statusMap,
    lastRun: visualResults.lastRun || markdownReport.lastRun || 'unknown',
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

// NOTE (B9): data is kept clean here and escaped once at the serialization
// boundary (see embedJson) when it is inlined into the HTML template. The
// canonical visual-results.json therefore contains unmangled values.

function buildEntry(id, category, manifest) {
  const slug = id.split('/').pop();
  return {
    id: String(id),
    category: String(category),
    name: String(manifest.name || slug),
    description: String(manifest.description || ''),
    priority: String(manifest.priority || 'medium'),
    tags: (manifest.tags || []).map(t => String(t)),
    requiresAuth: manifest.requires_auth ?? true,
    featureFlag: manifest.feature_flag ? String(manifest.feature_flag) : null,
    url: extractUrl(manifest.steps || []),
    steps: (manifest.steps || []).map(s => {
      const step = {};
      for (const k in s) { step[k] = String(s[k]); }
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
  return String(openStep.url).replace('{base_url}', config.base_url || 'http://localhost:6969');
}

function getScreenshotMtime(id, slug, steps) {
  const candidates = [];
  for (const s of steps) { if (s.screenshot) candidates.push(s.screenshot); }
  candidates.push(`${slug}.png`, id.replace(/\//g, '-') + '.png');
  for (const c of candidates) {
    const p = join(SCREENSHOTS_DIR, c);
    if (existsSync(p)) return statSync(p).mtimeMs;
  }
  return 0;
}

function findBeforeScreenshot(id, slug, steps) {
  const candidates = [];
  for (const s of steps) {
    if (s.screenshot) candidates.push(s.screenshot.replace('.png', '-before.png'));
  }
  candidates.push(`${slug}-before.png`, id.replace(/\//g, '-') + '-before.png');
  for (const c of candidates) {
    if (existsSync(join(SCREENSHOTS_DIR, c))) return `screenshots/${c}`;
  }
  return null;
}

function findScreenshot(id, slug, steps) {
  const candidates = [];
  // Manifest screenshot field takes priority over slug/id patterns
  for (const s of steps) {
    if (s.screenshot) candidates.push(s.screenshot);
  }
  candidates.push(`${slug}.png`);
  candidates.push(id.replace(/\//g, '-') + '.png');
  for (const c of candidates) {
    if (existsSync(join(SCREENSHOTS_DIR, c))) return `screenshots/${c}`;
  }
  return null;
}

// ── 5. Merge status from report ──
function mergeStatus(tests, report, regressions) {
  const ambiguous = new Set(report.ambiguousSlugs || []);
  const durationMap = report.durationMap || {};
  for (const t of tests) {
    const slug = t.id.split('/').pop();
    // Match by full category/slug id first, then fall back to slug only (B19)
    if (report.statusMap[t.id]) {
      t.status = normalizeStatus(report.statusMap[t.id]);
      if (Number.isFinite(durationMap[t.id])) t.durationMs = durationMap[t.id];
    } else if (report.statusMap[slug]) {
      if (ambiguous.has(slug)) {
        console.warn(`  WARN: test slug "${slug}" matches several results across categories; using the last status seen. Prefer full category/slug ids in visual-results.json.`);
      }
      t.status = normalizeStatus(report.statusMap[slug]);
      if (Number.isFinite(durationMap[slug])) t.durationMs = durationMap[slug];
    }
    const reg = regressions[t.id] || regressions[slug];
    if (reg) {
      t.failureReason = String(reg.failure_reason || '');
      if (t.status === 'STALE') t.status = 'FAIL';
      // consecutive_passes === 0 means currently broken = at least 1 fix cycle attempted
      if (typeof reg.consecutive_passes === 'number' && reg.consecutive_passes === 0) {
        t.fixCycles = Math.max(1, t.fixCycles);
      }
    }
  }
}

function buildVisualResultsContract(data, statusSource, rawTestsById = {}) {
  const scope = statusSource.scope && typeof statusSource.scope === 'object' ? { ...statusSource.scope } : null;
  const selectedIds = new Set(
    (scope?.selected_manifests || [])
      .map(normalizeTestId)
      .filter(Boolean)
  );
  const contractTests = selectedIds.size
    ? data.tests.filter(test => selectedIds.has(normalizeTestId(test.id)) || selectedIds.has(normalizeTestId(`${test.id}.yaml`)))
    : data.tests;
  const summary = selectedIds.size && contractTests.length
    ? {
      total: contractTests.length,
      pass: contractTests.filter(test => test.status === 'PASS').length,
      fail: contractTests.filter(test => test.status === 'FAIL').length,
      error: contractTests.filter(test => test.status === 'ERROR').length,
      stale: contractTests.filter(test => test.status === 'STALE').length,
      skipped: contractTests.filter(test => test.status === 'SKIPPED').length,
    }
    : {
      total: data.summary.total,
      pass: data.summary.pass,
      fail: data.summary.fail,
      error: data.summary.error || 0,
      stale: data.summary.stale,
      skipped: data.summary.skipped || 0,
    };
  if (scope) {
    if (!Number.isFinite(scope.selected_total)) scope.selected_total = summary.total;
    if (!Number.isFinite(scope.full_suite_total)) scope.full_suite_total = data.tests.length;
  }
  return {
    schema_version: '1.0',
    ...(statusSource.run_id ? { run_id: statusSource.run_id } : {}),
    // Preserve the producer's run timestamp (B11); generated_at is the build time.
    timestamp: statusSource.runTimestamp || data.generated,
    generated_at: data.generated,
    base_url: config.base_url || statusSource.baseUrl || null,
    ...(scope ? { scope } : {}),
    summary: {
      total: summary.total,
      pass: summary.pass,
      fail: summary.fail,
      error: summary.error,
      stale: summary.stale,
      skipped: summary.skipped,
      duration_ms: statusSource.durationMs ?? null,
    },
    tests: contractTests.map(test => {
      // Carry producer-only additive fields through the rewrite (they cannot
      // be reconstructed from manifests): browser_errors, llm_steps_pending.
      const raw = rawTestsById[normalizeTestId(test.id)] || {};
      return {
        id: test.id,
        manifest: `${test.id}.yaml`,
        name: test.name,
        url: test.url || '',
        status: test.status,
        // Preserve the producer's per-test duration when available (B11)
        duration_ms: Number.isFinite(test.durationMs) ? test.durationMs : null,
        screenshot: test.screenshot,
        failure_reason: test.failureReason || null,
        ...(Array.isArray(raw.browser_errors) && raw.browser_errors.length ? { browser_errors: raw.browser_errors } : {}),
        ...(Number.isFinite(raw.llm_steps_pending) && raw.llm_steps_pending > 0 ? { llm_steps_pending: raw.llm_steps_pending } : {}),
      };
    }),
  };
}

// ── 6. Read HTML template ──
function getHtmlTemplate() {
  // The template is a separate file for clarity
  return readFileSync(join(ROOT, '_review-template.html'), 'utf8');
}

// ── 7. Persona-aware change reports ──
const DEFAULT_REPORT_AUDIENCES = {
  client: {
    id: 'client',
    label: 'Client validation',
    badge: 'Decision view',
    focus: 'Choose what feels right and leave clear validation comments.',
    sections: ['impact', 'choices', 'risk'],
  },
  business: {
    id: 'business',
    label: 'Business stakeholder',
    badge: 'Outcome view',
    focus: 'Understand the business outcome, tradeoffs, and remaining risk.',
    sections: ['impact', 'priority', 'risk'],
  },
  product: {
    id: 'product',
    label: 'Product',
    badge: 'Roadmap view',
    focus: 'Evaluate scope, priority, acceptance criteria, and next decisions.',
    sections: ['problem', 'impact', 'priority', 'tests'],
  },
  design: {
    id: 'design',
    label: 'Design / UX',
    badge: 'UX rationale',
    focus: 'Review before/after evidence, interaction rationale, and visual tradeoffs.',
    sections: ['problem', 'decision', 'impact', 'risk'],
  },
  engineering: {
    id: 'engineering',
    label: 'Engineering',
    badge: 'Implementation view',
    focus: 'Check files, tests, technical risks, and implementation boundaries.',
    sections: ['decision', 'tests', 'files', 'risk'],
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(value) {
  return String(value || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report';
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeAudience(value) {
  if (typeof value === 'string') {
    const known = DEFAULT_REPORT_AUDIENCES[value];
    return known ? { ...known } : {
      id: slugify(value),
      label: value,
      badge: 'Custom view',
      focus: 'Review the change report from this audience perspective.',
      sections: ['problem', 'decision', 'impact', 'risk'],
    };
  }
  if (value && typeof value === 'object') {
    const id = slugify(value.id || value.label || 'custom');
    const known = DEFAULT_REPORT_AUDIENCES[id] || {};
    return {
      ...known,
      ...value,
      id,
      label: value.label || known.label || id,
      badge: value.badge || known.badge || 'Custom view',
      focus: value.focus || known.focus || 'Review the change report from this audience perspective.',
      sections: asArray(value.sections || known.sections || ['problem', 'decision', 'impact', 'risk']),
    };
  }
  return null;
}

function normalizeChangeReport(id, raw) {
  if (!raw || typeof raw !== 'object') throw new Error(`Invalid report.json for ${id}: expected object`);
  const changes = Array.isArray(raw.changes) ? raw.changes : null;
  if (!changes) throw new Error(`Invalid report.json for ${id}: changes must be an array`);
  const configuredAudiences = raw.audiences || raw.personas || ['client', 'product', 'design', 'engineering'];
  const audiences = asArray(configuredAudiences).map(normalizeAudience).filter(Boolean);
  if (audiences.length === 0) throw new Error(`Invalid report.json for ${id}: at least one audience is required`);
  const client = raw.client && typeof raw.client === 'object' ? raw.client : {};
  const validation = raw.validation && typeof raw.validation === 'object' ? raw.validation : {};
  return {
    id: slugify(raw.id || id),
    title: raw.title || id,
    subtitle: raw.subtitle || raw.summary || '',
    summary: raw.summary || raw.subtitle || '',
    route: raw.route || raw.url || '',
    generatedAt: raw.generated_at || raw.generatedAt || new Date().toISOString(),
    status: raw.status || 'draft',
    links: Array.isArray(raw.links) ? raw.links : [],
    client: {
      name: client.name || validation.client_name || validation.clientName || raw.client_name || raw.clientName || 'Client',
      contact: client.contact || client.email || validation.client_contact || validation.clientContact || '',
    },
    validation: {
      reference: validation.reference || raw.reference || raw.id || id,
      reviewUrl: validation.review_url || validation.reviewUrl || raw.review_url || raw.reviewUrl || '',
      replyTo: validation.reply_to || validation.replyTo || raw.reply_to || raw.replyTo || '',
      deadline: validation.deadline || raw.deadline || '',
      senderName: validation.sender_name || validation.senderName || raw.sender_name || raw.senderName || '',
      senderCompany: validation.sender_company || validation.senderCompany || raw.sender_company || raw.senderCompany || '',
    },
    audiences,
    changes: changes.map((change, index) => ({
      id: slugify(change.id || `change-${index + 1}`),
      title: change.title || `Change ${index + 1}`,
      summary: change.summary || '',
      problem: change.problem || '',
      decision: change.decision || change.solution || '',
      impact: change.impact || '',
      choices: asArray(change.choices),
      priority: change.priority || change.severity || '',
      risk: change.risk || change.residual_risk || '',
      tests: asArray(change.tests),
      files: asArray(change.files),
      tags: asArray(change.tags),
      before: normalizeShot(change.before),
      after: normalizeShot(change.after),
    })),
  };
}

function normalizeShot(value) {
  if (!value) return null;
  if (typeof value === 'string') return { src: value, caption: '' };
  if (typeof value === 'object' && value.src) {
    return {
      src: String(value.src),
      caption: value.caption || value.label || '',
      alt: value.alt || value.caption || value.label || '',
    };
  }
  return null;
}

function collectChangeReports() {
  if (!existsSync(CHANGE_REPORTS_DIR)) return [];
  const reports = [];
  for (const entry of readdirSync(CHANGE_REPORTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const reportPath = join(CHANGE_REPORTS_DIR, entry.name, 'report.json');
    if (!existsSync(reportPath)) continue;
    try {
      reports.push(normalizeChangeReport(entry.name, readJson(reportPath)));
    } catch (e) {
      console.warn(`  WARN: Skipping change report "${entry.name}": ${e.message}`);
    }
  }
  return reports;
}

function reportAssetHref(report, src) {
  if (!src) return '';
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  const cleaned = src.replace(/^\.?\//, '');
  return `../../change-reports/${encodeURIComponent(report.id)}/${cleaned.split('/').map(encodeURIComponent).join('/')}`;
}

function renderMaybe(label, value) {
  if (!value || (Array.isArray(value) && value.length === 0)) return '';
  const body = Array.isArray(value)
    ? `<ul>${value.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ul>`
    : `<p>${escapeHtml(value)}</p>`;
  return `<div class="fact"><strong>${escapeHtml(label)}</strong>${body}</div>`;
}

function renderShot(report, label, shot) {
  if (!shot) {
    return `<div class="shot empty"><div class="shot-label"><strong>${escapeHtml(label)}</strong><span>No screenshot provided</span></div></div>`;
  }
  const href = escapeHtml(reportAssetHref(report, shot.src));
  return `
    <a class="shot" href="${href}">
      <div class="shot-label"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(shot.caption || '')}</span></div>
      <img src="${href}" alt="${escapeHtml(shot.alt || shot.caption || label)}" loading="lazy" />
    </a>`;
}

function audienceFacts(change, audience) {
  const sections = new Set(audience.sections || []);
  const facts = [];
  if (sections.has('problem')) facts.push(renderMaybe('Problem', change.problem));
  if (sections.has('decision')) facts.push(renderMaybe('Decision', change.decision));
  if (sections.has('impact')) facts.push(renderMaybe('Expected impact', change.impact));
  if (sections.has('choices')) facts.push(renderMaybe('Choices to validate', change.choices));
  if (sections.has('priority')) facts.push(renderMaybe('Priority', change.priority));
  if (sections.has('tests')) facts.push(renderMaybe('Tests / routes', change.tests));
  if (sections.has('files')) facts.push(renderMaybe('Files', change.files));
  if (sections.has('risk')) facts.push(renderMaybe('Residual risk', change.risk));
  return facts.filter(Boolean).join('');
}

function renderAudienceReport(report, audience) {
  const title = `${report.title} - ${audience.label}`;
  const storageKey = `shipguard:persona-report:${report.id}:${audience.id}`;
  const changeCards = report.changes.map(change => `
    <article class="change" data-change="${escapeHtml(change.id)}">
      <div class="change-head">
        <div>
          <h2>${escapeHtml(change.title)}</h2>
          <p>${escapeHtml(change.summary || change.impact || change.problem || '')}</p>
        </div>
        ${change.tags.length ? `<div class="tags">${change.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="evidence">
        ${renderShot(report, 'Before', change.before)}
        ${renderShot(report, 'After', change.after)}
      </div>
      <div class="facts">${audienceFacts(change, audience)}</div>
      <div class="review">
        <textarea data-note placeholder="Comment for ${escapeHtml(audience.label)}..."></textarea>
        <div class="decision-row">
          <label><input type="radio" name="${escapeHtml(change.id)}" value="accept" /> Accept</label>
          <label><input type="radio" name="${escapeHtml(change.id)}" value="adjust" /> Adjust</label>
          <label><input type="radio" name="${escapeHtml(change.id)}" value="reject" /> Reject</label>
        </div>
      </div>
    </article>`).join('');

  const links = report.links.map(link => {
    if (!link || !link.href) return '';
    return `<a class="button" href="${escapeHtml(link.href)}">${escapeHtml(link.label || link.href)}</a>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#edf2f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}a{color:inherit}.hero{padding:28px min(5vw,56px);background:linear-gradient(180deg,#121a2b,#0b1020);border-bottom:1px solid #263247}.brand{color:#79b8ff;font-size:13px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.pill{display:inline-flex;border:1px solid #315078;border-radius:999px;color:#cfe2ff;background:#162b45;font-size:12px;font-weight:750;padding:5px 9px;margin-left:8px}h1{font-size:clamp(28px,4vw,46px);line-height:1.08;margin:14px 0 8px}h2,h3,p{margin:0}.subtitle{color:#a6b2c2;font-size:15px;max-width:940px}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:20px}.metric,.note,.change{background:#151e30;border:1px solid #2b374c;border-radius:8px}.metric{padding:13px 14px}.metric strong{display:block;font-size:24px}.metric span,.note p,.change-head p,.fact p,.fact li,.shot-label span,.footer{color:#a6b2c2}main{padding:24px min(5vw,56px) 56px}.note{padding:16px;margin-bottom:18px}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.button,button{background:#0f1726;border:1px solid #2b374c;border-radius:6px;color:#edf2f7;cursor:pointer;display:inline-flex;font:inherit;font-size:13px;font-weight:750;padding:8px 10px;text-decoration:none}.changes{display:grid;gap:18px}.change{overflow:hidden}.change-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid #2b374c;padding:16px}.tags{display:flex;gap:6px;flex-wrap:wrap}.tags span{background:#22314a;border:1px solid #344763;border-radius:999px;color:#b9c8dc;font-size:12px;padding:4px 8px}.evidence{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.shot{border-right:1px solid #2b374c;min-width:0}.shot:last-child{border-right:0}.shot-label{display:flex;justify-content:space-between;gap:10px;background:#1d2940;border-bottom:1px solid #2b374c;padding:10px 12px}.shot img{display:block;width:100%;height:auto;background:#0f1726}.shot.empty{min-height:180px;background:#0f1726}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;border-top:1px solid #2b374c;padding:14px 16px}.fact strong{display:block;font-size:12px;text-transform:uppercase;margin-bottom:4px}.fact ul{margin:0;padding-left:18px}.review{border-top:1px solid #2b374c;padding:14px 16px 16px}textarea{display:block;width:100%;min-height:86px;resize:vertical;background:#0f1726;border:1px solid #2b374c;border-radius:6px;color:#edf2f7;font:inherit;font-size:13px;padding:10px}textarea:focus{outline:none;border-color:#79b8ff}.decision-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;color:#a6b2c2}.decision-row input{accent-color:#79b8ff}.footer{font-size:12px;margin-top:24px}@media(max-width:860px){.evidence{grid-template-columns:1fr}.shot{border-right:0;border-bottom:1px solid #2b374c}.shot:last-child{border-bottom:0}}
</style>
</head>
<body>
<header class="hero">
  <div><span class="brand">ShipGuard</span><span class="pill">${escapeHtml(audience.badge)}</span></div>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">${escapeHtml(audience.focus)}</p>
  <div class="meta">
    <div class="metric"><strong>${report.changes.length}</strong><span>changes to review</span></div>
    <div class="metric"><strong>${escapeHtml(report.status)}</strong><span>report status</span></div>
    <div class="metric"><strong>${escapeHtml(report.route || 'n/a')}</strong><span>route / flow</span></div>
    <div class="metric"><strong>${escapeHtml(new Date(report.generatedAt).toISOString().slice(0, 10))}</strong><span>generated</span></div>
  </div>
</header>
<main>
  <section class="note">
    <h2>Report context</h2>
    <p>${escapeHtml(report.summary || report.subtitle || 'No summary provided.')}</p>
    <div class="toolbar">
      <a class="button" href="index.html">All audiences</a>
      <a class="button" href="client-invite-email.md">Email to send</a>
      <a class="button" href="client-response-email.md">Client reply email</a>
      <a class="button" href="proposal-trace.md">Proposal trace</a>
      <button id="export-comments" type="button">Export comments JSON</button>
      <button id="clear-comments" type="button">Clear local comments</button>
      ${links}
    </div>
  </section>
  <section class="changes">${changeCards}</section>
  <p class="footer">Generated by ShipGuard Persona Reports. Comments are stored locally in this browser and can be exported as JSON.</p>
</main>
<script>
(function(){
  var storageKey=${JSON.stringify(storageKey)};
  var changes=Array.prototype.slice.call(document.querySelectorAll('[data-change]'));
  function readState(){try{return JSON.parse(localStorage.getItem(storageKey)||'{}')}catch(_){return {}}}
  function writeState(state){localStorage.setItem(storageKey,JSON.stringify(state))}
  function collect(){var state={};changes.forEach(function(node){var id=node.getAttribute('data-change');var checked=node.querySelector('input[type=radio]:checked');state[id]={note:node.querySelector('[data-note]').value,decision:checked?checked.value:null}});return state}
  function restore(){var state=readState();changes.forEach(function(node){var id=node.getAttribute('data-change');var data=state[id]||{};node.querySelector('[data-note]').value=data.note||'';if(data.decision){var input=node.querySelector("input[value='"+data.decision+"']");if(input)input.checked=true}})}
  changes.forEach(function(node){node.addEventListener('input',function(){writeState(collect())});node.addEventListener('change',function(){writeState(collect())})});
  document.getElementById('export-comments').addEventListener('click',function(){var payload={report:${JSON.stringify(report.id)},audience:${JSON.stringify(audience.id)},exported_at:new Date().toISOString(),comments:collect()};var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});var url=URL.createObjectURL(blob);var link=document.createElement('a');link.href=url;link.download=${JSON.stringify(`${report.id}-${audience.id}-review.json`)};document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url)});
  document.getElementById('clear-comments').addEventListener('click',function(){localStorage.removeItem(storageKey);changes.forEach(function(node){node.querySelector('[data-note]').value='';Array.prototype.forEach.call(node.querySelectorAll('input[type=radio]'),function(input){input.checked=false})})});
  restore();
}());
</script>
</body>
</html>`;
}

function renderAudienceIndex(report) {
  const links = report.audiences.map(audience => `
    <a class="audience" href="${encodeURIComponent(audience.id)}.html">
      <strong>${escapeHtml(audience.label)}</strong>
      <span>${escapeHtml(audience.focus)}</span>
    </a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(report.title)} - ShipGuard audiences</title><style>body{margin:0;background:#0b1020;color:#edf2f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{padding:32px min(5vw,56px)}h1{font-size:clamp(28px,4vw,44px);margin:0 0 10px}.muted{color:#a6b2c2;max-width:860px;line-height:1.5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:24px}.audience,.artifact{display:block;background:#151e30;border:1px solid #2b374c;border-radius:8px;color:inherit;padding:16px;text-decoration:none}.audience:hover,.artifact:hover{border-color:#79b8ff}.audience strong,.artifact strong{display:block;margin-bottom:6px}.audience span,.artifact span{color:#a6b2c2;font-size:14px;line-height:1.45}.section{margin-top:30px}</style></head><body><main><h1>${escapeHtml(report.title)}</h1><p class="muted">${escapeHtml(report.summary || 'Choose the audience-specific view to review this change report.')}</p><div class="grid">${links}</div><div class="section"><h2>Validation artifacts</h2><p class="muted">Use these files to keep a trace of what was proposed and to exchange validation by email.</p><div class="grid"><a class="artifact" href="client-invite-email.md"><strong>Email to send</strong><span>Prepared message for sending the analysis to the client.</span></a><a class="artifact" href="client-response-email.md"><strong>Client reply email</strong><span>Prepared response template the client can send back.</span></a><a class="artifact" href="proposal-trace.md"><strong>Proposal trace</strong><span>Human-readable trace of the proposed changes and generated artifacts.</span></a><a class="artifact" href="proposal-trace.json"><strong>Proposal trace JSON</strong><span>Machine-readable trace for archiving or later automation.</span></a></div></div></main></body></html>`;
}

function renderReportsIndex(generated) {
  const links = generated.map(item => `<a class="report" href="${encodeURIComponent(item.id)}/index.html"><strong>${escapeHtml(item.title)}</strong><span>${item.audiences} audience views</span></a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>ShipGuard Persona Reports</title><style>body{margin:0;background:#0b1020;color:#edf2f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{padding:32px min(5vw,56px)}h1{font-size:clamp(28px,4vw,44px);margin:0 0 10px}.muted{color:#a6b2c2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:24px}.report{display:block;background:#151e30;border:1px solid #2b374c;border-radius:8px;color:inherit;padding:16px;text-decoration:none}.report:hover{border-color:#79b8ff}.report strong{display:block;margin-bottom:6px}.report span{color:#a6b2c2;font-size:14px}</style></head><body><main><h1>ShipGuard Persona Reports</h1><p class="muted">Audience-specific reports generated from change-report specs.</p><div class="grid">${links || '<p class="muted">No reports generated.</p>'}</div></main></body></html>`;
}

function md(value) {
  return String(value ?? '').replace(/\r/g, '').trim();
}

function mdList(values) {
  const items = asArray(values).map(value => md(value)).filter(Boolean);
  return items.length ? items.map(value => `- ${value}`).join('\n') : '- n/a';
}

function clientAudienceId(report) {
  return report.audiences.some(audience => audience.id === 'client') ? 'client' : report.audiences[0].id;
}

function clientReviewTarget(report) {
  return report.validation.reviewUrl || `${clientAudienceId(report)}.html`;
}

function renderChangeDecisionTemplate(report) {
  return report.changes.map(change => [
    `- ${md(change.title)} (${change.id})`,
    '  Decision: [Accept / Adjust / Reject]',
    '  Comment:'
  ].join('\n')).join('\n');
}

function renderClientInviteEmail(report) {
  const deadline = report.validation.deadline ? `\nRequested response date: ${md(report.validation.deadline)}\n` : '';
  const replyTo = report.validation.replyTo ? `\nPlease reply to: ${md(report.validation.replyTo)}\n` : '';
  const signature = [report.validation.senderName, report.validation.senderCompany].map(md).filter(Boolean).join('\n');
  return `Subject: Validation request - ${md(report.title)}

Hello ${md(report.client.name)},

We prepared the following ShipGuard validation report for your review:

${md(report.title)}

${md(report.summary || 'Please review the proposed changes and send back your validation decision.')}

Review page:
${clientReviewTarget(report)}
${deadline}${replyTo}
Please review the before/after evidence and send back a decision for each proposed change:

${renderChangeDecisionTemplate(report)}

Decision values:
- Accept: the proposal is approved as presented.
- Adjust: the direction is approved, but changes are requested.
- Reject: the proposal should not move forward.

Reference: ${md(report.validation.reference)}

${signature}
`;
}

function renderClientResponseEmail(report) {
  const replyTo = report.validation.replyTo ? `To: ${md(report.validation.replyTo)}\n` : '';
  return `${replyTo}Subject: Validation response - ${md(report.title)}

Hello,

After reviewing the ShipGuard validation report, here is our response.

Report: ${md(report.title)}
Reference: ${md(report.validation.reference)}
Review page: ${clientReviewTarget(report)}

Overall decision: [Accept / Adjust / Reject]

Change decisions:
${renderChangeDecisionTemplate(report)}

Additional comments:

Client name:
Decision date:
`;
}

function proposalArtifacts(report) {
  const audienceArtifacts = report.audiences.map(audience => ({
    type: 'audience_html',
    audience: audience.id,
    path: `${audience.id}.html`,
  }));
  return [
    { type: 'audience_index', path: 'index.html' },
    ...audienceArtifacts,
    { type: 'email_to_send', path: 'client-invite-email.md' },
    { type: 'client_reply_email', path: 'client-response-email.md' },
    { type: 'proposal_trace_markdown', path: 'proposal-trace.md' },
    { type: 'proposal_trace_json', path: 'proposal-trace.json' },
  ];
}

function renderProposalTraceMarkdown(report) {
  const changes = report.changes.map(change => `## ${md(change.title)}

- Change ID: ${change.id}
- Summary: ${md(change.summary || 'n/a')}
- Problem: ${md(change.problem || 'n/a')}
- Proposed decision: ${md(change.decision || 'n/a')}
- Expected impact: ${md(change.impact || 'n/a')}
- Choices:
${mdList(change.choices)}
- Residual risk: ${md(change.risk || 'n/a')}
- Tests / routes:
${mdList(change.tests)}
- Files:
${mdList(change.files)}
`).join('\n');

  const artifacts = proposalArtifacts(report).map(artifact => {
    const audience = artifact.audience ? ` (${artifact.audience})` : '';
    return `- ${artifact.type}${audience}: ${artifact.path}`;
  }).join('\n');

  return `# Proposal Trace - ${md(report.title)}

Status: prepared
Generated at: ${md(report.generatedAt)}
Reference: ${md(report.validation.reference)}
Client: ${md(report.client.name)}
Client contact: ${md(report.client.contact || 'n/a')}
Route / flow: ${md(report.route || 'n/a')}
Review target: ${clientReviewTarget(report)}

This file records what ShipGuard prepared for client validation. It is the local trace of the proposal before any manual email is sent.

# Proposed Changes

${changes}

# Generated Artifacts

${artifacts}

# Client Return

The client can return validation manually by sending back \`client-response-email.md\`, or by exporting JSON from the HTML report.
`;
}

function proposalTraceJson(report) {
  return {
    schema_version: 'shipguard.client-validation-trace.v1',
    status: 'prepared',
    generated_at: report.generatedAt,
    reference: report.validation.reference,
    report: {
      id: report.id,
      title: report.title,
      summary: report.summary,
      route: report.route,
      review_target: clientReviewTarget(report),
    },
    client: report.client,
    validation: report.validation,
    changes: report.changes.map(change => ({
      id: change.id,
      title: change.title,
      summary: change.summary,
      problem: change.problem,
      proposed_decision: change.decision,
      expected_impact: change.impact,
      choices: change.choices,
      residual_risk: change.risk,
      tests: change.tests,
      files: change.files,
      tags: change.tags,
    })),
    artifacts: proposalArtifacts(report),
    return_channel: {
      mode: 'manual_email_or_json_export',
      client_reply_template: 'client-response-email.md',
      browser_json_export: `${report.id}-${clientAudienceId(report)}-review.json`,
    },
  };
}

function writeValidationArtifacts(outDir, report) {
  writeFileSync(join(outDir, 'client-invite-email.md'), renderClientInviteEmail(report), 'utf8');
  writeFileSync(join(outDir, 'client-response-email.md'), renderClientResponseEmail(report), 'utf8');
  writeFileSync(join(outDir, 'proposal-trace.md'), renderProposalTraceMarkdown(report), 'utf8');
  writeFileSync(join(outDir, 'proposal-trace.json'), JSON.stringify(proposalTraceJson(report), null, 2), 'utf8');
}

function generatePersonaReports() {
  const reports = collectChangeReports();
  if (reports.length === 0) return 0;
  mkdirSync(PERSONA_REPORTS_DIR, { recursive: true });
  const generated = [];
  for (const report of reports) {
    const outDir = join(PERSONA_REPORTS_DIR, report.id);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), renderAudienceIndex(report), 'utf8');
    for (const audience of report.audiences) {
      writeFileSync(join(outDir, `${audience.id}.html`), renderAudienceReport(report, audience), 'utf8');
    }
    writeValidationArtifacts(outDir, report);
    generated.push({ id: report.id, title: report.title, audiences: report.audiences.length });
  }
  writeFileSync(join(PERSONA_REPORTS_DIR, 'index.html'), renderReportsIndex(generated), 'utf8');
  return generated.reduce((sum, item) => sum + item.audiences + 1, 1);
}

// ── Unified findings (evidence-first) ──
// One derived list merging all five signal sources. The three canonical
// schemas stay untouched — this is an additive projection. Evidence taxonomy:
// measured (a real observation), reasoned (a static/simulated prediction),
// manual (a human annotation).
function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function buildFindings({ audit, processResults, visual, crawlResults, fixManifest }) {
  const findings = [];
  for (const bug of (audit && Array.isArray(audit.bugs) ? audit.bugs : [])) {
    if (!bug || typeof bug !== 'object') continue;
    findings.push({
      title: bug.title || 'Audit finding',
      severity: SEV_RANK[bug.severity] !== undefined ? bug.severity : 'medium',
      evidence: 'reasoned', // static analysis (even verified) predicts; it does not observe
      source: 'audit',
      route: null,
      file: bug.file || null,
      line: Number.isFinite(bug.line) ? bug.line : null,
      detail: bug.description || '',
      origin: { lane: 'audit', id: bug.id || null },
    });
  }
  for (const unit of (processResults && Array.isArray(processResults.units) ? processResults.units : [])) {
    if (!unit || typeof unit !== 'object' || unit.verdict === 'unchanged') continue;
    const actions = Array.isArray(unit.actions) ? unit.actions : [];
    const measured = actions.some((a) => a && a.evidence === 'measured');
    const surprise = actions.some((a) => a && a.surprise);
    findings.push({
      title: `${unit.kind || 'unit'} ${unit.ref || unit.id || ''}: ${unit.verdict || 'changed'}`.trim(),
      severity: unit.verdict === 'new-error' || surprise ? 'high' : 'medium',
      evidence: measured ? 'measured' : 'reasoned',
      source: 'process',
      route: null,
      file: unit.file || null,
      line: null,
      detail: actions.map((a) => a && a.delta).filter(Boolean).join('; ') || (unit.verdict || ''),
      origin: { lane: 'process', id: unit.id || null },
    });
  }
  for (const t of (visual && Array.isArray(visual.tests) ? visual.tests : [])) {
    if (!t || typeof t !== 'object') continue;
    if (t.status === 'FAIL' || t.status === 'ERROR') {
      findings.push({
        title: `${t.name || t.id || 'visual test'}: ${t.status}`,
        severity: t.status === 'FAIL' ? 'high' : 'medium',
        evidence: 'measured',
        source: 'browser',
        route: t.url || null,
        file: null,
        line: null,
        detail: t.failure_reason || '',
        origin: { lane: 'visual', id: t.id || null },
      });
    }
    for (const err of (Array.isArray(t.browser_errors) ? t.browser_errors : [])) {
      if (!err || err.level !== 'error') continue;
      findings.push({
        title: 'Browser console error',
        severity: 'medium',
        evidence: 'measured',
        source: 'browser',
        route: t.url || null,
        file: null,
        line: null,
        detail: err.text || '',
        origin: { lane: 'visual', id: t.id || null },
      });
    }
  }
  for (const b of (crawlResults && Array.isArray(crawlResults.broken) ? crawlResults.broken : [])) {
    if (!b || typeof b !== 'object') continue;
    findings.push({
      title: `Missing local resource (${b.tag || 'asset'})`,
      severity: b.tag === 'a' ? 'medium' : 'high',
      evidence: 'measured',
      source: 'crawler',
      route: b.found_on || null,
      file: null,
      line: null,
      detail: `${b.url} → HTTP ${b.status}`,
      origin: { lane: 'crawl', id: b.url || null },
    });
  }
  for (const t of (fixManifest && Array.isArray(fixManifest.tests) ? fixManifest.tests : [])) {
    if (!t || !Array.isArray(t.annotations) || t.annotations.length === 0) continue;
    findings.push({
      title: `Human annotation on ${t.test || 'test'}`,
      severity: 'medium',
      evidence: 'manual',
      source: 'human',
      route: t.url || null,
      file: null,
      line: null,
      detail: `${t.annotations.length} annotated region(s) on ${t.screenshot || 'screenshot'}`,
      origin: { lane: 'human', id: t.test || null },
    });
  }
  findings.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
  findings.forEach((f, i) => { f.id = 'SG-' + String(i + 1).padStart(3, '0'); });
  const tally = (key) => findings.reduce((m, f) => { m[f[key]] = (m[f[key]] || 0) + 1; return m; }, {});
  return {
    schema_version: '1.0',
    generated: new Date().toISOString(),
    findings,
    summary: { total: findings.length, by_severity: tally('severity'), by_evidence: tally('evidence'), by_source: tally('source') },
  };
}

// ── Main ──
console.log('Building Visual review page...');

mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const visualResults = parseVisualResults();
if (visualResults.error) {
  console.warn(`  WARN: ${visualResults.error}`);
}
// Raw pre-rewrite copy for the findings projection — the rewrite below (from
// resolved manifest statuses) drops producer-only fields like browser_errors.
const visualRawForFindings = readJsonSafe(VISUAL_RESULTS_PATH);
const report = mergeStatusSources(visualResults, parseReport());
const regressions = parseRegressions();
const tests = collectTests();

console.log(`  Found ${tests.length} test manifests`);

mergeStatus(tests, report, regressions);

const passCount = tests.filter(t => t.status === 'PASS').length;
const failCount = tests.filter(t => t.status === 'FAIL').length;
const errorCount = tests.filter(t => t.status === 'ERROR').length;
const staleCount = tests.filter(t => t.status === 'STALE').length;
const skippedCount = tests.filter(t => t.status === 'SKIPPED').length;

const data = {
  generated: new Date().toISOString(),
  summary: {
    total: tests.length,
    pass: passCount,
    fail: failCount,
    error: errorCount,
    stale: staleCount,
    skipped: skippedCount,
    passRate: tests.length > 0 ? (passCount / tests.length) * 100 : 0,
    lastRun: report.lastRun || new Date().toISOString().split('T')[0],
  },
  categories: CATEGORIES.filter(c => tests.some(t => t.category === c)),
  tests,
  visualResultsSource: visualResults.source,
  visualResultsError: visualResults.error || null,
  // Track last fix-manifest timestamp to detect "updated" screenshots
  lastFixTimestamp: existsSync(join(RESULTS_DIR, 'fix-manifest.json'))
    ? statSync(join(RESULTS_DIR, 'fix-manifest.json')).mtimeMs : 0,
};

const rawTestsById = {};
for (const t of (visualRawForFindings && Array.isArray(visualRawForFindings.tests) ? visualRawForFindings.tests : [])) {
  if (t && t.id) rawTestsById[normalizeTestId(t.id)] = t;
}
writeFileSync(VISUAL_RESULTS_PATH, JSON.stringify(buildVisualResultsContract(data, report, rawTestsById), null, 2), 'utf8');

console.log(`  Status: ${passCount} pass, ${failCount} fail, ${errorCount} error, ${staleCount} stale, ${skippedCount} skipped`);
console.log(`  Screenshots matched: ${tests.filter(t => t.screenshot).length}/${tests.length}`);
console.log(`  Visual results: ${VISUAL_RESULTS_PATH}`);

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

// ── Collect process-check results (sg-process-check → Process tab) ──
let processResults = null;
if (existsSync(PROCESS_RESULTS_PATH)) {
  try {
    const parsed = JSON.parse(readFileSync(PROCESS_RESULTS_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      processResults = parsed;
      console.log('  Process check results: found');
    } else {
      console.warn('  WARN: process-results.json is not a JSON object — Process tab shows its empty state');
    }
  } catch (e) {
    console.warn(`  WARN: process-results.json is invalid JSON (${e.message}) — Process tab shows its empty state`);
  }
}

// ── Build the unified findings projection + lane availability ──
const auditForFindings = readJsonSafe(AUDIT_RESULTS_PATH);
const crawlResults = readJsonSafe(CRAWL_RESULTS_PATH);
const runData = readJsonSafe(RUN_JSON_PATH);
const fixManifestData = readJsonSafe(FIX_MANIFEST_PATH);
const findingsData = buildFindings({
  audit: auditForFindings,
  processResults,
  visual: visualRawForFindings,
  crawlResults,
  fixManifest: fixManifestData,
});
writeFileSync(FINDINGS_PATH, JSON.stringify(findingsData, null, 2), 'utf8');
console.log(`  Findings: ${findingsData.summary.total} (evidence: ${JSON.stringify(findingsData.summary.by_evidence)})`);

// Build-time facts for the dashboard's dynamic default tab
data.laneAvailability = {
  findings: findingsData.summary.total,
  audit: !!auditForFindings,
  process: !!processResults,
  visual: tests.some((t) => t.status && t.status !== 'STALE'),
  recorded: recordedTests.length,
};

// Escape once at the serialization boundary (B9): neutralize </script>
// injection and JS line separators when inlining data into the template.
function embedJson(value) {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/[\u2028\u2029]/g, m => (m === '\u2028' ? '\\u2028' : '\\u2029'));
}

const template = getHtmlTemplate();
// Function replacement (B7) so `$&`/`$'` patterns in the data are not expanded.
const html = template
  .replace('"__PLACEHOLDER_VISUAL_DATA__"', () => embedJson(data))
  .replace('"__PLACEHOLDER_RECORDED_DATA__"', () => embedJson(recordedTests))
  .replace('"__PLACEHOLDER_PROCESS_DATA__"', () => embedJson(processResults))
  .replace('"__PLACEHOLDER_FINDINGS_DATA__"', () => embedJson(findingsData))
  .replace('"__PLACEHOLDER_RUN_DATA__"', () => embedJson(runData));
writeFileSync(OUTPUT_PATH, html, 'utf8');

console.log(`  Output: ${OUTPUT_PATH}`);

// ── Generate thumbnails (macOS sips, no dependency) ──
const THUMBS_DIR = resolve(join(RESULTS_DIR, 'thumbs'));
mkdirSync(THUMBS_DIR, { recursive: true });
let thumbCount = 0;
for (const t of tests) {
  if (!t.screenshot) continue;
  const src = join(RESULTS_DIR, t.screenshot);
  const thumbName = t.screenshot.replace('screenshots/', '');
  const dest = resolve(THUMBS_DIR, thumbName);
  // B17: refuse thumbnail destinations that escape the thumbs directory
  const destRel = relative(THUMBS_DIR, dest);
  if (destRel.startsWith('..') || isAbsolute(destRel)) {
    console.warn(`  WARN: skipping thumbnail for "${t.screenshot}" — name escapes the thumbs directory`);
    continue;
  }
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

const personaReportCount = generatePersonaReports();
if (personaReportCount > 0) {
  console.log(`  Persona reports: ${personaReportCount} pages`);
}

// --serve: start HTTP server with PID file (--stop is handled at the top of the script)
if (process.argv.includes('--serve')) {
  // Kill a previously started server, then wait (up to ~2s) for it to exit
  // so the port is free before we listen (B10/B16).
  if (existsSync(PID_FILE)) {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf8').split('\n')[0].trim(), 10);
    if (!isNaN(oldPid) && oldPid !== process.pid && pidExists(oldPid)) {
      try { process.kill(oldPid); } catch { /* already dead */ }
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && pidExists(oldPid)) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }

  const http = await import('http');
  const { createReadStream, existsSync: fExists } = await import('fs');
  const { extname } = await import('path');

  const MIME = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript' };
  const portArg = process.argv.find(a => a.startsWith('--port='))?.split('=')[1];
  const PORT = portArg === undefined ? 8888 : Number(portArg);
  if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
    console.error(`Invalid --port value "${portArg}" — expected an integer between 0 and 65535.`);
    process.exit(1);
  }
  const HOST = process.argv.find(a => a.startsWith('--host='))?.split('=')[1] || '127.0.0.1';
  const RESULTS_ROOT = resolve(RESULTS_DIR);
  if (HOST === '0.0.0.0') {
    console.warn('  WARN: --host=0.0.0.0 exposes the review server on your local network.');
  }

  // ── Monitor state (in-memory + persisted to JSON) ──
  let auditState = null;
  const MONITOR_PATH = join(RESULTS_DIR, 'audit-monitor.json');

  function persistMonitor() {
    if (auditState) writeFileSync(MONITOR_PATH, JSON.stringify(auditState, null, 2), 'utf8');
  }

  function normalizeMonitorId(value) {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const roundPrefixed = raw.match(/^r\d+[:_-](.+)$/i);
    return roundPrefixed ? roundPrefixed[1] : raw;
  }

  function monitorIdFrom(data) {
    return normalizeMonitorId(data?.agent_id ?? data?.zone_id ?? data?.id);
  }

  function monitorAliasesFor(data, canonicalId) {
    const aliases = new Set();
    for (const value of [data?.agent_id, data?.zone_id, data?.id]) {
      if (value !== undefined && value !== null && String(value).trim()) aliases.add(String(value).trim());
    }
    if (canonicalId) aliases.add(`r1:${canonicalId}`);
    return [...aliases].filter(alias => alias !== canonicalId);
  }

  function existingMonitorKey(canonicalId) {
    if (!auditState?.agents) return canonicalId;
    if (auditState.agents[canonicalId]) return canonicalId;
    for (const [key, agent] of Object.entries(auditState.agents)) {
      if (normalizeMonitorId(key) === canonicalId || monitorIdFrom(agent) === canonicalId) return key;
    }
    return canonicalId;
  }

  function readBody(req, maxBytes = 5 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        size += chunk.length;
        if (size > maxBytes) {
          // Pause (do not destroy) so the caller can still send a 413 response.
          tooLarge = true;
          req.pause();
          reject(new Error('Payload too large'));
          return;
        }
        body += chunk;
      });
      req.on('end', () => {
        if (tooLarge) return;
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
      req.on('error', err => { if (!tooLarge) reject(err); });
    });
  }

  function resolveServedPath(requestUrl) {
    let pathname;
    try {
      const rawPath = String(requestUrl || '/').split('?')[0].split('#')[0] || '/';
      pathname = rawPath === '/' ? '/review.html' : rawPath;
      pathname = decodeURIComponent(pathname);
    } catch {
      return { error: 'Bad request path', status: 400 };
    }

    const target = resolve(RESULTS_ROOT, pathname.replace(/^\/+/, ''));
    const rel = relative(RESULTS_ROOT, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return { error: 'Forbidden', status: 403 };
    }
    return { path: target };
  }

  // ── Origin policy (B3): no wildcard CORS on a server with writable endpoints.
  // Allowed: requests without an Origin header (same-origin navigations, curl,
  // Node clients) and browser requests originating from this server itself.
  let actualPort = PORT; // updated on listen (supports --port=0)
  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (origin === `http://127.0.0.1:${actualPort}` || origin === `http://localhost:${actualPort}`) return true;
    // True same-origin on a non-loopback bind (e.g. --host=0.0.0.0 on a LAN)
    if (req.headers.host && origin === `http://${req.headers.host}`) return true;
    return false;
  }
  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !originAllowed(req)) return {};
    return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' };
  }

  const server = http.createServer(async (req, res) => {
    const CORS = corsHeaders(req);

    // Reject cross-origin POSTs to writable endpoints (/save-manifest, monitor API)
    if (req.method === 'POST' && !originAllowed(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cross-origin POST rejected' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/favicon.ico') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

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
          const id = monitorIdFrom(z);
          if (!id) continue;
          auditState.agents[id] = {
            ...(auditState.agents[id] || {}),
            id,
            agent_id: id,
            zone_id: id,
            aliases: monitorAliasesFor(z, id),
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
        const id = monitorIdFrom(data);
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ error: 'agent update missing id, agent_id, or zone_id' }));
          return;
        }
        const key = existingMonitorKey(id);
        const previous = auditState.agents[key] || {};
        const aliases = new Set([...(previous.aliases || []), ...monitorAliasesFor(data, id)]);
        auditState.agents[id] = {
          ...previous,
          ...data,
          id,
          agent_id: id,
          zone_id: normalizeMonitorId(data.zone_id ?? previous.zone_id ?? id),
          aliases: [...aliases].filter(alias => alias !== id),
        };
        if (key !== id) delete auditState.agents[key];
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
      try {
        const data = await readBody(req);
        // Server-side schema validation (B3): fix-manifest export contract
        const validShape = data && typeof data === 'object' && !Array.isArray(data)
          && data.action === 'validate-and-fix'
          && Array.isArray(data.tests)
          && data.tests.every(t => t && typeof t === 'object' && typeof t.test === 'string');
        if (!validShape) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ error: "Invalid manifest: expected { action: 'validate-and-fix', tests: [{ test: string, ... }] }" }));
          return;
        }
        const manifestPath = join(RESULTS_DIR, 'fix-manifest.json');
        writeFileSync(manifestPath, JSON.stringify(data, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, path: manifestPath }));
      } catch (e) {
        const tooLarge = e && e.message === 'Payload too large';
        res.writeHead(tooLarge ? 413 : 400, { 'Content-Type': 'application/json', ...CORS });
        // Send the response first, then drop the oversized upload (r1-z02-012).
        res.end(JSON.stringify({ error: tooLarge ? 'Payload too large (max 5 MB)' : e.message }), () => {
          if (tooLarge) req.destroy();
        });
      }
      return;
    }
    if (req.method === 'OPTIONS') {
      if (!originAllowed(req)) { res.writeHead(403); res.end(); return; }
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    // ── Static files: GET/HEAD only (B18) ──
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Allow': 'GET, HEAD', ...CORS });
      res.end('Method not allowed');
      return;
    }
    const served = resolveServedPath(req.url);
    if (served.error) { res.writeHead(served.status); res.end(served.error); return; }
    const filePath = served.path;
    if (!fExists(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    // B2: only serve regular files — a directory GET must not crash the server
    let fileStat;
    try { fileStat = statSync(filePath); } catch { res.writeHead(404); res.end('Not found'); return; }
    if (!fileStat.isFile()) { res.writeHead(403); res.end('Forbidden'); return; }
    const ext = extname(filePath);
    const noCache = { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' };
    const stream = createReadStream(filePath);
    stream.on('open', () => {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...noCache });
      stream.pipe(res);
    });
    stream.on('error', () => {
      // B2: a failing read must not crash the server
      stream.destroy();
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      } else {
        res.destroy();
      }
    });
  });

  // B10: fail cleanly when the port is taken instead of throwing a stack trace
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`  Error: port ${PORT} busy — pass --port=<other> or run /sg-visual-review-stop`);
    } else {
      console.error(`  Server error: ${err && err.message ? err.message : err}`);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    const addr = server.address();
    actualPort = addr && typeof addr === 'object' ? addr.port : PORT;
    // PID file contains two lines: <pid>\n<port> (used by /sg-visual-review-stop)
    writeFileSync(PID_FILE, `${process.pid}\n${actualPort}\n`, 'utf8');
    console.log(`  Server: http://${HOST}:${actualPort} (PID ${process.pid})`);
    console.log('  Stop: node visual-tests/build-review.mjs --stop  (or /sg-visual-review-stop)');
  });
} else {
  console.log('  Tip: --serve to start, --stop to stop');
  console.log('Done.');
}
