import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createRepo, git } from '../src/git.mjs';
import { backupRepo } from '../src/homenode.mjs';
import { saveCatalog } from '../src/homenode-bridge.mjs';
import { planPortableRecoveryKit, verifyPortableRecoveryKit } from '../src/homenode-portable-kit.mjs';

const exec = promisify(execFile);
const sha = b => createHash('sha256').update(b).digest('hex');
const catalog = () => ({
  schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
  visibility: 'PUBLIC_ONLY', count: 1,
  repositories: [{ name: 'PhiOS', eligible: true }],
});
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r14-'));
  try {
    const f = { root, data: join(root, 'source-data'),
      snapshots: join(root, 'snapshots'), src: join(root, 'prepared-kit'),
      dst: join(root, 'copied-kit'), evidence: join(root, 'evidence') };
    await Promise.all([f.snapshots, f.src, f.dst, f.evidence].map(x => mkdir(x)));
    const bare = await createRepo(f.data, 'PhiOS');
    const work = join(root, 'work');
    await git(['init', '--initial-branch=main', work]);
    await git(['-C', work, '-c', 'user.name=Portable Test',
      '-c', 'user.email=portable@example.invalid',
      'commit', '--allow-empty', '-m', 'bootstrapped']);
    await git(['-C', work, 'push', bare.path, 'main']);
    const snapshot = await backupRepo('PhiOS', f.snapshots, f.data);
    await cp(snapshot.path, join(f.src, 'snapshot'), { recursive: true });
    f.snapshot = snapshot;
    return await fn(f);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function payload(f, type = 'lfs', bytes = Buffer.from('portable binary content\n')) {
  const oid = sha(bytes);
  const loc = type === 'lfs' ? 'lfs/objects/sha256' : 'releases/releases/sha256';
  const file = join(f.src, loc, oid.slice(0, 2), oid);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return { file, oid };
}
async function duplicate(f) {
  await cp(f.src, f.dst, { recursive: true, force: true });
}
async function manifest(f) {
  const m = await planPortableRecoveryKit(catalog(), 'PhiOS', f.src);
  f.manifest = join(f.evidence, 'portable-manifest.json');
  await writeFile(f.manifest, JSON.stringify(m, null, 2) + '\n');
  return m;
}
test('real Git snapshot plus two binary assets are independently reverified from copied kit, no network', async () => fixture(async f => {
  const originalLfs = Buffer.from('LFS bytes not just the pointer');
  const originalRelease = Buffer.from('Release archive content');
  await payload(f, 'lfs', originalLfs);
  await payload(f, 'release', originalRelease);
  const p = await manifest(f);
  assert.equal(p.schema, 'gitporch.portable-recovery-kit.v0.1');
  assert.equal(p.status, 'KIT_FILE_BYTES_AND_GIT_BUNDLE_VERIFIED_ONLY');
  assert.equal(p.summary.files, 4);
  assert.equal(p.summary.gitSnapshotFiles, 2);
  assert.equal(p.summary.lfsObjects, 1);
  assert.equal(p.summary.releaseObjects, 1);
  assert.equal(p.networkUsed, false);
  assert.equal(p.acceptance.physicallyIndependentDeviceVerified, false);
  assert.equal(p.acceptance.detachedWanVerified, false);
  assert.match(p.manifestSha256, /^[a-f0-9]{64}$/);
  await duplicate(f);
  await rm(f.src, { recursive: true, force: true }); // source is actually unavailable
  const proof = await verifyPortableRecoveryKit(f.manifest, f.dst);
  assert.equal(proof.status, 'PORTABLE_KIT_BYTES_AND_GIT_BUNDLE_VERIFIED_ONLY');
  assert.equal(proof.acceptance.matchingBytesAtChosenPath, true);
  assert.equal(proof.acceptance.gitBundleCloneAndFsckPassed, true);
  assert.equal(proof.acceptance.physicallyIndependentDeviceVerified, false);
  assert.equal(proof.acceptance.detachedWanVerified, false);
  assert.equal(proof.acceptance.actualPhiOSComponentLaunched, false);
  assert.equal(proof.acceptance.completeEcosystemRecovered, false);
  assert.equal(proof.bundleSha256, f.snapshot.sha256);
  assert.equal(proof.manifestSha256, p.manifestSha256);
  assert.equal(proof.networkUsed, false);
}));

test('missing, added, corrupt and wrong-sized payloads all fail copied-kit readback', async () => fixture(async f => {
  const bytes = Buffer.from('known independently verifiable object');
  const { oid } = await payload(f, 'lfs', bytes);
  await manifest(f);
  await duplicate(f);
  const name = join(f.dst, 'lfs', 'objects', 'sha256', oid.slice(0, 2), oid);
  await writeFile(name, Buffer.from('same length but different content!'));
  await assert.rejects(verifyPortableRecoveryKit(f.manifest, f.dst), /Content-addressed|does not match/);
  await writeFile(name, bytes);
  await writeFile(join(f.dst, 'unlisted.txt'), 'extra');
  await assert.rejects(verifyPortableRecoveryKit(f.manifest, f.dst), /unexpected file/);
  await rm(join(f.dst, 'unlisted.txt'));
  await rm(name);
  await assert.rejects(verifyPortableRecoveryKit(f.manifest, f.dst), /does not match/);
}));

test('kit with only a valid bundle is still limited and cannot claim assets are complete', async () => fixture(async f => {
  const p = await manifest(f);
  assert.equal(p.summary.files, 2);
  assert.equal(p.summary.lfsObjects, 0);
  assert.equal(p.summary.releaseObjects, 0);
  await duplicate(f);
  const verified = await verifyPortableRecoveryKit(f.manifest, f.dst);
  assert.equal(verified.summary.files, 2);
  assert.equal(verified.acceptance.allDependenciesPreserved, false);
  assert.equal(verified.acceptance.completeEcosystemRecovered, false);
}));

test('tampered unsigned reference manifest and mismatched field fingerprint fail', async () => fixture(async f => {
  const p = await manifest(f);
  await duplicate(f);
  const raw = JSON.parse(await readFile(f.manifest, 'utf8'));
  raw.files[0].bytes += 1;
  await writeFile(f.manifest, JSON.stringify(raw));
  await assert.rejects(verifyPortableRecoveryKit(f.manifest, f.dst),
    /fingerprint does not match/);
  await writeFile(f.manifest, '{invalid');
  await assert.rejects(verifyPortableRecoveryKit(f.manifest, f.dst),
    /invalid JSON/);
  assert.match(p.manifestSha256, /^[a-f0-9]{64}$/);
}));

test('corrupted source Git bundle never produces a green manifest even if it is hashed', async () => fixture(async f => {
  await writeFile(join(f.src, 'snapshot', 'repository.bundle'), 'tampered bundle');
  await assert.rejects(planPortableRecoveryKit(catalog(), 'PhiOS', f.src),
    /Git bundle failed independent local restore verification/);
}));

test('unexpected file, unexpected directory and malformed object location fail instead of ignoring them', async () => fixture(async f => {
  await writeFile(join(f.src, 'notes.txt'), 'tempting but unapproved');
  await assert.rejects(planPortableRecoveryKit(catalog(), 'PhiOS', f.src), /unexpected file/);
  await rm(join(f.src, 'notes.txt'));
  await mkdir(join(f.src, 'mystery'));
  await assert.rejects(planPortableRecoveryKit(catalog(), 'PhiOS', f.src), /unexpected directory/);
  await rm(join(f.src, 'mystery'), { recursive: true });
  await mkdir(join(f.src, 'lfs', 'objects', 'sha256', 'ff'), { recursive: true });
  await writeFile(join(f.src, 'lfs', 'objects', 'sha256', 'ff', '0'.repeat(64)), 'bad');
  await assert.rejects(planPortableRecoveryKit(catalog(), 'PhiOS', f.src), /unexpected file/);
}));

test('symlinked artifact or copied-kit root is unsafe and never verified', async t => fixture(async f => {
  await manifest(f);
  await duplicate(f);
  const link = join(f.dst, 'snapshot', 'repository.bundle');
  const original = join(f.src, 'snapshot', 'repository.bundle');
  await rm(link);
  try { await symlink(original, link, 'file'); }
  catch (e) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(e.code)) return t.skip('symlinks unavailable');
    throw e;
  }
  await assert.rejects(verifyPortableRecoveryKit(f.manifest, f.dst), /symlink|redirected/);
}));

test('private, foreign, duplicates and unmatched source names rejected without indexing', async () => fixture(async f => {
  const bad = [
    { ...catalog(), visibility: 'PRIVATE' },
    { ...catalog(), owner: 'SomeOtherOwner' },
    { ...catalog(), count: 99 },
    { ...catalog(), repositories: [catalog().repositories[0], catalog().repositories[0]], count: 2 },
  ];
  for (const c of bad) await assert.rejects(planPortableRecoveryKit(c, 'PhiOS', f.src));
  await assert.rejects(planPortableRecoveryKit(catalog(), 'phios', f.src));
  await assert.rejects(planPortableRecoveryKit(catalog(), 'PhiOS', 'relative'));
}));

test('operator CLI emits manifest and readback while rejecting incomplete inputs', async () => fixture(async f => {
  const cat = await saveCatalog(catalog(), f.evidence);
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const p = JSON.parse((await exec(process.execPath, [
    cli, 'portable-kit-plan', cat.path, 'PhiOS', f.src,
  ])).stdout);
  f.manifest = join(f.evidence, 'portable-manifest.json');
  await writeFile(f.manifest, JSON.stringify(p, null, 2));
  await duplicate(f);
  const verify = JSON.parse((await exec(process.execPath, [
    cli, 'portable-kit-verify', f.manifest, f.dst,
  ])).stdout);
  assert.equal(verify.status, 'PORTABLE_KIT_BYTES_AND_GIT_BUNDLE_VERIFIED_ONLY');
  await assert.rejects(exec(process.execPath, [
    cli, 'portable-kit-verify', f.manifest,
  ]), e => e.code === 1 && /Invalid arguments/.test(e.stderr));
  assert.deepEqual((await readdir(f.dst)).sort(), ['snapshot']);
}));
