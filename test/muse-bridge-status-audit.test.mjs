import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditMuseStatusReceipt } from '../src/muse-bridge-status-audit.mjs';

function git(dir, ...args) {
  const p = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 10000 });
  if (p.status !== 0) throw new Error(args.join(' ') + ': ' + p.stderr);
  return p.stdout.trim();
}
function fixture(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gitporch-muse-status-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, 'source');
  const mirror = path.join(workspace, 'mirror');
  for (const dir of [source, mirror]) {
    fs.mkdirSync(dir);
    git(dir, 'init', '-b', dir === source ? 'main' : 'muse-mirror');
    git(dir, 'config', 'user.name', 'Synthetic Test');
    git(dir, 'config', 'user.email', 'test@example.invalid');
    fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'fixture');
  }
  const receipt = path.join(workspace, 'muse-status.json');
  const data = {
    last_import: { git_ref: 'main', git_sha: git(source, 'rev-parse', 'HEAD') },
    last_export: { git_ref: 'muse-mirror', git_sha: git(mirror, 'rev-parse', 'HEAD') },
    drift: { git_commits_since_import: 0, muse_commits_since_export: 0 },
  };
  function save(update = data) { fs.writeFileSync(receipt, JSON.stringify(update)); }
  save();
  return { source, mirror, receipt, data, save };
}

test('matching refs and zero drift pass status receipt only', t => {
  const f = fixture(t);
  const report = auditMuseStatusReceipt(f);
  assert.equal(report.status, 'PASS_STATUS_RECEIPT_ONLY');
  assert.deepEqual(report.findings, []);
  assert.ok(report.unverified.includes('Muse receipt authenticity'));
  assert.equal(report.execution.museInvoked, false);
});

test('new source commit and altered mirror receipt SHA are detected', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.source, 'a.txt'), 'change');
  git(f.source, 'add', '.');
  git(f.source, 'commit', '-m', 'new commit');
  f.data.last_export.git_sha = 'a'.repeat(40);
  f.save();
  const report = auditMuseStatusReceipt(f);
  assert.equal(report.status, 'FAIL_OR_UNVERIFIED_STATUS');
  assert.deepEqual(report.findings, ['SOURCE_SHA_MISMATCH', 'MIRROR_SHA_MISMATCH']);
});

test('nonzero or absent drift blocks status pass', t => {
  const f = fixture(t);
  f.data.drift.muse_commits_since_export = 1;
  f.save();
  assert.ok(auditMuseStatusReceipt(f).findings.includes('DRIFT_NONZERO'));
  delete f.data.drift;
  f.save();
  assert.ok(auditMuseStatusReceipt(f).findings.includes('DRIFT_UNVERIFIED'));
});

test('missing import record and malformed SHA cannot produce a pass', t => {
  const f = fixture(t);
  delete f.data.last_import;
  f.data.last_export.git_sha = 'not-a-sha';
  f.save();
  assert.deepEqual(auditMuseStatusReceipt(f).findings,
    ['MISSING_IMPORT_RECORD', 'INVALID_EXPORT_SHA']);
});

test('rejects same repository, relative paths, and untrusted branch names', t => {
  const f = fixture(t);
  assert.throws(() => auditMuseStatusReceipt({ ...f, mirror: f.source }), /separate/);
  assert.throws(() => auditMuseStatusReceipt({ ...f, source: 'relative/path' }), /absolute/);
  f.data.last_import.git_ref = '--upload-pack=evil';
  f.save();
  assert.throws(() => auditMuseStatusReceipt(f), /Unsafe or missing branch/);
});
