#!/usr/bin/env node
/**
 * ShipGuard review dashboard smoke test.
 *
 * Runs against the build-review.mjs and _review-template.html files installed
 * next to this script. It creates an isolated visual-tests fixture in /tmp,
 * builds review.html, starts the local review server, and verifies the minimum
 * dashboard data surface.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { request as httpRequest } from 'http';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_BUILD = join(SCRIPT_DIR, 'build-review.mjs');
const SOURCE_TEMPLATE = join(SCRIPT_DIR, '_review-template.html');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
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
    timestamp: '2026-06-29T13:30:00Z',
    base_url: 'http://127.0.0.1:8001',
    summary: { total: 1, pass: 1, fail: 0, error: 0, stale: 0, skipped: 0, duration_ms: 1200 },
    tests: [{ id: 'pages/root-index', manifest: 'visual-tests/pages/root-index.yaml', name: 'Home', url: '/', status: 'PASS', duration_ms: 1200, screenshot: null, failure_reason: null }],
  });
  writeJson(join(root, '_results', 'audit-results.json'), {
    summary: { total_bugs: 0, files_audited: 1, by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, by_category: {} },
    bugs: [],
    impacted_ui_routes: [{ route: '/', severity: 'low', reason: 'Smoke route', bug_count: 0 }],
    agents: [{ id: 'z1', label: 'Zone 1', status: 'completed', files_audited: 1, bugs_found: 0, duration_ms: 10, paths: ['pages/root-index.yaml'] }],
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
  const root = createFixture();
  execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
  assert(existsSync(join(root, '_results', 'review.html')), 'review.html was not generated');
  assert(existsSync(join(root, '_results', 'visual-results.json')), 'visual-results.json was not generated');
  assert(existsSync(join(root, '_results', 'persona-reports', 'demo', 'index.html')), 'persona report was not generated');

  const port = 21000 + Math.floor(Math.random() * 10000);
  const server = spawn(process.execPath, ['build-review.mjs', '--serve', `--port=${port}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
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
    console.log('review smoke test passed');
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(`review smoke test failed: ${error.message}`);
  process.exit(1);
});
