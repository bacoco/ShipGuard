#!/usr/bin/env node
// crawl-smoke-test.mjs — extractAssets pure tests + end-to-end crawl on a fixture site
import { extractAssets, crawl, isFollowablePage, resolveMaxPages, DEFAULT_MAX_PAGES, EXIT } from './shipguard.mjs';
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

// multiple URL attributes on ONE tag must all be captured
const multi = extractAssets('<video src="clip.mp4" poster="poster.jpg"></video>', 'http://127.0.0.1:9999/');
assert(multi.some((a) => a.url.endsWith('clip.mp4')) && multi.some((a) => a.url.endsWith('poster.jpg')),
  'extract: src AND poster on the same tag');

// clean-URL page-follow rules
assert(isFollowablePage('http://x/page.html') && isFollowablePage('http://x/docs/') && isFollowablePage('http://x/about'),
  'follow: html, directory, clean URL');
assert(!isFollowablePage('http://x/logo.png') && !isFollowablePage('http://x/clip.mp4'),
  'follow: asset extensions excluded');

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

// ── logic-007: reaching the page cap is DECLARED, never silent ──
// A site larger than the cap is not defective, so truncation is a fact in the
// artifact (reason-carrying, like a non-"ran" lane in run.json) and not a
// failure — but it must never be indistinguishable from a complete crawl.
assert(resolveMaxPages({}, {}) === DEFAULT_MAX_PAGES && DEFAULT_MAX_PAGES === 200, 'maxPages: default 200 when unset');
assert(resolveMaxPages({ crawl: { max_pages: 50 } }, {}) === 50, 'maxPages: crawl.max_pages honoured');
assert(resolveMaxPages({ crawl: { max_pages: 50 } }, { 'max-pages': '7' }) === 7, 'maxPages: --max-pages overrides config');
assert(resolveMaxPages({ crawl: { max_pages: 'nope' } }, {}) === DEFAULT_MAX_PAGES, 'maxPages: junk falls back to the default');
assert(resolveMaxPages({}, { 'max-pages': true }) === DEFAULT_MAX_PAGES, 'maxPages: valueless --max-pages does not silently cap at 1');

const bounded = await crawl(base, { maxPages: 1 });
assert(!!bounded.truncated, 'crawl: cap reached -> truncated declared');
assert(bounded.truncated && bounded.truncated.max_pages === 1 && bounded.truncated.queued_unvisited >= 1,
  'crawl: truncation names the cap and the unvisited count');
assert(bounded.truncated && typeof bounded.truncated.reason === 'string' && bounded.truncated.reason.length > 0,
  'crawl: truncation carries a reason (run.json non-ran-lane motif)');
assert(result.truncated === undefined, 'crawl: complete crawl carries NO truncated field');

// cmdCrawl end to end: capped run declares truncation and stays exit 0 (nothing
// broken was observed); raising the cap un-truncates it and finds the real bug.
const projT = mkdtempSync(join(tmpdir(), 'sg-crawltrunc-'));
mkdirSync(join(projT, 'visual-tests'), { recursive: true });
writeFileSync(join(projT, 'visual-tests', '_config.yaml'), `base_url: "${base}"\ncrawl:\n  max_pages: 1\n`);
const codeT = await runCli([CLI, 'crawl'], projT);
const artT = JSON.parse(readFileSync(join(projT, 'visual-tests', '_results', 'crawl-results.json'), 'utf8'));
assert(!!artT.truncated && artT.truncated.max_pages === 1, 'cmdCrawl: truncation written to crawl-results.json');
// The crawler declares the gap; the exit aggregation decides what it costs.
// A crawl bounded below the site never covered the site, and "incomplete is
// never clean" — so not 0. Not 2 either: re-running an unchanged truncated
// crawl stops at exactly the same page, and 2's whole sentence is "retry".
// 3 is the code whose sentence is "fix a declared file", which is the only
// thing that can actually widen the coverage.
assert(codeT === EXIT.CONFIG, 'cmdCrawl: a crawl bounded below the site -> exit 3, never a clean 0');
const codeT2 = await runCli([CLI, 'crawl', '--max-pages=10'], projT);
const artT2 = JSON.parse(readFileSync(join(projT, 'visual-tests', '_results', 'crawl-results.json'), 'utf8'));
assert(artT2.truncated === undefined, 'cmdCrawl: raising the cap clears the truncation (no permanent red)');
assert(codeT2 === EXIT.FINDINGS, 'cmdCrawl: the page beyond the old cap yields its real finding');

// ── logic-008: a page that cannot be fetched is a finding, not a crawled page ──
// The asset half of crawl() already treats status 0 as broken; the page half
// discarded it. Fixture: HEAD answers 200, GET drops the connection.
const siteD = mkdtempSync(join(tmpdir(), 'sg-deadsite-'));
writeFileSync(join(siteD, 'index.html'), '<html><a href="dead.html">d</a></html>');
const serverD = http.createServer((req, res) => {
  if (req.url.startsWith('/dead')) {
    if (req.method === 'HEAD') { res.setHeader('content-type', 'text/html'); return res.end(); }
    return req.socket.destroy();
  }
  try {
    const body = readFileSync(join(siteD, req.url === '/' ? 'index.html' : req.url.slice(1)));
    res.setHeader('content-type', 'text/html');
    res.end(body);
  } catch { res.statusCode = 404; res.end('nope'); }
});
await new Promise((r) => serverD.listen(0, '127.0.0.1', r));
const baseD = `http://127.0.0.1:${serverD.address().port}/`;
const dead = await crawl(baseD);
const deadEntry = dead.broken.find((b) => b.url.endsWith('/dead.html'));
assert(!!deadEntry && deadEntry.status === 0 && deadEntry.tag === 'page', 'crawl: unfetchable page -> broken status 0, tag page');
assert(dead.pages === 1, 'crawl: unfetchable page is not counted as crawled');

const projD = mkdtempSync(join(tmpdir(), 'sg-deadproj-'));
mkdirSync(join(projD, 'visual-tests'), { recursive: true });
writeFileSync(join(projD, 'visual-tests', '_config.yaml'), `base_url: "${baseD}"\n`);
const codeD = await runCli([CLI, 'crawl'], projD);
assert(codeD === EXIT.FINDINGS, 'cmdCrawl: unfetchable page -> exit 1 (same rule as a status-0 asset)');
serverD.close();

server.close();
console.log(fails === 0 ? 'crawl-smoke-test: ALL PASS' : `crawl-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
