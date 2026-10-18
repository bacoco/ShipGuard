#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main, parseArgs } from './adapter.mjs';
import { fixture } from './fixture.mjs';
import { digest, evidencePath } from './artifacts.mjs';
const root = mkdtempSync(join(tmpdir(), 'sg-e2e-'));
let count = 0;
async function check(name, fn) { await fn(); console.log(`ok ${++count} - ${name}`); }
function project(name) { const p = join(root, name); mkdirSync(p); return p; }
function save(p, d = fixture()) {
  mkdirSync(join(p, '.e2e'), { recursive: true });
  const file = join(p, '.e2e', 'report.json'); writeFileSync(file, JSON.stringify(d)); return file;
}
const runImport = (p, file) => main(['import', '--project', p, '--report', file]);
function read(bundle, file) { return JSON.parse(readFileSync(join(bundle, file), 'utf8')); }
function addImage(doc, p, changes = {}) {
  const bytes = Buffer.from('synthetic bytes; not a real screenshot');
  mkdirSync(join(p, '.e2e', 'results'), { recursive: true });
  writeFileSync(join(p, '.e2e', 'results', 'image.png'), bytes);
  doc.run.results[0].attempts[0].artifacts.push({ id: 'shot', kind: 'screenshot', mediaType: 'image/png',
    path: 'results/image.png', size: bytes.length, sha256: digest(bytes), redaction: 'complete',
    producer: { kind: 'attempt' }, ...changes });
  return bytes;
}
try {
  await check('fresh import preserves source, never writes canonical visual status', async () => {
    const p = project('import'); const file = save(p);
    mkdirSync(join(p, 'visual-tests', '_results'), { recursive: true });
    const canonical = join(p, 'visual-tests', '_results', 'visual-results.json'); writeFileSync(canonical, 'untouched');
    const r = await runImport(p, file); assert.equal(r.exitCode, 0);
    assert.equal(readFileSync(canonical, 'utf8'), 'untouched');
    assert.equal(read(r.bundle, 'adapter-run.json').ship_ready, false);
    assert.equal(read(r.bundle, 'e2e-results.json').tests[0].screenshot_evidence, 'unavailable');
    assert.equal(readFileSync(join(r.bundle, 'source-report.json'), 'utf8'), readFileSync(file, 'utf8'));
    const r2 = await runImport(p, file); assert.notEqual(r.bundle, r2.bundle);
    if (process.platform !== 'win32') assert.equal(statSync(join(r.bundle, 'source-report.json')).mode & 0o777, 0o600);
  });
  await check('integrity-checked bytes stay opaque and unreviewed', async () => {
    const p = project('image'); const doc = fixture(); const bytes = addImage(doc, p);
    const r = await runImport(p, save(p, doc)); assert.equal(r.exitCode, 0);
    const result = read(r.bundle, 'e2e-results.json'); const a = result.artifacts[0];
    assert.equal(a.state, 'copied'); assert.ok(a.local_file.endsWith('.bin'));
    assert.deepEqual(readFileSync(join(r.bundle, a.local_file)), bytes);
    assert.equal(result.tests[0].screenshot, null); assert.equal(result.tests[0].visual_review, 'not-performed');
  });
  await check('hash mismatch is infra, not a clean import', async () => {
    const p = project('hash'); const doc = fixture(); addImage(doc, p, { sha256: '0'.repeat(64) });
    const r = await runImport(p, save(p, doc)); assert.equal(r.exitCode, 2);
  });
  await check('missing file is infra', async () => {
    const p = project('missing'); const doc = fixture(); addImage(doc, p); rmSync(join(p, '.e2e', 'results', 'image.png'));
    assert.equal((await runImport(p, save(p, doc))).exitCode, 2);
  });
  await check('incomplete redaction is neither copied nor reviewed', async () => {
    const p = project('withheld'); const doc = fixture(); addImage(doc, p, { redaction: 'incomplete' });
    const r = await runImport(p, save(p, doc)); const a = read(r.bundle, 'e2e-results.json').artifacts[0];
    assert.equal(a.local_file, null); assert.equal(a.reason, 'redaction-incomplete');
  });
  await check('path traversal never reads outside evidence root', async () => {
    const p = project('traversal'); const doc = fixture(); addImage(doc, p, { path: '../secret.txt' });
    writeFileSync(join(p, 'secret.txt'), 'do-not-copy');
    const r = await runImport(p, save(p, doc)); assert.equal(r.exitCode, 2);
    assert.equal(read(r.bundle, 'e2e-results.json').artifacts[0].local_file, null);
  });
  await check('absolute, URL and Windows paths are refused', () => {
    for (const name of ['/etc/passwd', 'https://example.test/x', 'C:\\secret', 'a/../b', 'a//b'])
      assert.throws(() => evidencePath(root, name));
  });
  if (process.platform !== 'win32') {
    await check('artifact symlink is not followed', async () => {
      const p = project('symlink'); const doc = fixture(); addImage(doc, p);
      rmSync(join(p, '.e2e', 'results', 'image.png'));
      writeFileSync(join(p, 'private'), 'hidden'); symlinkSync(join(p, 'private'), join(p, '.e2e', 'results', 'image.png'));
      const r = await runImport(p, save(p, doc)); assert.equal(r.exitCode, 2);
    });
    await check('output symlink is refused without touching destination', async () => {
      const p = project('outlink'); const dest = project('outside'); symlinkSync(dest, join(p, 'visual-tests'));
      const r = await runImport(p, save(p)); assert.equal(r.exitCode, 3); assert.equal(r.error, 'UNSAFE_OUTPUT');
      assert.equal(existsSync(join(dest, '_results')), false);
    });
  }
  await check('malformed and missing reports cannot pass', async () => {
    const p = project('bad'); const file = save(p); writeFileSync(file, '{');
    assert.equal((await runImport(p, file)).exitCode, 3);
    assert.equal((await runImport(p, join(p, 'absent'))).exitCode, 2);
  });
  await check('unknown flags and widening empty scope are refused', () => {
    assert.throws(() => parseArgs(['run', '--config', 'e2e.config.ts', '--target', 'web']));
    assert.throws(() => parseArgs(['import', '--report', 'x', '--update-snapshots', 'yes']));
    assert.throws(() => parseArgs(['import', '--report', 'x', '--report', 'y']));
  });
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`PASS ${count} adapter checks`);
