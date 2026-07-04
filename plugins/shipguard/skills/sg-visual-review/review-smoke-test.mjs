#!/usr/bin/env node
/**
 * ShipGuard review dashboard smoke test.
 *
 * Runs against the build-review.mjs and _review-template.html files installed
 * next to this script. It creates an isolated visual-tests fixture in /tmp,
 * builds review.html, starts the local review server, and verifies the minimum
 * dashboard data surface.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { request as httpRequest } from 'http';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_BUILD = join(SCRIPT_DIR, 'build-review.mjs');
const SOURCE_TEMPLATE = join(SCRIPT_DIR, '_review-template.html');
const DEFAULT_PORT_BASE = 21000;

function parseArgs() {
  const options = {
    port: null,
    keepTmp: false,
    debug: false,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--keep-tmp') options.keepTmp = true;
    else if (arg === '--debug') options.debug = true;
    else if (arg.startsWith('--port=')) options.port = parseInt(arg.split('=')[1], 10);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const envPort = process.env.SHIPGUARD_REVIEW_SMOKE_PORT || process.env.SHIPGUARD_SMOKE_PORT;
  if (!options.port && envPort) options.port = parseInt(envPort, 10);
  if (options.port && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

function createProcessLog(child) {
  const lines = [];
  function push(prefix, chunk) {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line) continue;
      lines.push(`${prefix}${line}`);
      if (lines.length > 200) lines.shift();
    }
  }
  child.stdout.on('data', chunk => push('stdout: ', chunk));
  child.stderr.on('data', chunk => push('stderr: ', chunk));
  return {
    tail(count = 40) {
      return lines.slice(-count).join('\n') || '(no child output captured)';
    },
  };
}

function formatFailure(error, root, port, log) {
  const tail = log ? log.tail() : '(server was not started)';
  const eperm = tail.match(/listen EPERM[^\n]*/);
  const sandboxHint = eperm
    ? `\nLocal server bind denied by sandbox: ${eperm[0]}\nRerun with localhost/network permission, or outside the sandbox.`
    : '';
  return [
    error.message,
    `Fixture: ${root || '(not created)'}`,
    root ? `Rerun server: cd ${root} && node build-review.mjs --serve --port=${port}` : null,
    sandboxHint.trim() || null,
    'Server output:',
    tail,
  ].filter(Boolean).join('\n');
}

function request(port, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : undefined,
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await request(port, 'GET', '/health');
      if (res.status === 200) return;
    } catch {
      // keep polling
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('review server did not become ready');
}

function createFixture() {
  assert(existsSync(SOURCE_BUILD), `Missing ${SOURCE_BUILD}`);
  assert(existsSync(SOURCE_TEMPLATE), `Missing ${SOURCE_TEMPLATE}`);

  const root = mkdtempSync(join(tmpdir(), 'shipguard-review-smoke-'));
  copyFileSync(SOURCE_BUILD, join(root, 'build-review.mjs'));
  copyFileSync(SOURCE_TEMPLATE, join(root, '_review-template.html'));
  mkdirSync(join(root, 'pages'), { recursive: true });
  mkdirSync(join(root, 'manifests'), { recursive: true });
  mkdirSync(join(root, '_results', 'screenshots'), { recursive: true });
  mkdirSync(join(root, '_results', 'change-reports', 'demo'), { recursive: true });

  writeFileSync(join(root, '_config.yaml'), 'base_url: http://127.0.0.1:8001\n', 'utf8');
  writeFileSync(join(root, 'pages', 'root-index.yaml'), [
    'name: Home',
    'description: Home page smoke test',
    'priority: high',
    'requires_auth: false',
    'steps:',
    '  - action: open',
    '    url: /',
    '    screenshot: root-index.png',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(root, 'manifests', 'recorded-login.yaml'), [
    'name: Recorded Login',
    'description: Smoke recorded manifest',
    'source: recorded',
    'recorded_at: "2026-06-29T13:30:00Z"',
    'steps:',
    '  - action: open',
    '    url: /login',
    '  - action: assert_text',
    '    expected: Login',
    '',
  ].join('\n'), 'utf8');

  writeJson(join(root, '_results', 'visual-results.json'), {
    schema_version: '1.0',
    run_id: 'visual-smoke-20260629-133000',
    timestamp: '2026-06-29T13:30:00Z',
    base_url: 'http://127.0.0.1:8001',
    scope: {
      type: 'from-audit',
      source: 'visual-tests/_results/audit-results.json',
      selected_routes: ['/'],
      selected_manifests: ['visual-tests/pages/root-index.yaml'],
      uncovered_routes: [{ route: '/review.html', status: 'uncovered', reason: 'no_visual_manifest' }],
      selected_total: 1,
      full_suite_total: 99,
    },
    summary: { total: 2, pass: 1, fail: 1, error: 0, stale: 0, skipped: 0, duration_ms: 1200 },
    tests: [
      { id: 'pages/root-index', manifest: 'visual-tests/pages/root-index.yaml', name: 'Home', url: '/', status: 'PASS', duration_ms: 1200, screenshot: null, failure_reason: null },
      { id: 'pages/broken', manifest: 'visual-tests/pages/broken.yaml', name: 'Broken', url: '/broken.html', status: 'FAIL', duration_ms: 900, screenshot: null, failure_reason: 'assert_text: not found', browser_errors: [{ level: 'error', text: 'Uncaught TypeError: x is not a function' }] },
    ],
  });
  writeJson(join(root, '_results', 'audit-results.json'), {
    summary: { total_bugs: 1, files_audited: 1, by_severity: { critical: 1, high: 0, medium: 0, low: 0 }, by_category: {} },
    bugs: [{ id: 'r1-z01-001', severity: 'critical', category: 'security', file: 'app.py', line: 12, title: 'Missing ownership check', description: 'Any user can read any doc.' }],
    impacted_ui_routes: [{ route: '/', severity: 'low', reason: 'Smoke route', bug_count: 0 }],
    agents: [{ id: 'z1', label: 'Zone 1', status: 'completed', files_audited: 1, bugs_found: 0, duration_ms: 10, paths: ['pages/root-index.yaml'] }],
  });
  writeJson(join(root, '_results', 'process-results.json'), {
    schema_version: '1.0',
    mode: 'hybrid',
    summary: { units: 1, behavior_changed: 1, new_errors: 0, surprises: 0, evidence_mix: { reasoned: 0, measured: 1 } },
    units: [{
      id: 'u01', kind: 'function', ref: 'chunk_text', file: 'pipeline.py', verdict: 'behavior-changed',
      actions: [{ seed: 1, evidence: 'measured', delta: 'output length 12 -> 9', surprise: false }],
    }],
  });
  writeJson(join(root, '_results', 'crawl-results.json'), {
    schema_version: '1.0',
    timestamp: '2026-07-04T10:00:00Z',
    base_url: 'http://127.0.0.1:8001',
    pages: 2,
    assets_checked: 5,
    broken: [{ url: 'http://127.0.0.1:8001/media/ghost.mp4', status: 404, found_on: 'http://127.0.0.1:8001/ec09-captions.html', tag: 'source' }],
  });
  writeJson(join(root, '_results', 'fix-manifest.json'), {
    action: 'validate-and-fix',
    tests: [{ test: 'pages/root-index', url: 'http://127.0.0.1:8001/', screenshot: 'screenshots/root-index.png', annotations: [{ x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 }], steps: [] }],
  });
  writeJson(join(root, '_results', 'run.json'), {
    schema_version: '1.0',
    run_id: 'run-20260704100000',
    timestamp: '2026-07-04T10:00:00Z',
    scope: { type: 'profile', value: 'site-accessible' },
    lanes: {
      audit: { status: 'ran', results: 'audit-results.json' },
      process: { status: 'ran', results: 'process-results.json' },
      visual: { status: 'ran', results: 'visual-results.json' },
      crawl: { status: 'ran', results: 'crawl-results.json' },
      llm_checks: { status: 'needs-agent', reason: '2 llm-check steps require an agent lane', count: 2 },
    },
  });
  writeJson(join(root, '_results', 'change-reports', 'demo', 'report.json'), {
    id: 'demo',
    title: 'Demo change',
    summary: 'Smoke change report.',
    route: '/',
    audiences: ['client'],
    changes: [{ id: 'home', title: 'Home page', summary: 'Smoke evidence.', impact: 'No user impact.' }],
  });
  return root;
}

async function main() {
  const options = parseArgs();
  let root = null;
  let port = null;
  let server = null;
  let log = null;
  let passed = false;
  try {
    root = createFixture();
    execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
    assert(existsSync(join(root, '_results', 'review.html')), 'review.html was not generated');
    assert(existsSync(join(root, '_results', 'visual-results.json')), 'visual-results.json was not generated');
    const rebuiltVisualResults = JSON.parse(readFileSync(join(root, '_results', 'visual-results.json'), 'utf8'));
    assert(rebuiltVisualResults.run_id === 'visual-smoke-20260629-133000', 'visual-results run_id was not preserved');
    assert(rebuiltVisualResults.scope?.type === 'from-audit', 'visual-results scope was not preserved');
    assert(rebuiltVisualResults.scope?.full_suite_total === 99, 'visual-results full_suite_total was not preserved');
    assert(rebuiltVisualResults.scope?.uncovered_routes?.[0]?.reason === 'no_visual_manifest', 'visual-results uncovered routes were not preserved');
    assert(existsSync(join(root, '_results', 'persona-reports', 'demo', 'index.html')), 'persona report was not generated');

    // ── Unified findings (evidence-first) ──
    assert(existsSync(join(root, '_results', 'findings.json')), 'findings.json was not generated');
    const findings = JSON.parse(readFileSync(join(root, '_results', 'findings.json'), 'utf8'));
    assert(findings.schema_version === '1.0', 'findings: schema_version missing');
    assert(findings.findings.length === 6, `findings: expected 6, got ${findings.findings.length}`);
    assert(findings.findings[0].id === 'SG-001' && findings.findings[0].severity === 'critical', 'findings: not severity-sorted with SG ids');
    const f = findings.findings;
    assert(f.some(x => x.source === 'audit' && x.evidence === 'reasoned' && x.file === 'app.py'), 'findings: audit -> reasoned');
    assert(f.some(x => x.source === 'process' && x.evidence === 'measured'), 'findings: process w/ measured action -> measured');
    assert(f.some(x => x.source === 'browser' && x.evidence === 'measured' && x.title.includes('FAIL')), 'findings: visual FAIL -> measured');
    assert(f.some(x => x.source === 'browser' && x.title === 'Browser console error'), 'findings: browser_errors surfaced');
    assert(f.some(x => x.source === 'crawler' && x.evidence === 'measured' && x.severity === 'high'), 'findings: crawler -> measured/high');
    assert(f.some(x => x.source === 'human' && x.evidence === 'manual'), 'findings: annotation -> manual');
    assert(findings.summary.by_evidence.measured >= 4, 'findings: evidence tally wrong');

    const builtHtml = readFileSync(join(root, '_results', 'review.html'), 'utf8');
    assert(!builtHtml.includes('__PLACEHOLDER_FINDINGS_DATA__'), 'template: findings placeholder not replaced');
    assert(!builtHtml.includes('__PLACEHOLDER_RUN_DATA__'), 'template: run placeholder not replaced');
    assert(builtHtml.includes('"laneAvailability"'), 'data: laneAvailability not injected');
    assert(builtHtml.includes('id="main-tab-findings"'), 'template: Findings tab button missing');
    assert(builtHtml.includes('renderFindingsTab'), 'template: findings renderer missing');
    assert(builtHtml.includes('DEFAULT_TAB_ORDER'), 'template: dynamic default tab logic missing');
    assert(builtHtml.includes('id="lane-chips"'), 'template: lane chips container missing');

    // ── Config v2 parse safety: app+profiles blocks must not break the builder ──
    writeFileSync(join(root, '_config.yaml'), [
      'version: 2',
      'base_url: http://127.0.0.1:8001',
      'credentials:',
      '  username: "u"',
      '  password: "p"',
      'app:',
      '  type: static-site',
      '  root: docs',
      '  start: "python3 -m http.server {port} --bind 127.0.0.1"',
      '  healthcheck: "/index.html"',
      'profiles:',
      '  site-accessible:',
      '    scope: "site-accessible"',
      '    checks:',
      '      - page-load',
      '      - local-assets',
      '',
    ].join('\n'), 'utf8');
    execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
    assert(existsSync(join(root, '_results', 'review.html')), 'config v2: builder failed on app+profiles blocks');

    port = options.port || DEFAULT_PORT_BASE + Math.floor(Math.random() * 10000);
    console.error(`review smoke test: fixture=${root} port=${port}`);
    server = spawn(process.execPath, ['build-review.mjs', '--serve', `--port=${port}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    log = createProcessLog(server);
    await waitForServer(port);
    const review = await request(port, 'GET', '/review.html');
    assert(review.status === 200, 'review.html was not served');
    assert(review.body.includes('recorded-login.yaml'), 'recorded manifest was not embedded in review.html');
    assert((await request(port, 'GET', '/audit-results.json')).status === 200, 'audit-results.json was not served');
    assert((await request(port, 'GET', '/visual-results.json')).status === 200, 'visual-results.json was not served');
    assert((await request(port, 'GET', '/persona-reports/demo/index.html')).status === 200, 'persona report was not served');

    const save = await request(port, 'POST', '/save-manifest', { action: 'validate-and-fix', tests: [] });
    assert(save.status === 200, 'POST /save-manifest failed');
    assert(existsSync(join(root, '_results', 'fix-manifest.json')), 'fix-manifest.json was not written');

    assert((await request(port, 'GET', '/..%2Fsecret.txt')).status === 403, 'encoded path traversal was not rejected');
    passed = true;
    console.log('review smoke test passed');
    if (options.debug) console.error(log.tail());
  } catch (error) {
    throw new Error(formatFailure(error, root, port, log));
  } finally {
    if (server) server.kill('SIGTERM');
    if (root && passed && !options.keepTmp && !options.debug) {
      rmSync(root, { recursive: true, force: true });
    } else if (root) {
      console.error(`review smoke test fixture kept: ${root}`);
    }
  }
}

main().catch(error => {
  console.error(`review smoke test failed: ${error.message}`);
  process.exit(1);
});
