#!/usr/bin/env node
// Optional stateless hook adapter. No HTTP, transcript collection, or persistent writes.
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { EVENTS, enabled, makeView, validateController, outputFor } from './lib/dialogue-check.mjs';
const env = process.env;
if (!enabled(env.SHIPGUARD_DIALOGUE_HOOKS) || enabled(env.SHIPGUARD_DIALOGUE_CONTROLLER_ACTIVE)) process.exit(0);
async function readInput() {
  let raw = '', bytes = 0;
  const timer = setTimeout(() => { process.stdin.destroy(new Error('input deadline')); }, 1500);
  try {
    for await (const chunk of process.stdin) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 256 * 1024) throw new Error('hook input exceeds 256 KiB');
      raw += chunk;
    }
    return JSON.parse(raw);
  } finally { clearTimeout(timer); }
}
async function readContext(path) {
  if (!path) return null;
  if (!isAbsolute(path)) throw new Error('context path must be absolute');
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16384) throw new Error('context must be a JSON file <=16 KiB');
    const buffer = Buffer.alloc(16385);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > 16384) throw new Error('context too large');
    const data = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    if (!data || typeof data.original_request !== 'string' || !Array.isArray(data.sources) || data.sources.length > 4 ||
        data.sources.some(x => !x || typeof x.text !== 'string' || typeof x.reference !== 'string')) throw new Error('invalid selected context');
    return data;
  } finally { await file.close(); }
}
async function runController(path, view, timeout) {
  if (!isAbsolute(path) || !/\.m?js$/.test(path)) throw new Error('controller must be an absolute JS module path');
  const script = await realpath(path);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      env: { ...env, SHIPGUARD_DIALOGUE_CONTROLLER_ACTIVE: '1' } });
    let stdout = '', bytes = 0, finished = false;
    function kill() {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
    }
    function finish(error, value) {
      if (finished) return;
      finished = true; clearTimeout(timer); kill();
      process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
      error ? reject(error) : resolve(value);
    }
    function interrupt() { finish(new Error('controller interrupted')); process.exit(0); }
    const timer = setTimeout(() => finish(new Error('controller timeout')), timeout);
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    child.on('error', () => finish(new Error('controller could not start')));
    child.stdin.on('error', () => finish(new Error('controller input rejected')));
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 8192) finish(new Error('controller output exceeds 8 KiB'));
      else stdout += chunk;
    });
    // Never reproduce controller stderr, which can contain provider credentials.
    child.stderr.resume();
    child.on('close', code => {
      if (finished) return;
      if (code !== 0) return finish(new Error('controller failed'));
      try { finish(null, JSON.parse(stdout)); } catch { finish(new Error('controller returned invalid JSON')); }
    });
    child.stdin.end(JSON.stringify(view));
  });
}
try {
  const input = await readInput();
  if (!input || !EVENTS.includes(input.hook_event_name)) process.exit(0);
  if (input.hook_event_name.includes('ToolUse') && !enabled(env.SHIPGUARD_DIALOGUE_TOOL_CHECKS)) process.exit(0);
  let context = null, check = { status: 'unknown', message: 'Advisory guidance only; semantic controller not configured.' };
  try { context = await readContext(env.SHIPGUARD_DIALOGUE_CONTEXT); }
  catch { check = { status: 'unavailable', message: 'Selected context is invalid or unreadable; no passing check.' }; }
  const view = makeView(input, context);
  const deadline = env.SHIPGUARD_DIALOGUE_DEADLINE;
  const deadlineTime = deadline ? Date.parse(deadline) : null;
  const deadlineExpired = deadlineTime !== null && Number.isFinite(deadlineTime) && Date.now() >= deadlineTime;
  if (deadline && !Number.isFinite(deadlineTime)) check = { status: 'unavailable', message: 'Invalid explicit deadline; budget not verified.' };
  const controller = env.SHIPGUARD_DIALOGUE_CONTROLLER || ((env.SHIPGUARD_DIALOGUE_ENDPOINT || env.SHIPGUARD_DIALOGUE_MODEL) ? fileURLToPath(new URL('./model-controller.mjs', import.meta.url)) : null);
  if (controller && check.status !== 'unavailable' && !deadlineExpired && !input.stop_hook_active) {
    const timeout = env.SHIPGUARD_DIALOGUE_TIMEOUT_MS === undefined ? 2000 : Number(env.SHIPGUARD_DIALOGUE_TIMEOUT_MS);
    if (!Number.isInteger(timeout) || timeout < 50 || timeout > 5000) check = { status: 'unavailable', message: 'Controller timeout must be 50..5000 ms.' };
    else try { check = validateController(await runController(controller, view, deadlineTime !== null && Number.isFinite(deadlineTime) ? Math.max(1, Math.min(timeout, deadlineTime - Date.now())) : timeout), view); }
    catch { check = { status: 'unavailable', message: 'Controller failed, timed out, or returned invalid evidence; no passing check.' }; }
  }
  process.stdout.write(JSON.stringify(outputFor(input, view, check, { deadlineExpired: deadlineTime !== null && Number.isFinite(deadlineTime) && Date.now() >= deadlineTime })));
} catch {
  // Delivery failure is visible, but does not create a new permission gate.
  process.stdout.write(JSON.stringify({ systemMessage: 'ShipGuard dialogue: unavailable — invalid, oversized or incomplete hook input; NOT VERIFIED.' }));
}
