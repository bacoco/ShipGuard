#!/usr/bin/env node
/**
 * Integration test — verifies manifest conversion and review HTML generation:
 * 1. Generates a manifest via actionsToYaml
 * 2. Rebuilds the review page
 * 3. Checks the manifest appears in embedded data
 * Run the bootstrapped copy in a disposable project with _config.yaml present:
 *   node visual-tests/lib/integration-test.mjs
 * This writes review results and does not exercise browser recording or replay.
 */
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { actionsToYaml } from './actions-to-yaml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFESTS_DIR = join(ROOT, 'manifests');
const MANIFEST = join(MANIFESTS_DIR, 'recorded-integration-test.yaml');
const REVIEW = join(ROOT, '_results', 'review.html');

let pass = 0, fail = 0;
function check(label, ok) {
  if (ok) { console.log('  \x1b[32m✓\x1b[0m ' + label); pass++; }
  else { console.log('  \x1b[31m✕\x1b[0m ' + label); fail++; }
}

console.log('\n\x1b[35m⚡ Recorder Integration Test\x1b[0m\n');

// Ensure manifests dir exists
mkdirSync(MANIFESTS_DIR, { recursive: true });

// 1. Generate manifest via converter
const yaml = actionsToYaml([
  { type: 'open', url: 'http://localhost:6969/notaire-chat' },
  { type: 'click', text: 'Nouveau dossier', selector: 'button' },
  { type: 'fill', text: 'Nom', selector: '#name', value: 'Test' },
  { type: 'check', text: 'Dossier créé', elementTag: 'span' },
], { name: 'integration-test', baseUrl: 'http://localhost:6969' });

writeFileSync(MANIFEST, yaml, 'utf8');
check('Manifest created', existsSync(MANIFEST));
check('Has source: recorded', yaml.includes('source: recorded'));
check('Has assert_text', yaml.includes('action: assert_text'));
check('Has expected field', yaml.includes('expected: "Dossier'));
check('Uses {base_url}', yaml.includes('{base_url}/notaire-chat'));
check('Has recorded_at quoted', yaml.includes('recorded_at: "'));

// 2. Rebuild review page
try {
  execFileSync('node', [join(ROOT, 'build-review.mjs')], { cwd: ROOT, stdio: 'pipe' });
  check('Review page rebuilt', existsSync(REVIEW));
} catch (e) {
  const diagnostic = e.stderr?.toString().trim() || e.message;
  console.error(`  Review generator failed (exit ${e.status ?? 'unknown'}): ${diagnostic}`);
  check('Review page rebuilt', false);
}

// 3. Check review contains recorded data
if (existsSync(REVIEW)) {
  const html = readFileSync(REVIEW, 'utf8');
  check('Has recorded tab button', html.includes('main-tab-recorded'));
  check('Has recorded-view div', html.includes('recorded-view'));
  check('Has integration-test data', html.includes('integration-test'));
  check('Has renderRecordedGrid function', html.includes('renderRecordedGrid'));
}

// Cleanup test manifest
try { unlinkSync(MANIFEST); } catch {}

console.log('\n  ' + pass + ' pass, ' + fail + ' fail\n');
process.exit(fail > 0 ? 1 : 0);
