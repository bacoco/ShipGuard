/** Offline test double only: never installed or used by the real adapter. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const argv = process.argv.slice(2);
const output = argv[argv.indexOf('--output') + 1];
const config = JSON.parse(readFileSync(argv[argv.indexOf('--config') + 1], 'utf8'));
writeFileSync(join(output, 'invocation.json'), JSON.stringify({ argv,
  telemetry: process.env.E2E_TELEMETRY_DISABLED, ci: process.env.CI }));
if (config.mode === 'noisy') await new Promise(resolve => process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 'x'), resolve));
if (config.mode === 'no-report') process.exit(0);
if (config.mode === 'timeout') {
  process.on('SIGTERM', () => {});
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(join(output, 'pids.json'), JSON.stringify({ runner: process.pid, child: child.pid }));
  setInterval(() => {}, 1000);
} else {
  const doc = config.document;
  if (config.mode !== 'stale') doc.run.startedAt = doc.run.finishedAt = new Date().toISOString();
  else doc.run.startedAt = doc.run.finishedAt = '1970-01-01T00:00:00.000Z';
  writeFileSync(join(output, 'report.json'), JSON.stringify(doc));
  process.exit(config.mode === 'mismatch' ? 1 : doc.run.exitCode);
}
