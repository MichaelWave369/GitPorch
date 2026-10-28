import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { git } from '../src/git.mjs';
import { saveCatalog } from '../src/homenode-bridge.mjs';
import { auditLfsRecoveryManifest } from '../src/homenode-lfs-manifest.mjs';

const exec = promisify(execFile);
const hash = data => createHash('sha256').update(data).digest('hex');
const pointer = (oid, size) => 'version https://git-lfs.github.com/spec/v1\n' +
  'oid sha256:' + oid + '\nsize ' + size + '\n';
function catalog(...names) {
  return { schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
    visibility: 'PUBLIC_ONLY', count: names.length,
    repositories: names.map(name => ({ name, eligible: true })) };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r09-'));
  try {
    const f = { root, data: join(root, 'data'), assets: join(root, 'assets'),
      catalogs: join(root, 'catalogs') };
    await mkdir(f.assets);
    await mkdir(f.catalogs);
    return await fn(f);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function setup(f, entries = []) {
  const bare = join(f.data, 'repos', 'PhiOS.git'), work = join(f.root, 'work');
  await mkdir(dirname(bare), { recursive: true });
  await git(['init', '--bare', '--initial-branch=main', bare]);
  await git(['init', '--initial-branch=main', work]);
  await mkdir(join(work, 'models'), { recursive: true });
  await writeFile(join(work, 'README.md'), 'This is ordinary source text\n');
  await writeFile(join(work, '.gitattributes'), 'models/*.bin filter=lfs diff=lfs merge=lfs -text\n');
  const indexPaths = [];
  for (const [path, bytes, declared] of entries) {
    const oid = hash(bytes);
    const full = join(work, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, pointer(oid, declared ?? bytes.length));
    indexPaths.push(path);
  }
  await git(['-C', work, 'add', 'README.md']);
  // Install literal Git pointers rather than allowing a preinstalled Git LFS
  // clean/smudge driver to change or upload the fixture.
  for (const path of indexPaths) {
    const oid = await git(['-C', work, 'hash-object', '-w', '--no-filters', path]);
    await git(['-C', work, 'update-index', '--add', '--cacheinfo', '100644,' + oid + ',' + path]);
  }
  const attrs = await git(['-C', work, 'hash-object', '-w', '--no-filters', '.gitattributes']);
  await git(['-C', work, 'update-index', '--add', '--cacheinfo',
    '100644,' + attrs + ',.gitattributes']);
  await git(['-C', work, '-c', 'user.name=R09 Tester',
    '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'pinned LFS fixture']);
  await git(['-C', work, '-c', 'core.hooksPath=' + join(f.root, 'absent-hooks'),
    'push', bare, 'main']);
  return { bare, work, c: catalog('PhiOS') };
}
async function store(f, bytes, override) {
  const sha = hash(bytes);
  const folder = join(f.assets, 'objects', 'sha256', sha.slice(0, 2));
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, sha), override ?? bytes);
  return sha;
}
const audit = (f, s, branch = 'main') =>
  auditLfsRecoveryManifest(s.c, 'PhiOS', branch, f.assets, f.data);

test('counts unique objects, repeated pointer paths, missing and verified bytes; stable unsigned digest', async () => fixture(async f => {
  const a = Buffer.from('the first actual LFS binary payload');
  const b = Buffer.from('second independent LFS payload bytes');
  const s = await setup(f, [
    ['models/one.bin', a], ['models/duplicate.bin', a], ['models/two.bin', b],
  ]);
  const before = await readdir(f.assets);
  const r0 = await audit(f, s);
  assert.equal(r0.schema, 'gitporch.local-lfs-recovery-manifest.v0.1');
  assert.equal(r0.status, 'DETECTED_TIP_LFS_GAPS');
  assert.equal(r0.summary.trackedLfsPointersDetected, 3);
  assert.equal(r0.summary.uniqueLfsObjects, 2);
  assert.equal(r0.summary.declaredLfsBytes, a.length + b.length);
  assert.equal(r0.summary.verifiedObjects, 0);
  assert.equal(r0.summary.missingObjects, 2);
  assert.equal(r0.summary.allDetectedTipObjectsVerified, false);
  assert.equal(r0.scope.gitLfsFilterDeclaredAtTip, true);
  assert.equal(r0.scope.networkUsed, false);
  assert.equal(r0.scope.sourceOrAssetFilesWritten, false);
  assert.deepEqual(await readdir(f.assets), before);
  assert.match(r0.manifestSha256, /^[0-9a-f]{64}$/);
  const duplicate = r0.objects.find(x => x.oid === hash(a));
  assert.deepEqual(duplicate.trackedPaths, ['models/duplicate.bin', 'models/one.bin']);
  const r0Again = await audit(f, s);
  assert.equal(r0.manifestSha256, r0Again.manifestSha256);
  assert.equal(JSON.stringify(r0).includes(f.root), false);

  await store(f, a);
  const r1 = await audit(f, s);
  assert.equal(r1.summary.verifiedObjects, 1);
  assert.equal(r1.summary.missingObjects, 1);
  assert.notEqual(r1.manifestSha256, r0.manifestSha256);
  await store(f, b);
  const r2 = await audit(f, s);
  assert.equal(r2.summary.verifiedObjects, 2);
  assert.equal(r2.summary.missingObjects, 0);
  assert.equal(r2.status, 'ALL_DETECTED_TIP_LFS_BYTES_VERIFIED_ONLY');
  assert.equal(r2.summary.allDetectedTipObjectsVerified, true);
  for (const flag of Object.values(r2.acceptance)) assert.equal(flag, false);
  assert.equal(r2.scope.fullGitHistoryScanned, false);
}));

test('corrupted payload is never mistaken for verified; correcting bytes restores local-only state', async () => fixture(async f => {
  const bytes = Buffer.from('contents whose digest matters');
  const s = await setup(f, [['models/corrupt.bin', bytes]]);
  await store(f, bytes, Buffer.alloc(bytes.length, 0));
  const bad = await audit(f, s);
  assert.equal(bad.summary.unsafeOrCorruptObjects, 1);
  assert.equal(bad.summary.verifiedObjects, 0);
  assert.equal(bad.objects[0].status, 'UNSAFE_OR_CORRUPT_LOCAL_OBJECT');
  await store(f, bytes);
  const good = await audit(f, s);
  assert.equal(good.summary.verifiedObjects, 1);
  assert.equal(good.objects[0].status, 'LOCAL_LFS_BYTES_VERIFIED_ONLY');
}));

test('zero pointers is not an all-good/whole-history backup claim', async () => fixture(async f => {
  const s = await setup(f);
  const r = await audit(f, s);
  assert.equal(r.status, 'NO_CANONICAL_TIP_LFS_POINTERS_DETECTED_UNVERIFIED');
  assert.equal(r.summary.uniqueLfsObjects, 0);
  assert.equal(r.summary.allDetectedTipObjectsVerified, false);
  assert.equal(r.scope.gitLfsFilterDeclaredAtTip, true);
  assert.equal(r.acceptance.allGitHistoryLfsComplete, false);
}));

test('oversized single LFS object is visible as outside R0.8 download pilot, not omitted', async () => fixture(async f => {
  const bytes = Buffer.from('tiny object with intentionally large LFS declaration');
  const s = await setup(f, [['models/big.bin', bytes, 65 * 1024 * 1024]]);
  const r = await audit(f, s);
  assert.equal(r.summary.uniqueLfsObjects, 1);
  assert.equal(r.summary.unsupportedR08DownloadSize, 1);
  assert.equal(r.summary.missingObjects, 1);
  assert.equal(r.objects[0].r08PilotDownloadEligible, false);
  assert.equal(r.status, 'DETECTED_TIP_LFS_GAPS');
}));

test('malformed pointer containing canonical header blocks manifest, not partial pass', async () => fixture(async f => {
  const bytes = Buffer.from('test malformed');
  const s = await setup(f, [['models/bad.bin', bytes]]);
  await writeFile(join(s.work, 'models', 'bad.bin'),
    'version https://git-lfs.github.com/spec/v1\n' +
    'oid sha256:not-an-id\nsize ' + bytes.length + '\n');
  const blob = await git(['-C', s.work, 'hash-object', '-w', '--no-filters', 'models/bad.bin']);
  await git(['-C', s.work, 'update-index', '--add', '--cacheinfo', '100644,' + blob + ',models/bad.bin']);
  await git(['-C', s.work, '-c', 'user.name=R09 Tester',
    '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'corrupt pointer']);
  await git(['-C', s.work, '-c', 'core.hooksPath=' + join(f.root, 'absent-hooks'),
    'push', s.bare, 'main']);
  await assert.rejects(audit(f, s), /Malformed candidate LFS pointer/);
  assert.deepEqual(await readdir(f.assets), []);
}));

test('private, unknown and wrong-case public entries fail closed before scanning', async () => fixture(async f => {
  const s = await setup(f, [['models/x.bin', Buffer.from('test')]]);
  await assert.rejects(auditLfsRecoveryManifest(
    { ...s.c, visibility: 'PRIVATE' }, 'PhiOS', 'main', f.assets, f.data));
  await assert.rejects(auditLfsRecoveryManifest(
    { ...s.c, owner: 'DifferentOwner' }, 'PhiOS', 'main', f.assets, f.data));
  await assert.rejects(auditLfsRecoveryManifest(
    catalog('PhiOS', 'phios'), 'PhiOS', 'main', f.assets, f.data));
  await assert.rejects(auditLfsRecoveryManifest(
    s.c, 'phios', 'main', f.assets, f.data));
  await assert.rejects(audit(f, s, '../main'));
  await assert.rejects(auditLfsRecoveryManifest(
    s.c, 'PhiOS', 'main', join(f.data, 'repos'), f.data), /outside/);
}));

test('symlinked object path cannot be treated as verified backup', async t => fixture(async f => {
  const bytes = Buffer.from('symlink risk');
  const s = await setup(f, [['models/link.bin', bytes]]);
  const oid = hash(bytes), folder = join(f.assets, 'objects', 'sha256', oid.slice(0, 2));
  await mkdir(folder, { recursive: true });
  const original = join(f.root, 'outside-copy');
  await writeFile(original, bytes);
  try {
    await symlink(original, join(folder, oid), 'file');
  } catch (error) {
    if (['ENOTSUP', 'EPERM', 'EACCES'].includes(error.code)) return t.skip('symlinks unavailable');
    throw error;
  }
  const result = await audit(f, s);
  assert.equal(result.summary.unsafeOrCorruptObjects, 1);
  assert.equal(result.summary.verifiedObjects, 0);
}));

test('over 64 unique pointers refuses a partial success report', async () => fixture(async f => {
  const sources = Array.from({ length: 65 }, (_, i) => [
    'models/obj-' + i + '.bin', Buffer.from('independent-' + i),
  ]);
  const s = await setup(f, sources);
  await assert.rejects(audit(f, s), /More than 64 unique/);
  assert.deepEqual(await readdir(f.assets), []);
}));

test('operator CLI emits repeatable manifest without modifying store', async () => fixture(async f => {
  const bytes = Buffer.from('CLI real binary fixture');
  const s = await setup(f, [['models/cli.bin', bytes]]);
  const saved = await saveCatalog(s.c, f.catalogs);
  const env = { ...process.env, GITPORCH_DATA_DIR: f.data };
  const command = [process.execPath, [join(process.cwd(), 'src', 'homenode-cli.mjs'),
    'lfs-manifest', saved.path, 'PhiOS', 'main', f.assets]];
  const first = JSON.parse((await exec(command[0], command[1], { env })).stdout);
  const again = JSON.parse((await exec(command[0], command[1], { env })).stdout);
  assert.equal(first.manifestSha256, again.manifestSha256);
  assert.equal(first.summary.missingObjects, 1);
  assert.deepEqual(await readdir(f.assets), []);
  await assert.rejects(exec(process.execPath, [
    join(process.cwd(), 'src', 'homenode-cli.mjs'), 'lfs-manifest', saved.path, 'PhiOS', 'main',
  ], { env }), e => e.code === 1 && /Invalid arguments/.test(e.stderr));
}));
