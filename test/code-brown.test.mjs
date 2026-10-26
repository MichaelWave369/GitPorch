import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assessCodeBrown, CHECKS, VERSION } from '../src/code-brown.mjs';

function fixture(status = 'pass', method = 'human') {
  return {
    version: VERSION,
    app: { name: 'Example App', url: 'https://example.org' },
    session: { device: 'Xbox browser', method },
    checks: Object.fromEntries(CHECKS.map(({ id }) => [id, { status, evidence: 'Observed during a hands-on usability session.' }])),
  };
}
test('six human-observed passes produce a self-reported PASS', () => {
  assert.deepEqual(assessCodeBrown(fixture()).outcome, 'PASS');
});
test('unverified method cannot self-award a PASS', () => {
  assert.equal(assessCodeBrown(fixture('pass', 'unverified')).outcome, 'PENDING');
});
test('incomplete reports remain PENDING', () => {
  const report = fixture(); delete report.checks['would-return'];
  assert.deepEqual(assessCodeBrown(report), {
    outcome: 'PENDING', passed: 5, failed: 0, untested: 1, errors: [],
  });
});
test('an observed failure takes priority over passes', () => {
  const report = fixture(); report.checks['device-controls'] = { status: 'fail', evidence: 'Controller could not select the Start button.' };
  assert.equal(assessCodeBrown(report).outcome, 'FAIL');
});
test('no evidence is not a passing review', () => {
  const report = fixture(); report.checks.understand.evidence = '';
  assert.equal(assessCodeBrown(report).outcome, 'INVALID');
});
test('unknown check and malformed URLs fail closed', () => {
  const report = fixture(); report.checks.imagination = { status: 'pass', evidence: 'No.' };
  report.app.url = 'javascript:alert(1)';
  assert.equal(assessCodeBrown(report).outcome, 'INVALID');
});
test('example report is pending and optional CLI gate rejects it', () => {
  const run = spawnSync(process.execPath, ['src/code-brown-cli.mjs', 'examples/code-brown.example.json', '--require-pass'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /CODE BROWN: PENDING/);
});
