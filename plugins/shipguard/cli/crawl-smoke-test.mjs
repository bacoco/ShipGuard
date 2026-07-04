#!/usr/bin/env node
// crawl-smoke-test.mjs — extractAssets pure tests + end-to-end crawl on a fixture site
import { extractAssets, crawl, EXIT } from './shipguard.mjs';
import { spawn } from 'child_process';

// async subprocess runner — execFileSync would block the event loop and
// deadlock the in-process fixture HTTP server the CLI needs to reach
function runCli(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('node', args, { cwd, stdio: 'ignore' });
    child.on('close', (code) => resolve(code));
  });
}
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'shipguard.mjs');
let fails = 0;
const assert = (c, l) => { if (c) console.log(`  PASS ${l}`); else { console.error(`  FAIL ${l}`); fails++; } };

// ── extractAssets ──
const assets = extractAssets(`
  <img src="/img/ok.png"><img src="missing.png">
  <script src="app.js"></script>
  <link rel="stylesheet" href="style.css">
  <video poster="poster.jpg"><source src="clip.mp4"></video>
  <a href="page2.html">next</a>
  <a href="https://example.com/ext">ext</a>
  <a href="mailto:x@y.z">mail</a>
  <a href="#anchor">anchor</a>
`, 'http://127.0.0.1:9999/site/index.html');
const urls = assets.map((a) => a.url);
assert(urls.includes('http://127.0.0.1:9999/img/ok.png'), 'extract: root-relative src');
assert(urls.includes('http://127.0.0.1:9999/site/missing.png'), 'extract: relative src');
assert(urls.includes('http://127.0.0.1:9999/site/clip.mp4'), 'extract: <source src>');
assert(urls.includes('http://127.0.0.1:9999/site/page2.html'), 'extract: local <a href>');
assert(!urls.some((u) => u.includes('example.com')), 'extract: cross-origin skipped');
assert(!urls.some((u) => u.startsWith('mailto:')), 'extract: mailto skipped');
assert(assets.find((a) => a.url.endsWith('clip.mp4')).tag === 'source', 'extract: tag recorded');

// ── fixture site: index links page2; page2 has one broken img ──
const site = mkdtempSync(join(tmpdir(), 'sg-site-'));
writeFileSync(join(site, 'index.html'), '<html><a href="page2.html">p2</a><img src="ok.png"></html>');
writeFileSync(join(site, 'page2.html'), '<html><img src="ghost.png"></html>');
writeFileSync(join(site, 'ok.png'), 'x');
const server = http.createServer((req, res) => {
  const f = join(site, req.url === '/' ? 'index.html' : req.url.slice(1));
  try {
    const body = readFileSync(f);
    if (f.endsWith('.html') || req.url === '/') res.setHeader('content-type', 'text/html');
    res.end(body);
  } catch { res.statusCode = 404; res.end('nope'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const result = await crawl(base);
assert(result.pages >= 2, 'crawl: followed local link to page2');
assert(result.broken.length === 1 && result.broken[0].url.endsWith('/ghost.png') && result.broken[0].status === 404,
  'crawl: broken img found with status 404');
assert(result.broken[0].found_on.endsWith('/page2.html'), 'crawl: found_on recorded');

// ── cmdCrawl subprocess: writes artifact, exits 1 on findings ──
const proj = mkdtempSync(join(tmpdir(), 'sg-crawlproj-'));
mkdirSync(join(proj, 'visual-tests'), { recursive: true });
writeFileSync(join(proj, 'visual-tests', '_config.yaml'), `base_url: "${base}"\n`);
const code = await runCli([CLI, 'crawl'], proj);
assert(code === EXIT.FINDINGS, 'cmdCrawl: broken asset -> exit 1');
const artifact = JSON.parse(readFileSync(join(proj, 'visual-tests', '_results', 'crawl-results.json'), 'utf8'));
assert(artifact.schema_version === '1.0' && artifact.broken.length === 1, 'cmdCrawl: artifact written');

// ── unreachable base_url -> exit 2 ──
const proj2 = mkdtempSync(join(tmpdir(), 'sg-crawlproj2-'));
mkdirSync(join(proj2, 'visual-tests'), { recursive: true });
writeFileSync(join(proj2, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:1"\n');
const code2 = await runCli([CLI, 'crawl'], proj2);
assert(code2 === EXIT.INFRA, 'cmdCrawl: unreachable base_url -> exit 2');

server.close();
console.log(fails === 0 ? 'crawl-smoke-test: ALL PASS' : `crawl-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
