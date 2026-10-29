#!/usr/bin/env node
// A successful HTML build followed by a refused review start is infrastructure,
// while the product results stay intact. No persistent review server is started.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { EXIT } from './shipguard.mjs';

const exec = promisify(execFile);
const cli = join(import.meta.dirname, 'shipguard.mjs');
const app = createServer((request, response) => response.end('<html>Ok</html>'));
await new Promise((resolve, reject) => {
  app.once('error', reject);
  app.listen(0, '127.0.0.1', resolve);
});

try {
  for (const status of ['PASS', 'FAIL']) {
    const root = mkdtempSync(join(tmpdir(), 'sg-review-serve-'));
    const tests = join(root, 'visual-tests');
    const results = join(tests, '_results');
    mkdirSync(join(tests, 'pages'), { recursive: true });
    writeFileSync(join(tests, '_config.yaml'), `version: 2
base_url: "http://127.0.0.1:${app.address().port}"
profiles:
  smoke:
    checks: [page-load]
`);
    writeFileSync(join(tests, 'pages', 'ok.yaml'), `name: "Product assertion"
steps:
  - action: open
    url: "{base_url}/"
  - action: assert_text
    text: "${status === 'PASS' ? 'Ok' : 'Never present'}"
`);
    const browser = join(root, 'fake-agent-browser');
    writeFileSync(browser, '#!/bin/sh\nif [ "$1" = snapshot ]; then printf \'%s\\n\' \'- heading "Ok" @e1\'; fi\nexit 0\n');
    chmodSync(browser, 0o755);
    writeFileSync(join(tests, 'build-review.mjs'), `
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const results = join(import.meta.dirname, '_results');
if (process.argv.includes('--serve')) {
  writeFileSync(join(results, 'serve-refused'), 'refused');
  process.exit(7);
}
copyFileSync(join(results, 'visual-results.json'), join(results, 'product-before-serve.json'));
writeFileSync(join(results, 'review.html'), '<!doctype html><title>Review fixture</title>');
`);

    let code = EXIT.CLEAN;
    let stderr = '';
    try {
      const outcome = await exec(process.execPath, [cli, 'run', '--profile=smoke', '--no-crawl', '--serve'], {
        cwd: root, timeout: 20000,
        env: { ...process.env, SHIPGUARD_AGENT_BROWSER: browser },
      });
      stderr = outcome.stderr;
    } catch (error) {
      if (!Number.isInteger(error.code)) throw error;
      code = error.code;
      stderr = error.stderr;
    }

    const load = name => JSON.parse(readFileSync(join(results, name), 'utf8'));
    const run = load('run.json');
    const visual = load('visual-results.json');
    assert.ok(existsSync(join(results, 'review.html')), 'HTML build succeeded');
    assert.ok(existsSync(join(results, 'serve-refused')), 'review start was attempted and refused');
    assert.match(stderr, /review server did not come up/);
    assert.equal(code, EXIT.INFRA, 'CLI propagates review startup failure as infrastructure');
    assert.equal(run.exit_code, EXIT.INFRA, 'run.json agrees with the CLI exit code');
    assert.equal(run.lanes.review.status, 'error');
    assert.equal(run.lanes.review.remedy, 'infrastructure');
    assert.match(run.lanes.review.reason, /review server did not come up/);
    assert.equal(run.lanes.review.results, 'review.html', 'the built artifact remains declared');
    assert.equal(run.lanes.visual.status, 'ran', 'product evaluation stays completed');
    assert.equal(visual.tests[0].status, status, 'the product verdict is preserved');
    assert.equal(visual.summary.error, 0, 'review infrastructure is not a product error');
    assert.deepEqual(visual, load('product-before-serve.json'), 'product results are unchanged after review failure');
    console.log(`  PASS review start refusal: exit 2, review error, product ${status} unchanged`);
  }
} finally {
  await new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
}

console.log('review-serve-smoke-test: ALL PASS');
