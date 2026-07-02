import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { actionsToYaml } from './actions-to-yaml.mjs';

/* ── Minimal YAML double-quoted scalar helpers (no dependencies) ──
 * Used to sanity-check the emitted YAML: quoting must round-trip and
 * no unescaped control characters may appear in the output. */

function unescapeYamlDoubleQuoted(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'x') { out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else out += n; // handles \\ and \" (and passes through anything else)
  }
  return out;
}

function countUnescapedQuotes(line) {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '"') continue;
    let backslashes = 0;
    let j = i - 1;
    while (j >= 0 && line[j] === '\\') { backslashes++; j--; }
    if (backslashes % 2 === 0) count++;
  }
  return count;
}

function extractQuotedValue(line) {
  const first = line.indexOf('"');
  const last = line.lastIndexOf('"');
  assert.ok(first !== -1 && last > first, `expected a double-quoted value in: ${line}`);
  return line.slice(first + 1, last);
}

describe('actionsToYaml', () => {
  test('converts open action', () => {
    const actions = [{ type: 'open', url: 'http://localhost:6969/notaire-chat' }];
    const yaml = actionsToYaml(actions, { name: 'test-open', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('name: "test-open"'));
    assert.ok(yaml.includes('source: recorded'));
    assert.ok(yaml.includes('action: open'));
    assert.ok(yaml.includes('url: "{base_url}/notaire-chat"'));
  });

  test('output starts with the open step when given one', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/start' },
      { type: 'click', text: 'Go', selector: 'button' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-first-open', baseUrl: 'http://localhost:6969' });
    const lines = yaml.split('\n');
    const stepsIdx = lines.findIndex(l => l === 'steps:');
    assert.ok(stepsIdx !== -1, 'has a steps: section');
    const firstStep = lines.slice(stepsIdx + 1).find(l => l.trim().startsWith('- action:'));
    assert.equal(firstStep.trim(), '- action: open', 'first step must be the open action');
    const urlLine = lines[lines.indexOf('  - action: open') + 1];
    assert.ok(urlLine.includes('url: "{base_url}/start"'));
  });

  test('converts click action with text target', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/login' },
      { type: 'click', text: 'Se connecter', selector: 'button.login-btn' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-click', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: click'));
    assert.ok(yaml.includes('target: "Se connecter"'));
  });

  test('converts fill action', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/login' },
      { type: 'fill', text: "Username", selector: '#username', value: 'demo-user' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-fill', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: fill'));
    assert.ok(yaml.includes("target: \"Username\""));
    assert.ok(yaml.includes('value: "demo-user"'));
  });

  test('converts press action (Enter key)', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/search' },
      { type: 'fill', text: 'Recherche', selector: '#q', value: 'notaire' },
      { type: 'press', key: 'Enter' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-press', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: press'));
    assert.ok(yaml.includes('key: "Enter"'));
  });

  test('converts check assertion with short text', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/dashboard' },
      { type: 'check', text: 'Dossier créé', elementTag: 'span' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-check', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: assert_text'));
    assert.ok(yaml.includes('expected: "Dossier créé"'));
  });

  test('converts check assertion with long text to llm-check with severity warning', () => {
    const longText = 'This is a very long dynamic text that exceeds the threshold for simple assertion and should be converted to an llm-check instead of assert_text';
    const actions = [
      { type: 'open', url: 'http://localhost:6969/dashboard' },
      { type: 'check', text: longText, elementTag: 'div' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-llm', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: llm-check'));
    assert.ok(yaml.includes('description: "Verify element content"'));
    // Executor contract: llm-check severity values are critical | warning ONLY
    assert.ok(yaml.includes('severity: warning'));
    assert.ok(!yaml.includes('severity: medium'), 'medium is not a valid llm-check severity');
  });

  test('inserts namespaced screenshot after each check', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/page' },
      { type: 'check', text: 'OK', elementTag: 'span' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-screenshot', baseUrl: 'http://localhost:6969' });
    const lines = yaml.split('\n');
    const checkIdx = lines.findIndex(l => l.includes('action: assert_text'));
    const screenshotIdx = lines.findIndex((l, i) => i > checkIdx && l.includes('action: screenshot'));
    assert.ok(screenshotIdx > checkIdx, 'screenshot should follow check');
    // Screenshot filenames are namespaced with the manifest name to avoid
    // collisions between manifests writing into the same results directory.
    assert.ok(yaml.includes('filename: "test-screenshot-check-1.png"'));
    assert.ok(!yaml.includes('filename: "check-1.png"'), 'bare check-N.png names collide across manifests');
  });

  test('converts upload action to {data.*} placeholder with data stub', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/upload' },
      { type: 'upload', selector: 'input[type=file]', files: ['doc.pdf'] },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-upload', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: upload'));
    // upload.file is a PROJECT-RELATIVE path; the recorder only sees the
    // browser-side basename, so it must emit a {data.*} placeholder.
    assert.ok(yaml.includes('file: "{data.upload_file}"'));
    assert.ok(!yaml.includes('file: "doc.pdf"'), 'browser basename is not a valid project path');
    // data: stub the user must edit
    assert.ok(yaml.includes('data:'));
    assert.ok(yaml.includes('upload_file: "<path to a real file — set me>"'));
    // comment on the step tells the user what was recorded
    assert.ok(yaml.includes('# Recorded upload of "doc.pdf"'));
    assert.ok(!yaml.includes('selector:'), 'should NOT emit selector — runner finds input via snapshot');
    assert.ok(!yaml.includes('files:'), 'should use file: (singular) not files: (array)');
  });

  test('skips upload step entirely when no files were recorded', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/upload' },
      { type: 'upload', selector: 'input[type=file]', files: [] },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-upload-empty', baseUrl: 'http://localhost:6969' });
    assert.ok(!yaml.includes('action: upload'), 'a bare upload step with no file is invalid');
    assert.ok(!yaml.includes('data:'), 'no data stub without an actual upload');
  });

  test('numbers data keys for multiple uploads', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/upload' },
      { type: 'upload', files: ['a.pdf'] },
      { type: 'upload', files: ['b.png'] },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-upload-multi', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('file: "{data.upload_file}"'));
    assert.ok(yaml.includes('file: "{data.upload_file_2}"'));
    assert.ok(yaml.includes('upload_file: "<path to a real file — set me>"'));
    assert.ok(yaml.includes('upload_file_2: "<path to a real file — set me>"'));
  });

  test('strips base_url from open URLs', () => {
    const actions = [{ type: 'open', url: 'http://localhost:6969/notaire-chat' }];
    const yaml = actionsToYaml(actions, { name: 'test-strip', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('url: "{base_url}/notaire-chat"'));
    assert.ok(!yaml.includes('localhost:6969/notaire-chat'));
  });

  test('stripBase requires a path boundary (no partial-port match)', () => {
    const actions = [{ type: 'open', url: 'http://localhost:6969/x' }];
    const yaml = actionsToYaml(actions, { name: 'test-boundary', baseUrl: 'http://localhost:69' });
    // base is a string prefix but NOT a path boundary — must keep the full URL
    assert.ok(yaml.includes('url: "{base_url}http://localhost:6969/x"'));
    assert.ok(!yaml.includes('url: "{base_url}69/x"'));
  });

  test('stripBase yields /?q=1 for query-only URLs', () => {
    const actions = [{ type: 'open', url: 'http://localhost:6969?q=1' }];
    const yaml = actionsToYaml(actions, { name: 'test-query', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('url: "{base_url}/?q=1"'));
  });

  test('adds namespaced trailing screenshot', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/page' },
      { type: 'click', text: 'Button', selector: 'button' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-trailing', baseUrl: 'http://localhost:6969' });
    const lines = yaml.trim().split('\n');
    assert.ok(lines[lines.length - 2].includes('action: screenshot'));
    assert.ok(lines[lines.length - 1].includes('filename: "test-trailing-final.png"'));
  });

  test('converts select action', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/form' },
      { type: 'select', text: 'Type de dossier', selector: '#type', value: 'Vente immobilière' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-select', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('action: select'));
    assert.ok(yaml.includes('target: "Type de dossier"'));
    assert.ok(yaml.includes('value: "Vente immobilière"'));
  });

  test('generates valid manifest header', () => {
    const actions = [{ type: 'open', url: 'http://localhost:6969/' }];
    const yaml = actionsToYaml(actions, { name: 'header-test', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('name: "header-test"'));
    assert.ok(yaml.includes('description: "Recorded session for header-test"'));
    assert.ok(yaml.includes('source: recorded'));
    assert.ok(yaml.includes('recorded_at:'));
    assert.ok(yaml.includes('priority: medium'));
    assert.ok(yaml.includes('tags: [recorded]'));
    assert.ok(yaml.includes('steps:'));
  });

  test('masks password fields with placeholder (#34)', () => {
    const actions = [
      { type: 'open', url: 'http://localhost:6969/login' },
      { type: 'fill', text: 'Password', selector: '#password', value: 'SuperSecret123', isPassword: true },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-password', baseUrl: 'http://localhost:6969' });
    assert.ok(yaml.includes('{credentials.password}'), 'password should be replaced with placeholder');
    assert.ok(!yaml.includes('SuperSecret123'), 'real password must NOT appear in YAML');
  });

  test('requires_auth follows usedStorage, not recorded password fills', () => {
    // Contract: requires_auth true iff auth was EXTERNAL to the recording
    // (--storage used) — the runner then executes _shared/login.yaml first.
    // A recording that captured its own login must stay requires_auth: false.
    const withPassword = [
      { type: 'open', url: 'http://localhost:6969/login' },
      { type: 'fill', text: 'Password', selector: '#pw', value: '{credentials.password}', isPassword: true },
    ];
    const selfLogin = actionsToYaml(withPassword, { name: 'self-login', baseUrl: 'http://localhost:6969' });
    assert.ok(selfLogin.includes('requires_auth: false'), 'captured login → runner must NOT run login.yaml again');

    const selfLoginExplicit = actionsToYaml(withPassword, { name: 'self-login-2', baseUrl: 'http://localhost:6969', usedStorage: false });
    assert.ok(selfLoginExplicit.includes('requires_auth: false'));

    const noLoginSteps = [{ type: 'open', url: 'http://localhost:6969/dashboard' }];
    const external = actionsToYaml(noLoginSteps, { name: 'external-auth', baseUrl: 'http://localhost:6969', usedStorage: true });
    assert.ok(external.includes('requires_auth: true'), '--storage recording → runner must log in before the steps');
  });

  test('escapes control characters in double-quoted scalars', () => {
    const tricky = 'a"b\\c\nd\te\rf\x07g';
    const actions = [
      { type: 'open', url: 'http://localhost:6969/form' },
      { type: 'fill', text: 'Champ', selector: '#f', value: tricky },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-escape', baseUrl: 'http://localhost:6969' });
    // No raw control characters anywhere in the output (besides line feeds)
    for (const line of yaml.split('\n')) {
      assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\r\t]/.test(line), `raw control char leaked into: ${JSON.stringify(line)}`);
    }
    // Quoting round-trips: unescaping the emitted value recovers the input
    const valueLine = yaml.split('\n').find(l => l.trim().startsWith('value:'));
    const roundTripped = unescapeYamlDoubleQuoted(extractQuotedValue(valueLine));
    assert.equal(roundTripped, tricky, 'double-quoted escaping must round-trip');
  });

  test('emitted YAML is structurally sane (balanced quotes, no raw control chars)', () => {
    const longText = 'x'.repeat(90) + ' with "quotes" and \\backslashes\\ and\nnewlines';
    const actions = [
      { type: 'open', url: 'http://localhost:6969/a?x=1' },
      { type: 'fill', text: 'Nom "complet"', selector: '#n', value: 'val\tue' },
      { type: 'press', key: 'Enter' },
      { type: 'select', text: 'Choix', value: 'Opt "A"' },
      { type: 'upload', files: ['rapport final.pdf'] },
      { type: 'check', text: longText, elementTag: 'div' },
      { type: 'check', text: 'Court', elementTag: 'span' },
      { type: 'click', text: 'OK', selector: 'button' },
    ];
    const yaml = actionsToYaml(actions, { name: 'test-sanity', baseUrl: 'http://localhost:6969' });
    for (const line of yaml.split('\n')) {
      assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\r\t]/.test(line), `raw control char in: ${JSON.stringify(line)}`);
      if (line.trim().startsWith('#')) continue; // comments are free text
      assert.equal(countUnescapedQuotes(line) % 2, 0, `unbalanced quotes in: ${line}`);
    }
    // Both check screenshots are namespaced and numbered
    assert.ok(yaml.includes('filename: "test-sanity-check-1.png"'));
    assert.ok(yaml.includes('filename: "test-sanity-check-2.png"'));
  });
});
