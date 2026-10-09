/** Narrow report-1 consumer. Not a substitute for upstream's full JSON Schema. */
export class AdapterError extends Error {
  constructor(code, message, exitCode = 3) {
    super(message); this.name = 'AdapterError'; this.code = code; this.exitCode = exitCode;
  }
}
export function ensure(condition, code, message, exitCode = 3) {
  if (!condition) throw new AdapterError(code, message, exitCode);
}
export const SOURCE_VERSION = '0.18.0';
const RESULT = ['passed', 'flaky', 'failed', 'timed-out', 'interrupted', 'skipped'];
const STEP = ['passed', 'failed', 'blocked', 'timed-out', 'cancelled'];
const CATEGORY = ['test', 'configuration', 'infrastructure', 'internal', 'interrupted'];
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.length > 0;
const count = x => Number.isSafeInteger(x) && x >= 0;
const array = x => Array.isArray(x);
function need(ok, label) { ensure(ok, 'INVALID_REPORT', `Invalid or missing ${label}`); }
function error(e) {
  need(object(e) && CATEGORY.includes(e.category) && text(e.code) &&
    typeof e.message === 'string' && typeof e.retryable === 'boolean', 'error');
}
function errors(owner) {
  if (owner.error !== undefined) error(owner.error);
  need(array(owner.secondaryErrors), 'secondaryErrors');
  owner.secondaryErrors.forEach(error);
}
function attempt(attemptData) {
  const a = attemptData;
  need(object(a) && text(a.id) && RESULT.filter(x => x !== 'flaky').includes(a.status), 'attempt');
  need(count(a.durationMs) && ['complete', 'failed', 'forced'].includes(a.cleanup), 'attempt completion');
  need(array(a.steps) && array(a.artifacts), 'attempt steps/artifacts'); errors(a);
  const ids = new Set();
  for (const s of a.steps) {
    need(object(s) && text(s.id) && !ids.has(s.id) && text(s.api) && text(s.kind) &&
      STEP.includes(s.status) && count(s.durationMs), 'step'); ids.add(s.id);
    if (s.error !== undefined) error(s.error);
    need(array(s.artifacts) && s.artifacts.every(text), 'step artifact IDs');
  }
  const artifacts = new Set();
  for (const a of attemptData.artifacts) {
    need(object(a) && text(a.id) && !artifacts.has(a.id) &&
      ['screenshot', 'video', 'download', 'log', 'other'].includes(a.kind) &&
      text(a.mediaType) && ['complete', 'incomplete'].includes(a.redaction), 'artifact');
    artifacts.add(a.id);
    if (a.path !== undefined) need(text(a.path), 'artifact path');
    if (a.size !== undefined) need(count(a.size), 'artifact size');
    if (a.sha256 !== undefined) need(/^[a-f0-9]{64}$/.test(a.sha256), 'artifact hash');
    if (a.redaction === 'complete') need(text(a.path) && count(a.size) &&
      /^[a-f0-9]{64}$/.test(a.sha256), 'complete artifact integrity');
  }
  for (const s of a.steps) need(s.artifacts.every(id => artifacts.has(id)), 'artifact references');
}
export function validateReport(doc) {
  need(object(doc) && doc.schemaVersion === 'report-1' && object(doc.run), 'schemaVersion/run');
  const r = doc.run;
  ensure(r.specVersion === '0.1' && r.runner?.name === 'e2e' && r.runner.version === SOURCE_VERSION,
    'UNSUPPORTED_VERSION', `Supported: report-1/spec 0.1/e2e ${SOURCE_VERSION}`);
  need(text(r.id) && ['passed', 'failed', 'error', 'blocked', 'interrupted'].includes(r.status), 'run identity/status');
  need([0, 1, 2, 3, 4, 130].includes(r.exitCode), 'run exitCode');
  const start = Date.parse(r.startedAt), finish = Date.parse(r.finishedAt);
  need(Number.isFinite(start) && Number.isFinite(finish) && finish >= start, 'run timestamps');
  need(array(r.results) && array(r.errors) && array(r.targets) && array(r.serialGroups), 'run collections');
  ensure(r.explore === undefined, 'UNSUPPORTED_EXPLORE', 'Import test runs, not exploration reports');
  ensure(r.serialGroups.length === 0 && r.results.every(x => x?.serialGroupId === undefined),
    'UNSUPPORTED_SERIAL', 'Serial-group evidence needs a dedicated mapper; not silently flattened');
  ensure(r.carried === undefined, 'UNSUPPORTED_CARRIED', 'Carried previous failures must be resolved before import');
  r.errors.forEach(error);
  const targetIds = new Set();
  for (const t of r.targets) {
    need(object(t) && text(t.id) && !targetIds.has(t.id), 'target'); targetIds.add(t.id);
  }
  const ids = new Set();
  for (const t of r.results) {
    need(object(t) && text(t.id) && !ids.has(t.id) && text(t.testId) &&
      ['test', 'setup'].includes(t.kind), 'result identity/kind'); ids.add(t.id);
    need(typeof t.selected === 'boolean' && RESULT.includes(t.status) && array(t.attempts), 'result state');
    need(array(t.titlePath) && t.titlePath.every(text) && text(t.file) &&
      text(t.targetId) && targetIds.has(t.targetId), 'result metadata');
    ensure(!t.selected || t.platform === 'web', 'UNSUPPORTED_PLATFORM', 'Initial adapter supports web results only');
    need(t.selected || (t.status === 'skipped' && t.attempts.length === 0), 'unselected result');
    if (t.selected && t.status !== 'skipped') need(t.attempts.length > 0, 'executed attempts');
    const attemptIds = new Set();
    for (const a of t.attempts) {
      attempt(a); need(!attemptIds.has(a.id), 'unique attempt IDs'); attemptIds.add(a.id);
    }
  }
  const selected = r.results.filter(t => t.selected);
  need(object(r.summary) && count(r.summary.executed), 'summary');
  const expected = { discovered: r.results.length, selected: selected.length,
    passed: 0, failed: 0, interrupted: 0, flaky: 0, skipped: 0 };
  for (const t of selected) expected[t.status === 'timed-out' ? 'failed' : t.status]++;
  for (const [key, value] of Object.entries(expected)) need(r.summary[key] === value, `summary.${key}`);
  return r;
}
/** ShipGuard priority is not numeric order: infra > incomplete > findings > clean. */
export function mergeExit(...codes) {
  return [2, 3, 1, 0].find(code => codes.includes(code)) ?? 0;
}
export function sourceExit(code) {
  ensure([0, 1, 2, 3, 4, 130].includes(code), 'UNKNOWN_EXIT', 'Unknown runner exit code', 2);
  return ({ 0: 0, 1: 1, 2: 3, 3: 2, 4: 2, 130: 2 })[code];
}
export function errorExit(e) {
  return e.code === 'REPLAY_STALE' ? 3 : ({ test: 1, configuration: 3,
    infrastructure: 2, internal: 2, interrupted: 2 })[e.category];
}
