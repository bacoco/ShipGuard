/** Synthetic report-1 consumer fixtures, not recorded browser executions. */
export function failure(category = 'test', code = 'ASSERTION_FAILED') {
  return { category, code, message: 'synthetic test failure', retryable: false };
}
export function fixture(status = 'passed', err = null) {
  const step = { id: 'step-1', index: 1, kind: 'assertion', api: 'expect.toHaveText',
    label: 'status is Ready', source: { file: 'tests/cart.e2e.ts', line: 10, column: 3 },
    startedAt: '2026-10-09T05:00:00.000Z', durationMs: 1,
    status: status === 'passed' ? 'passed' : 'failed', artifacts: [], events: [],
    ...(err ? { error: err } : {}) };
  const attempt = { id: 'attempt-1', index: 1, status: status === 'flaky' ? 'passed' : status,
    startedAt: '2026-10-09T05:00:00.000Z', durationMs: 10, steps: [step], artifacts: [],
    cleanup: 'complete', secondaryErrors: [], ...(err ? { error: err } : {}) };
  const result = { id: 'result-1', testId: 'test-1', kind: 'test', declarationIndex: 0,
    titlePath: ['cart', 'shows total'], file: 'tests/cart.e2e.ts', source: step.source,
    targetId: 'web', platform: 'web', agent: 'default', repeat: 0, tags: [], selected: true,
    status, attempts: status === 'skipped' ? [] : [attempt] };
  const exit = err ? ({ test: 1, configuration: 2, infrastructure: 3, internal: 4, interrupted: 130 })[err.category]
    : status === 'passed' || status === 'skipped' || status === 'flaky' ? 0 : status === 'interrupted' ? 130 : 1;
  const doc = { schemaVersion: 'report-1', run: { id: '019a1234-1234-7000-8000-123456789abc',
    specVersion: '0.1', runner: { name: 'e2e', version: '0.18.0' }, status: exit === 0 ? 'passed' : 'failed',
    exitCode: exit, startedAt: '2026-10-09T05:00:00.000Z', finishedAt: '2026-10-09T05:00:00.010Z',
    project: { id: 'fixture', configDigest: '0'.repeat(64) },
    environment: { ci: true, trustNoticeShown: true, os: 'linux', arch: 'x64', runtime: 'node' },
    targets: [{ id: 'web', index: 0, platform: 'web', environment: 'local',
      engine: { name: 'playwright', version: 'fixture', spiVersion: '0.1' },
      capabilities: [], artifactCapabilities: ['screenshot'], stateCapability: false }],
    serialGroups: [], results: [result], errors: [], summary: {}, usage: { modelTokens: 0 } } };
  return recount(doc);
}
export function recount(doc) {
  const r = doc.run;
  r.summary = { discovered: r.results.length, selected: 0, executed: 0, passed: 0,
    failed: 0, flaky: 0, interrupted: 0, skipped: 0 };
  for (const t of r.results.filter(t => t.selected)) {
    r.summary.selected++; if (t.attempts.length) r.summary.executed++;
    r.summary[t.status === 'timed-out' ? 'failed' : t.status]++;
  }
  return doc;
}
