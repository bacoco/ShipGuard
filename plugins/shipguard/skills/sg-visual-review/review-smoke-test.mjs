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
import { createServer, request as httpRequest } from 'http';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn, spawnSync } from 'child_process';
import { runInNewContext } from 'vm';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_BUILD = join(SCRIPT_DIR, 'build-review.mjs');
const SOURCE_TEMPLATE = join(SCRIPT_DIR, '_review-template.html');
const DEFAULT_PORT_BASE = 21000;

function parseArgs() {
  const options = {
    port: null,
    keepTmp: false,
    debug: false,
    pidOnly: false,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--keep-tmp') options.keepTmp = true;
    else if (arg === '--pid-only') options.pidOnly = true;
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
  writeFileSync(join(root, 'pages', 'quarantined.yaml'), [
    'name: Quarantined',
    'description: Carries a status word this build does not know',
    'steps:',
    '  - action: open',
    '    url: /quarantined',
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
    // `quarantined` is a bucket this build has never heard of, and it must
    // survive alongside the five it knows.
    summary: { total: 3, pass: 1, fail: 1, error: 0, stale: 0, skipped: 0, quarantined: 1, duration_ms: 1200 },
    tests: [
      { id: 'pages/root-index', manifest: 'visual-tests/pages/root-index.yaml', name: 'Home', url: '/', status: 'PASS', duration_ms: 1200, screenshot: null, failure_reason: null, browser_errors: [], llm_steps_pending: 0 },
      // No pages/broken.yaml on disk: a producer result whose manifest is gone
      // is still a result, and carries every additive field of report-formats.md.
      { id: 'pages/broken', manifest: 'visual-tests/pages/broken.yaml', name: 'Broken', url: '/broken.html', status: 'FAIL', duration_ms: 900, screenshot: null, failure_reason: 'assert_text: not found', browser_errors: [{ level: 'error', text: 'Uncaught TypeError: x is not a function' }], screenshot_error: 'screenshot empty file', console_capture_error: 'agent-browser: console bridge crashed', manifest_error: 'unknown action "clik"' },
      { id: 'pages/quarantined', manifest: 'visual-tests/pages/quarantined.yaml', name: 'Quarantined', url: '/quarantined', status: 'QUARANTINED', duration_ms: 10, screenshot: null, failure_reason: 'held for triage' },
    ],
  });
  writeJson(join(root, '_results', 'audit-results.json'), {
    summary: { total_bugs: 1, files_audited: 1, by_severity: { critical: 1, high: 0, medium: 0, low: 0 }, by_category: {} },
    bugs: [{ id: 'r1-z01-001', severity: 'critical', category: 'security', file: 'app.py', line: 12,
      title: 'Missing ownership check', description: 'Any user can read any doc.',
      verification_score: 90, verified: true,
      verification_protocol: { status: 'parsed', reason: null, semantic_verification: 'not_verified',
        raw_reply: 'PRIVATE VERIFIER RESPONSE', raw_reply_bytes: 25, raw_reply_sha256: 'private-digest' } }],
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
  writeJson(join(root, '_results', 'logic-results.json'), {
    schema_version: '1.0',
    repo: 'smoke-fixture',
    timestamp: '2026-08-29T10:00:00Z',
    mode: 'reason',
    depth: 'standard',
    status: 'completed',
    summary: {
      candidates_checked: 1, obligations_checked: 1, confirmed_violations: 1,
      risks: 0, contract_conflicts: 1, questions: 1, uncovered: 1,
      evidence_mix: { reasoned: 1, measured: 0 },
    },
    candidates: [{
      id: 'p01', kind: 'procedure', name: 'job lifecycle', files: ['worker.py'],
      obligations: [{ id: 'o01', statement: 'Completed jobs cannot return to running', source_kind: 'declared', confidence: 'high' }],
      findings: [{
        id: 'logic-001', kind: 'invariant-violation', severity: 'high', status: 'confirmed',
        obligation_id: 'o01', evidence: 'reasoned', confidence: 'high',
        counterexample: 'late retry callback', file: 'worker.py', line: 41,
      }],
    }],
    contract_conflicts: [{ candidate_id: 'p01', description: 'Contract requires cents; consumer expects euros', source: 'docs/currency.md', sources: [{ file: 'client.py', line: 12 }] }],
    questions: [{ candidate_id: 'p01', description: 'Who decides the session versus global scope?', source: 'docs/scope.md' }],
    uncovered: [{ candidate_id: 'p01', description: 'Worker recovery path could not be traced', file: 'worker.py' }],
    skipped: [],
    impacted_backend: [], impacted_ui_routes: [],
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
      logic: { status: 'ran', results: 'logic-results.json' },
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

// #144: exercise YAML through the real generator and its embedded dashboard data.
function checkYamlRegressions() {
  const root = mkdtempSync(join(tmpdir(), 'shipguard-review-yaml-'));
  const failures = [];
  const check = (label, fn) => { try { fn(); } catch (error) { failures.push(`${label}: ${error.message}`); } };
  try {
    copyFileSync(SOURCE_BUILD, join(root, 'build-review.mjs'));
    copyFileSync(SOURCE_TEMPLATE, join(root, '_review-template.html'));
    mkdirSync(join(root, 'pages'));
    writeFileSync(join(root, '_config.yaml'), 'base_url: null\n');
    // HTML stringifies step values; inspect the production parser as well to
    // distinguish quoted booleans/numbers from the unchanged unquoted types.
    check('scalar types', () => {
      const source = readFileSync(SOURCE_BUILD, 'utf8');
      const context = {};
      runInNewContext(source.slice(source.indexOf('function yamlParse('), source.indexOf('const yaml =')), context);
      for (const raw of ['0042', 'true', 'false', 'null', '~', '|', '>', '!!str', '!local', '!<tag:example.com,2026:label>']) {
        const quoted = JSON.stringify(raw);
        const doc = context.yamlParse(`name: ${quoted}\ndata:\n  value: ${quoted}\nsteps:\n  - expected: ${quoted}\n    criteria: ${quoted}\n`);
        assert([doc.name, doc.data.value, doc.steps[0].expected, doc.steps[0].criteria].every(v => v === raw),
          `quoted ${raw} changed type or value`);
      }
      const doc = context.yamlParse('count: 42\nenabled: true\nempty: null\ntilde: ~\ndata:\n  count: 42\nsteps:\n  - count: 42\n    enabled: false\n');
      assert(doc.count === 42 && doc.enabled === true && doc.empty === null && doc.tilde === null,
        'unquoted top-level types changed');
      assert(doc.steps[0].count === 42 && doc.steps[0].enabled === false && doc.data.count === '42',
        'unquoted array/nested types changed');
      assert(context.yamlParse("name: 'l''accueil' # comment").name === "l'accueil", 'single quote escape lost');
      assert(context.yamlParse('name: "a # b" # comment').name === 'a # b', 'quoted hash lost');
      assert(context.yamlParse('name: "a\\n\\"b\\""').name === 'a\n"b"', 'double quote escapes lost');
    });
    const manifestPath = join(root, 'pages', 'yaml.yaml');
    const build = () => spawnSync(process.execPath, ['build-review.mjs'], { cwd: root, encoding: 'utf8' });
    writeFileSync(manifestPath, [
      'name: "0042"',
      "description: '  true  ' # keep spaces and type",
      'requires_auth: false',
      'steps:',
      '  - expected: "0042"',
      "    criteria: 'false'",
      '  - action: open',
      '    url: "{base_url}/"',
      '',
    ].join('\n'));
    check('quoted strings', () => {
      const result = build();
      assert(result.status === 0, result.stderr);
      const html = readFileSync(join(root, '_results/review.html'), 'utf8');
      const data = JSON.parse(html.match(/var __VISUAL_DATA__ = ([\s\S]*?);\nvar __RECORDED_DATA__/)[1]);
      const test = data.tests[0];
      assert(test.name === '0042', `name became ${JSON.stringify(test.name)}`);
      assert(test.description === '  true  ', 'quoted whitespace/comment was altered');
      assert(test.steps[0].expected === '0042', 'array leading property lost its quoted type');
      assert(test.steps[0].criteria === 'false', 'array property lost its quoted type');
      assert(test.requiresAuth === false, 'unquoted false changed type');
      assert(test.url === 'http://localhost:6969/', 'unquoted null config changed type');
    });
    const historical = [
      'name: "0042"', 'description: |', '  First line', '  Second line',
      'steps:', '  - action: open', '    url: "{base_url}/"',
      '  - action: llm-check', '    criteria: |',
      '      The heading is visible', '      The form is labelled', '',
    ].join('\n');
    const refused = [
      ['historical #12', historical],
      ['tagged block (Astra)', [
        'name: Tagged block', 'description: !!str |', '  First line', '  Second line',
        'steps:', '  - action: llm-check', '    criteria: !!str |', '      The heading is visible', '',
      ].join('\n')],
      ['tagged quoted string (Astra)', 'name: !!str "0042"\n'],
      ['tagged folded block', 'description: !!str >-\n  first\n  second\n'],
      ['tagged array leading property', 'steps:\n  - criteria: !!str |\n      first\n'],
      ['tagged array property', 'steps:\n  - action: llm-check\n    criteria: !!str |\n      first\n'],
      ['tagged nested value', 'data:\n  value: !!int "0042"\n'],
      ['tagged scalar list item', 'tags:\n  - !label demo\n'],
      ['tagged inline list item', 'tags: [!!str "0042"]\n'],
      ['local tag', 'name: !label "0042"\n'],
      ['named tag handle', 'name: !custom!label "0042"\n'],
      ['verbatim tag', 'name: !<tag:yaml.org,2002:str> "0042"\n'],
      ['folded block', 'description: >- # folded\n  first\n  second\n'],
      ['array leading block', 'steps:\n  - criteria: |+\n      first\n'],
      ['array property block', 'steps:\n  - action: llm-check\n    criteria: |\n      first\n'],
      ['nested block', 'data:\n  criteria: >2-\n    first\n'],
      ['anchor', 'name: &label Demo\n'],
      ['alias', 'name: *label\n'],
      ['multiline quote', 'name: "first\n  second"\n'],
      ['unsupported escape', 'name: "\\e"\n'],
    ];
    for (const [label, yaml] of refused) check(label, () => {
      // A refusal must neither create a misleading report nor rewrite existing evidence.
      for (const existing of [false, true]) {
        const paths = ['review.html', 'visual-results.json', 'findings.json'].map(name => join(root, '_results', name));
        for (const path of paths) {
          rmSync(path, { force: true });
          if (existing) writeFileSync(path, 'previous evidence');
        }
        writeFileSync(manifestPath, yaml);
        const result = build();
        assert(result.status !== 0, 'unsupported YAML was accepted with exit 0');
        assert(result.stderr.includes(manifestPath) && /unsupported YAML/i.test(result.stderr) && /at line \d+/.test(result.stderr),
          `missing explicit file diagnostic: ${result.stderr}`);
        for (const path of paths) assert(existing ? readFileSync(path, 'utf8') === 'previous evidence' : !existsSync(path),
          'refused YAML changed generated output');
      }
    });
    // All YAML readers carry the same filename diagnostic, even outside walkDir.
    for (const filename of ['_config.yaml', '_regressions.yaml']) check(filename, () => {
      rmSync(manifestPath);
      const path = join(root, filename);
      writeFileSync(path, 'description: |\n  unsupported\n');
      const result = build();
      assert(result.status !== 0 && result.stderr.includes(path) && /unsupported YAML/i.test(result.stderr),
        'unsupported YAML did not fail explicitly');
      rmSync(path);
      writeFileSync(manifestPath, 'name: Plain\n');
      if (filename === '_config.yaml') writeFileSync(path, 'base_url: null\n');
    });
    assert(!failures.length, failures.join('\n'));
    console.log('review YAML regressions passed');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function checkManifestDiscovery() {
  const root = mkdtempSync(join(tmpdir(), 'shipguard-review-discovery-'));
  try {
    copyFileSync(SOURCE_BUILD, join(root, 'build-review.mjs'));
    copyFileSync(SOURCE_TEMPLATE, join(root, '_review-template.html'));
    mkdirSync(join(root, '_results'), { recursive: true });
    writeFileSync(join(root, '_config.yaml'), 'base_url: http://localhost:8001\n');
    const cases = [
      ['pages/existing.yaml', 'PASS'],
      ['pages/nested/flow.yaml-copy.yml', 'FAIL'],
      ['root-yaml.yaml', 'PASS'],
      ['root-yml.yml', 'ERROR'],
    ];
    const ignored = [
      '_helper.yaml', '_helper.yml', '.hidden.yaml', '.hidden.yml',
      '_shared/login.yml', '.private/login.yaml', 'lib/helper.yml',
      'node_modules/helper.yaml', 'manifests/recorded.yaml', 'notes.txt',
    ];
    for (const path of [...cases.map(([path]) => path), ...ignored, 'old.yml', 'pages/old.yml']) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), `name: ${path}\n${path.endsWith('old.yml') ? 'deprecated: true\n' : ''}steps:\n  - action: open\n    url: /example\n`);
    }
    const producer = {
      schema_version: '1.0',
      run_id: 'manifest-discovery',
      summary: { total: 4, pass: 2, fail: 1, error: 1, stale: 0, skipped: 0 },
      scope: { type: 'full', selected_total: 4 },
      tests: cases.map(([path, status], index) => ({
        id: path.replace(/\.ya?ml$/, ''), manifest: `visual-tests/${path}`, status,
        duration_ms: index + 1, screenshot: null, failure_reason: status === 'PASS' ? null : 'measured reason',
      })),
    };
    writeJson(join(root, '_results/visual-results.json'), producer);
    const build = spawnSync(process.execPath, ['build-review.mjs'], { cwd: root, encoding: 'utf8' });
    assert(build.status === 0, `manifest discovery build failed: ${build.stderr}`);
    const html = readFileSync(join(root, '_results/review.html'), 'utf8');
    const data = JSON.parse(html.match(/var __VISUAL_DATA__ = ([\s\S]*?);\nvar __RECORDED_DATA__/)[1]);
    assert(data.tests.length === cases.length, 'manifest discovery omitted a supported path or included a private/deprecated file');
    for (const result of producer.tests) {
      const test = data.tests.find(test => test.id === result.id);
      assert(test, `manifest missing from review: ${result.manifest}`);
      assert(test.status === result.status && test.durationMs === result.duration_ms && test.inLastRun,
        `producer result not matched to ${result.manifest}`);
      assert(test.failureReason === result.failure_reason, `failure reason changed for ${result.manifest}`);
      assert(data.categories.includes(test.category), `sidebar category missing for ${result.manifest}`);
    }
    for (const key of ['total', 'pass', 'fail', 'error', 'stale', 'skipped']) {
      assert(data.summary[key] === producer.summary[key], `review ${key} count disagrees with discovered manifests`);
    }
    const persisted = JSON.parse(readFileSync(join(root, '_results/visual-results.json'), 'utf8'));
    assert(persisted.generated_at, 'manifest discovery build did not retain its generated_at contract');
    delete persisted.generated_at;
    assert(JSON.stringify(persisted) === JSON.stringify(producer), 'manifest discovery changed producer storage');
    const recorded = JSON.parse(html.match(/var __RECORDED_DATA__ = ([\s\S]*?);\n/)[1]);
    assert(recorded.length === 1 && recorded[0].file === 'recorded.yaml', 'recorded manifests changed category or storage');
    console.log('Manifest discovery regressions passed (.yml nested, .yaml/.yml root, exclusions, producer storage).');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function checkAuditRegressions() {
  const root = mkdtempSync(join(tmpdir(), 'shipguard-review-regressions-'));
  const failures = [];
  const check = (id, fn) => { try { fn(); } catch (error) { failures.push(`${id}: ${error.message}`); } };
  try {
    copyFileSync(SOURCE_BUILD, join(root, 'build-review.mjs'));
    copyFileSync(SOURCE_TEMPLATE, join(root, '_review-template.html'));
    writeFileSync(join(root, '_config.yaml'), 'base_url: http://localhost:8001\n');
    for (const id of ['user/login', 'admin/login', 'pages/error', 'pages/old', 'pages/unique']) {
      mkdirSync(join(root, dirname(id)), { recursive: true });
      writeFileSync(join(root, id + '.yaml'), `name: ${id}\nsteps:\n  - action: open\n    url: /\n`);
    }
    mkdirSync(join(root, '_results/screenshots/nested'), { recursive: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=', 'base64');
    writeFileSync(join(root, '_results/screenshots/nested/custom.png'), png);
    writeFileSync(join(root, '_results/screenshots/old.png'), png);
    writeJson(join(root, '_results/visual-results.json'), { tests: [
      { id: 'login', manifest: 'visual-tests/user/login.yaml', status: 'PASS', duration_ms: 17, screenshot: 'screenshots/nested/custom.png' },
      { id: 'pages/error', status: 'ERROR', failure_reason: 'browser unavailable', screenshot: null },
      { id: 'unique', status: 'PASS' },
    ] });
    writeJson(join(root, '_results/process-results.json'), { units: [{ id: 'mixed', verdict: 'behavior-changed', actions: [
      { delta: 'unchanged', evidence: 'measured' }, { delta: 'wrong result', evidence: 'reasoned' },
    ] }] });
    const build = spawnSync(process.execPath, ['build-review.mjs'], { cwd: root, encoding: 'utf8' });
    assert(build.status === 0, build.stderr);
    const html = readFileSync(join(root, '_results/review.html'), 'utf8');
    const data = JSON.parse(html.match(/var __VISUAL_DATA__ = ([\s\S]*?);\nvar __RECORDED_DATA__/)[1]);
    const byId = id => data.tests.find(t => t.id === id);
    check('r1-z04-001', () => {
      assert(byId('user/login').status === 'PASS', 'qualified result lost');
      assert(byId('admin/login').status === 'STALE', 'unexecuted same-basename test inherited PASS');
      assert(byId('admin/login').durationMs === undefined, 'duration crossed identities');
      assert(byId('pages/unique').status === 'PASS', 'unique legacy slug no longer resolves');
    });
    check('r1-z04-004', () => assert(byId('user/login').screenshot === 'screenshots/nested/custom.png', 'producer screenshot path ignored'));
    check('r1-z04-007', () => {
      const findings = JSON.parse(readFileSync(join(root, '_results/findings.json'), 'utf8'));
      assert(findings.findings.find(f => f.source === 'process').evidence === 'reasoned', 'mixed proof upgraded to measured');
    });
    const slice = (start, end) => {
      const a = html.indexOf(start), b = html.indexOf(end, a);
      assert(a >= 0 && b > a, `renderer boundaries missing: ${start}`);
      return html.slice(a, b);
    };
    const nodes = new Map();
    function element() {
      const classes = new Set();
      return { style: {}, value: '', children: [], handlers: {}, focus() {}, appendChild(x) { this.children.push(x); },
        addEventListener(name, fn) { this.handlers[name] = fn; },
        classList: { add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, contains(c) { return classes.has(c); } } };
    }
    const document = { createElement: element, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; },
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); } };
    check('r1-z04-002', () => {
      const context = { document, pendingAnnot: {}, editingIndex: 0, selectedCount: 0 };
      runInNewContext(slice('function showNoteInput(', 'function saveAnnotation(') + slice("document.addEventListener('keydown', function(e) {", '// ── Toast'), context);
      context.showNoteInput('first'); document.handlers.keydown({ key: 'Escape' }); context.showNoteInput('second');
      const overlay = document.getElementById('note-overlay');
      assert(overlay.classList.contains('visible') && overlay.style.display !== 'none', 'note stays hidden after Escape');
      assert(context.pendingAnnot === null && context.editingIndex === null, 'Escape must cancel pending annotation');
    });
    check('r1-z04-003', () => {
      const context = { document, selected: { x: true }, selectedCount: 1, annotationData: { x: [] }, redoFlags: { x: true }, revertFlags: { x: true }, renderGrid() {}, updateBar() {} };
      runInNewContext(slice('function toggleSelect(', 'var redoFlags ='), context);
      context.toggleSelect('x'); context.toggleSelect('x');
      assert(!context.revertFlags.x, 'deselect retained revert intent');
      context.revertFlags.x = true;
      runInNewContext(slice("document.getElementById('btn-clear').addEventListener(", '// ── Lightbox navigation'), context);
      document.getElementById('btn-clear').handlers.click();
      assert(!context.revertFlags.x, 'Clear retained revert intent');
    });
    check('r1-z04-005', () => {
      const context = { document, D: data, lastRunOnly: true, activeCat: 'all', activeStatus: 'ALL', query: '', isUpdated() { return false; } };
      runInNewContext(slice('function renderSidebar(', 'function renderGrid('), context);
      const ids = context.getFiltered().map(t => t.id);
      assert(ids.includes('pages/error'), 'last-run error without screenshot hidden');
      assert(!ids.includes('pages/old') && !ids.includes('admin/login'), 'unexecuted tests included');
      context.renderSidebar();
      assert(document.getElementById('cat-list').children[0].children[1].textContent === ids.length, 'sidebar count disagrees with last-run grid');
    });
    check('r1-z04-006', () => {
      const context = { document };
      runInNewContext(slice('function procVerdictBadge(', 'function procEvidenceOf('), context);
      assert(context.procVerdictBadge('unchanged').className === 'badge badge-pass', 'unchanged classified as changed');
      assert(context.procVerdictBadge('behavior-changed').className === 'mc-sev mc-sev-high', 'changed verdict lost warning');
    });
    assert(!failures.length, failures.join('\n'));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Execute the production stop/replacement blocks with in-memory files and
// signal spies only. Never send even signal 0 to a real process (#143).
async function checkPidRegressions() {
  const source = readFileSync(SOURCE_BUILD, 'utf8');
  const helperStart = source.indexOf('// Check whether a PID');
  const stopStart = source.indexOf('// ── --stop:');
  const stopEnd = source.indexOf('// Dynamically discover', stopStart);
  const serveStart = source.indexOf("if (process.argv.includes('--serve')) {");
  const serveEnd = source.indexOf("  const http = await import('http');", serveStart);
  assert(helperStart >= 0 && stopStart > helperStart && stopEnd > stopStart
    && serveStart > stopEnd && serveEnd > serveStart, 'PID block boundaries missing');
  const helpers = source.slice(helperStart, stopStart);
  const invalid = ['', ' ', '0', '-1', '-42', '4242junk', '12.5', '1e3', '+4242',
    '0x1092', 'NaN', 'Infinity', '4242 43', '9007199254740992', '9'.repeat(400)];
  const failures = [];
  let checked = 0;
  for (const mode of ['stop', 'serve']) {
    const scenarios = [
      ...invalid.map(text => ({ text, invalid: true })),
      { text: '4242', pid: 4242 },
      { text: ' 004242 \n8888\n', pid: 4242 },
      { text: '9007199254740991', pid: Number.MAX_SAFE_INTEGER },
      { text: '4242', pid: 4242, stale: true },
      { text: '7777', pid: 7777, self: true },
      { text: null },
    ];
    for (const scenario of scenarios) {
      const label = `${mode} PID ${JSON.stringify(scenario.text)}`;
      const calls = [], errors = [], removed = [];
      let stopped = false, exitCode = null;
      const exit = {};
      const context = {
        PID_FILE: '/fixture/.server.pid',
        existsSync: () => scenario.text !== null,
        readFileSync: () => scenario.text,
        unlinkSync: path => removed.push(path),
        console: { log() {}, error: message => errors.push(message) },
        process: {
          argv: [mode === 'stop' ? '--stop' : '--serve'], pid: 7777,
          exit(code) { exitCode = code; throw exit; },
          kill(pid, signal) {
            calls.push([pid, signal]);
            if (scenario.stale || stopped) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
            if (signal === undefined) stopped = true;
          },
        },
        setTimeout(resolve) { resolve(); },
      };
      const block = mode === 'stop' ? source.slice(stopStart, stopEnd)
        : source.slice(serveStart, serveEnd) + '\n}';
      try {
        try { await runInNewContext(`(async () => {\n${helpers}\n${block}\n})()`, context); }
        catch (error) { if (error !== exit) throw error; }
        if (scenario.invalid) {
          assert(calls.length === 0, `${label}: reached signal spy ${JSON.stringify(calls)}`);
          assert(exitCode === 1 && errors.some(message => /Invalid PID file/.test(message)), `${label}: missing explicit refusal`);
          assert(removed.length === 0, `${label}: invalid PID evidence removed`);
        } else {
          const expected = scenario.text === null || (mode === 'serve' && scenario.self) ? []
            : scenario.stale ? [[scenario.pid, 0]]
            : mode === 'stop' ? [[scenario.pid, 0], [scenario.pid, undefined]]
            : [[scenario.pid, 0], [scenario.pid, undefined], [scenario.pid, 0]];
          assert(JSON.stringify(calls) === JSON.stringify(expected), `${label}: nominal/stale/self behavior changed`);
          assert(exitCode === (mode === 'stop' ? 0 : null) && errors.length === 0, `${label}: unexpected refusal`);
          assert(removed.length === (mode === 'stop' && scenario.text !== null ? 1 : 0), `${label}: cleanup changed`);
        }
        checked++;
      } catch (error) { failures.push(error.message); }
    }
  }
  assert(failures.length === 0, `PID regressions (${failures.length} failures):\n${failures.join('\n')}`);
  console.log(`PID regressions passed: ${checked} cases, signal spies only`);
}

// #190: the review must not attribute A's retained crawl to B's --no-crawl run.
async function checkCrawlHistory() {
  const root = mkdtempSync(join(tmpdir(), 'shipguard-review-crawl-history-'));
  const visual = join(root, 'visual-tests');
  const results = join(visual, '_results');
  mkdirSync(visual);
  copyFileSync(SOURCE_BUILD, join(visual, 'build-review.mjs'));
  copyFileSync(SOURCE_TEMPLATE, join(visual, '_review-template.html'));
  let fixed = false;
  let linkRequests = 0;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/') return res.end('<a href="/missing.html">Link</a>');
    linkRequests++;
    res.statusCode = fixed ? 200 : 404;
    res.end(fixed ? 'Fixed' : 'Missing');
  });
  const cli = join(SCRIPT_DIR, '..', '..', 'cli', 'shipguard.mjs');
  const run = flags => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'run', '--profile=links', ...flags], { cwd: root, stdio: 'pipe' });
    const log = createProcessLog(child);
    child.on('error', reject);
    child.on('close', code => resolve({ code, log: log.tail() }));
  });
  const read = name => readFileSync(join(results, name), 'utf8');
  let passed = false;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    writeFileSync(join(visual, '_config.yaml'), `base_url: http://127.0.0.1:${server.address().port}\nprofiles:\n  links:\n    checks: [local-assets]\n`);
    const a = await run([]);
    assert(a.code === 1, `crawl A: expected product findings, got ${a.code}: ${a.log}`);
    const crawlA = read('crawl-results.json');
    const source = JSON.parse(crawlA);
    const findingA = JSON.parse(read('findings.json')).findings.find(f => f.source === 'crawler');
    assert(source.broken.length === 1 && source.broken[0].status === 404, 'crawl A: broken link was not measured');
    assert(findingA.title === 'Missing local resource (a)' && findingA.origin.timestamp === source.timestamp
      && findingA.origin.historical === false, 'crawl A: current evidence was mislabeled');

    fixed = true;
    const requestsBeforeB = linkRequests;
    const b = await run(['--no-crawl']);
    assert(b.code === 3, `crawl B: empty run result changed, got ${b.code}: ${b.log}`);
    const runB = read('run.json');
    assert(JSON.parse(runB).lanes.crawl.status === 'skipped' && JSON.parse(runB).exit_code === b.code,
      'crawl B: skipped lane or run outcome changed');
    assert(linkRequests === requestsBeforeB && read('crawl-results.json') === crawlA,
      'crawl B: skipped crawl made requests or changed the retained artifact');
    const findingB = JSON.parse(read('findings.json')).findings.find(f => f.source === 'crawler');
    assert(findingB.origin.historical === true && findingB.origin.timestamp === source.timestamp
      && findingB.title === `Historical crawl (${source.timestamp}): ${findingA.title}`,
      'crawl B: retained crawl was not explicitly dated and historical');
    const { title: titleA, origin: originA, ...restA } = findingA;
    const { title: titleB, origin: originB, ...restB } = findingB;
    assert(JSON.stringify(restB) === JSON.stringify(restA), 'crawl B: historical evidence changed beyond attribution');

    // A standalone review rebuild must also preserve the producer documents.
    const rebuilt = spawnSync(process.execPath, ['build-review.mjs'], { cwd: visual, encoding: 'utf8' });
    assert(rebuilt.status === 0 && read('run.json') === runB && read('crawl-results.json') === crawlA,
      'review rebuild changed the source crawl or the current run');
    assert(read('review.html').includes(findingB.title), 'historical attribution did not reach the review page');
    passed = true;
    console.log('crawl history regression passed: A crawl with broken link, B --no-crawl; artifacts and exits preserved');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (passed) rmSync(root, { recursive: true, force: true });
    else console.error(`crawl history fixture kept: ${root}`);
  }
}

async function main() {
  const options = parseArgs();
  await checkPidRegressions();
  if (options.pidOnly) return;
  let root = null;
  let port = null;
  let server = null;
  let log = null;
  let passed = false;
  try {
    checkYamlRegressions();
    checkManifestDiscovery();
    checkAuditRegressions();
    await checkCrawlHistory();
    root = createFixture();
    const producerDoc = JSON.parse(readFileSync(join(root, '_results', 'visual-results.json'), 'utf8'));
    const auditBefore = readFileSync(join(root, '_results', 'audit-results.json'), 'utf8');
    const firstBuild = spawnSync(process.execPath, ['build-review.mjs'], { cwd: root, encoding: 'utf8' });
    assert(firstBuild.status === 0, `build-review.mjs exited ${firstBuild.status}: ${firstBuild.stderr}`);
    assert(existsSync(join(root, '_results', 'review.html')), 'review.html was not generated');
    assert(existsSync(join(root, '_results', 'visual-results.json')), 'visual-results.json was not generated');
    const rebuiltVisualResults = JSON.parse(readFileSync(join(root, '_results', 'visual-results.json'), 'utf8'));
    assert(rebuiltVisualResults.run_id === 'visual-smoke-20260629-133000', 'visual-results run_id was not preserved');
    assert(rebuiltVisualResults.scope?.type === 'from-audit', 'visual-results scope was not preserved');
    assert(rebuiltVisualResults.scope?.full_suite_total === 99, 'visual-results full_suite_total was not preserved');
    assert(rebuiltVisualResults.scope?.uncovered_routes?.[0]?.reason === 'no_visual_manifest', 'visual-results uncovered routes were not preserved');
    assert(existsSync(join(root, '_results', 'persona-reports', 'demo', 'index.html')), 'persona report was not generated');

    // ── The dashboard is a rendering layer: it adds, it does not destroy ──
    // Everything below describes what the producer wrote and what must still be
    // there once the page a human reads has been built on top of it.
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const testById = (doc, id) => (doc.tests || []).find(t => t && t.id === id);
    assert(rebuiltVisualResults.tests.length === producerDoc.tests.length,
      `producer results were dropped: ${producerDoc.tests.length} in, ${rebuiltVisualResults.tests.length} out`);
    assert(testById(rebuiltVisualResults, 'pages/broken'),
      'a producer result whose manifest is no longer on disk was deleted');
    const broken = testById(rebuiltVisualResults, 'pages/broken');
    assert(broken.failure_reason === 'assert_text: not found',
      `producer failure_reason was dropped (got ${JSON.stringify(broken.failure_reason)})`);
    for (const field of ['screenshot_error', 'console_capture_error', 'manifest_error']) {
      assert(eq(broken[field], testById(producerDoc, 'pages/broken')[field]),
        `additive producer field ${field} was dropped`);
    }
    assert(eq(broken.browser_errors, testById(producerDoc, 'pages/broken').browser_errors),
      'browser_errors was not preserved');
    const home = testById(rebuiltVisualResults, 'pages/root-index');
    assert(Array.isArray(home.browser_errors) && home.browser_errors.length === 0,
      'an observed-empty browser_errors was dropped, turning "no errors seen" into "nothing said"');
    assert(home.llm_steps_pending === 0, 'llm_steps_pending: 0 was dropped');
    assert(home.manifest === 'visual-tests/pages/root-index.yaml',
      `the producer's manifest path was rewritten (got ${JSON.stringify(home.manifest)})`);
    assert(home.url === '/', `the producer's recorded url was rewritten (got ${JSON.stringify(home.url)})`);
    // summary and scope describe the same run: recomputing one and preserving
    // the other made them contradict each other.
    assert(eq(rebuiltVisualResults.summary, producerDoc.summary),
      `summary was recomputed instead of preserved (got ${JSON.stringify(rebuiltVisualResults.summary)})`);
    assert(eq(rebuiltVisualResults.scope, producerDoc.scope), 'scope was rewritten instead of preserved');
    assert(rebuiltVisualResults.generated_at, 'generated_at (the one additive field) is missing');

    // ── An unknown status word is a contract fault, not selector drift ──
    const quarantined = testById(rebuiltVisualResults, 'pages/quarantined');
    assert(quarantined.status === 'QUARANTINED',
      `an unknown status was coerced instead of preserved (got ${JSON.stringify(quarantined.status)})`);
    assert(/WARN: status "QUARANTINED"/.test(firstBuild.stderr),
      `the unknown status was accepted silently (stderr: ${JSON.stringify(firstBuild.stderr)})`);
    assert(!/"status": "STALE"/.test(JSON.stringify(quarantined)), 'unknown status was filed as STALE');
    const firstHtml = readFileSync(join(root, '_results', 'review.html'), 'utf8');
    assert(/"name":\s*"Quarantined"[\s\S]{0,600}"status":\s*"ERROR"/.test(firstHtml),
      'the unknown-status test is not rendered in a bucket a human will look at');
    // The producer's measured reason must reach the page, not only the file.
    assert(firstHtml.includes('assert_text: not found') || firstHtml.includes('held for triage'),
      'no producer failure_reason reached review.html');

    // ── Unified findings (evidence-first) ──
    assert(existsSync(join(root, '_results', 'findings.json')), 'findings.json was not generated');
    const findings = JSON.parse(readFileSync(join(root, '_results', 'findings.json'), 'utf8'));
    assert(findings.schema_version === '1.0', 'findings: schema_version missing');
    assert(findings.findings.length === 8, `findings: expected 8, got ${findings.findings.length}`);
    assert(findings.findings[0].id === 'SG-001' && findings.findings[0].severity === 'critical', 'findings: not severity-sorted with SG ids');
    const f = findings.findings;
    assert(f.some(x => x.source === 'audit' && x.evidence === 'reasoned' && x.file === 'app.py'), 'findings: audit -> reasoned');
    const auditFinding = f.find(x => x.source === 'audit');
    assert(auditFinding.verification_score === 90 && auditFinding.verified === true,
      'findings: audit review score and assessment were dropped');
    assert(eq(auditFinding.verification_protocol, { status: 'parsed', reason: null, semantic_verification: 'not_verified' }),
      'findings: verification scope was dropped or private response metadata leaked');
    assert(!JSON.stringify(findings).includes('PRIVATE VERIFIER RESPONSE') && !JSON.stringify(findings).includes('private-digest'),
      'findings: private verifier response was projected into the public report');
    assert(readFileSync(join(root, '_results', 'audit-results.json'), 'utf8') === auditBefore,
      'dashboard changed the canonical audit producer document');
    assert(f.some(x => x.source === 'process' && x.evidence === 'measured'), 'findings: process w/ measured action -> measured');
    assert(f.some(x => x.source === 'logic' && x.evidence === 'reasoned' && x.file === 'worker.py'), 'findings: logic -> reasoned');
    assert(f.some(x => x.source === 'browser' && x.evidence === 'measured' && x.title.includes('FAIL')), 'findings: visual FAIL -> measured');
    assert(f.some(x => x.source === 'browser' && x.title === 'Browser console error'), 'findings: browser_errors surfaced');
    assert(f.some(x => x.source === 'crawler' && x.evidence === 'measured' && x.severity === 'high'), 'findings: crawler -> measured/high');
    assert(f.some(x => x.source === 'human' && x.evidence === 'manual'), 'findings: annotation -> manual');
    assert(findings.summary.by_evidence.measured >= 4, 'findings: evidence tally wrong');

    const builtHtml = readFileSync(join(root, '_results', 'review.html'), 'utf8');
    assert(!builtHtml.includes('__PLACEHOLDER_FINDINGS_DATA__'), 'template: findings placeholder not replaced');
    assert(!builtHtml.includes('__PLACEHOLDER_LOGIC_DATA__'), 'template: logic placeholder not replaced');
    assert(!builtHtml.includes('__PLACEHOLDER_RUN_DATA__'), 'template: run placeholder not replaced');
    assert(builtHtml.includes('"laneAvailability"'), 'data: laneAvailability not injected');
    assert(builtHtml.includes('id="main-tab-findings"'), 'template: Findings tab button missing');
    assert(builtHtml.includes('id="main-tab-logic"'), 'template: Logic tab button missing');
    assert(builtHtml.includes('renderLogicTab'), 'template: logic renderer missing');
    // The dashboard must expose in-flight orchestration honestly: planned or
    // running lanes are not green execution receipts.
    {
      const nodes = new Map([['lane-chips', { children: [], appendChild(child) { this.children.push(child); } }]]);
      const document = {
        createElement() { return { className: '', textContent: '' }; },
        getElementById(id) { return nodes.get(id) || null; },
      };
      const start = builtHtml.indexOf('function laneReason(');
      const end = builtHtml.indexOf('function renderFindingsTab(', start);
      assert(start >= 0 && end > start, 'lane renderer boundaries missing');
      runInNewContext(builtHtml.slice(start, end) + '\nrenderLaneChips();', {
        document,
        __RUN_DATA__: { lanes: {
          audit: { status: 'running', reason: 'Phase 1 active' },
          process: { status: 'pending', reason: 'awaiting Phase 2' },
        } },
      });
      const chips = nodes.get('lane-chips').children;
      assert(chips.length === 2, 'lane chips: expected running and pending states');
      assert(chips[0].className === 'lane-chip running', 'running lane was not rendered distinctly');
      assert(chips[1].className === 'lane-chip pending', 'pending lane was not rendered distinctly');
      assert(chips.every(chip => !chip.className.includes(' ran')), 'transitional lane rendered as ran');
    }
    // Execute the installed renderer, not a reimplementation or an embedded-text check.
    // Minimal DOM seam proves row construction; browser visibility is checked separately.
    const nodes = new Map();
    const htmlIds = new Set([...builtHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    function element() {
      return { children: [], style: {}, className: '', classList: { add() {} },
        _text: '', set textContent(value) { this._text = String(value); this.children = []; },
        get textContent() { return this._text + this.children.map(x => x.textContent).join(''); },
        appendChild(child) { this.children.push(child); } };
    }
    const document = {
      createElement: element,
      getElementById(id) { if (!htmlIds.has(id)) return null; if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    };
    // Exercise the actual audit row renderer and the unified Findings consumer.
    const auditStart = builtHtml.indexOf('function auditVerificationInfo(');
    const auditEnd = builtHtml.indexOf('// ── Auto-load on page open:', auditStart);
    assert(auditStart >= 0 && auditEnd > auditStart, 'audit verification renderer boundaries missing');
    const auditContext = { document };
    runInNewContext(builtHtml.slice(auditStart, auditEnd), auditContext);
    const cases = [
      [{ verification_score: 90, verified: true }, 'Review 90/100', 'Static review assessment'],
      [{ verification_score: 55, verified: 'uncertain' }, 'Review 55/100', 'severity downgrade'],
      [{ verification_score: 12, verified: false }, 'Review 12/100', 'unverified'],
      [{ verification_score: null, verification_protocol: { status: 'unavailable', reason: 'finding_id_mismatch' } },
        'Unavailable', 'another finding'],
      [{ verification_score: null, verification_protocol: { status: 'unavailable', reason: 'reply_not_text' } },
        'Unavailable', 'No text response'],
      [{ verification_score: null }, 'Not verified', 'Reason not recorded'],
      [{}, 'Not verified', 'Reason not recorded'],
      [{ verification_score: null, verification_protocol: { status: 'unavailable', reason: '<script>not markup</script>' } },
        'Unavailable', '<script>not markup</script>'],
      [{ verification_score: null, verification_protocol: { status: 'unavailable', reason: 'constructor' } },
        'Unavailable', 'constructor'],
    ];
    for (const [verification, label, detail] of cases) {
      const bug = { id: 'r1-z01-001', severity: 'high', category: 'security', title: 'Sample', ...verification };
      const before = JSON.stringify(bug);
      const row = auditContext.makeBugRow(bug);
      const cell = row.children[7];
      assert(cell.textContent === label, `audit verification label: expected ${label}, got ${cell.textContent}`);
      assert(cell.title.includes(detail), `audit verification detail missing: ${detail}`);
      assert(!cell.title.includes('Confirmed'), 'model assessment was called confirmed');
      assert(JSON.stringify(bug) === before, 'audit renderer changed the source assessment');
    }
    const findingsStart = builtHtml.indexOf('function renderFindingsTab(');
    const findingsEnd = builtHtml.indexOf('// backward-compat alias', findingsStart);
    runInNewContext(builtHtml.slice(findingsStart, findingsEnd) + '\nrenderFindingsTab();', {
      document, __FINDINGS_DATA__: findings, __RUN_DATA__: null,
      auditVerificationInfo: auditContext.auditVerificationInfo,
    });
    const auditRow = nodes.get('findings-tbody').children.find(row => row.children[3].textContent === 'audit');
    assert(auditRow.children[2].textContent === 'reasoned · Review 90/100',
      'Findings tab did not preserve reasoned evidence and the static review assessment');
    assert(auditRow.children[2].title.includes('not an observed result'),
      'Findings tab did not explain the review scope');
    {
      const audit = JSON.parse(auditBefore);
      audit.bugs = cases.map(([verification], i) => ({
        id: `r1-z01-${String(i + 1).padStart(3, '0')}`, severity: 'high', category: 'security',
        file: 'app.py', line: i + 1, title: `Verification case ${i + 1}`, ...verification,
      }));
      writeJson(join(root, '_results', 'audit-results.json'), audit);
      const original = readFileSync(join(root, '_results', 'audit-results.json'), 'utf8');
      execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
      const projected = JSON.parse(readFileSync(join(root, '_results', 'findings.json'), 'utf8')).findings.filter(x => x.source === 'audit');
      assert(projected.length === audit.bugs.length, 'verification projection changed finding selection');
      for (const item of projected) {
        const input = audit.bugs.find(x => x.id === item.origin.id);
        assert(input && item.severity === input.severity && item.evidence === 'reasoned',
          'verification projection changed origin, severity or evidence type');
        assert(item.verification_score === (input.verification_score ?? null) && item.verified === (input.verified ?? null),
          'verification projection changed the original assessment');
        for (const field of ['status', 'reason', 'semantic_verification']) {
          assert((item.verification_protocol?.[field] ?? null) === (input.verification_protocol?.[field] ?? null),
            `verification projection lost ${field}`);
        }
        if (!input.verification_protocol) assert(item.verification_protocol === null,
          'verification projection invented a protocol for a legacy finding');
      }
      assert(readFileSync(join(root, '_results', 'audit-results.json'), 'utf8') === original,
        'verification projection mutated the canonical audit input');
      writeFileSync(join(root, '_results', 'audit-results.json'), auditBefore);
    }
    const start = builtHtml.indexOf('function logicEntries(');
    const end = builtHtml.indexOf('function procAsText(', start);
    assert(start >= 0 && end > start, 'logic renderer boundaries missing');
    const data = JSON.parse(readFileSync(join(root, '_results', 'logic-results.json'), 'utf8'));
    runInNewContext(builtHtml.slice(start, end) + '\nrenderLogicTab();', {
      document, __LOGIC_DATA__: data, laneReason: () => '', procSeverityCell: value => {
        const cell = element(); cell.textContent = value; return cell;
      },
    });
    const rows = nodes.get('logic-concerns-tbody').children;
    assert(rows.length === 3, 'logic concerns: expected three rendered rows');
    ['contract_conflicts', 'questions', 'uncovered'].forEach((key, index) => {
      assert(rows[index].children[0].textContent === key.replace(/_/g, '-'), `logic concerns: ${key} type missing`);
      assert(rows[index].children[2].textContent === data[key][0].description, `logic concerns: ${key} description missing`);
      assert(rows[index].children[3].textContent === (data[key][0].source || data[key][0].file), `logic concerns: ${key} source missing`);
    });
    assert(nodes.get('logic-concerns-section').style.display === 'block', 'logic concerns section hidden');

    const preReview = { schema_version: '1.0', request: 'Reuse existing interface', status: 'partial',
      candidates: [{ reference: 'worker.py', decision: 'undetermined', justification: 'Consumer not traced' }],
      interfaces: [], usages: [], contract_conflicts: [], questions: [], uncovered: [{ description: 'Missing consumer evidence' }], search_scope: [{ roots: ['plugins/shipguard'], query: 'worker', exclusions: [] }], context: { selected_references: [], transmission: "not observable" } };
    writeJson(join(root, '_results', 'prereview-results.json'), preReview);
    execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
    const preHtml = readFileSync(join(root, '_results', 'review.html'), 'utf8');
    const preStart = preHtml.indexOf('function renderPreReviewTab(');
    const preEnd = preHtml.indexOf('function logicEntries(', preStart);
    runInNewContext(preHtml.slice(preStart, preEnd) + '\nrenderPreReviewTab();', { document, __PREREVIEW_DATA__: preReview });
    assert(nodes.get('prereview-summary').textContent.startsWith('partial'), 'partial review appears completed');
    assert(nodes.get('prereview-tbody').children.length === 3, 'pre-review candidates/uncovered/search scope not rendered');
    assert(!preHtml.includes('__PLACEHOLDER_PREREVIEW_DATA__'), 'pre-review data not embedded');
    writeJson(join(root, '_results', 'prereview-results.json'), { ...preReview, status: 'completed' });
    execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
    assert(readFileSync(join(root, '_results', 'review.html'), 'utf8').includes('"status":"partial"'), 'undetermined completion not downgraded');
    writeJson(join(root, '_results', 'prereview-results.json'), { ...preReview, questions: [{}] });
    execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
    assert(readFileSync(join(root, '_results', 'review.html'), 'utf8').includes('Pre-review result could not be read'), 'malformed concern accepted');
    writeFileSync(join(root, '_results', 'prereview-results.json'), '{invalid');
    execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
    assert(readFileSync(join(root, '_results', 'review.html'), 'utf8').includes('Pre-review result could not be read'), 'invalid pre-review not reported');
    assert(f.some(x => x.kind === 'contract-conflict' && x.status === 'unresolved' && x.title.includes('cents')), 'unresolved conflict missing from Findings');
    assert(f.some(x => x.kind === 'contract-conflict' && x.file === 'client.py' && x.detail.includes('docs/currency.md') && x.detail.includes('client.py')), 'conflict sources lost in Findings');

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

    // ── A scoped run: summary.total and scope.selected_total count the same
    // thing, so the build must not move one of them. It used to recompute the
    // summary over every manifest on disk and leave the scope alone. ──
    const scopedDoc = {
      schema_version: '1.0',
      run_id: 'visual-scoped-1',
      timestamp: '2026-06-29T13:30:00Z',
      base_url: 'http://127.0.0.1:8001',
      scope: { type: 'scope', value: 'pages/root-index', selected_total: 1, full_suite_total: 2 },
      summary: { total: 1, pass: 1, fail: 0, error: 0, stale: 0, skipped: 0, duration_ms: 5 },
      tests: [{ id: 'pages/root-index', manifest: 'visual-tests/pages/root-index.yaml', name: 'Home', url: '/', status: 'PASS', duration_ms: 5, screenshot: null, failure_reason: null }],
    };
    writeJson(join(root, '_results', 'visual-results.json'), scopedDoc);
    execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
    const scoped = JSON.parse(readFileSync(join(root, '_results', 'visual-results.json'), 'utf8'));
    assert(scoped.summary.total === scoped.scope.selected_total,
      `scoped run: summary.total ${scoped.summary.total} contradicts scope.selected_total ${scoped.scope.selected_total}`);
    assert(scoped.tests.length === 1,
      `scoped run: ${scoped.tests.length} tests written for a 1-test run — manifests that never ran were invented into it`);
    assert(scoped.summary.stale === 0, 'scoped run: unrun manifests were counted as STALE results of this run');

    // Observed selector drift belongs in Findings; inventory-only STALE does not.
    // Declaration failures and tool failures must not claim browser evidence.
    const visualFindingsDoc = {
      ...scopedDoc,
      tests: [
        { id: 'pages/stale-zero', status: 'STALE', duration_ms: 0, failure_reason: null },
        { id: 'pages/stale-legacy', status: 'STALE', failure_reason: 'Element not found: #submit' },
        { id: 'pages/unrun', status: 'STALE', duration_ms: null, failure_reason: null, screenshot: 'screenshots/root-index.png' },
        { id: 'pages/pending', status: 'SKIPPED', failure_reason: 'agent steps pending' },
        { id: 'pages/invalid', status: 'ERROR', duration_ms: 0, failure_reason: 'a different general failure', manifest_error: 'unknown action "clik"',
          browser_errors: [{ level: 'error', text: 'An independently captured console error' }] },
        { id: 'pages/tooling', status: 'ERROR', duration_ms: 1, failure_reason: 'open: browser process exited' },
      ],
      summary: { total: 6, pass: 0, fail: 0, error: 2, stale: 3, skipped: 1, duration_ms: 1 },
    };
    writeJson(join(root, '_results', 'visual-results.json'), visualFindingsDoc);
    execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
    const visualFindings = JSON.parse(readFileSync(join(root, '_results', 'findings.json'), 'utf8'));
    const visualRows = visualFindings.findings.filter(f => f.origin.lane === 'visual');
    for (const id of ['pages/stale-zero', 'pages/stale-legacy']) {
      assert(visualRows.some(f => f.origin.id === id && f.source === 'browser' && f.evidence === 'measured' && f.title.endsWith(': STALE')),
        `findings: observed STALE ${id} was lost`);
    }
    assert(!visualRows.some(f => ['pages/unrun', 'pages/pending'].includes(f.origin.id)),
      'findings: a never-executed manifest was promoted to an observed defect');
    assert(visualRows.some(f => f.origin.id === 'pages/invalid' && f.source === 'declaration' && f.evidence === 'reasoned' && f.detail === 'unknown action "clik"'),
      'findings: manifest validation was presented as measured browser evidence');
    assert(visualRows.some(f => f.origin.id === 'pages/tooling' && f.source === 'tooling' && f.detail === 'open: browser process exited'),
      'findings: tooling failure was presented as a browser finding');
    assert(visualRows.some(f => f.origin.id === 'pages/invalid' && f.source === 'browser' && f.evidence === 'measured' && f.title === 'Browser console error'),
      'findings: an independent console observation was lost alongside a declaration error');
    assert(visualRows.length === 5 && visualFindings.summary.by_source.declaration === 1 && visualFindings.summary.by_source.tooling === 1,
      'findings: visual projection count or source tallies are wrong');
    const visualAfterProjection = JSON.parse(readFileSync(join(root, '_results', 'visual-results.json'), 'utf8'));
    assert(eq(visualAfterProjection, { ...visualFindingsDoc, generated_at: visualAfterProjection.generated_at }),
      'findings: visual producer document was changed beyond the existing generated_at enrichment');

    // ── An unparseable producer document is the only evidence of its own
    // fault. Report it, do not overwrite it. ──
    writeFileSync(join(root, '_results', 'visual-results.json'), '{ this is not json', 'utf8');
    const onInvalid = spawnSync(process.execPath, ['build-review.mjs'], { cwd: root, encoding: 'utf8' });
    assert(onInvalid.status === 0, 'builder did not survive an invalid visual-results.json');
    assert(readFileSync(join(root, '_results', 'visual-results.json'), 'utf8') === '{ this is not json',
      'an unparseable visual-results.json was overwritten — the evidence of the fault is gone');
    assert(/left untouched/.test(onInvalid.stderr), 'the untouched file was not reported');
    assert(existsSync(join(root, '_results', 'review.html')), 'review.html was not built from the fallback');

    // ── Bootstrap (anti-over-correction): with no producer document at all,
    // the build is the producer of last resort and must still write one. ──
    rmSync(join(root, '_results', 'visual-results.json'));
    execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
    assert(existsSync(join(root, '_results', 'visual-results.json')),
      'bootstrap: no canonical contract was written for a suite that has never run');
    const bootstrapped = JSON.parse(readFileSync(join(root, '_results', 'visual-results.json'), 'utf8'));
    assert(bootstrapped.tests.length === 2 && bootstrapped.tests.every(t => t.status === 'STALE'),
      'bootstrap: manifests on disk were not written as STALE');
    assert(bootstrapped.summary.total === 2 && bootstrapped.summary.stale === 2, 'bootstrap: summary not derived');
    // A second build now sees the synthesized contract as input; it must still
    // distinguish inventory placeholders from results of an actual execution.
    execFileSync(process.execPath, ['build-review.mjs'], { cwd: root, stdio: 'pipe' });
    const bootstrapFindings = JSON.parse(readFileSync(join(root, '_results', 'findings.json'), 'utf8'));
    assert(!bootstrapFindings.findings.some(f => f.origin.lane === 'visual'),
      'bootstrap: rebuilding a never-run suite invented measured STALE findings');

    port = options.port || DEFAULT_PORT_BASE + Math.floor(Math.random() * 10000);
    console.error(`review smoke test: fixture=${root} port=${port}`);
    server = spawn(process.execPath, ['build-review.mjs', '--serve', `--port=${port}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    log = createProcessLog(server);
    await waitForServer(port);
    const review = await request(port, 'GET', '/review.html');
    assert(review.status === 200, 'review.html was not served');
    assert(review.body.includes('recorded-login.yaml'), 'recorded manifest was not embedded in review.html');
    assert((await request(port, 'GET', '/audit-results.json')).status === 200, 'audit-results.json was not served');
    assert((await request(port, 'GET', '/logic-results.json')).status === 200, 'logic-results.json was not served');
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
