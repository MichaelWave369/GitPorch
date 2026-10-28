import test from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, lstat, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { auditPublicMirrors } from '../src/homenode-mirror-audit.mjs';
import { saveCatalog } from '../src/homenode-bridge.mjs';

const exec = promisify(execFile);
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r02-'));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function catalog(names) {
  return {
    schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
    visibility: 'PUBLIC_ONLY', count: names.length,
    repositories: names.map(name => ({ name, eligible: true })),
  };
}
async function localFixture(root, name = 'PhiOS') {
  const store = join(root, 'data', 'repos');
  const bare = join(store, name + '.git');
  const work = join(root, 'work-' + name);
  await mkdir(store, { recursive: true });
  await git(['init', '--bare', '--initial-branch=main', bare]);
  await git(['init', '--initial-branch=main', work]);
  await git(['-C', work, '-c', 'user.name=R02 Test', '-c', 'user.email=test@example.invalid',
    'commit', '--allow-empty', '-m', 'first']);
  await git(['-C', work, 'tag', 'v1']);
  await git(['-C', work, 'push', bare, '--all']);
  await git(['-C', work, 'push', bare, '--tags']);
  return { bare, store, data: join(root, 'data') };
}

test('offline R0.2 audits real Git refs without writing or claiming source parity', async () => fixture(async root => {
  const local = await localFixture(root);
  const before = (await readdir(local.store)).sort();
  const scan = await auditPublicMirrors(catalog(['PhiOS', 'NotHere', 'CON']), local.data);
  assert.equal(scan.schema, 'gitporch.public-mirror-audit.v1');
  assert.equal(scan.mode, 'OFFLINE_READ_ONLY_LOCAL_OBJECT_AUDIT');
  assert.deepEqual(scan.summary, {
    total: 3, objectsVerifiedOnly: 1, notLocal: 1, unsupportedNames: 1,
    unsafeOrUnsupported: 0, verificationFailed: 0,
  });
  const [first, missing, reserved] = scan.repositories;
  assert.equal(first.status, 'LOCAL_GIT_OBJECTS_VERIFIED_ONLY');
  assert.equal(first.refCount, 2);
  assert.match(first.refsSha256, /^[0-9a-f]{64}$/);
  assert.equal(missing.status, 'NOT_LOCAL');
  assert.equal(reserved.status, 'UNSUPPORTED_NAME');
  for (const state of Object.values(scan.acceptance)) assert.equal(state, false);
  assert.equal(JSON.stringify(scan).includes(local.data), false);
  assert.deepEqual(await auditPublicMirrors(catalog(['PhiOS', 'NotHere', 'CON']), local.data), scan);
  assert.deepEqual((await readdir(local.store)).sort(), before);
}));

test('absent GitPorch store stays absent with honest NOT_LOCAL results', async () => fixture(async root => {
  const notCreated = join(root, 'not-created');
  const report = await auditPublicMirrors(catalog(['PhiOS', 'GitPorch']), notCreated);
  assert.equal(report.summary.notLocal, 2);
  await assert.rejects(lstat(notCreated), { code: 'ENOENT' });
}));

test('broken refs or unsupported object storage never receive verified status', async () => fixture(async root => {
  const local = await localFixture(root);
  await writeFile(join(local.bare, 'refs', 'heads', 'main'), '0'.repeat(40) + '\n');
  const corrupted = await auditPublicMirrors(catalog(['PhiOS']), local.data);
  assert.equal(corrupted.repositories[0].status, 'LOCAL_VERIFICATION_FAILED');
  const local2 = await localFixture(join(root, 'second'), 'GitPorch');
  await writeFile(join(local2.bare, 'objects', 'info', 'alternates'), '/outside/store\n');
  const alt = await auditPublicMirrors(catalog(['GitPorch']), local2.data);
  assert.equal(alt.repositories[0].status, 'LOCAL_UNSUPPORTED_OBJECT_STORAGE');
  await rm(join(local2.bare, 'objects', 'info', 'alternates'));
  await writeFile(join(local2.bare, 'objects', 'pack', 'anything.promisor'), '');
  const promisor = await auditPublicMirrors(catalog(['GitPorch']), local2.data);
  assert.equal(promisor.repositories[0].status, 'LOCAL_UNSUPPORTED_OBJECT_STORAGE');
}));

test('rejects counterfeit private, foreign, malformed and duplicate catalog identities', async () => fixture(async root => {
  const base = catalog(['PhiOS']);
  for (const changed of [
    { ...base, visibility: 'PRIVATE' }, { ...base, schema: 'secret.private' },
    { ...base, count: 1000 }, { ...base, owner: '../foreign' },
    catalog(['PhiOS', 'phios']), catalog(['../bad']),
  ]) await assert.rejects(auditPublicMirrors(changed, join(root, 'absent')));
  await assert.rejects(auditPublicMirrors(base, 'relative-path'), /absolute/);
}));

test('symlinked candidate mirror is refused without traversal', async (t) => fixture(async root => {
  const local = await localFixture(root);
  const disguised = join(local.store, 'GitPorch.git');
  try { await symlink(local.bare, disguised, 'dir'); } catch (error) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error?.code)) return t.skip('host cannot create symlinks');
    throw error;
  }
  const r = await auditPublicMirrors(catalog(['GitPorch', 'PhiOS']), local.data);
  assert.equal(r.repositories[0].status, 'LOCAL_UNSAFE_LAYOUT');
  assert.equal(r.repositories[1].status, 'LOCAL_GIT_OBJECTS_VERIFIED_ONLY');
}));

test('public bridge audit CLI supports strict failure without network approval', async () => fixture(async root => {
  const dir = join(root, 'catalogs');
  const data = join(root, 'data');
  await mkdir(dir);
  const saved = await saveCatalog(catalog(['PhiOS']), dir);
  const cli = join(process.cwd(), 'src', 'homenode-bridge-cli.mjs');
  const env = { ...process.env, GITPORCH_DATA_DIR: data };
  const a = await exec(process.execPath, [cli, 'audit', saved.path], { env });
  assert.equal(JSON.parse(a.stdout).summary.notLocal, 1);
  await assert.rejects(
    exec(process.execPath, [cli, 'audit', saved.path, '--require-all-local-objects-verified'], { env }),
    error => error.code === 2 && JSON.parse(error.stdout).summary.notLocal === 1
  );
  await assert.rejects(
    exec(process.execPath, [cli, 'audit', saved.path, '--i-approve-github-import'], { env }),
    error => error.code === 1 && /invalid arguments/i.test(error.stderr)
  );
}));
