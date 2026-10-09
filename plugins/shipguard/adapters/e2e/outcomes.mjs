/** External execution outcomes; never creates a ShipGuard visual verdict. */
import { validateReport, errorExit, mergeExit, sourceExit } from './contract.mjs';

function mapTest(t) {
  const attempts = t.attempts;
  const last = attempts.at(-1);
  const allErrors = attempts.flatMap(a => [a.error, ...a.secondaryErrors,
    ...a.steps.map(s => s.error)].filter(Boolean));
  const reasons = [];
  let code = mergeExit(...allErrors.map(errorExit));
  if (allErrors.length) reasons.push(...allErrors.map(e => `${e.category}:${e.code}`));
  if (attempts.some(a => a.cleanup !== 'complete')) { code = mergeExit(code, 2); reasons.push('cleanup-incomplete'); }
  if (t.status === 'interrupted' || attempts.some(a => a.status === 'interrupted')) {
    code = mergeExit(code, 2); reasons.push('interrupted');
  }
  if (t.status === 'skipped') { code = mergeExit(code, 3); reasons.push('selected-test-skipped'); }
  if (['failed', 'timed-out', 'flaky'].includes(t.status) || attempts.some(a => ['failed', 'timed-out'].includes(a.status))) {
    code = mergeExit(code, 1); reasons.push(t.status === 'flaky' ? 'flaky-not-clean' : 'failed-attempt');
  }
  const badSteps = attempts.flatMap(a => a.steps).filter(s => s.status !== 'passed');
  if (badSteps.length) {
    code = mergeExit(code, ...badSteps.map(s => s.error ? errorExit(s.error) : s.status === 'cancelled' ? 2 : 3));
    reasons.push('non-passing-steps');
  }
  if (t.status === 'passed' && last?.status !== 'passed') {
    code = mergeExit(code, 3); reasons.push('inconsistent-last-attempt');
  }
  const checks = (last?.steps ?? []).filter(s => s.kind === 'assertion' || s.api === 'agent.assert');
  if (t.kind === 'test' && t.status === 'passed' && !checks.some(s => s.status === 'passed')) {
    code = mergeExit(code, 3); reasons.push('no-recorded-verification');
  }
  let status = code === 2 ? 'ERROR' : code === 3 ? 'ERROR' : code === 1 ? 'FAIL' : 'PASS';
  if (code === 3 && allErrors.some(e => e.code === 'REPLAY_STALE')) status = 'STALE';
  if (code === 3 && t.status === 'skipped' && !allErrors.length) status = 'SKIPPED';
  return {
    id: t.id, name: t.titlePath.join(' > '), source_file: t.file, target_id: t.targetId,
    kind: t.kind, status, source_status: t.status, exit_code: code,
    duration_ms: attempts.reduce((n, a) => n + a.durationMs, 0),
    failure_reason: reasons.length ? [...new Set(reasons)].join('; ') : null,
    screenshot: null, visual_review: 'not-performed', recorded_checks: checks.length,
    errors: allErrors, source_attempts: attempts,
  };
}
export function normalizeReport(doc) {
  const r = validateReport(doc);
  const tests = r.results.filter(t => t.selected).map(mapTest);
  const problems = [];
  let code = mergeExit(sourceExit(r.exitCode), ...r.errors.map(errorExit), ...tests.map(t => t.exit_code));
  if (!tests.some(t => t.kind === 'test')) { code = mergeExit(code, 3); problems.push('no-selected-tests'); }
  if (r.status !== 'passed' && code === 0) { code = 3; problems.push('inconsistent-run-status'); }
  if (r.status === 'interrupted') code = mergeExit(code, 2);
  if ((r.status === 'passed') !== (r.exitCode === 0)) {
    code = mergeExit(code, 3); problems.push('inconsistent-run-exit');
  }
  const summary = { total: tests.length, pass: 0, fail: 0, error: 0, stale: 0, skipped: 0,
    duration_ms: Date.parse(r.finishedAt) - Date.parse(r.startedAt) };
  for (const t of tests) summary[t.status.toLowerCase()]++;
  return {
    schema_version: '1.0', adapter: 'tester-army-e2e', run_id: r.id, timestamp: r.finishedAt,
    scope: { type: 'external-e2e', selected_total: tests.length, full_suite_total: r.results.length },
    summary, tests, exit_code: code, problems, source_errors: r.errors,
    evidence_kind: 'external-execution', visual_review: 'not-performed', ship_ready: false,
    source: { schema_version: doc.schemaVersion, runner: r.runner, status: r.status,
      exit_code: r.exitCode, summary: r.summary, usage: r.usage ?? null, vcs: r.vcs ?? null },
  };
}
