import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createGitHistoryBaseline } from '../src/muse-bridge-history-baseline.mjs';

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) throw new Error(args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitporch-muse-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.name', 'Synthetic Fixture');
  git(dir, 'config', 'user.email', 'synthetic@example.invalid');
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-m', 'base');
  git(dir, 'switch', '-c', 'feature');
  fs.writeFileSync(path.join(dir, 'feature.txt'), 'on-feature\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-m', 'feature');
  git(dir, 'switch', 'main');
  fs.writeFileSync(path.join(dir, 'main.txt'), 'only-main\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-m', 'main-diverge');
  git(dir, 'merge', '--no-ff', 'feature', '-m', 'merge feature');
  fs.writeFileSync(path.join(dir, 'run.sh'), '#!/bin/sh\necho ok\n');
  git(dir, 'add', 'run.sh');
  git(dir, 'update-index', '--chmod=+x', 'run.sh');
  git(dir, 'commit', '-m', 'executable');
  return dir;
}

test('records true parent graph and branch-specific historical snapshots', t => {
  const dir = workspace(t);
  const report = createGitHistoryBaseline(dir);
  assert.equal(report.status, 'GIT_ONLY_BASELINE');
  assert.equal(report.source.commitCount, 5);
  assert.equal(report.commits.filter(x => x.isMerge).length, 1);
  const merge = report.commits.find(x => x.isMerge);
  assert.equal(merge.parents.length, 2);
  assert.ok(merge.parents.every(x => report.commits.some(c => c.gitSha === x)));
  const mainOnly = report.commits.find(x => x.files.some(f => f.path === 'main.txt') && !x.isMerge);
  assert.equal(mainOnly.files.some(f => f.path === 'feature.txt'), false);
  const featureOnly = report.commits.find(x => x.files.some(f => f.path === 'feature.txt') && !x.isMerge);
  assert.equal(featureOnly.files.some(f => f.path === 'main.txt'), false);
  assert.ok(merge.files.some(f => f.path === 'feature.txt'));
  assert.ok(merge.files.some(f => f.path === 'main.txt'));
});

test('history baseline is deterministic and includes executable mode', t => {
  const dir = workspace(t);
  const a = createGitHistoryBaseline(dir);
  const b = createGitHistoryBaseline(dir);
  assert.deepEqual(a, b);
  assert.ok(a.commits.at(-1).files.some(f => f.path === 'run.sh' && f.mode === '100755'));
  assert.match(a.commits.at(-1).snapshotSha256, /^[0-9a-f]{64}$/);
  assert.equal(a.execution.museInvoked, false);
});

test('new commit changes newest historical snapshot without changing ancestors', t => {
  const dir = workspace(t);
  const first = createGitHistoryBaseline(dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'modified\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-m', 'modify');
  const second = createGitHistoryBaseline(dir);
  assert.equal(second.source.commitCount, first.source.commitCount + 1);
  assert.deepEqual(second.commits.slice(0, -1), first.commits);
  assert.notEqual(second.commits.at(-1).snapshotSha256, first.commits.at(-1).snapshotSha256);
});

test('rejects relative/nested roots and unsafe refs', t => {
  const dir = workspace(t);
  assert.throws(() => createGitHistoryBaseline('.'), /absolute/);
  assert.throws(() => createGitHistoryBaseline(path.join(dir, '.git')), /Git working-tree root|Git rev-parse failed/);
  assert.throws(() => createGitHistoryBaseline(dir, '--upload-pack=bad'), /Unsafe/);
  assert.throws(() => createGitHistoryBaseline(dir, 'does-not-exist'), /Git rev-parse failed/);
});

test('fails closed on Git submodules instead of silently dropping gitlinks', t => {
  const dir = workspace(t);
  const tip = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'update-index', '--add', '--cacheinfo', '160000,' + tip + ',vendor/sample');
  git(dir, 'commit', '-m', 'gitlink');
  assert.throws(() => createGitHistoryBaseline(dir), /Unsupported Git tree entry/);
});
