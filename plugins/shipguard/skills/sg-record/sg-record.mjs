#!/usr/bin/env node
/**
 * sg-record.mjs — ShipGuard Macro Recorder
 * Opens a Playwright Chromium with a recording toolbar.
 * Usage: node visual-tests/sg-record.mjs <url> [--name <name>] [--storage <auth.json>] [--save-storage <path>] [--check-timeout <ms>]
 *        node visual-tests/sg-record.mjs --check
 * Flags accept both `--flag value` and `--flag=value` forms.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { actionsToYaml, uploadDataKey } from './lib/actions-to-yaml.mjs';
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
  const value = args[idx + 1];
  // Never swallow a following flag as a value (`--name --storage x`)
  if (value.startsWith('--')) return null;
  return value;
}

function getFlagValue(name) {
  const exact = getFlag(name);
  if (exact) return exact;
  const prefix = `--${name}=`;
  const match = args.find(arg => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name) {
  return args.includes('--' + name) || args.some(arg => arg.startsWith('--' + name + '='));
}

// Known flags that take a value (others are boolean)
const FLAGS_WITH_VALUE = new Set(['name', 'storage', 'save-storage', 'check-timeout']);
const checkOnly = hasFlag('check');

// First non-flag arg = URL
let url = null;
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const flagName = args[i].slice(2).split('=')[0];
    const hasInlineValue = args[i].includes('=');
    // Skip the value only for flags that take one, only when it is a real
    // value (not another flag) and not already inline (`--name=x`).
    if (!hasInlineValue && FLAGS_WITH_VALUE.has(flagName)
        && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      i++;
    }
    continue;
  }
  url = args[i];
  break;
}

if (!checkOnly && !url) {
  console.error('Usage: node visual-tests/sg-record.mjs <url> [--name <name>] [--storage <auth.json>] [--save-storage <path>] [--check-timeout <ms>]');
  console.error('       node visual-tests/sg-record.mjs --check');
  process.exit(1);
}

const nameArg = getFlagValue('name');
const storageArg = getFlagValue('storage');
const saveStorageArg = getFlagValue('save-storage');
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
let browser = null;
let manifestSaved = false;

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
    let checkBrowser = null;
    try {
      checkBrowser = await chromium.launch({ headless: false, timeout: timeoutMs });
      console.log('GUI_LAUNCH_OK');
      return;
    } catch (error) {
      lastError = error;
      if (attempt < GUI_LAUNCH_ATTEMPTS) {
        console.error(`GUI_LAUNCH_RETRY: attempt ${attempt} failed, retrying once`);
        await sleep(750);
      }
    } finally {
      if (checkBrowser) await checkBrowser.close();
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

/* ── Step recording (Node-side list is authoritative) ───────────── */

function normalizeUrl(u) {
  return String(u || '').replace(/\/+$/, '');
}

function recordStep(step) {
  // Dedup: skip an 'open' echo for a URL we just recorded (e.g. the toolbar
  // reporting the initial navigation that main() already pushed).
  if (step.type === 'open' && allSteps.length > 0) {
    const last = allSteps[allSteps.length - 1];
    if (last.type === 'open' && normalizeUrl(last.url) === normalizeUrl(step.url)) return;
  }
  allSteps.push(step);
  console.log(`  ✓ ${step.type.padEnd(8)} ${stepDetail(step)}`);
  if (step.isPassword) {
    console.log('  ⚠ Password field detected — value replaced with {credentials.password}');
  }
}

/* ── Bridge event handler ───────────────────────────────────────── */

function handleBridgeEvent(event) {
  // After stop, ignore any late step-mutation events from the page.
  if (stopped && event.type !== 'stop') return;

  switch (event.type) {
    case 'step':
      recordStep(event.step);
      break;
    case 'undo':
      allSteps.pop();
      console.log(`  ↩ undo (${allSteps.length} steps remaining)`);
      break;
    case 'delete': {
      const idx = event.index;
      if (!Number.isInteger(idx) || idx < 0 || idx >= allSteps.length) {
        console.log(`  ⚠ ignoring delete for out-of-range index ${idx}`);
        break;
      }
      allSteps.splice(idx, 1);
      console.log(`  ✕ delete #${idx} (${allSteps.length} steps remaining)`);
      break;
    }
    case 'pause':
      console.log('  ⏸ paused');
      break;
    case 'resume':
      console.log('  ▶ resumed');
      break;
    case 'stop': {
      // Node's incrementally-built list is authoritative. The toolbar's local
      // list resets on cross-origin navigations (e.g. SSO IdP pages), so
      // overwriting with stop.steps would silently lose steps. Only reconcile.
      const toolbarSteps = Array.isArray(event.steps) ? event.steps : [];
      if (toolbarSteps.length !== allSteps.length) {
        console.log(`  ⚠ Toolbar reported ${toolbarSteps.length} steps but Node recorded ${allSteps.length} — keeping the Node-side list (toolbar state resets across cross-origin pages).`);
      }
      stopped = true;
      console.log('\n  ■ Stop — finalizing...');
      break;
    }
  }
}

function stepDetail(step) {
  switch (step.type) {
    case 'open': return step.url || '';
    case 'click': return step.text || step.selector || '';
    case 'fill': return `${step.text || step.selector || ''} ← "${(step.value || '').slice(0, 30)}"`;
    case 'press': return step.key || '';
    case 'check': return `"${(step.text || '').slice(0, 40)}"`;
    case 'upload': return (step.files && step.files[0]) || '';
    case 'select': return `${step.text || step.selector || ''} ← ${step.value || ''}`;
    default: return step.type;
  }
}

/* ── Manifest saving ────────────────────────────────────────────── */

function warnAboutUploads(steps) {
  const uploads = steps.filter(s => s.type === 'upload' && ((s.files && s.files.length > 0 && s.files[0]) || s.file));
  if (uploads.length === 0) return;
  console.log('\n  ⚠ Upload steps recorded. The manifest uses {data.*} placeholders because the');
  console.log('    recorder only sees browser-side filenames. Edit the manifest `data:` map to');
  console.log('    point each entry at a real project-relative file before replaying:');
  uploads.forEach((s, i) => {
    const recorded = (s.files && s.files.join(', ')) || s.file;
    console.log(`      data.${uploadDataKey(i)}  ← recorded file: ${recorded}`);
  });
}

function saveManifest(rawName) {
  const name = String(rawName).replace(/[\/\\:*?"<>|]/g, '-');
  const yaml = actionsToYaml(allSteps, { name, baseUrl, usedStorage: Boolean(storageArg) });

  const manifestDir = join(__dirname, 'manifests');
  mkdirSync(manifestDir, { recursive: true });
  const outPath = join(manifestDir, `recorded-${name}.yaml`);
  writeFileSync(outPath, yaml);
  manifestSaved = true;

  console.log(`\n  ✅ Saved ${allSteps.length} steps to ${outPath}`);
  warnAboutUploads(allSteps);
  console.log(`  Replay with: /sg-visual-run recorded-${name}`);
  return outPath;
}

/* ── Signal handling (best-effort save + cleanup) ───────────────── */

let signalHandled = false;

async function handleSignal(signal) {
  if (signalHandled) process.exit(1);
  signalHandled = true;
  console.log(`\n  ${signal} received — shutting down...`);
  try {
    if (!manifestSaved && allSteps.length > 0) {
      // Best effort: persist what was recorded so the session is not lost.
      saveManifest(nameArg || 'interrupted');
    }
  } catch (e) {
    console.error('  Warning: could not save recorded steps:', e.message || e);
  }
  try {
    if (browser) await browser.close();
  } catch (_) { /* already closed */ }
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGINT', () => { handleSignal('SIGINT'); });
process.on('SIGTERM', () => { handleSignal('SIGTERM'); });

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

  // Non-interactive runs (agents, background tasks) cannot answer the
  // manifest-name prompt — require --name up front instead of silently
  // writing recorded-untitled.yaml at the end.
  if (!nameArg && !process.stdin.isTTY) {
    console.error('  --name is required when stdin is not a TTY (agent/background runs).');
    console.error('  Re-run with: node visual-tests/sg-record.mjs <url> --name <manifest-name>');
    process.exit(1);
  }

  console.log('\n⚡ ShipGuard Recorder');
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
  browser = await chromium.launch({ headless: false });

  try {
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
    // (context-wide, so it works in popups/new tabs too)
    await context.exposeFunction('__sgBridge', (jsonStr) => {
      try {
        const event = JSON.parse(jsonStr);
        handleBridgeEvent(event);
      } catch (e) {
        console.error('  Bridge parse error:', e.message);
      }
    });

    const page = await context.newPage();

    // New tabs / popups: inject the toolbar bridge into them too (best
    // effort). The bridge binding is context-wide, so recorded steps flow
    // back to Node. Limitation: a popup that closes before injection
    // completes (e.g. an instant OAuth redirect window) records nothing.
    // Attached AFTER context.newPage() so it only fires for extra pages.
    context.on('page', (newPage) => {
      const injectIntoPopup = async () => {
        try {
          await newPage.addScriptTag({ content: toolbarJS });
        } catch (_) { /* popup closed or navigation raced the injection */ }
      };
      newPage.on('load', injectIntoPopup);
      newPage.on('framenavigated', (frame) => {
        if (frame === newPage.mainFrame()) {
          console.log(`  → (popup) ${frame.url()}`);
        }
      });
      newPage.waitForLoadState('domcontentloaded').then(injectIntoPopup).catch(() => {});
    });

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
        console.log(`  → ${frame.url()}`);
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Record the initial open so every manifest starts at the real start URL.
    // recordStep dedups the toolbar's echo of the same navigation.
    recordStep({ type: 'open', url });

    await injectToolbar();

    console.log('  Browser open — start interacting!');
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
  } finally {
    // Always close the browser — including when page.goto or any other
    // step above throws.
    try {
      await browser.close();
    } catch (_) {
      // Already closed
    }
  }

  // No steps recorded?
  if (allSteps.length === 0) {
    console.log('\n  No steps recorded. Exiting.');
    process.exit(0);
  }

  // Ask for name if not provided (TTY guaranteed by the early check)
  let name = nameArg;
  if (!name) {
    name = await askQuestion('  Manifest name: ');
    if (!name) name = 'untitled';
  }

  saveManifest(name);
}

main().catch(async (err) => {
  console.error('\n  Error:', err.message || err);
  try {
    if (browser) await browser.close();
  } catch (_) { /* already closed */ }
  process.exit(1);
});
