import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createDisposableFixture,
  inspectGitRepository,
  makeBridgePlan,
} from '../src/muse-bridge-pilot.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitporch-muse-pilot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('fixture requires explicit approval and never overwrites an existing directory', t => {
  const root = workspace(t);
  const target = path.join(root, 'synthetic');
  assert.throws(() => createDisposableFixture(target), /requires/);
  assert.equal(fs.existsSync(target), false);
  const result = createDisposableFixture(target, true);
  assert.equal(result.status, 'LOCAL_SYNTHETIC_GIT_FIXTURE_CREATED');
  assert.equal(result.museInvoked, false);
  assert.equal(result.networkUsed, false);
  assert.throws(() => createDisposableFixture(target, true), /refusing overwrite/);
});

test('fixture includes actual divergent history, merge, deletion, and executable mode', t => {
  const root = workspace(t);
  const source = path.join(root, 'repo');
  createDisposableFixture(source, true);
  const result = inspectGitRepository(source);
  assert.equal(result.branch, 'main');
  assert.equal(result.clean, true);
  assert.ok(result.commitCount >= 6);
  assert.ok(result.mergeCount >= 1);
  assert.ok(result.executableFileCount >= 1);
  assert.equal(fs.existsSync(path.join(source, 'obsolete.txt')), false);
  assert.equal(fs.existsSync(path.join(source, 'src', 'feature.js')), true);
  const remotes = spawnSync('git', ['-C', source, 'remote'], { encoding: 'utf8' });
  assert.equal(remotes.status, 0);
  assert.equal(remotes.stdout.trim(), '');
});

test('plan generates reviewable Muse commands but runs nothing', t => {
  const root = workspace(t);
  const source = path.join(root, 'source');
  createDisposableFixture(source, true);
  const museDir = path.join(root, 'muse-new');
  const mirrorDir = path.join(root, 'mirror-new');
  const result = makeBridgePlan({ source, museDir, mirrorDir });
  assert.equal(result.status, 'PLAN_ONLY_AWAITING_RELEASE_CANDIDATE');
  assert.equal(result.execution.museInvoked, false);
  assert.equal(result.execution.gitPushAttempted, false);
  assert.equal(result.execution.networkUsed, false);
  assert.ok(result.commandsForHumanReview.some(x =>
    x.argv.includes('git-import') && x.argv.includes('--json')));
  assert.ok(result.commandsForHumanReview.some(x =>
    x.argv.includes('git-export') && x.argv.includes('--no-push')));
  assert.equal(fs.existsSync(museDir), false);
  assert.equal(fs.existsSync(mirrorDir), false);
});

test('plan refuses overlapping, existing, or dirty targets', t => {
  const root = workspace(t);
  const source = path.join(root, 'source');
  createDisposableFixture(source, true);
  const museDir = path.join(root, 'muse-new');
  const mirrorDir = path.join(root, 'mirror-new');
  assert.throws(() => makeBridgePlan({ source, museDir: source, mirrorDir }), /disjoint/);
  assert.throws(() => makeBridgePlan({ source, museDir, mirrorDir: path.join(museDir, 'git') }), /disjoint/);
  fs.mkdirSync(museDir);
  assert.throws(() => makeBridgePlan({ source, museDir, mirrorDir }), /must NOT exist/);
  fs.rmdirSync(museDir);
  fs.writeFileSync(path.join(source, 'unexpected.txt'), 'untracked file');
  assert.throws(() => makeBridgePlan({ source, museDir, mirrorDir }), /working-tree changes/);
});

test('inspection rejects nested repository paths, invalid refs, and relative paths', t => {
  const root = workspace(t);
  const source = path.join(root, 'source');
  createDisposableFixture(source, true);
  assert.throws(() => inspectGitRepository(path.join(source, 'src')), /repository root/);
  assert.throws(() => inspectGitRepository(source, '../unsafe'), /Unsafe Git branch/);
  assert.throws(() => inspectGitRepository('relative/path'), /absolute/);
});
