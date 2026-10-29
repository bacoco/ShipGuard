#!/usr/bin/env node
// crawl-smoke-test.mjs — extractAssets pure tests + end-to-end crawl on a fixture site
import { extractAssets, crawl, isFollowablePage, resolveMaxPages, DEFAULT_MAX_PAGES, resolveResourceBudget, DEFAULT_RESOURCE_BUDGET_MS, RESOURCE_CONCURRENCY, EXIT } from './shipguard.mjs';
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

const attrCases = extractAssets('<img src=/unquoted.png><a href="/search?q=1&amp;page=2">next</a><img src="/&#105;mage.png">', 'http://example.test/');
assert(attrCases.some(a => a.url.endsWith('/unquoted.png')) && attrCases.some(a => a.url.endsWith('/image.png'))
  && attrCases.some(a => a.url.endsWith('/search?q=1&page=2')), 'r1-z01-013: unquoted URLs and HTML entities decode before resolution');

// clean-URL page-follow rules
assert(isFollowablePage('http://x/page.html') && isFollowablePage('http://x/docs/') && isFollowablePage('http://x/about'),
  'follow: html, directory, clean URL');
assert(!isFollowablePage('http://x/logo.png') && !isFollowablePage('http://x/clip.mp4'),
  'follow: asset extensions excluded');

// ── #197: simulated slow resources, including HEAD -> GET fallback ──
assert(resolveResourceBudget({}) === 30000 && DEFAULT_RESOURCE_BUDGET_MS === 30000,
  'resource budget: default 30 seconds');
assert(resolveResourceBudget({ crawl: { resource_budget_ms: 80 } }) === 80,
  'resource budget: config honoured');
assert([true, 0, -1, 'nope'].every((n) => resolveResourceBudget({ crawl: { resource_budget_ms: n } }) === DEFAULT_RESOURCE_BUDGET_MS),
  'resource budget: invalid declarations retain the default');
const realFetch = globalThis.fetch;
const slowBase = 'http://slow.test/';
let mode = 'complete';
let active = 0;
let peak = 0;
let requests = [];
globalThis.fetch = async (url, { method = 'GET', signal } = {}) => {
  signal?.throwIfAborted();
  const path = new URL(url).pathname;
  requests.push(`${method} ${path}`);
  const html = mode === 'complete'
    ? (path === '/' ? '<img src="a.png"><script src="a.png"></script><img src="b.png"><img src="c.png"><img src="d.png"><img src="e.png"><a href="next.html">next</a>' : '<img src="a.png"><img src="fallback.png"><img src="fallback501.png">')
    : mode === 'cumulative'
      ? (path === '/' ? '<img src="first.png"><a href="next.html">next</a>' : '<img src="second.png">')
      : '<img src="broken.png">' + Array.from({ length: 100 }, (_, i) => `<img src="slow${i}.png">`).join('') + '<a href="next.html">next</a>';
  if (path === '/' || path === '/next.html') return new Response(method === 'GET' ? html : null, { headers: { 'content-type': 'text/html' } });
  active++;
  peak = Math.max(peak, active);
  const delay = mode === 'complete' ? (path === '/a.png' ? 30 : 5)
    : mode === 'cumulative' ? 150
      : path === '/broken.png' ? 1 : 1000;
  try {
    await new Promise((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, delay);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const status = method === 'HEAD' && path.startsWith('/fallback') ? (path === '/fallback501.png' ? 501 : 405)
      : ['/a.png', '/b.png', '/broken.png'].includes(path) ? 404 : 200;
    return new Response(null, { status });
  } finally { active--; }
};
try {
  const complete = await crawl(slowBase);
  assert(peak === RESOURCE_CONCURRENCY && peak === 4 && active === 0,
    'resource concurrency: checks overlap without exceeding four requests');
  assert(complete.pages === 2 && complete.assets_checked === 8 && !complete.truncated
    && JSON.stringify(complete.broken) === JSON.stringify([
      { url: `${slowBase}a.png`, status: 404, found_on: slowBase, tag: 'img' },
      { url: `${slowBase}b.png`, status: 404, found_on: slowBase, tag: 'img' },
      { url: `${slowBase}a.png`, status: 404, found_on: `${slowBase}next.html`, tag: 'img' },
    ]), 'resource concurrency: completion order preserves findings, tags and source pages');
  assert(requests.filter((r) => r === 'HEAD /a.png').length === 1
    && requests.includes('GET /fallback.png') && requests.includes('GET /fallback501.png'),
    'resource concurrency: URL deduplication and HEAD 405/501 fallback preserved');

  mode = 'cumulative'; requests = []; peak = 0;
  const cumulative = await crawl(slowBase, { resourceBudgetMs: 250 });
  assert(cumulative.pages === 2 && cumulative.assets_checked === 2 && cumulative.broken.length === 0
    && cumulative.truncated?.resources_unchecked === 1 && active === 0,
    'resource budget: shared across pages, not reset for each resource batch');

  mode = 'exhausted'; requests = []; peak = 0;
  const started = performance.now();
  const exhausted = await crawl(slowBase, { resourceBudgetMs: 100 });
  assert(performance.now() - started < 800 && requests.length < 10 && peak <= 4 && active === 0,
    'resource budget: aborts in-flight work and stops launching queued slow requests');
  assert(exhausted.assets_checked === 1 && exhausted.broken.length === 1 && exhausted.broken[0].status === 404
    && exhausted.truncated?.resources_unchecked === 101 && exhausted.truncated.queued_unvisited === 1
    && exhausted.truncated.resource_budget_ms === 100 && exhausted.truncated.reason.includes('coverage is partial'),
    'resource budget: retains measured failures and declares unchecked resources/pages without fake status-0 failures');

  // Expiration also covers the GET fallback, without counting its HEAD as a completed check.
  mode = 'complete'; requests = [];
  const fallback = await crawl(`${slowBase}next.html`, { resourceBudgetMs: 8 });
  assert(fallback.truncated?.resources_unchecked > 0 && active === 0
    && requests.includes('GET /fallback.png') && !fallback.broken.some((b) => b.status === 0),
    'resource budget: GET fallback shares the deadline and cancellation is not a finding');
} finally { globalThis.fetch = realFetch; }

// Both CLI entry points persist incomplete coverage and return declaration exit 3.
const budgetServer = http.createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('content-type', 'text/html');
    return res.end('<img src="slow.png">');
  }
  if (req.method === 'HEAD') { res.statusCode = 405; return res.end(); }
  const timer = setTimeout(() => res.end('slow'), 1000);
  res.once('close', () => clearTimeout(timer));
});
await new Promise((r) => budgetServer.listen(0, '127.0.0.1', r));
const budgetRoot = mkdtempSync(join(tmpdir(), 'sg-resource-budget-'));
mkdirSync(join(budgetRoot, 'visual-tests'), { recursive: true });
writeFileSync(join(budgetRoot, 'visual-tests', '_config.yaml'), `base_url: "http://127.0.0.1:${budgetServer.address().port}/"\ncrawl:\n  resource_budget_ms: 80\nprofiles:\n  resources:\n    checks: [local-assets]\n`);
writeFileSync(join(budgetRoot, 'visual-tests', 'build-review.mjs'), 'process.exit(0);');
try {
  const budgetCode = await runCli([CLI, 'crawl'], budgetRoot);
  const budgetArtifact = JSON.parse(readFileSync(join(budgetRoot, 'visual-tests', '_results', 'crawl-results.json'), 'utf8'));
  assert(budgetCode === EXIT.CONFIG && budgetArtifact.assets_checked === 0 && budgetArtifact.broken.length === 0
    && budgetArtifact.truncated?.resource_budget_ms === 80 && budgetArtifact.truncated.resources_unchecked === 1,
    'cmdCrawl: resource budget config reaches the artifact and incomplete coverage never exits clean');
  const budgetRunCode = await runCli([CLI, 'run', '--profile=resources'], budgetRoot);
  const budgetRun = JSON.parse(readFileSync(join(budgetRoot, 'visual-tests', '_results', 'run.json'), 'utf8'));
  assert(budgetRunCode === EXIT.CONFIG && budgetRun.lanes.crawl.truncated?.resources_unchecked === 1
    && budgetRun.lanes.crawl.remedy === 'declaration',
    'cmdRun: resource exhaustion reaches the crawl lane and exit aggregation');
} finally { budgetServer.closeAllConnections(); budgetServer.close(); }

// Redirected HTML resolves relative assets against the final response URL.
const redirectServer = http.createServer((req, res) => {
  if (req.url === '/docs') { res.writeHead(302, { location: '/docs/' }); return res.end(); }
  res.setHeader('content-type', 'text/html');
  if (req.url === '/docs/') return res.end('<a href="guide.html">Guide</a>');
  if (req.url === '/docs/guide.html') return res.end('<p>Guide</p>');
  res.statusCode = 404; res.end('missing');
});
await new Promise(r => redirectServer.listen(0, '127.0.0.1', r));
const redirected = await crawl(`http://127.0.0.1:${redirectServer.address().port}/docs`);
assert(redirected.pages === 2 && redirected.broken.length === 0, 'r1-z01-012: redirected page keeps its directory when resolving links');
redirectServer.close();

// A failed collection after the initial health probe must dominate a passing visual lane.
const collectionRoot = mkdtempSync(join(tmpdir(), 'sg-collect-error-'));
mkdirSync(join(collectionRoot, 'visual-tests', 'pages'), { recursive: true });
let collectionGets = 0;
const collectionServer = http.createServer((req, res) => {
  if (++collectionGets > 1) return req.socket.destroy();
  res.setHeader('content-type', 'text/html'); res.end('<p>ok</p>');
});
await new Promise(r => collectionServer.listen(0, '127.0.0.1', r));
writeFileSync(join(collectionRoot, 'visual-tests', '_config.yaml'), `base_url: "http://127.0.0.1:${collectionServer.address().port}"\nprofiles:\n  test:\n    checks: [page-load, local-assets]\n`);
writeFileSync(join(collectionRoot, 'visual-tests', 'pages', 'ok.yaml'), 'steps:\n  - action: wait\n    duration: 0ms\n');
writeFileSync(join(collectionRoot, 'visual-tests', 'build-review.mjs'), 'process.exit(0);');
const collectionBin = join(collectionRoot, 'browser');
writeFileSync(collectionBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const savedCollectionBin = process.env.SHIPGUARD_AGENT_BROWSER;
process.env.SHIPGUARD_AGENT_BROWSER = collectionBin;
const collectionCode = await runCli([CLI, 'run', '--profile=test'], collectionRoot);
if (savedCollectionBin === undefined) delete process.env.SHIPGUARD_AGENT_BROWSER;
else process.env.SHIPGUARD_AGENT_BROWSER = savedCollectionBin;
const collectionRun = JSON.parse(readFileSync(join(collectionRoot, 'visual-tests', '_results', 'run.json'), 'utf8'));
assert(collectionCode === EXIT.INFRA && collectionRun.lanes.crawl.remedy === 'infrastructure',
  'r1-z01-001: collection error stays infrastructure even beside a passing visual lane');
collectionServer.close();

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

// ── #117: a linked HTTP error is neither a second finding nor a crawled page ──
writeFileSync(join(site, 'missing-link.html'), '<html><a href="absent.html">missing</a></html>');
const missingBase = `${base}missing-link.html`;
const missing = await crawl(missingBase);
const expectedMissing = [{ url: `${base}absent.html`, status: 404, found_on: missingBase, tag: 'a' }];
assert(missing.pages === 1, 'crawl: linked HTTP 404 is not counted as crawled');
assert(missing.assets_checked === 1 && JSON.stringify(missing.broken) === JSON.stringify(expectedMissing),
  'crawl: linked HTTP 404 has one finding with the original link provenance');

const projH = mkdtempSync(join(tmpdir(), 'sg-http404-'));
mkdirSync(join(projH, 'visual-tests'), { recursive: true });
writeFileSync(join(projH, 'visual-tests', '_config.yaml'), `base_url: "${missingBase}"\n`);
const codeH = await runCli([CLI, 'crawl'], projH);
const artH = JSON.parse(readFileSync(join(projH, 'visual-tests', '_results', 'crawl-results.json'), 'utf8'));
assert(codeH === EXIT.FINDINGS, 'cmdCrawl: linked HTTP 404 still exits 1');
assert(artH.schema_version === '1.0' && artH.pages === 1 && JSON.stringify(artH.broken) === JSON.stringify(expectedMissing),
  'cmdCrawl: HTTP 404 artifact preserves schema, count and a single finding');

writeFileSync(join(site, 'two-sources.html'), '<html><a href="absent.html">missing</a><a href="missing-link.html">other source</a></html>');
const shared = await crawl(`${base}two-sources.html`);
assert(shared.pages === 2 && shared.broken.length === 2
  && shared.broken.every((b) => b.tag === 'a' && b.url === `${base}absent.html`)
  && new Set(shared.broken.map((b) => b.found_on)).size === 2,
  'crawl: a shared HTTP 404 retains both source pages without a page duplicate');
const missingRoot = await crawl(`${base}absent.html`);
assert(missingRoot.pages === 0 && missingRoot.broken.length === 1 && missingRoot.broken[0].tag === 'page',
  'crawl: HTTP 404 at base_url remains a finding, not a crawled page');
writeFileSync(join(site, 'missing-frame.html'), '<html><iframe src="absent.html"></iframe></html>');
const frame = await crawl(`${base}missing-frame.html`);
assert(frame.pages === 1 && frame.broken.length === 1 && frame.broken[0].tag === 'iframe',
  'crawl: linked iframe HTTP 404 preserves its original finding only');

// HEAD and GET can disagree: retain the visit and any distinct GET failure.
let headStatus = 200;
let getStatus = 404;
const serverH = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url === '/') return res.end('<html><a href="method.html">next</a></html>');
  if (req.url === '/method.html') {
    res.statusCode = req.method === 'HEAD' ? headStatus : getStatus;
    return res.end('<html><a href="leaf.html">leaf</a></html>');
  }
  res.end('<html>leaf</html>');
});
await new Promise((r) => serverH.listen(0, '127.0.0.1', r));
const baseH = `http://127.0.0.1:${serverH.address().port}/`;
const getMissing = await crawl(baseH);
assert(getMissing.pages === 1 && getMissing.broken.length === 1
  && getMissing.broken[0].status === 404 && getMissing.broken[0].tag === 'page',
  'crawl: GET-only HTTP failure is still reported and excluded from coverage');
headStatus = 404;
getStatus = 200;
const headMissing = await crawl(baseH);
assert(headMissing.pages === 3 && headMissing.broken.length === 1 && headMissing.broken[0].tag === 'a',
  'crawl: failed HEAD does not prevent a successful GET or following its links');
getStatus = 500;
const differentFailure = await crawl(baseH);
assert(differentFailure.pages === 1 && differentFailure.broken.length === 2
  && differentFailure.broken.some((b) => b.status === 500 && b.tag === 'page'),
  'crawl: a distinct GET failure is not hidden by the HEAD finding');
serverH.close();

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

// cmdCrawl end to end: capped run declares truncation and returns exit 3 (incomplete
// evidence); raising the cap un-truncates it and finds the real bug.
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
