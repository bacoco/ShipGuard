#!/usr/bin/env node
// cli-smoke-test.mjs — pure-function + subprocess tests for shipguard.mjs
import {
  yamlParse, EXIT, validateConfig, resolveProfile, KNOWN_CHECKS,
  tolerantJson, normalizeConsole, validateScreenshot, matchSnapshotRef, buildRunJson,
  loadManifests, MECHANICAL_ACTIONS, AGENT_ACTIONS, executeManifest,
} from './shipguard.mjs';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdtempSync, readFileSync as rf, writeFileSync as wf, existsSync as ex, mkdirSync, symlinkSync, copyFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import zlib from 'zlib';
import { syncBuiltinESMExports } from 'module';
import { actionsToYaml } from '../skills/sg-record/lib/actions-to-yaml.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'shipguard.mjs');
let fails = 0;
function assert(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); }
  else { console.error(`  FAIL ${label}`); fails++; }
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ── yamlParse: config v2 shape ──
const cfg = yamlParse(`
version: 2
base_url: "http://localhost:3000"
credentials:
  username: "u"
  password: "p"
app:
  type: static-site
  root: docs
  start: "python3 -m http.server {port} --bind 127.0.0.1"
  healthcheck: "/index.html"
  startup_timeout_ms: 30000
profiles:
  site-accessible:
    scope: "site-accessible"
    checks:
      - page-load
      - local-assets
  all:
    scope: all
    checks: [page-load, screenshots]
`);
assert(cfg.version === 2, 'yaml: version number');
assert(cfg.credentials.username === 'u', 'yaml: 1-level nesting');
assert(cfg.app.start.includes('{port}'), 'yaml: quoted string with braces');
assert(cfg.app.startup_timeout_ms === 30000, 'yaml: nested number');
assert(cfg.profiles['site-accessible'].scope === 'site-accessible', 'yaml: 2-level nesting');
assert(deepEq(cfg.profiles['site-accessible'].checks, ['page-load', 'local-assets']), 'yaml: nested block list');
assert(deepEq(cfg.profiles.all.checks, ['page-load', 'screenshots']), 'yaml: inline list');

// ── yamlParse: manifest shape (steps list of maps) ──
const man = yamlParse(`
name: "Home page"
priority: high
requires_auth: false
tags: [pages, smoke]
steps:
  - action: open
    url: "{base_url}/index.html"
  - action: llm-check
    criteria: "Page renders"
    screenshot: home.png
`);
assert(man.steps.length === 2, 'yaml: steps list length');
assert(man.steps[0].action === 'open' && man.steps[0].url === '{base_url}/index.html', 'yaml: list-of-maps item 1');
assert(man.steps[1].screenshot === 'home.png', 'yaml: list-of-maps item 2');
assert(man.requires_auth === false, 'yaml: boolean');

// ── sg-record → CLI scalar round-trip (#193) ──
const recordedValues = [
  'Première ligne\nseconde\tcolonne\r\n"cité" # contenu',
  String.raw`C:\notes\draft \n \r \t \x41 \"fin"`,
  Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join('') + '\x7f',
];
const recordedManifest = yamlParse(actionsToYaml(
  recordedValues.map(value => ({ type: 'fill', selector: '#notes', value })),
  { name: 'recorded-escapes', baseUrl: 'http://example.test' }));
assert(deepEq(recordedManifest.steps.filter(step => step.action === 'fill').map(step => step.value), recordedValues),
  'yaml: recorder values round-trip newlines, tabs, control characters, quotes and literal backslashes');
const literalEscapes = String.raw`\n\t\r\x41\u0041\b\q\xZZ\x1`;
const preservedEscapes = yamlParse(String.raw`
double: "\\n\\t\\r\\x41\u0041\b\q\xZZ\x1" # outside
single: '\n\t\r\x41\u0041\b\q\xZZ\x1'
plain: \n\t\r\x41\u0041\b\q\xZZ\x1
comment: "line\n# inside\tend" # outside
`);
assert(['double', 'single', 'plain'].every(key => preservedEscapes[key] === literalEscapes),
  'yaml: literal backslashes, unknown escapes and non-double-quoted scalars retain their behavior');
assert(preservedEscapes.comment === 'line\n# inside\tend',
  'yaml: decoded escapes preserve quoted hashes and trailing comments');
for (const [label, text] of [
  ['malformed indentation', 'a:\n  b: one\n c: two\n'],
  ['multiline block scalar', 'a: |\n  multi\n'],
  ['top-level list', '- top-level-list\n'],
]) {
  let rejected = false;
  try { yamlParse(text); } catch { rejected = true; }
  assert(rejected, `yaml: ${label} remains rejected`);
}

// ── exit codes constant ──
assert(EXIT.CLEAN === 0 && EXIT.FINDINGS === 1 && EXIT.INFRA === 2 && EXIT.CONFIG === 3, 'EXIT contract');

// ── subprocess: --help exits 0 and prints subcommands ──
const help = execFileSync('node', [CLI, '--help'], { encoding: 'utf8' });
for (const cmd of ['init', 'serve', 'stop', 'crawl', 'run', 'review']) {
  assert(help.includes(cmd), `help mentions ${cmd}`);
}
assert(help.includes('exit codes'), 'help documents exit codes');

// ── subprocess: unknown subcommand exits 3 ──
let code = 0;
try { execFileSync('node', [CLI, 'frobnicate'], { encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code = e.status; }
assert(code === EXIT.CONFIG, 'unknown subcommand -> exit 3');

// ── validateConfig ──
assert(validateConfig({ base_url: 'http://x' }).length === 0, 'config: minimal v1 config valid');
assert(validateConfig({ app: { start: 'python3 -m http.server {port}' } }).length === 0, 'config: app.start without base_url valid');
assert(validateConfig({}).length === 1, 'config: needs base_url or app.start');
assert(validateConfig({ base_url: 'http://x', profiles: { p: { checks: ['nope'] } } })
  .some(e => e.includes('unknown check')), 'config: unknown check rejected');
assert(validateConfig({ base_url: 'http://x', app: { start: 42 } })
  .some(e => e.includes('app.start')), 'config: non-string app.start rejected');
assert(validateConfig({ base_url: '127.0.0.1:4711' }).some(e => e.includes('base_url')), 'config: scheme-less base_url rejected');
assert(validateConfig({ base_url: 'localhost:3000' }).some(e => e.includes('base_url')), 'config: non-http base_url rejected');
assert(validateConfig({ base_url: 8080 }).some(e => e.includes('base_url')), 'config: non-string base_url rejected');
assert(validateConfig({ base_url: 'https://staging.example.com:8443/app' }).length === 0, 'config: absolute https base_url valid');
assert(validateConfig({ base_url: 'http://127.0.0.1:{port}', app: { start: 'python3 -m http.server {port}' } }).length === 0,
  'config: {port} placeholder in base_url still valid');

// ── resolveProfile ──
const cfg2 = { base_url: 'http://x', profiles: { acc: { scope: 'site-accessible', checks: ['page-load'] } } };
const p1 = resolveProfile(cfg2, 'acc');
assert(p1.errors.length === 0 && p1.scope === 'site-accessible' && deepEq(p1.checks, ['page-load']), 'profile: named');
const p2 = resolveProfile(cfg2, null);
assert(p2.errors.length === 0 && p2.scope === 'all' && deepEq(p2.checks, KNOWN_CHECKS), 'profile: default = all checks');
assert(resolveProfile(cfg2, 'ghost').errors.length === 1, 'profile: unknown -> error');

// ── init: scaffolds and is idempotent ──
const tmp = mkdtempSync(join(tmpdir(), 'sg-init-'));
execFileSync('node', [CLI, 'init'], { cwd: tmp, encoding: 'utf8' });
assert(ex(join(tmp, 'visual-tests', '_config.yaml')), 'init: config scaffolded');
assert(ex(join(tmp, 'visual-tests', '_results')), 'init: _results dir');
const gi1 = rf(join(tmp, '.gitignore'), 'utf8');
assert(gi1.includes('visual-tests/_results/') && gi1.includes('.DS_Store'), 'init: gitignore guard-rails');
assert(gi1.includes('# visual-tests/_regressions.yaml'), 'init: regressions line commented (kept in git by default)');
wf(join(tmp, 'visual-tests', '_config.yaml'), 'base_url: "http://keep-me"\n');
execFileSync('node', [CLI, 'init'], { cwd: tmp, encoding: 'utf8' });
assert(rf(join(tmp, 'visual-tests', '_config.yaml'), 'utf8').includes('keep-me'), 'init: never overwrites config');
const gi2 = rf(join(tmp, '.gitignore'), 'utf8');
assert(gi1 === gi2, 'init: gitignore idempotent');

// ── missing config -> exit 3 for crawl ──
let code3 = 0;
try { execFileSync('node', [CLI, 'crawl'], { cwd: mkdtempSync(join(tmpdir(), 'sg-noconf-')), encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code3 = e.status; }
assert(code3 === EXIT.CONFIG, 'crawl without config -> exit 3');

// ── unusable base_url -> exit 3 (config), not an uncaught throw in startApp ──
const projBad = mkdtempSync(join(tmpdir(), 'sg-badurl-'));
mkdirSync(join(projBad, 'visual-tests'), { recursive: true });
wf(join(projBad, 'visual-tests', '_config.yaml'), 'base_url: "127.0.0.1:4711"\napp:\n  start: "python3 -m http.server 4711"\n');
let code4 = 0;
try { execFileSync('node', [CLI, 'run', '--no-crawl'], { cwd: projBad, encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code4 = e.status; }
assert(code4 === EXIT.CONFIG, 'run: unusable base_url -> exit 3');

// ── valueless --scope -> exit 3, never a silent empty selection ──
const projScope = mkdtempSync(join(tmpdir(), 'sg-scope-'));
mkdirSync(join(projScope, 'visual-tests'), { recursive: true });
wf(join(projScope, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:1"\n');
let code5 = 0;
try { execFileSync('node', [CLI, 'run', '--scope', '--no-crawl'], { cwd: projScope, encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { code5 = e.status; }
assert(code5 === EXIT.CONFIG, 'run: valueless --scope -> exit 3');

// ── tolerantJson ──
assert(deepEq(tolerantJson('{"a":1}'), { a: 1 }), 'tolerantJson: plain object');
assert(deepEq(tolerantJson('"{\\"a\\":1}"'), { a: 1 }), 'tolerantJson: escaped JSON string unwrapped');
assert(tolerantJson('not json at all') === null, 'tolerantJson: garbage -> null');
assert(deepEq(tolerantJson('  [1,2] '), [1, 2]), 'tolerantJson: array with whitespace');

// ── normalizeConsole ──
const cons = normalizeConsole(`[error] Failed to load resource: 404 (Not Found)
[warning] Deprecated API
info: fine
pageerror: Uncaught TypeError: x is not a function`);
assert(cons.length === 3, 'console: 3 entries (info dropped)');
assert(cons[0].level === 'error' && cons[0].text.includes('404'), 'console: error entry');
assert(cons[1].level === 'warn', 'console: warning normalized to warn');
assert(cons[2].level === 'error' && cons[2].text.includes('TypeError'), 'console: pageerror -> error');

// ── validateScreenshot ──
const shotDir = mkdtempSync(join(tmpdir(), 'sg-shot-'));
// Real 2x2 RGB PNG emitted by agent-browser 0.39.1 (two IDAT chunks).
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGJh+M8ABEwMYAAAAAD//yRdExIAAAAGSURBVAMADEgBBnJFnNoAAAAASUVORK5CYII=';
const png = Buffer.from(PNG_BASE64, 'base64');
const goodShot = join(shotDir, 'good.png');
const goodShotShell = "'" + goodShot.replace(/'/g, "'\\''") + "'";
wf(goodShot, png);
wf(join(shotDir, 'empty.png'), '');
assert(deepEq(validateScreenshot(goodShot), { ok: true, size: png.length }), 'screenshot: real PNG accepted with unchanged result shape');
assert(validateScreenshot(join(shotDir, 'empty.png')).ok === false, 'screenshot: empty rejected');
assert(validateScreenshot(join(shotDir, 'ghost.png')).reason === 'missing', 'screenshot: missing rejected');
const invalidShots = {
  'non-image': Buffer.from('PNGFAKE'),
  truncated: png.subarray(0, 4),
  'missing IDAT': Buffer.concat([png.subarray(0, 33), png.subarray(-12)]),
  'bad CRC': Buffer.from(png),
  'trailing bytes': Buffer.concat([png, Buffer.from([0])]),
};
invalidShots['bad CRC'][29] ^= 1;
// Complete chunk framing and CRCs isolate dimension and compressed-data checks.
for (const [label, base64] of [
  ['zero width', 'iVBORw0KGgoAAAANSUhEUgAAAAAAAAACCAIAAAD5IUpOAAAAEUlEQVR4nGNh+M8ABEwMYAAADEgBBuenLbEAAAAASUVORK5CYII='],
  ['zero height', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAAACAIAAACwHDt4AAAAEUlEQVR4nGNh+M8ABEwMYAAADEgBBuenLbEAAAAASUVORK5CYII='],
  ['dimensions mismatch', 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEUlEQVR4nGNh+M8ABEwMYAAADEgBBuenLbEAAAAASUVORK5CYII='],
  ['truncated compressed pixels', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGJh+M8ABEwMYAAAAAD//wMADEgBCj/h5AAAAABJRU5ErkJggg=='],
  ['short pixel rows', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGNh+M8ABEwgggEAC0IBBoZdg1wAAAAASUVORK5CYII='],
  ['invalid row filter', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGNl+M8ABEwMYAAADFYBB5+0HEYAAAAASUVORK5CYII='],
]) invalidShots[label] = Buffer.from(base64, 'base64');
for (const [label, bytes] of Object.entries(invalidShots)) {
  const file = join(shotDir, `${label}.png`);
  wf(file, bytes);
  const result = validateScreenshot(file);
  assert(!result.ok && result.size === bytes.length && !!result.reason, `screenshot: ${label} rejected`);
}
assert(Array.from({ length: png.length - 1 }, (_, i) => i + 1).every(length => {
  const file = join(shotDir, 'prefix.png');
  wf(file, png.subarray(0, length));
  return !validateScreenshot(file).ok;
}), 'screenshot: every truncated prefix of the real PNG is rejected');
assert(rf(goodShot).equals(png), 'screenshot: validation preserves stored bytes');

// Encode complete PNGs with correct CRCs so memory guards, not broken framing,
// decide the result. A lying IHDR deliberately describes fewer rows than IDAT.
function memoryTestPng(width, height, pixels, depth = 8, color = 2) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = depth; header[9] = color;
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const bombShot = join(shotDir, 'pixel-bomb.png');
// 90 million 1-bit pixels expand to valid rows from a tiny compressed file.
wf(bombShot, memoryTestPng(10000, 9000, Buffer.alloc(9000 * (1 + 1250)), 1, 0));
const lyingShot = join(shotDir, 'lying-header.png');
wf(lyingShot, memoryTestPng(1, 1, Buffer.alloc(4 * 1024 * 1024)));
const tallShot = join(shotDir, 'tall.png');
const tallRowBytes = 1 + 1440 * 3;
wf(tallShot, memoryTestPng(1440, 20000, Buffer.alloc(20000 * tallRowBytes)));
// Observe the real inflater used by the imported validator: the pixel guard
// must run before inflation, and a small IHDR must not permit a large output.
const originalInflate = zlib.inflateSync;
const inflationLimits = [];
zlib.inflateSync = (data, options) => {
  inflationLimits.push(options.maxOutputLength);
  return originalInflate(data, options);
};
syncBuiltinESMExports();
try {
  const bomb = validateScreenshot(bombShot);
  assert(!bomb.ok && bomb.size === rf(bombShot).length
    && /PNG exceeds pixel limit \(\d+ pixels\)/.test(bomb.reason)
    && inflationLimits.length === 0, 'screenshot: PNG pixel bomb rejected clearly before decompression');
  const lying = validateScreenshot(lyingShot);
  assert(!lying.ok && lying.reason === 'invalid PNG'
    && deepEq(inflationLimits, [5]), 'screenshot: lying IHDR rejected with header-sized output plus one byte');
  const tall = validateScreenshot(tallShot);
  assert(deepEq(tall, { ok: true, size: rf(tallShot).length })
    && deepEq(inflationLimits, [5, 20000 * tallRowBytes + 1]),
  'screenshot: complete 1440x20000 PNG accepted with bounded decompression');
} finally {
  zlib.inflateSync = originalInflate;
  syncBuiltinESMExports();
}

// Real 2x2 RGB JPEG, encoded from the PNG screenshot by macOS sips.
// Keep the .png path: agent-browser's user config can override its encoding.
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgACAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+L6KKK/lM/38P//Z', 'base64');
const goodJpeg = join(shotDir, 'jpeg.png');
wf(goodJpeg, jpeg);
// Real 2x2 progressive JPEG encoded by Pillow/libjpeg; no runtime dependency.
const progressiveJpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVAQEBAAAAAAAAAAAAAAAAAAAFBv/aAAwDAQACEAMQAAABigy4/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64');
for (const [label, bytes] of [['sequential', jpeg], ['progressive', progressiveJpeg]]) {
  const file = join(shotDir, `jpeg-${label}.png`);
  wf(file, bytes);
  assert(deepEq(validateScreenshot(file), { ok: true, size: bytes.length }),
    `screenshot: valid ${label} JPEG at a .png path accepted with unchanged result shape`);
  assert(Array.from({ length: bytes.length - 1 }, (_, i) => i + 1).every(length => {
    const prefixFile = join(shotDir, 'jpeg-prefix.png');
    wf(prefixFile, bytes.subarray(0, length));
    return !validateScreenshot(prefixFile).ok;
  }), `screenshot: every truncated prefix of the real ${label} JPEG is rejected`);
}
assert(rf(goodJpeg).equals(jpeg), 'screenshot: JPEG validation preserves stored bytes');
const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
const sos = jpeg.indexOf(Buffer.from([0xff, 0xda]));
const scanStart = sos + 2 + jpeg.readUInt16BE(sos + 2);
const invalidJpegs = {
  'JPEG disguised text': Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from('not an image'), jpeg.subarray(-2)]),
  'JPEG truncated': jpeg.subarray(0, -1),
  'JPEG zero width': Buffer.from(jpeg),
  'JPEG zero height': Buffer.from(jpeg),
  'JPEG bad segment length': Buffer.from(jpeg),
  'JPEG missing frame': Buffer.concat([jpeg.subarray(0, sof), jpeg.subarray(sof + 2 + jpeg.readUInt16BE(sof + 2))]),
  'JPEG missing scan': Buffer.concat([jpeg.subarray(0, sos), jpeg.subarray(-2)]),
  'JPEG no scan data': Buffer.concat([jpeg.subarray(0, scanStart), jpeg.subarray(-2)]),
  'JPEG trailing bytes': Buffer.concat([jpeg, Buffer.from([0])]),
};
invalidJpegs['JPEG zero width'].writeUInt16BE(0, sof + 7);
invalidJpegs['JPEG zero height'].writeUInt16BE(0, sof + 5);
invalidJpegs['JPEG bad segment length'].writeUInt16BE(1, sof + 2);
for (const [label, bytes] of Object.entries(invalidJpegs)) {
  wf(join(shotDir, `${label}.png`), bytes);
  const result = validateScreenshot(join(shotDir, `${label}.png`));
  assert(!result.ok && result.size === bytes.length && result.reason === 'invalid JPEG',
    `screenshot: ${label} rejected`);
}

// ── matchSnapshotRef ──
// Line shape copied from real `agent-browser 0.27.0 snapshot -i` output (element
// names kept from the original fixture). The previous fixture invented an `@eN`
// snapshot shape the binary never emits, so these assertions only ever proved
// the parser agreed with whoever wrote the fixture. The live probe at the end of
// this file is what actually pins the shape to the installed binary.
const snap = `- heading "Espace client" [level=1, ref=e1]
- button "Nouvelle conversation" [ref=e3]
- combobox [expanded=false, ref=e5]: Alpha
- link "Accueil" [ref=e7]
- textbox "Nom d'utilisateur" [ref=e9]`;
assert(matchSnapshotRef(snap, 'Nouvelle conversation') === '@e3', 'snapshot: match by text');
assert(matchSnapshotRef(snap, 'accueil') === '@e7', 'snapshot: case-insensitive');
assert(matchSnapshotRef(snap, 'Inexistant') === null, 'snapshot: no match -> null');
// The ref is returned as `@eN` because that is the only spelling the consuming
// commands accept: `agent-browser click e9` answers "Unknown ref", and
// `click "[ref=e9]"` is parsed as a CSS attribute selector and finds nothing.
assert(/^@e\d+$/.test(matchSnapshotRef(snap, 'Alpha') || ''), 'snapshot: ref returned in @eN command form');
// Older agent-browser emitted the bare token; keep reading it.
const legacySnap = `- button "Nouvelle conversation" @e3
- link "Accueil" @e7`;
assert(matchSnapshotRef(legacySnap, 'Nouvelle conversation') === '@e3', 'snapshot: legacy @eN still matched');
assert(matchSnapshotRef(legacySnap, 'Introuvable') === null, 'snapshot: legacy no match -> null');
// An accessible name (or a `-u` url) that itself contains `ref=eN` must not
// shadow the line's real ref.
const trapSnap = '- link "Weird ref=e99 link" [ref=e6, url=file:///deep/link?ref=e99]';
assert(matchSnapshotRef(trapSnap, 'Weird ref=e99 link') === '@e6', 'snapshot: quoted/url ref decoy ignored');

// ── buildRunJson ──
const run = buildRunJson({
  scope: { type: 'profile', value: 'site-accessible' },
  lanes: {
    audit: { status: 'not-applicable', reason: 'static recette profile' },
    visual: { status: 'ran', results: 'visual-results.json' },
  },
});
assert(run.schema_version === '1.0' && run.scope.value === 'site-accessible', 'run.json: shape');
assert(run.lanes.audit.status === 'not-applicable' && run.lanes.audit.reason, 'run.json: declared n/a with reason');
let threw = false;
try { buildRunJson({ scope: {}, lanes: { visual: { status: 'skipped' } } }); } catch { threw = true; }
assert(threw, 'run.json: non-ran lane without reason throws');

// ── loadManifests: scope filtering ──
const projR = mkdtempSync(join(tmpdir(), 'sg-run-'));
mkdirSync(join(projR, 'visual-tests', 'site-accessible'), { recursive: true });
mkdirSync(join(projR, 'visual-tests', 'site-inaccessible'), { recursive: true });
mkdirSync(join(projR, 'visual-tests', '_shared'), { recursive: true });
wf(join(projR, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:1"\n');
wf(join(projR, 'visual-tests', 'site-accessible', 'index.yaml'),
  'name: "Acc index"\nsteps:\n  - action: open\n    url: "{base_url}/site-accessible/index.html"\n');
wf(join(projR, 'visual-tests', 'site-inaccessible', 'index.yaml'),
  'name: "Inacc index"\nsteps:\n  - action: open\n    url: "{base_url}/site-inaccessible/index.html"\n');
wf(join(projR, 'visual-tests', 'site-accessible', 'old.yaml'), 'name: "Old"\ndeprecated: true\nsteps:\n  - action: open\n    url: "{base_url}/x.html"\n');
wf(join(projR, 'visual-tests', '_shared', 'login.yaml'), 'name: "login"\nsteps:\n  - action: open\n    url: "{base_url}/login"\n');

assert(loadManifests(projR, 'all').entries.length === 2, 'manifests: all excludes _shared and deprecated');
const scoped = loadManifests(projR, 'site-accessible').entries;
assert(scoped.length === 1 && scoped[0].id === 'site-accessible/index', 'manifests: scope filter');
assert(MECHANICAL_ACTIONS.includes('open') && !MECHANICAL_ACTIONS.includes('llm-check'), 'mechanical actions list');
assert(AGENT_ACTIONS.includes('llm-check') && AGENT_ACTIONS.includes('include')
  && !AGENT_ACTIONS.some((a) => MECHANICAL_ACTIONS.includes(a)), 'agent actions list: declared, and disjoint from mechanical');
// A healthy suite reports no lost coverage — deprecated is excluded silently.
assert(loadManifests(projR, 'all').unloadable.length === 0, 'manifests: a deprecated manifest is not reported as lost coverage');

// ── loadManifests: a manifest that cannot be loaded is reported, not dropped ──
const projU = mkdtempSync(join(tmpdir(), 'sg-unloadable-'));
mkdirSync(join(projU, 'visual-tests', 'pages'), { recursive: true });
wf(join(projU, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:1"\n');
wf(join(projU, 'visual-tests', 'pages', 'ok.yaml'),
  'name: "Ok"\nsteps:\n  - action: open\n    url: "{base_url}/ok.html"\n');
// A leading document marker is outside this parser subset and is rejected.
wf(join(projU, 'visual-tests', 'pages', 'login.yaml'),
  '---\nname: "Login"\nsteps:\n  - action: open\n    url: "{base_url}/login.html"\n');
wf(join(projU, 'visual-tests', 'pages', 'old.yaml'), 'name: "Old"\ndeprecated: true\nsteps: []\n');
const loadedU = loadManifests(projU, 'all');
assert(loadedU.entries.length === 1 && loadedU.entries[0].id === 'pages/ok', 'manifests: unloadable stays out of the suite');
assert(loadedU.unloadable.length === 1 && loadedU.unloadable[0].path === 'pages/login.yaml'
  && loadedU.unloadable[0].reason === 'manifest_unreadable', 'manifests: unloadable is reported with its path and reason');
// The scope filter runs after the parse gate, so a lost manifest is declared
// whatever the scope — it has no readable path/url pair to filter it on.
assert(loadManifests(projU, 'pages/ok').unloadable.length === 1, 'manifests: unloadable is scope-independent');
// End to end, through a live app and a stand-in browser, so the run reaches the
// visual lane instead of short-circuiting on an infra precondition (an
// unreachable base_url or a missing browser would make this pass for the wrong
// reason). Same app.start idiom as appserver-smoke-test.mjs.
const APP_U = `node -e "require('http').createServer((q,s)=>{s.end('<html>Ok</html>')}).listen({port},'127.0.0.1')"`;
wf(join(projU, 'visual-tests', '_config.yaml'),
  `version: 2\napp:\n  start: "${APP_U.replace(/"/g, '\\"')}"\n  healthcheck: "/"\n  startup_timeout_ms: 15000\n`);
const FAKE_BIN = join(projU, 'fake-agent-browser');
wf(FAKE_BIN, '#!/bin/sh\ncase "$1" in\n  snapshot) printf \'%s\\n\' \'- heading "Ok" @e1\' ;;\n'
  + `  screenshot) cp ${goodShotShell} "$2" ;;\n`
  + '  get) [ "$2" = url ] && printf \'%s\\n\' \'http://127.0.0.1/ok.html\' ;;\nesac\nexit 0\n');
chmodSync(FAKE_BIN, 0o755);
let codeU = 0;
try {
  execFileSync('node', [CLI, 'run', '--no-crawl'],
    { cwd: projU, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, SHIPGUARD_AGENT_BROWSER: FAKE_BIN } });
} catch (e) { codeU = e.status; }
const runU = JSON.parse(rf(join(projU, 'visual-tests', '_results', 'run.json'), 'utf8'));
const visU = JSON.parse(rf(join(projU, 'visual-tests', '_results', 'visual-results.json'), 'utf8'));
assert(visU.summary.pass === 1 && visU.summary.error === 0,
  'run: the loadable manifest really ran (the run did not stop on an infra precondition)');
assert(codeU !== EXIT.CLEAN, 'run: a suite with an unloadable manifest never exits clean');
assert(runU.lanes.visual.status === 'error' && /pages\/login\.yaml/.test(runU.lanes.visual.reason),
  'run: an unloadable manifest makes the visual lane an errored lane that names it');
assert(visU.scope.uncovered_routes.length === 1
  && visU.scope.uncovered_routes[0].route === 'visual-tests/pages/login.yaml'
  && visU.scope.uncovered_routes[0].status === 'uncovered',
  'run: the lost manifest is preserved as an uncovered route');
assert(visU.scope.full_suite_total === 2 && visU.scope.selected_total === 1,
  'run: full_suite_total counts the manifest that was meant to run, not only the one that could');

// ── executeManifest: an unknown action is an invalid manifest, never a PASS ──
const invalid = await executeManifest(
  { id: 'pages/typo', url: '', manifest: { name: 'Typo', steps: [{ action: 'assert_txt', text: 'Home' }] } },
  { baseUrl: 'http://127.0.0.1:1', config: {}, checks: [], screenshotsDir: join(projU, 'visual-tests', '_results') });
assert(invalid.status === 'ERROR' && /unknown action "assert_txt"/.test(invalid.manifest_error || ''),
  'steps: an unknown action stops the test and names itself in manifest_error');
const agentOnly = await executeManifest(
  { id: 'pages/inc', url: '', manifest: { name: 'Inc', steps: [{ action: 'include', path: '_shared/login.yaml' }] } },
  { baseUrl: 'http://127.0.0.1:1', config: {}, checks: [], screenshotsDir: join(projU, 'visual-tests', '_results') });
assert(!agentOnly.manifest_error && agentOnly.llm_steps_pending === 1,
  'steps: a declared agent-owned action is pending agent work, not an invalid manifest');

// The documented expected field must drive the verdict. This stand-in browser
// supplies deterministic captures; these are contract tests, not UI evidence.
const savedBrowser = process.env.SHIPGUARD_AGENT_BROWSER;
process.env.SHIPGUARD_AGENT_BROWSER = FAKE_BIN;
try {
  for (const action of ['assert_text', 'assert_url']) {
    const matching = action === 'assert_text' ? 'Ok' : '/ok.html';
    const alias = action === 'assert_text' ? 'text' : 'url';
    const cases = [
      [{ expected: matching }, 'PASS', 'documented expected matches'],
      [{ expected: 'absent-value' }, 'FAIL', 'documented expected mismatch'],
      [{ expected: 'absent-value', [alias]: matching }, 'FAIL', 'expected takes precedence over aliases'],
      [{ [alias]: matching }, 'PASS', 'legacy named alias'],
      [{ value: matching }, 'PASS', 'legacy value alias'],
      [{}, 'ERROR', 'missing expectation'],
      [{ expected: '' }, 'ERROR', 'empty expectation'],
      [{ expected: '  ' }, 'ERROR', 'blank expectation'],
      [{ expected: '', [alias]: matching }, 'ERROR', 'empty expected cannot fall through to an alias'],
      [{ expected: '{data.absent}' }, 'ERROR', 'unresolved data expectation'],
      [{ expected: '{credentials.absent}' }, 'ERROR', 'unresolved credential expectation'],
      [{ expected: '{data.match}' }, 'PASS', 'resolved data expectation'],
    ];
    for (const [fields, status, label] of cases) {
      const result = await executeManifest(
        { id: `pages/${action}`, url: '', manifest: { data: { match: matching }, steps: [{ action, ...fields }] } },
        { baseUrl: 'http://127.0.0.1', config: {}, checks: [], screenshotsDir: join(projU, 'visual-tests', '_results') });
      assert(result.status === status, `${action}: ${label} -> ${status}`);
      if (status === 'ERROR') assert(result.manifest_error?.includes('expected must resolve'),
        `${action}: ${label} is a declaration error`);
    }
  }
} finally {
  if (savedBrowser === undefined) delete process.env.SHIPGUARD_AGENT_BROWSER;
  else process.env.SHIPGUARD_AGENT_BROWSER = savedBrowser;
}

// ── recorded open URLs reach the real interpolator intact (#122) ──
// Capture the browser arguments; no browser or network is involved.
const URL_BIN = join(projU, 'recorded-url-browser');
const URL_LOG = join(projU, 'recorded-url-args.jsonl');
wf(URL_BIN, '#!/usr/bin/env node\n'
  + `require('node:fs').appendFileSync(${JSON.stringify(URL_LOG)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
chmodSync(URL_BIN, 0o755);
const savedUrlBrowser = process.env.SHIPGUARD_AGENT_BROWSER;
process.env.SHIPGUARD_AGENT_BROWSER = URL_BIN;
try {
  const baseUrl = 'http://example.test:4100';
  const replayBase = 'http://example.test:4300';
  for (const [recorded, expected] of [
    [`${baseUrl}/form?q=1#fin`, `${replayBase}/form?q=1#fin`],
    ['http://example.test:4200/form?q=1#fin', 'http://example.test:4200/form?q=1#fin'],
    ['http://example.test:41000/form', 'http://example.test:41000/form'],
    ['https://other.example.test/form?q=1#fin', 'https://other.example.test/form?q=1#fin'],
  ]) {
    wf(URL_LOG, '');
    const manifest = yamlParse(actionsToYaml([{ type: 'open', url: recorded }],
      { name: 'recorded-url', baseUrl }));
    // This contract concerns open; omit the generated trailing screenshot.
    manifest.steps = manifest.steps.filter(step => step.action === 'open');
    const result = await executeManifest(
      { id: 'pages/recorded-url', url: '', manifest },
      { baseUrl: replayBase, config: {}, checks: [], screenshotsDir: join(projU, 'visual-tests', '_results') });
    const calls = rf(URL_LOG, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert(result.status === 'PASS' && deepEq(calls.filter(call => call[0] === 'open'), [['open', expected]]),
      `recorded URL: real interpolator opens ${expected}`);
  }
} finally {
  if (savedUrlBrowser === undefined) delete process.env.SHIPGUARD_AGENT_BROWSER;
  else process.env.SHIPGUARD_AGENT_BROWSER = savedUrlBrowser;
}

// ── audited CLI regressions (r1-z01) ──
const auditDir = mkdtempSync(join(tmpdir(), 'sg-cli-audit-'));
const auditBin = join(auditDir, 'browser');
const auditLog = join(auditDir, 'calls.jsonl');
wf(auditBin, '#!/usr/bin/env node\n' + `
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(auditLog)}, JSON.stringify({args:a, session:process.env.AGENT_BROWSER_SESSION})+'\\n');
if (a[0] === 'get' && a[1] === 'url') console.log('http://example.test/login?next=/dashboard');
if (a[0] === 'snapshot') console.log(a.includes('-i') ? '- button "Unrelated" [ref=e3]' : '- region "Main" [ref=e1]\\n  - text: empty\\n- region "Other" [ref=e2]\\n  - text: Success');
if (a[0] === 'get' && a[1] === 'text') console.log(['@e1', '#empty'].includes(a[2]) ? 'empty' : 'Success');
if (a[0] === 'upload' && !fs.existsSync(require('path').resolve(${JSON.stringify(auditDir)}, a[2]))) process.exit(7);
if (process.env.SG_AUDIT_HISTORY_FAIL && ['back','forward'].includes(a[0])) { console.error('history failed'); process.exit(7); }
if (a[0] === 'screenshot') {
  if (process.env.SG_AUDIT_SHOT_FAIL) process.exit(7);
  fs.writeFileSync(a[1], Buffer.from(${JSON.stringify(PNG_BASE64)}, 'base64'));
}
`);
chmodSync(auditBin, 0o755);
const auditSaved = process.env.SHIPGUARD_AGENT_BROWSER;
const auditShotDir = join(auditDir, 'screenshots');
mkdirSync(auditShotDir);
const auditExec = (id, steps, extra = {}, checks = []) => executeManifest(
  { id, url: '', manifest: { steps, ...extra } },
  { baseUrl: 'http://example.test', config: {}, checks, screenshotsDir: auditShotDir, projectRoot: auditDir });
process.env.SHIPGUARD_AGENT_BROWSER = auditBin;
try {
  // Exercise the real recorder/parser/executor path up to the browser boundary.
  // NUL is covered by the parser round-trip above; OS arguments cannot carry it.
  wf(auditLog, '');
  const recordedReplay = await executeManifest(
    { id: 'pages/recorded-escapes', url: '', manifest: {
      ...recordedManifest, steps: recordedManifest.steps.filter(step => step.action === 'fill').slice(0, 2),
    } },
    { baseUrl: 'http://example.test', config: {}, checks: [], screenshotsDir: auditShotDir });
  const recordedCalls = rf(auditLog, 'utf8').trim().split('\n').map(JSON.parse).map(call => call.args)
    .filter(args => args[0] === 'fill');
  assert(recordedReplay.status === 'PASS'
    && deepEq(recordedCalls, recordedValues.slice(0, 2).map(value => ['fill', '#notes', value])),
    'recorder integration: fill receives original newlines, tabs and literal escape text');
  wf(auditLog, '');
  const history = await auditExec('pages/history', [{action:'back'}, {action:'forward'}]);
  const historyCalls = rf(auditLog, 'utf8').trim().split('\n').map(JSON.parse).map(c => c.args)
    .filter(args => ['back','forward','open'].includes(args[0]));
  assert(history.status === 'PASS' && deepEq(historyCalls, [['back'], ['forward']]),
    'history: Back and Forward dispatch native commands without open');
  process.env.SG_AUDIT_HISTORY_FAIL = '1';
  try {
    for (const action of ['back','forward']) {
      const failed = await auditExec('pages/history-error', [{action}]);
      assert(failed.status === 'ERROR' && failed.failure_reason.includes('history failed'), `history: ${action} tool failure cannot pass`);
    }
  } finally { delete process.env.SG_AUDIT_HISTORY_FAIL; }
  const query = await auditExec('pages/query', [{ action: 'assert_url', expected: '/dashboard' }]);
  assert(query.status === 'FAIL', 'r1-z01-004: a query redirect target cannot satisfy the current pathname');
  const region = await auditExec('pages/region', [{ action: 'assert_text', target: 'Main', expected: 'Success' }]);
  assert(region.status === 'FAIL', 'r1-z01-005: text outside the named region cannot satisfy its assertion');
  const regionOk = await auditExec('pages/region-ok', [{ action: 'assert_text', target: 'Main', expected: 'empty' }]);
  assert(regionOk.status === 'PASS', 'r1-z01-005: text inside the named region still passes');
  wf(auditLog, '');
  const css = await auditExec('pages/css', [{ action: 'click', selector: '#submit' },
    { action: 'fill', selector: '#input', value: 'hello' }, { action: 'press', selector: '#input', key: 'Enter' }]);
  const cssCalls = rf(auditLog, 'utf8').trim().split('\n').map(JSON.parse).map(c => c.args);
  assert(css.status === 'PASS' && cssCalls.some(c => deepEq(c, ['click', '#submit']))
    && cssCalls.some(c => deepEq(c, ['fill', '#input', 'hello']))
    && cssCalls.findIndex(c => deepEq(c, ['focus', '#input'])) < cssCalls.findIndex(c => deepEq(c, ['press', 'Enter']))
    && cssCalls.some(c => deepEq(c, ['focus', '#input'])),
    'recorder integration: explicit CSS selector is replayed and press restores its focus');
  // Recorded uploads keep their targets through the real YAML parser and
  // executor, even when selectors contain quotes, backslashes, or YAML syntax.
  const uploadSelectors = ['#attachment', String.raw`input[type="file"][data-name="draft: #1\\final"]`];
  const recordedUpload = yamlParse(actionsToYaml(uploadSelectors.map(selector =>
    ({ type: 'upload', selector, files: ['attachment.txt'] })),
  { name: 'recorded-upload', baseUrl: 'http://example.test' }));
  assert(deepEq(recordedUpload.steps.filter(step => step.action === 'upload'), uploadSelectors.map((selector, index) =>
    ({ action: 'upload', selector, file: index === 0 ? '{data.upload_file}' : '{data.upload_file_2}' }))),
  'recorded upload: selectors and numbered file placeholders survive YAML round-trip');
  wf(join(auditDir, 'attachment.txt'), 'Recorded upload fixture');
  recordedUpload.data.upload_file = 'attachment.txt';
  recordedUpload.data.upload_file_2 = 'attachment.txt';
  wf(auditLog, '');
  const uploadReplay = await auditExec('pages/recorded-upload', recordedUpload.steps, recordedUpload);
  const uploadCalls = rf(auditLog, 'utf8').trim().split('\n').map(JSON.parse).map(call => call.args);
  assert(uploadReplay.status === 'PASS' && deepEq(uploadCalls.filter(call => call[0] === 'upload'),
    uploadSelectors.map(selector => ['upload', selector, 'attachment.txt'])),
  'recorded upload: replay dispatches each saved target with its configured file instead of STALE');
  assert(!uploadCalls.some(call => call[0] === 'snapshot'),
    'recorded upload: explicit file input selectors bypass accessibility-tree matching');
  const scopedCss = await auditExec('pages/css-text', [{ action: 'assert_text', target: 'Other', selector: '#empty', expected: 'Success' }]);
  assert(scopedCss.status === 'FAIL', 'recorder integration: explicit CSS assertion scope takes precedence over label');
  const malformedStep = await auditExec('pages/typo', [{ action: 'open', url: '/' }, { acton: 'assert_text', expected: 'absent' }]);
  assert(malformedStep.status === 'ERROR' && !!malformedStep.manifest_error,
    'r1-z01-010: an absent action is a manifest declaration error');
  for (const duration of ['abc', '31s']) {
    const badWait = await auditExec('pages/wait', [{ action: 'wait', duration }]);
    assert(badWait.status === 'ERROR' && !!badWait.manifest_error,
      `r1-z01-018: invalid wait ${duration} is a declaration error`);
  }
  const timed = await auditExec('pages/timeout', [{ action: 'wait', duration: '100ms' }], { timeout: '20ms' });
  assert(timed.status === 'ERROR' && timed.duration_ms < 100,
    'r1-z01-008: manifest timeout bounds a wait and cannot return PASS');
  const auth = await auditExec('pages/auth', [{ action: 'open', url: '/private' }], { requires_auth: true });
  assert(auth.status !== 'PASS' && /login|auth/i.test(auth.failure_reason || ''),
    'r1-z01-007: missing login prerequisite cannot pass as an ordinary manifest');
  mkdirSync(join(auditDir, 'visual-tests', '_shared'), { recursive: true });
  wf(join(auditDir, 'visual-tests', '_shared', 'login.yaml'), 'steps:\n  - action: open\n    url: "{base_url}/login"\n');
  wf(auditLog, '');
  const authed = await auditExec('pages/auth', [{ action: 'open', url: '/private' }], { requires_auth: true });
  const authCalls = rf(auditLog, 'utf8').trim().split('\n').map(JSON.parse).filter(c => c.args[0] === 'open');
  assert(authed.status === 'PASS' && authCalls.length === 2 && authCalls[0].args[1].endsWith('/login'),
    'r1-z01-007: mechanical shared login executes before authenticated steps');
  const named = await auditExec('pages/named', [{ action: 'screenshot', filename: 'recorded.png' }], {}, ['screenshots']);
  assert(named.screenshot === 'screenshots/recorded.png', 'r1-z01-006: recorder filename is honored');
  for (const action of ['assert_text', 'assert_url']) {
    const optional = `${action}.png`;
    await auditExec(`pages/${action}`, [{ action, expected: action === 'assert_text' ? 'Success' : '/login', screenshot: optional }]);
    assert(ex(join(auditShotDir, optional)), `r1-z01-006: ${action} optional screenshot is captured`);
  }
  const first = await auditExec('auth/index', [{ action: 'open', url: '/' }], {}, ['screenshots']);
  const second = await auditExec('docs/index', [{ action: 'open', url: '/' }], {}, ['screenshots']);
  assert(first.screenshot !== second.screenshot && ex(join(auditDir, first.screenshot)) && ex(join(auditDir, second.screenshot)),
    'r1-z01-003: same leaf name in different folders keeps separate screenshot evidence');
  wf(join(auditShotDir, 'old.png'), png);
  process.env.SG_AUDIT_SHOT_FAIL = '1';
  const old = await auditExec('old', [{ action: 'open', url: '/' }], {}, ['screenshots']);
  delete process.env.SG_AUDIT_SHOT_FAIL;
  assert(old.status === 'ERROR' && !old.screenshot && !!old.screenshot_error,
    'r1-z01-002: failed screenshot cannot reuse an old valid file');
  const logged = rf(auditLog, 'utf8').trim().split('\n').map(JSON.parse);
  assert(logged.every(c => c.session && c.session !== process.env.AGENT_BROWSER_SESSION),
    'r1-z01-011: browser bridge overrides the caller session with a dedicated session');
  let malformedRejected = false;
  try { yamlParse('steps:\n  - action: open\n    url: /\n - action: assert_text\n   expected: missing\n'); }
  catch { malformedRejected = true; }
  assert(malformedRejected, 'r1-z01-009: malformed trailing indentation cannot discard an assertion');
} finally {
  if (auditSaved === undefined) delete process.env.SHIPGUARD_AGENT_BROWSER;
  else process.env.SHIPGUARD_AGENT_BROWSER = auditSaved;
  delete process.env.SG_AUDIT_SHOT_FAIL;
}

// ── run without agent-browser -> exit 2 (infra), run.json declares it ──
// SHIPGUARD_AGENT_BROWSER points at a nonexistent binary (agent-browser shares
// nvm's bin dir with node, so PATH restriction cannot hide one without the other).
let codeR = 0;
try {
  execFileSync('node', [CLI, 'run', '--scope=site-accessible', '--no-crawl'],
    { cwd: projR, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, SHIPGUARD_AGENT_BROWSER: '/nonexistent/agent-browser' } });
} catch (e) { codeR = e.status; }
assert(codeR === EXIT.INFRA, 'run: agent-browser missing -> exit 2');
const runJson = JSON.parse(rf(join(projR, 'visual-tests', '_results', 'run.json'), 'utf8'));
assert(runJson.lanes.visual.status === 'error' && runJson.lanes.visual.reason.includes('agent-browser'),
  'run: run.json declares visual lane error with reason');
assert(runJson.lanes.audit.status === 'not-applicable', 'run: audit lane declared not-applicable by CLI recette');

// ── exit-code aggregation: each code is an instruction, not a severity ──────
// 0 "nothing to see" | 1 "look at your product" | 2 "retry, the tooling broke"
// | 3 "fix your declaration". The axis between 2 and 3 is whether re-running
// unchanged could ever help. Precedence 2 > 3 > 1 > 0.
// Each fixture is a full `run` over a real app and a stand-in browser, because
// the aggregation reads lanes that only a real run produces.
const FAKE_F = join(mkdtempSync(join(tmpdir(), 'sg-fbin-')), 'fake-agent-browser');
wf(FAKE_F, '#!/bin/sh\nif [ -n "$SG_BROWSER_CALLS" ]; then printf \'%s|%s\\n\' "$1" "$AGENT_BROWSER_SESSION" >> "$SG_BROWSER_CALLS"; fi\ncase "$1" in\n  snapshot) printf \'%s\\n\' \'- heading "Ok" @e1\' ;;\n'
  + `  screenshot) if [ "$SG_EMPTY_SHOT" = 1 ]; then : > "$2"; elif [ -n "$SG_SHOT_FILE" ]; then cp "$SG_SHOT_FILE" "$2"; else cp ${goodShotShell} "$2"; fi ;;\n`
  + '  get) [ "$2" = url ] && printf \'%s\\n\' \'http://127.0.0.1/ok.html\' ;;\nesac\nexit 0\n');
chmodSync(FAKE_F, 0o755);
const OK_MANIFEST = 'name: "Ok"\nsteps:\n  - action: open\n    url: "{base_url}/ok.html"\n  - action: assert_text\n    text: "Ok"\n';

function runFixture({ files = {}, flags = [], env = {}, configExtra = '', builder = 'process.exit(0);\n' }) {
  const root = mkdtempSync(join(tmpdir(), 'sg-exit-'));
  mkdirSync(join(root, 'visual-tests'), { recursive: true });
  wf(join(root, 'visual-tests', '_config.yaml'),
    `version: 2\napp:\n  start: "${APP_U.replace(/"/g, '\\"')}"\n  healthcheck: "/"\n  startup_timeout_ms: 15000\n${configExtra}`);
  // A project-local no-op builder keeps the dashboard out of every case that is
  // not about the dashboard (it is also the only way to control its failure).
  if (builder !== null) wf(join(root, 'visual-tests', 'build-review.mjs'), builder);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, 'visual-tests', rel)), { recursive: true });
    wf(join(root, 'visual-tests', rel), body);
  }
  const ran = spawnSync('node', [CLI, 'run', ...flags], { cwd: root, encoding: 'utf8',
    env: { ...process.env, SHIPGUARD_AGENT_BROWSER: FAKE_F, ...env } });
  const rd = join(root, 'visual-tests', '_results');
  const load = (f) => (ex(join(rd, f)) ? JSON.parse(rf(join(rd, f), 'utf8')) : null);
  return { root, code: ran.status, err: ran.stderr, run: load('run.json'), visual: load('visual-results.json') };
}

const fPaths = runFixture({ files: { 'pages/ok.yaml': OK_MANIFEST }, flags: ['--no-crawl'],
  configExtra: 'screenshots_dir: "artifacts/shots"\nreport_path: "artifacts/summary.md"\n' });
assert(fPaths.code === EXIT.CLEAN && ex(join(fPaths.root, 'artifacts', 'summary.md'))
  && ex(join(fPaths.root, 'artifacts', 'shots', fPaths.visual.tests[0].screenshot.split('/').pop())),
  'r1-z01-020: configured screenshots_dir and report_path drive the actual outputs');

// a scope that selects nothing while the suite exists: the run asserted nothing
// and the fix is the scope string, not a retry
const fScope = runFixture({ files: { 'pages/ok.yaml': OK_MANIFEST }, flags: ['--no-crawl', '--scope=pagez'] });
assert(fScope.code === EXIT.CONFIG, 'exit: a scope that selects nothing -> 3, never a clean 0');
assert(fScope.run?.lanes?.visual?.status === 'skipped' && fScope.run?.lanes?.visual?.remedy === 'declaration',
  'exit: the skipped visual lane names a declaration remedy');

// a manifest this deterministic layer cannot evaluate is not a PASS, and a run
// made only of those evaluated nothing
const fLlm = runFixture({ files: { 'pages/llm.yaml': 'name: "L"\nsteps:\n  - action: llm-check\n    prompt: "ok?"\n' }, flags: ['--no-crawl'] });
assert(fLlm.visual?.tests?.[0]?.status === 'SKIPPED', 'exit: a manifest with no mechanically evaluable step is SKIPPED, not PASS');
assert(fLlm.visual?.summary?.skipped === 1, 'exit: summary.skipped counts it (previously hardcoded 0)');
assert(fLlm.run?.lanes?.llm_checks?.status === 'needs-agent', 'exit: the pending agent work stays declared');
assert(fLlm.code === EXIT.CONFIG, 'exit: a run in which no lane evaluated anything -> 3, never a clean 0');

// a pending handoff BESIDE real mechanical work is not a fault: needs-agent is
// a declared handoff like not-applicable, not an incomplete recette
const fMixed = runFixture({ files: { 'pages/ok.yaml': OK_MANIFEST, 'pages/llm.yaml': 'name: "L"\nsteps:\n  - action: llm-check\n    prompt: "ok?"\n' }, flags: ['--no-crawl'] });
assert(fMixed.code === EXIT.CLEAN, 'exit: a pending agent lane beside evaluated work stays 0');
assert(fMixed.run?.lanes?.visual?.status === 'ran', 'exit: the visual lane ran because something was evaluated');

// no manifests and no crawl: every individual skip is legitimate, their
// conjunction is a run that asserted nothing
const emptyCalls = join(auditDir, 'empty-browser-calls');
const fEmpty = runFixture({ flags: ['--no-crawl'], env: { SG_BROWSER_CALLS: emptyCalls } });
assert(!ex(emptyCalls), 'r1-z01-011: a run without browser work does not issue close or any browser command');
assert(fEmpty.code === EXIT.CONFIG, 'exit: no lane evaluated anything -> 3');

// an invalid manifest is closer to a bad config than to a broken machine
const fInvalid = runFixture({ files: { 'pages/typo.yaml': 'name: "T"\nsteps:\n  - action: assert_txt\n    text: "Ok"\n' }, flags: ['--no-crawl'] });
assert(fInvalid.code === EXIT.CONFIG, 'exit: an unknown action -> 3 (fix the manifest), not 2 (retry)');
assert(fInvalid.run?.lanes?.visual?.remedy === 'declaration', 'exit: the errored visual lane names a declaration remedy');

const fMissingExpected = runFixture({ files: { 'pages/missing.yaml':
  'name: "Missing expectation"\nsteps:\n  - action: assert_text\n' }, flags: ['--no-crawl'] });
assert(fMissingExpected.code === EXIT.CONFIG && fMissingExpected.visual?.tests?.[0]?.status === 'ERROR',
  'exit: missing assertion expectation -> 3 and ERROR, never a clean PASS');
assert(fMissingExpected.run?.lanes?.visual?.remedy === 'declaration',
  'exit: missing assertion expectation tells the human to fix the manifest');
const fExpectedMismatch = runFixture({ files: { 'pages/mismatch.yaml':
  'name: "Expected mismatch"\nsteps:\n  - action: assert_url\n    expected: "/absent-page"\n' }, flags: ['--no-crawl'] });
assert(fExpectedMismatch.code === EXIT.FINDINGS && fExpectedMismatch.visual?.tests?.[0]?.status === 'FAIL',
  'exit: documented expected mismatch -> 1 and FAIL');

// a tooling failure keeps 2, and outranks a declaration fault in the same run:
// a human who fixes only the manifest still gets untrusted evidence
const fTool = runFixture({ files: { 'pages/ok.yaml': OK_MANIFEST }, flags: ['--no-crawl'], env: { SG_EMPTY_SHOT: '1' } });
assert(fTool.code === EXIT.INFRA, 'exit: a per-test tooling ERROR -> 2 (unchanged)');
assert(fTool.run?.lanes?.visual?.remedy === 'infrastructure', 'exit: the errored visual lane names an infrastructure remedy');
for (const explicit of [false, true]) {
  const fShot = runFixture({ files: { 'pages/ok.yaml': OK_MANIFEST
    + (explicit ? '  - action: screenshot\n    filename: explicit.png\n' : '') },
    flags: ['--no-crawl'], env: { SG_SHOT_FILE: goodJpeg } });
  const test = fShot.visual?.tests?.[0];
  assert(fShot.code === EXIT.CLEAN && test?.status === 'PASS' && test.screenshot?.endsWith('.png')
    && rf(join(fShot.root, 'visual-tests', '_results', test.screenshot)).equals(jpeg),
    `screenshot run: JPEG (${explicit ? 'explicit step' : 'automatic check'}) keeps its path and bytes`);
}
for (const label of ['non-image', 'truncated', 'truncated compressed pixels', 'JPEG truncated', 'JPEG zero width']) {
  for (const explicit of [false, true]) {
    const fShot = runFixture({ files: { 'pages/ok.yaml': OK_MANIFEST
      + (explicit ? '  - action: screenshot\n    filename: explicit.png\n' : '') },
      flags: ['--no-crawl'], env: { SG_SHOT_FILE: join(shotDir, `${label}.png`) } });
    const test = fShot.visual?.tests?.[0];
    assert(fShot.code === EXIT.INFRA && test?.status === 'ERROR' && !test.screenshot
      && (test.screenshot_error || test.failure_reason || '').includes(`invalid ${label.startsWith('JPEG') ? 'JPEG' : 'PNG'}`)
      && fShot.run?.lanes?.visual?.remedy === 'infrastructure',
      `screenshot run: ${label} (${explicit ? 'explicit step' : 'automatic check'}) cannot produce a green run or image reference`);
  }
}
const fBoth = runFixture({ files: { 'pages/ok.yaml': OK_MANIFEST, 'pages/typo.yaml': 'name: "T"\nsteps:\n  - action: assert_txt\n    text: "Ok"\n' },
  flags: ['--no-crawl'], env: { SG_EMPTY_SHOT: '1' } });
assert(fBoth.code === EXIT.INFRA, 'exit: tooling and declaration faults together -> 2 outranks 3');

// logic-016: a dashboard that never built is a lane like any other, and
// cmdReview already maps the same crash to EXIT.INFRA
const fDash = runFixture({ files: { 'pages/ok.yaml': OK_MANIFEST }, flags: ['--no-crawl'], builder: 'process.exit(7);\n' });
assert(fDash.code === EXIT.INFRA, 'exit: a dashboard that failed to build -> 2, never a clean 0');
assert(fDash.run?.lanes?.review?.status === 'error' && fDash.run?.lanes?.review?.remedy === 'infrastructure',
  'exit: the failed dashboard is declared as an errored review lane');

// The reason an evidence gap on an ALREADY-FAILED test does not move the code:
// telling a CI "retry, the tooling broke" when a real, reproducible product
// failure is sitting in the artifact sends the human to the wrong place. It is
// safe because a SYSTEMIC capture failure still reaches 2 on its own — every
// test that would otherwise PASS is promoted to ERROR. Green both ways: this
// guards the decision, it does not prove the change.
const fGap = runFixture({ files: {
  'pages/ok.yaml': OK_MANIFEST,
  'pages/bad.yaml': 'name: "B"\nsteps:\n  - action: open\n    url: "{base_url}/ok.html"\n  - action: assert_text\n    text: "NEVER-ON-THIS-PAGE"\n',
}, flags: ['--no-crawl'], env: { SG_EMPTY_SHOT: '1' } });
assert(fGap.code === EXIT.INFRA, 'exit: a capture broken on every test still reaches 2 on its own');
const fGapBad = (fGap.visual?.tests || []).find((t) => t.id === 'pages/bad') || {};
assert(fGapBad.status === 'FAIL' && !!fGapBad.screenshot_error,
  'exit: the observed product failure keeps FAIL and records the evidence gap beside it');

// non-regression: the four documented codes on their own paths
const fClean = runFixture({ files: { 'pages/ok.yaml': OK_MANIFEST }, flags: ['--no-crawl'] });
assert(fClean.code === EXIT.CLEAN, 'exit: a healthy suite still exits 0');
assert(/copy differs: build-review\.mjs/.test(fClean.err), 'copies: run warns about a pinned builder without changing the clean verdict');
assert(Object.values(fClean.run?.lanes || {}).every((l) => !l.remedy), 'exit: a clean run declares no remedy anywhere');
assert(fClean.run?.lanes?.review?.status === 'ran', 'exit: a built dashboard is declared as a ran review lane');
assert(fClean.run?.exit_code === EXIT.CLEAN, 'exit: run.json records the code on the success path too');
const fFail = runFixture({ files: { 'pages/bad.yaml': 'name: "B"\nsteps:\n  - action: open\n    url: "{base_url}/ok.html"\n  - action: assert_text\n    text: "NEVER-ON-THIS-PAGE"\n' }, flags: ['--no-crawl'] });
assert(fFail.code === EXIT.FINDINGS, 'exit: a real product failure still exits 1');
assert(fFail.run?.exit_code === EXIT.FINDINGS, 'exit: run.json records the findings code');

// ── uncaught throw -> exit 2 (infra), never 1 (findings) ──
// Without a top-level catch, any throw becomes an unhandled rejection and Node
// exits 1 — the code reserved for "ran, findings present". Both halves matter:
// main() and 4 of the 7 subcommands are synchronous, so a sync throw escapes a
// catch chained onto Promise.resolve(main(...)) evaluated eagerly.
function cliRun(cmd, cwd, env) {
  try { execFileSync('node', [CLI, cmd], { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...env } }); }
  catch (e) { return { code: e.status, err: String(e.stderr || '') }; }
  return { code: 0, err: '' };
}

// async path: a DIRECTORY where run.json must be written makes cmdRun throw
// EISDIR mid-await. The trigger used to be a scheme-less base_url — until
// validateConfig started rejecting that at load and returning exit 3 before
// anything could throw. Two correct fixes, and the old fixture stopped
// reproducing its own scenario: the config here is deliberately VALID, so the
// only thing left to fail is the write itself.
const projT = mkdtempSync(join(tmpdir(), 'sg-throw-'));
mkdirSync(join(projT, 'visual-tests', '_results', 'run.json'), { recursive: true });
wf(join(projT, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:4711"\n');
const thrownAsync = cliRun('run', projT, {});
assert(thrownAsync.code === EXIT.INFRA, 'async throw -> exit 2 (infra), not 1 (findings)');
assert(/^shipguard: /m.test(thrownAsync.err), 'async throw -> one-line "shipguard:" diagnostic');
assert(!thrownAsync.err.includes('at writeFileSync'), 'async throw -> no raw stack by default');
assert(cliRun('run', projT, { SHIPGUARD_DEBUG: '1' }).err.includes('at writeFileSync'),
  'SHIPGUARD_DEBUG=1 restores the stack');

// sync path: a regular file where visual-tests/ must be a directory makes
// cmdInit's mkdirSync throw ENOTDIR synchronously, before any promise exists.
const projS = mkdtempSync(join(tmpdir(), 'sg-syncthrow-'));
wf(join(projS, 'visual-tests'), 'not a directory\n');
const thrownSync = cliRun('init', projS, {});
assert(thrownSync.code === EXIT.INFRA, 'sync throw -> exit 2 (infra), not 1 (findings)');
assert(/^shipguard: /m.test(thrownSync.err), 'sync throw -> one-line "shipguard:" diagnostic');

// ── review: the exit code is read from build-review.mjs, not assumed (u-03) ──
// Every non-zero code used to become EXIT.INFRA on the untested assumption that
// the builder can only fail as a tool. A missing visual-tests/_config.yaml is a
// config fault; the builder says so with code 3 and `review` must pass it on
// instead of reporting a broken machine.
const projRv = mkdtempSync(join(tmpdir(), 'sg-review-'));
mkdirSync(join(projRv, 'visual-tests'), { recursive: true });
const reviewNoConfig = cliRun('review', projRv, {});
assert(reviewNoConfig.code === EXIT.CONFIG, `review: missing _config.yaml -> exit 3 (got ${reviewNoConfig.code})`);
// The builder's other failures stay infra, and the observed code is named
// rather than swallowed.
wf(join(projRv, 'visual-tests', '_config.yaml'), 'base_url: "http://127.0.0.1:4711"\n');
wf(join(projRv, 'visual-tests', 'build-review.mjs'), 'console.error("builder blew up"); process.exit(7);\n');
const reviewBroken = cliRun('review', projRv, {});
assert(reviewBroken.code === EXIT.INFRA, `review: an unknown builder code stays infra (got ${reviewBroken.code})`);
assert(/exited 7/.test(reviewBroken.err), `review: the observed exit code is not reported (stderr: ${JSON.stringify(reviewBroken.err)})`);

// ── entry guard: a symlinked invocation path must still run the CLI ──
// process.argv[1] keeps the path the caller typed; import.meta.url carries the
// one the ESM loader resolved. A symlink anywhere in the path makes the two
// strings differ for the same file (macOS /var -> /private/var, i.e. every
// mktemp -d), and a string comparison then reads "imported as a library":
// the CLI ran nothing, printed nothing and exited 0.
const linkBase = mkdtempSync(join(tmpdir(), 'sg-guard-'));
const realDir = join(linkBase, 'real');
mkdirSync(realDir);
copyFileSync(CLI, join(realDir, 'shipguard.mjs'));
symlinkSync(realDir, join(linkBase, 'link'));
const viaLink = join(linkBase, 'link', 'shipguard.mjs');

const helpL = execFileSync('node', [viaLink, '--help'], { encoding: 'utf8' });
assert(helpL.includes('Subcommands:'), 'entry guard: symlinked path still runs the CLI');
let codeL = -1;
try { execFileSync('node', [viaLink, 'frobnicate'], { encoding: 'utf8', stdio: 'pipe' }); codeL = 0; }
catch (e) { codeL = e.status; }
assert(codeL === EXIT.CONFIG, 'entry guard: symlinked path still reports exit 3, not a silent 0');

// non-regression, the reason the guard exists: importing the module must expose
// its functions without executing the CLI. This very file imports it above.
wf(join(realDir, 'consumer.mjs'),
  "import { main, EXIT, loadManifests } from './shipguard.mjs';\n"
  + "console.log('imported', typeof main, typeof loadManifests, EXIT.INFRA);\n");
for (const [label, entry] of [['direct', join(realDir, 'consumer.mjs')], ['through symlink', join(linkBase, 'link', 'consumer.mjs')]]) {
  const libOut = execFileSync('node', [entry], { encoding: 'utf8' });
  assert(libOut.trim() === 'imported function function 2', `entry guard: library import (${label}) does not run the CLI`);
}
// Exercise the actual live-probe block with an opened browser whose click fails.
// This is deliberately isolated: it cannot use or close a real browser session.
const liveSource = rf(fileURLToPath(import.meta.url), 'utf8');
const liveStart = liveSource.indexOf('\nlet liveSkip = null;');
const liveEnd = liveSource.indexOf('\nif (liveSkip)', liveStart);
const liveProbe = liveSource.slice(liveStart, liveEnd);
const liveFault = spawnSync('node', ['--input-type=module', '-e', `
  let failures = 0;
  const assert = ok => { if (!ok) failures++; };
  const abBin='fixture', livePage='fixture';
  const matchSnapshotRef = () => '@e1';
  const ab = cmd => { if(cmd==='click') throw new Error('unsupported click'); return '- button "Go" [ref=e1]'; };
  ${liveProbe}
  process.exit(failures > 0 ? 1 : 0);
`], { encoding: 'utf8' });
assert(liveFault.status === 1, 'r1-z01-021: browser command failure after open fails the live probe instead of SKIP');

// ── matchSnapshotRef vs the real binary (fixture-vs-binary guard) ──
// The fixtures above are captured, not invented — but a captured fixture still
// freezes. This probe re-derives the contract from whatever agent-browser is
// installed: snapshot shape in, `@eN` out, and the ref actually accepted by a
// consuming command. A future format change fails here instead of silently
// breaking every click/fill/select/upload in the field. Skipped (never failed)
// when no browser is available, so this stays a smoke test, not an e2e suite.
const abBin = process.env.SHIPGUARD_AGENT_BROWSER || 'agent-browser';
const abSession = `sg-cli-smoke-${process.pid}`;
const ab = (...a) => execFileSync(abBin, ['--session', abSession, ...a], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
const liveDir = mkdtempSync(join(tmpdir(), 'sg-live-'));
const livePage = join(liveDir, 'probe.html');
wf(livePage, '<!doctype html><meta charset="utf-8"><title>sg probe</title>'
  + '<button onclick="document.getElementById(\'o\').textContent=\'HIT\'">Nouvelle conversation</button>'
  + '<p id="o">MISS</p>');
let liveSkip = null;
let liveOpened = false;
try {
  ab('open', `file://${livePage}`);
  liveOpened = true;
  const liveSnap = ab('snapshot', '-i');
  const liveRef = matchSnapshotRef(liveSnap, 'Nouvelle conversation');
  assert(liveRef !== null, `live: ${abBin} snapshot parsed (got: ${JSON.stringify(liveSnap.trim().split('\n')[0])})`);
  if (liveRef) {
    ab('click', liveRef);
    assert(ab('get', 'text', '#o').trim() === 'HIT', 'live: ref returned by matchSnapshotRef is clickable');
  }
} catch (e) {
  const reason = String(e.stderr || e.message).trim().split('\n')[0];
  if (liveOpened) assert(false, `live: browser command failed after open (${reason})`);
  else liveSkip = e.code === 'ENOENT' ? `${abBin} not installed` : reason;
} finally {
  try { ab('close'); } catch { /* browser already gone */ }
}
if (liveSkip) console.log(`  SKIP live agent-browser format check (${liveSkip})`);

console.log(fails === 0 ? 'cli-smoke-test: ALL PASS' : `cli-smoke-test: ${fails} FAILURES`);
process.exit(fails > 0 ? 1 : 0);
