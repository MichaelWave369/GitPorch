import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, lstat, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { backupRepo } from '../src/homenode.mjs';
import { restoreBundleDrill } from '../src/homenode-restore-drill.mjs';
import { createRepo, git } from '../src/git.mjs';

const exec = promisify(execFile);
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-drill-'));
  try {
    const data = join(root, 'data');
    const copies = join(root, 'backup-disk-simulated');
    const restores = join(root, 'restore-disk-simulated');
    await mkdir(copies);
    await mkdir(restores);
    return await fn({ root, data, copies, restores });
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function populatedSnapshot({ root, data, copies }) {
  const repo = await createRepo(data, 'PhiOS');
  const work = join(root, 'work');
  await git(['init', '--initial-branch=main', work]);
  await git(['-C', work, '-c', 'user.name=Restore Test', '-c', 'user.email=restore@example.invalid',
    'commit', '--allow-empty', '-m', 'committed code']);
  await git(['-C', work, 'tag', 'v1']);
  await git(['-C', work, 'push', repo.path, '--all']);
  await git(['-C', work, 'push', repo.path, '--tags']);
  const snapshot = await backupRepo('PhiOS', copies, data);
  return { repo, snapshot };
}

test('real standalone recovery retains complete refs and detaches backup origin', async () => fixture(async f => {
  const { repo, snapshot } = await populatedSnapshot(f);
  const first = await restoreBundleDrill(snapshot.path, f.restores, { dataDir: f.data });
  assert.equal(first.schema, 'gitporch.offline-restore-drill.v0.1');
  assert.equal(first.status, 'LOCAL_RESTORE_DRILL_VERIFIED_ONLY');
  assert.equal(first.repository, 'PhiOS');
  assert.equal(first.refCount, 2);
  assert.equal(first.bundleSha256, snapshot.sha256);
  assert.match(first.refsSha256, /^[0-9a-f]{64}$/);
  assert.equal(first.evidence.bundleChecksumVerified, true);
  assert.equal(first.evidence.gitFsckPassed, true);
  assert.equal(first.evidence.manifestRefsMatched, true);
  assert.equal(first.evidence.originDetached, true);
  assert.equal(first.evidence.offHostDeviceVerified, false);
  assert.equal(first.evidence.physicalWanDisconnectVerified, false);
  assert.equal(first.evidence.sourceAuthenticityVerified, false);
  assert.equal(first.evidence.lfsAndGitHubMetadataBackedUp, false);
  assert.equal(first.evidence.phiosBootVerified, false);
  assert.equal((await git(['--git-dir', first.restoredBareRepository, 'rev-parse', '--is-bare-repository'])), 'true');
  const refs = await git(['--git-dir', first.restoredBareRepository, 'for-each-ref', '--format=%(refname)']);
  assert.deepEqual(refs.split('\n'), ['refs/heads/main', 'refs/tags/v1']);
  await assert.rejects(git(['--git-dir', first.restoredBareRepository, 'config', '--get', 'remote.origin.url']));
  await assert.equal((await lstat(repo.path)).isDirectory(), true);
  assert.deepEqual((await readdir(f.restores)).filter(x => x.startsWith('.gitporch-restore-pending-')), []);
  const repeat = await restoreBundleDrill(snapshot.path, f.restores, { dataDir: f.data });
  assert.notEqual(repeat.restoredBareRepository, first.restoredBareRepository);
  assert.equal((await lstat(first.restoredBareRepository)).isDirectory(), true);
}));

test('can recover from snapshot after source GitPorch mirror has been lost', async () => fixture(async f => {
  const { repo, snapshot } = await populatedSnapshot(f);
  await rm(repo.path, { recursive: true, force: true });
  const result = await restoreBundleDrill(snapshot.path, f.restores, { dataDir: f.data });
  assert.equal(result.refCount, 2);
  assert.equal((await lstat(result.restoredBareRepository)).isDirectory(), true);
  await assert.rejects(lstat(repo.path), { code: 'ENOENT' });
}));

test('corrupted bundle fails checksum check without touching recovery target', async () => fixture(async f => {
  const { snapshot } = await populatedSnapshot(f);
  await writeFile(join(snapshot.path, 'repository.bundle'), 'corrupted data');
  await assert.rejects(restoreBundleDrill(snapshot.path, f.restores, { dataDir: f.data }), /checksum or size/);
  assert.deepEqual(await readdir(f.restores), []);
}));

test('forged refs in manifest fail strict restore-ref equality, without recovery artifact', async () => fixture(async f => {
  const { snapshot } = await populatedSnapshot(f);
  const path = join(snapshot.path, 'snapshot.json');
  const m = JSON.parse(await readFile(path, 'utf8'));
  m.refs[0].oid = '0'.repeat(40);
  await writeFile(path, JSON.stringify(m));
  await assert.rejects(restoreBundleDrill(snapshot.path, f.restores, { dataDir: f.data }), /Restored refs/);
  assert.deepEqual(await readdir(f.restores), []);
}));

test('snapshot and destination overlap or live GitPorch data target are rejected', async () => fixture(async f => {
  const { snapshot } = await populatedSnapshot(f);
  await assert.rejects(restoreBundleDrill(snapshot.path, snapshot.path, { dataDir: f.data }), /outside the snapshot/);
  await assert.rejects(restoreBundleDrill(snapshot.path, f.data, { dataDir: f.data }), /separate from the live GitPorch/);
  await assert.rejects(restoreBundleDrill(snapshot.path, join(f.root, 'missing-destination'), { dataDir: f.data }));
  await assert.rejects(restoreBundleDrill(snapshot.path, 'relative', { dataDir: f.data }), /absolute/);
  assert.deepEqual(await readdir(f.restores), []);
}));

test('symlinked snapshot and recovery destination fail closed', async t => fixture(async f => {
  const { snapshot } = await populatedSnapshot(f);
  const linkSnapshot = join(f.root, 'snapshot-link');
  const linkDest = join(f.root, 'restore-link');
  try {
    await symlink(snapshot.path, linkSnapshot, 'dir');
    await symlink(f.restores, linkDest, 'dir');
  } catch (e) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(e.code)) return t.skip('symlinks unavailable on this host');
    throw e;
  }
  await assert.rejects(restoreBundleDrill(linkSnapshot, f.restores, { dataDir: f.data }), /non-symlink/);
  await assert.rejects(restoreBundleDrill(snapshot.path, linkDest, { dataDir: f.data }), /non-symlink/);
  assert.deepEqual(await readdir(f.restores), []);
}));

test('CLI requires explicit operator approval and prints a local-only recovery receipt', async () => fixture(async f => {
  const { snapshot } = await populatedSnapshot(f);
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  await assert.rejects(
    exec(process.execPath, [cli, 'drill', snapshot.path, f.restores]),
    e => e.code === 1 && /Invalid arguments/.test(e.stderr)
  );
  assert.deepEqual(await readdir(f.restores), []);
  const run = await exec(process.execPath, [
    cli, 'drill', snapshot.path, f.restores, '--i-confirm-local-restore',
  ], { env: { ...process.env, GITPORCH_DATA_DIR: f.data } });
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'LOCAL_RESTORE_DRILL_VERIFIED_ONLY');
  assert.equal((await lstat(result.restoredBareRepository)).isDirectory(), true);
}));

test('host-injected Git configuration cannot redirect the restore to the network', async () => fixture(async f => {
  const { snapshot } = await populatedSnapshot(f);
  const previous = process.env.GIT_CONFIG_COUNT;
  const previousAsk = process.env.GIT_ASKPASS;
  try {
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'url.https://example.invalid/.insteadOf';
    process.env.GIT_CONFIG_VALUE_0 = snapshot.path;
    process.env.GIT_ASKPASS = 'should-not-execute';
    const result = await restoreBundleDrill(snapshot.path, f.restores, { dataDir: f.data });
    assert.equal(result.status, 'LOCAL_RESTORE_DRILL_VERIFIED_ONLY');
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_COUNT;
    else process.env.GIT_CONFIG_COUNT = previous;
    if (previousAsk === undefined) delete process.env.GIT_ASKPASS;
    else process.env.GIT_ASKPASS = previousAsk;
    delete process.env.GIT_CONFIG_KEY_0;
    delete process.env.GIT_CONFIG_VALUE_0;
  }
}));
