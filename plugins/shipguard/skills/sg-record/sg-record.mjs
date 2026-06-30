#!/usr/bin/env node
/**
 * sg-record.mjs — ShipGuard Macro Recorder
 * Opens a Playwright Chromium with a recording toolbar.
 * Usage: node visual-tests/sg-record.mjs <url> [--name <name>] [--storage <auth.json>] [--save-storage <path>]
 *        node visual-tests/sg-record.mjs --check
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { actionsToYaml } from './lib/actions-to-yaml.mjs';
import * as readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CHECK_TIMEOUT_MS = 15000;
const GUI_LAUNCH_ATTEMPTS = 2;

/* ── CLI args parsing ───────────────────────────────────────────── */

const args = process.argv.slice(2);

function getFlag(name) {
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function getFlagValue(name) {
  const exact = getFlag(name);
  if (exact) return exact;
  const prefix = `--${name}=`;
  const match = args.find(arg => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name) {
  return args.includes('--' + name);
}

// Known flags that take a value (others are boolean)
const FLAGS_WITH_VALUE = new Set(['name', 'storage', 'save-storage', 'check-timeout']);
const checkOnly = hasFlag('check');

// First non-flag arg = URL
let url = null;
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const flagName = args[i].slice(2);
    if (FLAGS_WITH_VALUE.has(flagName)) i++; // skip the value only for flags that take one
    continue;
  }
  url = args[i];
  break;
}

if (!checkOnly && !url) {
  console.error('Usage: node visual-tests/sg-record.mjs <url> [--name <name>] [--storage <auth.json>] [--save-storage <path>]');
  console.error('       node visual-tests/sg-record.mjs --check');
  process.exit(1);
}

const nameArg = getFlag('name');
const storageArg = getFlag('storage');
const saveStorageArg = getFlag('save-storage');
const checkTimeoutArg = getFlagValue('check-timeout');

/* ── Read base_url from config (fallback to URL arg) ────────────── */

// baseUrl is used only for stripping prefixes in YAML output.
// The CLI url argument is always used for page.goto().
let baseUrl = url;
try {
  const configPath = join(__dirname, '_config.yaml');
  if (existsSync(configPath)) {
    const configText = readFileSync(configPath, 'utf-8');
    const match = configText.match(/base_url:\s*"?([^"\n]+)"?/);
    if (match) baseUrl = match[1].trim();
  }
} catch (_) { /* use URL arg as fallback */ }

/* ── State ──────────────────────────────────────────────────────── */

let allSteps = [];
let stopped = false;
let toolbarJS = null;

/* ── Preflight ──────────────────────────────────────────────────── */

function installHint() {
  const hasPackageJson = existsSync(join(process.cwd(), 'package.json'));
  const initStep = hasPackageJson ? '' : 'npm init -y && ';
  return `${initStep}npm install --save-dev playwright && npx playwright install chromium`;
}

function checkTimeoutMs() {
  const raw = checkTimeoutArg || process.env.SHIPGUARD_RECORD_CHECK_TIMEOUT;
  if (!raw) return DEFAULT_CHECK_TIMEOUT_MS;
  const parsed = parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1000) {
    console.error(`Invalid check timeout: ${raw}`);
    process.exit(1);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyGuiLaunch(chromium, timeoutMs) {
  let lastError = null;
  for (let attempt = 1; attempt <= GUI_LAUNCH_ATTEMPTS; attempt++) {
    let browser = null;
    try {
      browser = await chromium.launch({ headless: false, timeout: timeoutMs });
      console.log('GUI_LAUNCH_OK');
      return;
    } catch (error) {
      lastError = error;
      if (attempt < GUI_LAUNCH_ATTEMPTS) {
        console.error(`GUI_LAUNCH_RETRY: attempt ${attempt} failed, retrying once`);
        await sleep(750);
      }
    } finally {
      if (browser) await browser.close();
    }
  }

  console.error('GUI_LAUNCH_FAILED');
  console.error('Grant browser/GUI launch permission, ensure a display is available, or run in an environment that supports headed Chromium.');
  console.error(`Increase timeout with SHIPGUARD_RECORD_CHECK_TIMEOUT=${timeoutMs * 2} or --check-timeout=${timeoutMs * 2}`);
  console.error(`Detail: ${lastError?.message || lastError}`);
  process.exit(1);
}

async function runCheck() {
  console.log('ShipGuard Recorder Preflight');
  const timeoutMs = checkTimeoutMs();

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
    console.log('PLAYWRIGHT_OK');
  } catch (error) {
    console.error('PLAYWRIGHT_MISSING');
    console.error('sg-record requires the Node package `playwright` importable from this project. A Python/global playwright command is not enough.');
    console.error(`Install with: ${installHint()}`);
    console.error(`Detail: ${error.message}`);
    process.exit(1);
  }

  const executablePath = chromium.executablePath();
  if (!existsSync(executablePath)) {
    console.error('CHROMIUM_MISSING');
    console.error('Install with: npx playwright install chromium');
    console.error(`Expected executable: ${executablePath}`);
    process.exit(1);
  }
  console.log('CHROMIUM_OK');

  await verifyGuiLaunch(chromium, timeoutMs);
}

function loadToolbarScript() {
  const toolbarCSS = readFileSync(join(__dirname, 'lib', 'recorder-toolbar.css'), 'utf-8');
  const rawJS = readFileSync(join(__dirname, 'lib', 'recorder-toolbar.js'), 'utf-8');
  return rawJS.replace("'__CSS_PLACEHOLDER__'", '`' + toolbarCSS.replace(/`/g, '\\`') + '`');
}

/* ── Bridge event handler ───────────────────────────────────────── */

function handleBridgeEvent(event) {
  switch (event.type) {
    case 'step':
      allSteps.push(event.step);
      console.log(`  \u2713 ${event.step.type.padEnd(8)} ${stepDetail(event.step)}`);
      if (event.step.isPassword) {
        console.log('  \u26A0 Password field detected — value replaced with {credentials.password}');
      }
      break;
    case 'undo':
      allSteps.pop();
      console.log(`  \u21A9 undo (${allSteps.length} steps remaining)`);
      break;
    case 'delete':
      allSteps.splice(event.index, 1);
      console.log(`  \u2715 delete #${event.index} (${allSteps.length} steps remaining)`);
      break;
    case 'pause':
      console.log('  \u23F8 paused');
      break;
    case 'resume':
      console.log('  \u25B6 resumed');
      break;
    case 'stop':
      allSteps = event.steps || allSteps;
      stopped = true;
      console.log('\n  \u25A0 Stop — finalizing...');
      break;
  }
}

function stepDetail(step) {
  switch (step.type) {
    case 'open': return step.url || '';
    case 'click': return step.text || step.selector || '';
    case 'fill': return `${step.text || step.selector || ''} \u2190 "${(step.value || '').slice(0, 30)}"`;
    case 'check': return `"${(step.text || '').slice(0, 40)}"`;
    case 'upload': return (step.files && step.files[0]) || '';
    case 'select': return `${step.text || step.selector || ''} \u2190 ${step.value || ''}`;
    default: return step.type;
  }
}

/* ── Readline helper ────────────────────────────────────────────── */

function askQuestion(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('close', () => resolve('')); // handles SIGINT / stream end
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/* ── Main ───────────────────────────────────────────────────────── */

async function main() {
  if (checkOnly) {
    await runCheck();
    return;
  }

  console.log('\n\u26A1 ShipGuard Recorder');
  console.log(`  URL:     ${url}`);
  if (nameArg) console.log(`  Name:    ${nameArg}`);
  if (storageArg) console.log(`  Auth:    ${storageArg}`);
  if (saveStorageArg) console.log(`  Save:    ${saveStorageArg}`);
  console.log('');

  // Dynamically import Playwright (may be installed globally via npx)
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(`  Playwright not found. Install with:\n\n    ${installHint()}\n`);
    console.error('  sg-record requires the Node package `playwright` importable from this project. A Python/global playwright command is not enough.\n');
    console.error('  Run `node visual-tests/sg-record.mjs --check` after installing to verify Chromium and GUI launch.\n');
    process.exit(1);
  }

  toolbarJS = loadToolbarScript();

  // Launch browser
  const browser = await chromium.launch({ headless: false });

  const contextOptions = {
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  };
  if (storageArg && existsSync(storageArg)) {
    contextOptions.storageState = storageArg;
  }

  const context = await browser.newContext(contextOptions);

  // Bridge function: receives JSON strings from the toolbar
  await context.exposeFunction('__sgBridge', (jsonStr) => {
    try {
      const event = JSON.parse(jsonStr);
      handleBridgeEvent(event);
    } catch (e) {
      console.error('  Bridge parse error:', e.message);
    }
  });

  const page = await context.newPage();

  // Inject toolbar after page load (not addInitScript which gets overwritten by DOM parser)
  async function injectToolbar() {
    try {
      await page.addScriptTag({ content: toolbarJS });
    } catch (_) { /* page may have been closed */ }
  }

  // Re-inject on every navigation (SPA and MPA)
  page.on('load', () => injectToolbar());

  // Log frame navigations
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      console.log(`  \u2192 ${frame.url()}`);
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await injectToolbar();

  console.log('  Browser open \u2014 start interacting!');
  console.log('  Press Stop in the toolbar when done.\n');

  // Wait for stop or browser close
  await new Promise((resolve) => {
    const pollId = setInterval(() => {
      if (stopped) {
        clearInterval(pollId);
        resolve();
      }
    }, 500);

    context.on('close', () => {
      // Give bridge events 200ms to flush before resolving
      // (stop event carries the authoritative step list)
      setTimeout(() => {
        stopped = true;
        clearInterval(pollId);
        resolve();
      }, 200);
    });
  });

  // Save auth state if requested
  if (saveStorageArg) {
    try {
      const state = await context.storageState();
      writeFileSync(saveStorageArg, JSON.stringify(state, null, 2));
      console.log(`  Auth state saved to ${saveStorageArg}`);
    } catch (e) {
      console.error('  Warning: could not save auth state:', e.message);
    }
  }

  // Close browser
  try {
    await browser.close();
  } catch (_) {
    // Already closed
  }

  // No steps recorded?
  if (allSteps.length === 0) {
    console.log('\n  No steps recorded. Exiting.');
    process.exit(0);
  }

  // Ask for name if not provided
  let name = nameArg;
  if (!name) {
    name = await askQuestion('  Manifest name: ');
    if (!name) name = 'untitled';
  }
  name = name.replace(/[\/\\:*?"<>|]/g, '-');

  // Generate YAML
  const yaml = actionsToYaml(allSteps, { name, baseUrl });

  // Write manifest (ensure directory exists)
  const manifestDir = join(__dirname, 'manifests');
  mkdirSync(manifestDir, { recursive: true });
  const outPath = join(manifestDir, `recorded-${name}.yaml`);
  writeFileSync(outPath, yaml);

  console.log(`\n  \u2705 Saved ${allSteps.length} steps to ${outPath}`);
}

main().catch((err) => {
  console.error('\n  Error:', err.message || err);
  process.exit(1);
});
