import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditBridgeSnapshot } from '../src/muse-bridge-snapshot-audit.mjs';

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitporch-muse-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  git(source, 'init', '-b', 'main');
  git(source, 'config', 'user.name', 'Synthetic');
  git(source, 'config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(source, 'README.md'), 'Source tree\n');
  fs.writeFileSync(path.join(source, 'script.sh'), '#!/bin/sh\necho hello\n');
  git(source, 'add', '.');
  git(source, 'update-index', '--chmod=+x', 'script.sh');
  git(source, 'commit', '-m', 'synthetic fixture');
  const mirror = path.join(root, 'mirror');
  const clone = spawnSync('git', ['clone', '--no-hardlinks', '--', source, mirror], { encoding: 'utf8' });
  if (clone.status !== 0) throw new Error(clone.stderr);
  git(mirror, 'config', 'user.name', 'Synthetic');
  git(mirror, 'config', 'user.email', 'test@example.invalid');
  git(mirror, 'switch', '-c', 'muse-mirror');
  return { root, source, mirror };
}

test('matching file bytes, modes and paths pass, without claiming history parity', t => {
  const { source, mirror } = fixture(t);
  const report = auditBridgeSnapshot(source, mirror);
  assert.equal(report.status, 'PASS_SNAPSHOT_ONLY');
  assert.equal(report.source.fileCount, 2);
  assert.equal(report.execution.networkUsed, false);
  assert.ok(report.unverified.includes('merge ancestry'));
});

test('changed content and unexpected extra tracked file are reported', t => {
  const { source, mirror } = fixture(t);
  fs.writeFileSync(path.join(mirror, 'README.md'), 'Mutated\n');
  fs.writeFileSync(path.join(mirror, 'extra.txt'), 'Not part of source\n');
  git(mirror, 'add', '.');
  git(mirror, 'commit', '-m', 'change mirror');
  const report = auditBridgeSnapshot(source, mirror);
  assert.equal(report.status, 'FAIL_SNAPSHOT');
  assert.deepEqual(report.differences.contentMismatch, ['README.md']);
  assert.deepEqual(report.differences.extraInMirror, ['extra.txt']);
});

test('deleted tracked file and lost executable bit are reported separately', t => {
  const { source, mirror } = fixture(t);
  fs.rmSync(path.join(mirror, 'README.md'));
  git(mirror, 'add', '-u');
  git(mirror, 'update-index', '--chmod=-x', 'script.sh');
  git(mirror, 'commit', '-m', 'regress mirror');
  const report = auditBridgeSnapshot(source, mirror);
  assert.equal(report.status, 'FAIL_SNAPSHOT');
  assert.deepEqual(report.differences.missingFromMirror, ['README.md']);
  assert.deepEqual(report.differences.modeMismatch, ['script.sh']);
});

test('refuses same repository, nested directories, and bogus branch', t => {
  const { source, mirror } = fixture(t);
  assert.throws(() => auditBridgeSnapshot(source, source), /separate/);
  assert.throws(() => auditBridgeSnapshot(source, path.join(source, '.git')), /Git working-tree root|Git rev-parse failed/);
  assert.throws(() => auditBridgeSnapshot(source, mirror, { mirrorBranch: '--evil' }), /Invalid branch/);
});
