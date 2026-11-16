import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assembleMuseEvidencePacket } from '../src/muse-bridge-evidence-packet.mjs';

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15000 });
  if (r.status !== 0) throw new Error(args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitporch-r05-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'src');
  const mirror = path.join(dir, 'mirror');
  fs.mkdirSync(source);
  git(source, 'init', '-b', 'main');
  git(source, 'config', 'user.name', 'Synthetic');
  git(source, 'config', 'user.email', 'synthetic@example.invalid');
  fs.writeFileSync(path.join(source, 'README.md'), 'synthetic\n');
  git(source, 'add', '.'); git(source, 'commit', '-m', 'initial');
  const clone = spawnSync('git', ['clone', '--no-hardlinks', source, mirror], { encoding: 'utf8' });
  if (clone.status !== 0) throw new Error(clone.stderr);
  git(mirror, 'remote', 'remove', 'origin');
  git(mirror, 'switch', '-c', 'muse-mirror');
  const statusReceipt = path.join(dir, 'status.json');
  const versionLog = path.join(dir, 'version.txt');
  const importLog = path.join(dir, 'import.log');
  const exportLog = path.join(dir, 'export.log');
  const status = {
    last_import: { git_sha: git(source, 'rev-parse', 'HEAD'), git_ref: 'main' },
    last_export: { git_sha: git(mirror, 'rev-parse', 'HEAD'), git_ref: 'muse-mirror' },
    drift: { git_commits_since_import: 0, muse_commits_since_export: 0 },
  };
  fs.writeFileSync(statusReceipt, JSON.stringify(status));
  fs.writeFileSync(versionLog, 'muse synthetic-not-a-real-install\n');
  fs.writeFileSync(importLog, '{"synthetic":true}\n');
  fs.writeFileSync(exportLog, '{"synthetic":true}\n');
  return { source, mirror, statusReceipt, versionLog, importLog, exportLog, status };
}

test('composes four opaque operator logs with three independent Git checks; never claims Muse verified', t => {
  const f = fixture(t);
  const r = assembleMuseEvidencePacket(f);
  assert.equal(r.status, 'GIT_CHECKS_PASS_LOGS_PRESENT_HUMAN_REVIEW_REQUIRED');
  assert.equal(r.gitBaseline.commits, 1);
  assert.equal(r.snapshot.status, 'PASS_SNAPSHOT_ONLY');
  assert.equal(r.syncReceipt.status, 'PASS_STATUS_RECEIPT_ONLY');
  assert.ok(r.opaqueLogs.import.sha256.match(/^[a-f0-9]{64}$/));
  assert.match(r.reviewBoundary, /UNVERIFIED/);
  assert.equal(r.execution.museInvoked, false);
});

test('missing import and export logs blocks review completeness', t => {
  const f = fixture(t);
  delete f.importLog; delete f.exportLog;
  const r = assembleMuseEvidencePacket(f);
  assert.equal(r.status, 'BLOCKED_OR_INCOMPLETE');
  assert.ok(r.blockers.includes('MISSING_IMPORT_RECEIPT'));
  assert.ok(r.blockers.includes('MISSING_EXPORT_RECEIPT'));
});

test('mismatched snapshot and stale status receipt are separate failures', t => {
  const f = fixture(t);
  git(f.mirror, 'config', 'user.name', 'Synthetic');
  git(f.mirror, 'config', 'user.email', 'synthetic@example.invalid');
  fs.writeFileSync(path.join(f.mirror, 'README.md'), 'different\n');
  git(f.mirror, 'add', '.'); git(f.mirror, 'commit', '-m', 'mutated');
  const r = assembleMuseEvidencePacket(f);
  assert.ok(r.blockers.includes('SNAPSHOT_MISMATCH'));
  assert.ok(r.blockers.includes('STATUS_RECEIPT_MISMATCH_OR_UNVERIFIED'));
  assert.ok(r.blockers.includes('GIT_HEADS_INCONSISTENT') === false);
});

test('existing Git remote blocks readiness even if Git snapshots match', t => {
  const f = fixture(t);
  git(f.mirror, 'remote', 'add', 'origin', 'https://example.invalid/nope');
  const r = assembleMuseEvidencePacket(f);
  assert.ok(r.blockers.includes('GIT_REMOTE_PRESENT'));
});

test('refuses evidence logs inside Git trees and symlinked logs', t => {
  const f = fixture(t);
  const internal = path.join(f.source, 'version.txt');
  fs.writeFileSync(internal, 'not approved');
  assert.throws(() => assembleMuseEvidencePacket({ ...f, versionLog: internal }), /outside both Git worktrees/);
  const link = path.join(path.dirname(f.versionLog), 'link.txt');
  fs.symlinkSync(f.versionLog, link);
  assert.throws(() => assembleMuseEvidencePacket({ ...f, versionLog: link }), /non-symlink/);
});

test('dirty worktrees are refused even if committed snapshots match', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.mirror, 'untracked.tmp'), 'not in snapshot');
  const r = assembleMuseEvidencePacket(f);
  assert.ok(r.blockers.includes('DIRTY_GIT_WORKTREE'));
  assert.equal(r.snapshot.status, 'PASS_SNAPSHOT_ONLY');
});
