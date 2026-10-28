import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, lstat, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { git } from '../src/git.mjs';
import { saveCatalog } from '../src/homenode-bridge.mjs';
import {
  planLocalLfsIntake, intakeLocalLfsObject, verifyLocalLfsObject,
} from '../src/homenode-lfs-intake.mjs';

const exec = promisify(execFile);
function catalog(...names) {
  return { schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
    visibility: 'PUBLIC_ONLY', count: names.length,
    repositories: names.map(name => ({ name, eligible: true })) };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r07-'));
  try {
    const f = { root, data: join(root, 'data'), assets: join(root, 'asset-root'),
      catalogDir: join(root, 'catalogs'), imports: join(root, 'payload-input') };
    await mkdir(f.assets);
    await mkdir(f.catalogDir);
    await mkdir(f.imports);
    return await fn(f);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function createLfsFixture(f, opts = {}) {
  const name = opts.name ?? 'PhiOS';
  const bare = join(f.data, 'repos', name + '.git');
  const work = join(f.root, 'work-' + name);
  await mkdir(dirname(bare), { recursive: true });
  await git(['init', '--bare', '--initial-branch=main', bare]);
  await git(['init', '--initial-branch=main', work]);
  const bytes = Buffer.from(opts.bytes ?? 'binary pixels and meshes from our local offline supply\n');
  const oid = createHash('sha256').update(bytes).digest('hex');
  const pointerPath = 'models/mesh.bin';
  const payload = join(f.imports, 'mesh-real.bin');
  await writeFile(payload, bytes);
  await mkdir(join(work, 'models'));
  const pointer = 'version https://git-lfs.github.com/spec/v1\n' +
    'oid sha256:' + oid + '\nsize ' + (opts.declaredSize ?? bytes.length) + '\n';
  await writeFile(join(work, pointerPath), pointer);
  // Explicitly stage the literal Git pointer, not a host-installed Git LFS clean transform.
  const blob = await git(['-C', work, 'hash-object', '-w', '--no-filters', pointerPath]);
  await git(['-C', work, 'update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + pointerPath]);
  await git(['-C', work, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-m', 'record pointer']);
  await git(['-C', work, '-c', 'core.hooksPath=' + join(f.root, 'no-git-hooks'),
    'push', bare, 'main']);
  return { name, bare, work, oid, payload, bytes, pointerPath, c: catalog(name) };
}
function args(f, s) { return [s.c, s.name, 'main', s.pointerPath, s.payload, f.assets, f.data]; }

test('read-only plan finds exact tracked pointer, then preserves verified actual bytes', async () => fixture(async f => {
  const s = await createLfsFixture(f);
  const before = await readdir(f.assets);
  const plan = await planLocalLfsIntake(...args(f, s));
  assert.equal(plan.schema, 'gitporch.local-lfs-byte-plan.v0.1');
  assert.equal(plan.oid, s.oid);
  assert.equal(plan.bytes, s.bytes.length);
  assert.equal(plan.networkUsed, false);
  assert.equal(plan.writesMade, false);
  assert.equal(plan.status, 'EXPLICIT_APPROVAL_REQUIRED');
  assert.match(plan.planSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(await readdir(f.assets), before);
  const unbacked = await verifyLocalLfsObject(s.c, s.name, 'main', s.pointerPath, f.assets, f.data);
  assert.equal(unbacked.status, 'NOT_STORED');
  const result = await intakeLocalLfsObject(...args(f, s).slice(0, 6), plan.planSha256, f.data);
  assert.equal(result.status, 'LOCAL_LFS_BYTES_VERIFIED_ONLY');
  assert.equal(result.oid, s.oid);
  assert.equal(result.bytes, s.bytes.length);
  assert.equal(result.networkUsed, false);
  assert.equal(result.payloadExecuted, false);
  for (const value of Object.values(result.acceptance)) assert.equal(value, false);
  const dest = join(f.assets, 'objects', 'sha256', s.oid.slice(0, 2), s.oid);
  assert.deepEqual(await readFile(dest), s.bytes);
  assert.deepEqual(await readdir(dirname(dest)), [s.oid]);
  await rm(s.payload);
  const readback = await verifyLocalLfsObject(s.c, s.name, 'main', s.pointerPath, f.assets, f.data);
  assert.equal(readback.status, 'LOCAL_LFS_BYTES_VERIFIED_ONLY');
  assert.equal(JSON.stringify(readback).includes(f.root), false);
  assert.equal((await lstat(s.bare)).isDirectory(), true);
}));

test('stale plan, mutated source payload and incorrectly sized payload fail before publishing', async () => fixture(async f => {
  const s = await createLfsFixture(f);
  const plan = await planLocalLfsIntake(...args(f, s));
  await assert.rejects(intakeLocalLfsObject(...args(f, s).slice(0, 6), 'f'.repeat(64), f.data), /plan changed/);
  await writeFile(s.payload, Buffer.from('tampered binary with same declared length but other bytes'.slice(0, s.bytes.length).padEnd(s.bytes.length, 'x')));
  await assert.rejects(intakeLocalLfsObject(...args(f, s).slice(0, 6), plan.planSha256, f.data), /SHA-256/);
  assert.deepEqual(await readdir(f.assets), []);
  await writeFile(s.payload, 'bad');
  await assert.rejects(planLocalLfsIntake(...args(f, s)), /declared size/);
}));

test('existing matching object cannot be overwritten, invalid stored bytes are refused', async () => fixture(async f => {
  const s = await createLfsFixture(f);
  const plan = await planLocalLfsIntake(...args(f, s));
  await intakeLocalLfsObject(...args(f, s).slice(0, 6), plan.planSha256, f.data);
  const again = await planLocalLfsIntake(...args(f, s));
  assert.equal(again.status, 'ALREADY_VERIFIED_NO_WRITE_NEEDED');
  await assert.rejects(intakeLocalLfsObject(...args(f, s).slice(0, 6), again.planSha256, f.data), /No fresh intake/);
  const dest = join(f.assets, 'objects', 'sha256', s.oid.slice(0, 2), s.oid);
  await writeFile(dest, Buffer.alloc(s.bytes.length, 1));
  const verified = await verifyLocalLfsObject(s.c, s.name, 'main', s.pointerPath, f.assets, f.data);
  assert.equal(verified.status, 'STORED_OBJECT_UNSAFE_OR_INVALID');
  await assert.rejects(planLocalLfsIntake(...args(f, s)), /Existing object conflicts/);
}));

test('private/foreign/unrecognized repo and unsafe path are rejected', async () => fixture(async f => {
  const s = await createLfsFixture(f);
  for (const bad of [
    { ...s.c, owner: 'Other' }, { ...s.c, visibility: 'PRIVATE' },
    { ...s.c, count: 2 }, catalog('PhiOS', 'phios'),
  ]) await assert.rejects(planLocalLfsIntake(bad, s.name, 'main', s.pointerPath, s.payload, f.assets, f.data));
  await assert.rejects(planLocalLfsIntake(s.c, 'Unknown', 'main', s.pointerPath, s.payload, f.assets, f.data));
  for (const bad of ['../mesh.bin', 'models/../../escape', '/absolute/file', 'models\\mesh.bin']) {
    await assert.rejects(planLocalLfsIntake(s.c, s.name, 'main', bad, s.payload, f.assets, f.data));
  }
  await assert.rejects(planLocalLfsIntake(s.c, s.name, '--upload-pack=evil', s.pointerPath, s.payload, f.assets, f.data));
  await assert.rejects(planLocalLfsIntake(s.c, s.name, 'main', s.pointerPath, s.payload, join(f.data, 'repos'), f.data), /outside live/);
  assert.deepEqual(await readdir(f.assets), []);
}));

test('oversized pointer is denied before source reading and malicious local store symlink refused', async t => fixture(async f => {
  const s = await createLfsFixture(f, { declaredSize: 70 * 1024 * 1024 });
  await assert.rejects(planLocalLfsIntake(...args(f, s)), /64MiB/);
  // Make a separate fresh valid Git mirror fixture for the symlink attack.
  const fresh = await createLfsFixture(f, { name: 'GitPorch' });
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  try { await symlink(outside, join(f.assets, 'objects'), 'dir'); }
  catch (e) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(e.code)) return t.skip('symlinks not available');
    throw e;
  }
  await assert.rejects(planLocalLfsIntake(...args(f, fresh)), /unsafe|symlink/i);
}));

test('the operator CLI refuses missing approval and rechecks a fresh plan before writing', async () => fixture(async f => {
  const s = await createLfsFixture(f);
  const saved = await saveCatalog(s.c, f.catalogDir);
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const env = { ...process.env, GITPORCH_DATA_DIR: f.data };
  const cmd = [saved.path, 'PhiOS', 'main', s.pointerPath, s.payload, f.assets];
  const p = JSON.parse((await exec(process.execPath, [cli, 'lfs-plan', ...cmd], { env })).stdout);
  assert.equal(p.status, 'EXPLICIT_APPROVAL_REQUIRED');
  await assert.rejects(exec(process.execPath, [cli, 'lfs-intake', ...cmd, p.planSha256], { env }),
    e => e.code === 1 && /Invalid arguments/.test(e.stderr));
  assert.deepEqual(await readdir(f.assets), []);
  const result = JSON.parse((await exec(process.execPath, [
    cli, 'lfs-intake', ...cmd, p.planSha256, '--i-approve-lfs-byte-intake'], { env })).stdout);
  assert.equal(result.status, 'LOCAL_LFS_BYTES_VERIFIED_ONLY');
  const check = JSON.parse((await exec(process.execPath, [
    cli, 'lfs-verify', saved.path, 'PhiOS', 'main', s.pointerPath, f.assets], { env })).stdout);
  assert.equal(check.status, 'LOCAL_LFS_BYTES_VERIFIED_ONLY');
}));

test('Git config/askpass overrides cannot turn local LFS intake into a fetch', async () => fixture(async f => {
  const s = await createLfsFixture(f);
  const keys = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_ASKPASS'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'url.https://example.invalid/.insteadOf';
    process.env.GIT_CONFIG_VALUE_0 = f.data;
    process.env.GIT_ASKPASS = 'secret-askpass';
    const plan = await planLocalLfsIntake(...args(f, s));
    assert.equal(plan.status, 'EXPLICIT_APPROVAL_REQUIRED');
  } finally {
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}));
