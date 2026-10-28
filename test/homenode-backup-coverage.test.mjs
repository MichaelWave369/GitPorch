import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { backupRepo } from '../src/homenode.mjs';
import { publicBackupCoverage } from '../src/homenode-backup-coverage.mjs';
import { createRepo, git } from '../src/git.mjs';
import { saveCatalog } from '../src/homenode-bridge.mjs';

const exec = promisify(execFile);
const UUID = '12345678-1234-1234-1234-123456789abc';
function catalog(...names) {
  return { schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
    visibility: 'PUBLIC_ONLY', count: names.length,
    repositories: names.map(name => ({ name, eligible: true })) };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r05-'));
  try {
    const data = join(root, 'data'), backups = join(root, 'backups'), catalogs = join(root, 'catalogs');
    await mkdir(backups);
    await mkdir(catalogs);
    return await fn({ root, data, backups, catalogs });
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function populated(f, name = 'PhiOS') {
  const repo = await createRepo(f.data, name);
  const work = join(f.root, 'work-' + name);
  await git(['init', '--initial-branch=main', work]);
  await git(['-C', work, '-c', 'user.name=R05 Tester', '-c', 'user.email=ledger@example.invalid',
    'commit', '--allow-empty', '-m', 'first']);
  await git(['-C', work, 'tag', 'v1']);
  await git(['-C', work, 'push', repo.path, '--all']);
  await git(['-C', work, 'push', repo.path, '--tags']);
  return { repo, work };
}
async function pushNext(work, repoPath) {
  await git(['-C', work, '-c', 'user.name=R05 Tester', '-c', 'user.email=ledger@example.invalid',
    'commit', '--allow-empty', '-m', 'second']);
  await git(['-C', work, 'push', repoPath, '--all']);
}

test('all-public coverage starts missing, then becomes verified and ref-current', async () => fixture(async f => {
  const c = catalog('PhiOS', 'LENZ');
  const initial = await publicBackupCoverage(c, f.backups, f.data);
  assert.equal(initial.summary.totalPublic, 2);
  assert.equal(initial.summary.noSnapshot, 2);
  assert.equal(initial.summary.locallyVerifiedGitObjects, 0);
  assert.deepEqual(initial.repositories.map(r => r.backupStatus), ['NO_SNAPSHOT_FOUND', 'NO_SNAPSHOT_FOUND']);
  await populated(f);
  const snapshot = await backupRepo('PhiOS', f.backups, f.data);
  const audit = await publicBackupCoverage(c, f.backups, f.data);
  assert.equal(audit.schema, 'gitporch.public-backup-coverage.v0.1');
  assert.equal(audit.mode, 'OFFLINE_PUBLIC_BACKUP_COVERAGE_AUDIT');
  assert.equal(audit.summary.backedUpCurrentRefs, 1);
  assert.equal(audit.summary.noSnapshot, 1);
  assert.equal(audit.summary.locallyVerifiedGitObjects, 1);
  assert.equal(audit.repositories[0].backupStatus, 'VERIFIED_SNAPSHOT_MATCHES_LOCAL_REFS');
  assert.equal(audit.repositories[0].verifiedBundleSha256, snapshot.sha256);
  assert.equal(audit.repositories[0].verifiedSnapshots, 1);
  assert.equal(audit.repositories[1].mirrorStatus, 'NOT_LOCAL');
  for (const claimed of Object.values(audit.acceptance)) assert.equal(claimed, false);
  assert.equal(JSON.stringify(audit).includes(f.root), false);
  assert.equal((await readdir(f.backups)).length, 1);
}));

test('valid backup after local Git refs changed is not marked current', async () => fixture(async f => {
  const { repo, work } = await populated(f);
  await backupRepo('PhiOS', f.backups, f.data);
  await pushNext(work, repo.path);
  const stale = await publicBackupCoverage(catalog('PhiOS'), f.backups, f.data);
  assert.equal(stale.summary.backedUpCurrentRefs, 0);
  assert.equal(stale.summary.verifiedButRefsChanged, 1);
  assert.equal(stale.repositories[0].backupStatus, 'VERIFIED_SNAPSHOT_REFS_DIFFER_FROM_LOCAL');
  await backupRepo('PhiOS', f.backups, f.data);
  const fresh = await publicBackupCoverage(catalog('PhiOS'), f.backups, f.data);
  assert.equal(fresh.summary.backedUpCurrentRefs, 1);
  assert.equal(fresh.summary.examinedSnapshots, 2);
  assert.equal(fresh.repositories[0].verifiedSnapshots, 2);
}));

test('verified backup survives missing local mirror but cannot compare source refs', async () => fixture(async f => {
  const { repo } = await populated(f);
  await backupRepo('PhiOS', f.backups, f.data);
  await rm(repo.path, { recursive: true, force: true });
  const result = await publicBackupCoverage(catalog('PhiOS'), f.backups, f.data);
  assert.equal(result.summary.verifiedButNoLocalComparison, 1);
  assert.equal(result.repositories[0].backupStatus, 'VERIFIED_SNAPSHOT_LOCAL_COMPARISON_UNAVAILABLE');
  assert.equal(result.repositories[0].mirrorStatus, 'NOT_LOCAL');
  assert.equal(result.acceptance.offHostRestored, false);
}));

test('corrupt backup is invalid, never counted as verified coverage', async () => fixture(async f => {
  await populated(f);
  const backup = await backupRepo('PhiOS', f.backups, f.data);
  await writeFile(join(backup.path, 'repository.bundle'), 'broken');
  const report = await publicBackupCoverage(catalog('PhiOS'), f.backups, f.data);
  assert.equal(report.summary.backedUpCurrentRefs, 0);
  assert.equal(report.summary.invalidSnapshotOnly, 1);
  assert.equal(report.repositories[0].backupStatus, 'SNAPSHOT_CANDIDATES_INVALID');
  assert.equal(report.repositories[0].verifiedSnapshots, 0);
}));

test('unrelated directories and private repo-looking names are ignored, never published', async () => fixture(async f => {
  await populated(f);
  const unrelated = join(f.backups, 'gitporch-SecretInternal-' + UUID);
  await mkdir(unrelated);
  await writeFile(join(unrelated, 'snapshot.json'), JSON.stringify({ privateToken: 'DO-NOT-PUBLISH' }));
  await mkdir(join(f.backups, 'ordinary-files'));
  const result = await publicBackupCoverage(catalog('PhiOS'), f.backups, f.data);
  assert.equal(result.summary.examinedSnapshots, 0);
  assert.equal(result.summary.noSnapshot, 1);
  assert.equal(JSON.stringify(result).includes('SecretInternal'), false);
  assert.equal(JSON.stringify(result).includes('DO-NOT-PUBLISH'), false);
}));

test('refuses private, foreign, duplicate, and backup root inside live source tree', async () => fixture(async f => {
  const c = catalog('PhiOS');
  await populated(f);
  for (const bad of [
    { ...c, visibility: 'PRIVATE' }, { ...c, owner: 'DifferentOwner' },
    { ...c, count: 99 }, catalog('PhiOS', 'phios'),
  ]) await assert.rejects(publicBackupCoverage(bad, f.backups, f.data));
  await assert.rejects(publicBackupCoverage(c, join(f.data, 'repos'), f.data), /outside/);
  await assert.rejects(publicBackupCoverage(c, 'relative', f.data), /absolute/);
}));

test('CLI uses existing public catalog and existing backups without importing new repositories', async () => fixture(async f => {
  const c = catalog('PhiOS', 'GitPorch');
  const saved = await saveCatalog(c, f.catalogs);
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const env = { ...process.env, GITPORCH_DATA_DIR: f.data };
  const stdout = await exec(process.execPath, [cli, 'coverage', saved.path, f.backups], { env });
  const report = JSON.parse(stdout.stdout);
  assert.equal(report.summary.noSnapshot, 2);
  assert.equal(report.acceptance.fullOfflineReady, false);
  assert.deepEqual(await readdir(f.backups), []);
  const failed = await assert.rejects(
    exec(process.execPath, [cli, 'coverage', saved.path], { env }),
    e => e.code === 1 && /Invalid arguments/.test(e.stderr)
  );
}));

test('Git config injection cannot convert bundle verification into a remote clone', async () => fixture(async f => {
  await populated(f);
  await backupRepo('PhiOS', f.backups, f.data);
  const keys = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_ASKPASS'];
  const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'url.https://example.invalid/.insteadOf';
    process.env.GIT_CONFIG_VALUE_0 = f.backups;
    process.env.GIT_ASKPASS = 'evil-askpass';
    const report = await publicBackupCoverage(catalog('PhiOS'), f.backups, f.data);
    assert.equal(report.summary.backedUpCurrentRefs, 1);
  } finally {
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}));
