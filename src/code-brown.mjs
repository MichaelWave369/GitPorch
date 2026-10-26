// Code Brown v0.1: local, human-reported usability review. No automated human-verification claims.
export const VERSION = 'code-brown/0.1';
export const CHECKS = Object.freeze([
  { id: 'understand', label: 'Understands the app in 5 seconds' },
  { id: 'find-action', label: 'Finds the main action without instruction' },
  { id: 'first-success', label: 'Completes something useful in 30 seconds' },
  { id: 'device-controls', label: 'Can navigate using available controls' },
  { id: 'error-recovery', label: 'Recovers from a mistake without developer help' },
  { id: 'would-return', label: 'Would voluntarily use the app again' },
]);
const statuses = new Set(['pass', 'fail', 'not-tested']);
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }

export function assessCodeBrown(report) {
  const errors = [];
  if (!plainObject(report)) return { outcome: 'INVALID', passed: 0, failed: 0, untested: 6, errors: ['Report must be an object.'] };
  if (report.version !== VERSION) errors.push('Unknown report version.');
  if (!plainObject(report.app) || !nonempty(report.app.name) || !nonempty(report.app.url)) {
    errors.push('App name and URL are required.');
  } else {
    try {
      const u = new URL(report.app.url);
      if (!['http:', 'https:'].includes(u.protocol)) errors.push('App URL must use HTTP(S).');
    } catch { errors.push('App URL must be a valid absolute URL.'); }
  }
  if (!plainObject(report.session) || !nonempty(report.session.device) ||
      !['human', 'unverified'].includes(report.session.method)) {
    errors.push('Session needs device and method (human or unverified).');
  }
  if (!plainObject(report.checks)) errors.push('Checks must be an object.');
  const ids = new Set(CHECKS.map(c => c.id));
  if (plainObject(report.checks)) for (const id of Object.keys(report.checks)) {
    if (!ids.has(id)) errors.push('Unknown check: ' + id);
  }
  let passed = 0, failed = 0, untested = 0;
  for (const { id } of CHECKS) {
    const item = plainObject(report.checks) ? report.checks[id] : undefined;
    if (item === undefined) { untested++; continue; }
    if (!plainObject(item) || !statuses.has(item.status)) {
      errors.push('Invalid status for ' + id); continue;
    }
    if (item.status === 'pass') {
      passed++;
      if (!nonempty(item.evidence)) errors.push('Passing check requires observation: ' + id);
    } else if (item.status === 'fail') {
      failed++;
      if (!nonempty(item.evidence)) errors.push('Failing check requires observation: ' + id);
    } else untested++;
  }
  let outcome = 'PENDING';
  if (errors.length) outcome = 'INVALID';
  else if (failed) outcome = 'FAIL';
  else if (passed === CHECKS.length && report.session.method === 'human') outcome = 'PASS';
  // Even PASS means a self-reported human acceptance review, not independently witnessed.
  return { outcome, passed, failed, untested, errors };
}
