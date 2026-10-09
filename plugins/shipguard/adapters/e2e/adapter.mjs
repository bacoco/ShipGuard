#!/usr/bin/env node
/** Optional e2e boundary. No changes to ShipGuard's default runner or canonical artifacts. */
import { randomUUID } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, realpathSync } from 'node:fs';
import { AdapterError, ensure, mergeExit } from './contract.mjs';
import { normalizeReport } from './outcomes.mjs';
import { readRegular, digest, collectArtifacts, writeJson, newBundle } from './artifacts.mjs';
import { launchRunner } from './runner.mjs';

export function parseArgs(args) {
  const [mode, ...rest] = args;
  ensure(['run', 'import'].includes(mode), 'USAGE', 'Use import --report FILE or run --config FILE --target ID --test FILE');
  const options = { mode, project: process.cwd(), tests: [], timeoutMs: 300000 };
  const seen = new Set();
  const names = { '--project': 'project', '--report': 'report', '--config': 'config', '--target': 'target', '--timeout-ms': 'timeoutMs' };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i + 1];
    ensure((flag === '--test' || names[flag]) && typeof value === 'string' && value.length > 0 && !value.startsWith('--'),
      'USAGE', 'Unknown option or missing value');
    ensure(flag === '--test' || !seen.has(flag), 'USAGE', 'Duplicate option'); seen.add(flag);
    if (flag === '--test') options.tests.push(value);
    else options[names[flag]] = flag === '--timeout-ms' ? Number(value) : value;
  }
  if (mode === 'import') ensure(options.report && !options.config && !options.target && !options.tests.length && !seen.has('--timeout-ms'),
    'USAGE', 'Import accepts only --report and --project');
  else ensure(options.config && options.target && options.tests.length && !options.report,
    'USAGE', 'Run requires --config, --target and at least one --test; no --report');
  return options;
}
export function importReport(source, bundle, execution = null) {
  const bytes = readRegular(source);
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); }
  catch { throw new AdapterError('INVALID_JSON', 'The source report is not valid JSON'); }
  const result = normalizeReport(doc);
  if (execution) {
    ensure(!execution.reason && execution.exitCode === doc.run.exitCode, 'PROCESS_REPORT_MISMATCH', 'Runner process and report disagree', 2);
    ensure(Date.parse(doc.run.startedAt) >= Date.parse(execution.startedAt) - 1000 &&
      Date.parse(doc.run.finishedAt) <= Date.parse(execution.finishedAt) + 1000,
      'STALE_REPORT', 'Report timestamps do not belong to this execution', 2);
  }
  // Private provenance snapshot. This can contain confidential text; never publish automatically.
  writeFileSync(join(bundle, 'source-report.json'), bytes, { flag: 'wx', mode: 0o600 });
  const artifacts = collectArtifacts(doc, dirname(source), bundle);
  if (artifacts.some(a => a.state === 'error')) result.exit_code = mergeExit(result.exit_code, 2);
  result.artifacts = artifacts;
  result.source.report_file = 'source-report.json'; result.source.sha256 = digest(bytes);
  for (const t of result.tests) {
    const screenshots = artifacts.filter(a => a.test_id === t.id && a.kind === 'screenshot');
    t.screenshot_evidence = screenshots.some(a => a.state === 'copied') ? 'captured-not-reviewed' : 'unavailable';
  }
  // Deliberately NOT visual-results.json: imported execution PASS is not visual verification.
  writeJson(join(bundle, 'e2e-results.json'), result);
  writeJson(join(bundle, 'adapter-run.json'), {
    schema_version: '1.0', adapter: 'tester-army-e2e', mode: execution ? 'run' : 'import',
    run_id: result.run_id, exit_code: result.exit_code, visual_review: 'not-performed', ship_ready: false,
    source_sha256: digest(bytes), results_file: 'e2e-results.json',
    execution: execution ? { exit_code: execution.exitCode, started_at: execution.startedAt, finished_at: execution.finishedAt,
      logs_truncated: execution.logsTruncated } : null,
  });
  return result.exit_code;
}
export async function main(args) {
  let bundle;
  try {
    const options = parseArgs(args);
    const project = realpathSync(resolve(options.project));
    bundle = newBundle(project, randomUUID());
    let execution = null, source = options.report ? resolve(project, options.report) : null;
    if (options.mode === 'run') {
      execution = await launchRunner({ ...options, project }, bundle);
      ensure(!execution.reason, 'RUNNER_INCOMPLETE', `Runner did not finish: ${execution.reason}`, 2);
      source = join(execution.output, 'report.json');
    }
    const exitCode = importReport(source, bundle, execution);
    return { exitCode, bundle };
  } catch (error) {
    const exitCode = error instanceof AdapterError ? error.exitCode : 2;
    const code = error instanceof AdapterError ? error.code : 'ADAPTER_IO_ERROR';
    if (bundle) {
      try { writeJson(join(bundle, 'adapter-error.json'), { code, exit_code: exitCode, ship_ready: false }); }
      catch { /* never overwrite an existing artifact to report a second error */ }
    }
    return { exitCode, bundle, error: code };
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await main(process.argv.slice(2));
  // No raw provider output, test text, configuration, environment or source errors on stdout.
  console.log(JSON.stringify(result)); process.exitCode = result.exitCode;
}
