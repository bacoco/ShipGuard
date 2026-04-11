#!/usr/bin/env node
/**
 * sg-record.mjs — ShipGuard Macro Recorder
 * Opens a Playwright Chromium with a recording toolbar.
 * Usage: node visual-tests/sg-record.mjs <url> [--name <name>] [--storage <auth.json>] [--save-storage <path>]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { actionsToYaml } from './lib/actions-to-yaml.mjs';
import * as readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ── CLI args parsing ───────────────────────────────────────────── */

const args = process.argv.slice(2);

function getFlag(name) {
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

// Known flags that take a value (others are boolean)
const FLAGS_WITH_VALUE = new Set(['name', 'storage', 'save-storage']);

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

if (!url) {
  console.error('Usage: node visual-tests/sg-record.mjs <url> [--name <name>] [--storage <auth.json>] [--save-storage <path>]');
  process.exit(1);
}

const nameArg = getFlag('name');
const storageArg = getFlag('storage');
const saveStorageArg = getFlag('save-storage');

/* ── Read toolbar assets ────────────────────────────────────────── */

const toolbarCSS = readFileSync(join(__dirname, 'lib', 'recorder-toolbar.css'), 'utf-8');
const rawJS = readFileSync(join(__dirname, 'lib', 'recorder-toolbar.js'), 'utf-8');

// Inject CSS into the JS placeholder — handle backticks in CSS
const toolbarJS = rawJS.replace("'__CSS_PLACEHOLDER__'", '`' + toolbarCSS.replace(/`/g, '\\`') + '`');

/* ── Read base_url from config (fallback to URL arg) ────────────── */

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

/* ── Bridge event handler ───────────────────────────────────────── */

function handleBridgeEvent(event) {
  switch (event.type) {
    case 'step':
      allSteps.push(event.step);
      console.log(`  \u2713 ${event.step.type.padEnd(8)} ${stepDetail(event.step)}`);
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
    console.error('  Playwright not found. Install with: npm i playwright && npx playwright install chromium');
    process.exit(1);
  }

  // Launch browser
  const browser = await chromium.launch({ headless: false });

  const contextOptions = {
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  };
  if (storageArg && existsSync(storageArg)) {
    contextOptions.storageState = storageArg;
  }

  const context = await browser.newContext(contextOptions);

  // Inject toolbar on every page (including navigations)
  await context.addInitScript(toolbarJS);

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

  // Log frame navigations
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      console.log(`  \u2192 ${frame.url()}`);
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

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
    } catch (_) {
      // Context may already be closed
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
