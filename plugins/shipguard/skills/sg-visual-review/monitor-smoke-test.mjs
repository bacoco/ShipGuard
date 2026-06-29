#!/usr/bin/env node
/**
 * ShipGuard monitor endpoint smoke test.
 *
 * Starts the review server in an isolated fixture and exercises the audit
 * monitor API: start, agent updates, status, completion, and persistence.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { request as httpRequest } from 'http';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_BUILD = join(SCRIPT_DIR, 'build-review.mjs');
const SOURCE_TEMPLATE = join(SCRIPT_DIR, '_review-template.html');

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {
          // non-JSON response
        }
        resolve({ status: res.statusCode, body: text, json });
      });
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

  const root = mkdtempSync(join(tmpdir(), 'shipguard-monitor-smoke-'));
  copyFileSync(SOURCE_BUILD, join(root, 'build-review.mjs'));
  copyFileSync(SOURCE_TEMPLATE, join(root, '_review-template.html'));
  mkdirSync(join(root, 'pages'), { recursive: true });
  mkdirSync(join(root, '_results'), { recursive: true });
  writeFileSync(join(root, '_config.yaml'), 'base_url: http://127.0.0.1:8001\n', 'utf8');
  writeFileSync(join(root, 'pages', 'root-index.yaml'), [
    'name: Home',
    'steps:',
    '  - action: open',
    '    url: /',
    '',
  ].join('\n'), 'utf8');
  return root;
}

async function main() {
  const root = createFixture();
  const port = 22000 + Math.floor(Math.random() * 10000);
  const server = spawn(process.execPath, ['build-review.mjs', '--serve', `--port=${port}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitForServer(port);
    let res = await request(port, 'POST', '/api/monitor/audit-start', {
      timestamp: '2026-06-29T13:30:00Z',
      round_count: 1,
      zones: [
        { zone_id: 'z1', paths: ['src/a.js'], file_count: 1 },
        { zone_id: 'z2', paths: ['src/b.js'], file_count: 1 },
      ],
    });
    assert(res.status === 200, 'audit-start failed');

    res = await request(port, 'POST', '/api/monitor/agent-update', {
      agent_id: 'z1',
      status: 'completed',
      bugs_found: 1,
      duration_s: 12,
    });
    assert(res.status === 200, 'first agent update failed');

    res = await request(port, 'POST', '/api/monitor/agent-update', {
      agent_id: 'z2',
      status: 'completed',
      bugs_found: 0,
      duration_s: 8,
    });
    assert(res.status === 200, 'second agent update failed');

    res = await request(port, 'GET', '/api/monitor/status');
    assert(res.status === 200, 'status failed');
    assert(res.json?.status === 'running', 'status is not running');
    assert(Object.keys(res.json?.agents || {}).length >= 2, 'expected agent status entries');

    res = await request(port, 'POST', '/api/monitor/audit-complete', {
      timestamp: '2026-06-29T13:31:00Z',
    });
    assert(res.status === 200, 'audit-complete failed');

    res = await request(port, 'GET', '/api/monitor/status');
    assert(res.json?.status === 'completed', 'status is not completed');
    const persisted = JSON.parse(readFileSync(join(root, '_results', 'audit-monitor.json'), 'utf8'));
    assert(persisted.status === 'completed', 'monitor state was not persisted');
    console.log('monitor smoke test passed');
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(`monitor smoke test failed: ${error.message}`);
  process.exit(1);
});
