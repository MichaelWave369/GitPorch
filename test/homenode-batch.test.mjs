import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, lstat, readdir, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { importMirrorFromSource, saveCatalog } from '../src/homenode-bridge.mjs';
import {
  MAX_PUBLIC_BATCH, parseBatchNames, publicCloneEnv,
  preparePublicBatch, importApprovedPublicBatch,
} from '../src/homenode-batch.mjs';

const exec = promisify(execFile);
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r03-'));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const catalog = (...names) => ({
  schema: 'gitporch.public-catalog.v1',
  owner: 'MichaelWave369', visibility: 'PUBLIC_ONLY',
  count: names.length, capturedAt: '2026-10-28T12:00:00.000Z',
  repositories: names.map(name => ({ name, eligible: true })),
});
async function makeGitSource(root, name = 'PhiOS') {
  const work = join(root, 'work-' + name);
  await git(['init', '--initial-branch=main', work]);
  await git(['-C', work, '-c', 'user.name=R03 Tester', '-c', 'user.email=r03@example.invalid',
    'commit', '--allow-empty', '-m', 'first']);
  await git(['-C', work, 'tag', 'v1']);
  return work;
}

test('offline plan is zero-write, explicit, fixed-owner and hash-stable', async () => fixture(async root => {
  const data = join(root, 'uncreated-store');
  const snapshot = catalog('PhiOS', 'GitPorch', 'PhiARK');
  const p = await preparePublicBatch(snapshot, 'PhiOS,GitPorch', data);
  const again = await preparePublicBatch(snapshot, 'PhiOS,GitPorch', data);
  assert.equal(p.schema, 'gitporch.public-batch-plan.v1');
  assert.equal(p.status, 'NEEDS_EXPLICIT_OPERATOR_APPROVAL');
  assert.equal(p.maxBatch, 5);
  assert.equal(MAX_PUBLIC_BATCH, 5);
  assert.equal(p.expectedNetworkClones, 2);
  assert.deepEqual(p.selected, [
    { name: 'PhiOS', status: 'NOT_LOCAL' },
    { name: 'GitPorch', status: 'NOT_LOCAL' },
  ]);
  assert.match(p.planSha256, /^[0-9a-f]{64}$/);
  assert.equal(p.planSha256, again.planSha256);
  assert.equal(p.networkUsed, false);
  assert.equal(p.filesystemWritten, false);
  await assert.rejects(lstat(data), { code: 'ENOENT' });
}));

test('private, foreign, unknown, case-duplicate, unsupported and unbounded selections fail before import', async () => fixture(async root => {
  const data = join(root, 'absent');
  const c = catalog('PhiOS', 'GitPorch', 'PhiARK', 'BTM', 'LENZ', 'SparkTheSubstrate');
  const attempts = [
    [{ ...c, visibility: 'PRIVATE' }, 'PhiOS'],
    [{ ...c, owner: 'OtherOwner' }, 'PhiOS'],
    [{ ...c, count: 0 }, 'PhiOS'],
    [catalog('PhiOS', 'phios'), 'PhiOS'],
    [c, 'UnknownRepo'],
    [c, 'phios'],
    [c, 'PhiOS,PhiOS'],
    [c, 'PhiOS,phios'],
    [c, 'PhiOS,,GitPorch'],
    [c, 'PhiOS,GitPorch,PhiARK,BTM,LENZ,SparkTheSubstrate'],
    [c, '--upload-pack=/evil'],
  ];
  for (const [doc, names] of attempts) {
    await assert.rejects(preparePublicBatch(doc, names, data));
  }
  assert.deepEqual(parseBatchNames('PhiOS,GitPorch'), ['PhiOS', 'GitPorch']);
  await assert.rejects(lstat(data), { code: 'ENOENT' });
}));

test('plan fingerprint rejects modified catalog, selection and stale local state before any clone', async () => fixture(async root => {
  const data = join(root, 'data');
  const c = catalog('PhiOS', 'GitPorch', 'LENZ');
  const plan = await preparePublicBatch(c, 'PhiOS,GitPorch', data);
  let called = 0;
  const importer = async () => { called++; throw new Error('unexpected execution'); };
  await assert.rejects(importApprovedPublicBatch(c, 'PhiOS,GitPorch', '0'.repeat(64), data, importer), /plan changed/i);
  await assert.rejects(importApprovedPublicBatch(c, 'PhiOS,LENZ', plan.planSha256, data, importer), /plan changed/i);
  await assert.rejects(importApprovedPublicBatch({ ...c, capturedAt: 'changed' }, 'PhiOS,GitPorch', plan.planSha256, data, importer), /plan changed/i);
  assert.equal(called, 0);
  const work = await makeGitSource(root);
  await importMirrorFromSource('PhiOS', work, data);
  await assert.rejects(importApprovedPublicBatch(c, 'PhiOS,GitPorch', plan.planSha256, data, importer), /NOT_LOCAL/);
  assert.equal(called, 0);
}));

test('real local Git fixture imports sequentially then stops on first failure with no silent retry', async () => fixture(async root => {
  const data = join(root, 'data');
  const c = catalog('PhiOS', 'GitPorch', 'LENZ');
  const plan = await preparePublicBatch(c, 'PhiOS,GitPorch,LENZ', data);
  const work = await makeGitSource(root);
  const attempted = [];
  const importer = async (_c, name, dir, options) => {
    attempted.push(name);
    assert.equal(options.cloneEnv.GIT_ALLOW_PROTOCOL, 'https');
    if (name === 'GitPorch') throw new Error('SIMULATED PRIVATE FAILURE -- never print!');
    return importMirrorFromSource(name, work, dir);
  };
  const result = await importApprovedPublicBatch(c, 'PhiOS,GitPorch,LENZ', plan.planSha256, data, importer);
  assert.deepEqual(attempted, ['PhiOS', 'GitPorch']);
  assert.equal(result.status, 'PARTIAL_OR_FAILED_REVIEW_REQUIRED');
  assert.deepEqual(result.summary, { selected: 3, imported: 1, failed: 1, notAttempted: 1 });
  assert.deepEqual(result.repositories.map(r => r.status), [
    'IMPORTED_GIT_OBJECTS_VERIFIED_ONLY', 'FAILED_UNVERIFIED', 'NOT_ATTEMPTED_AFTER_FAILURE',
  ]);
  assert.equal(JSON.stringify(result).includes('SIMULATED PRIVATE FAILURE'), false);
  assert.equal(JSON.stringify(result).includes(data), false);
  assert.equal(result.acceptance.offHostRestoreVerified, false);
  assert.equal(result.acceptance.fullOfflineReady, false);
  assert.deepEqual((await readdir(join(data, 'repos'))).sort(), ['PhiOS.git']);
  await assert.rejects(preparePublicBatch(c, 'PhiOS,GitPorch,LENZ', data), /NOT_LOCAL/);
}));

test('successful batch imports two fixture repositories without auto-sync or overwrite', async () => fixture(async root => {
  const data = join(root, 'data');
  const c = catalog('PhiOS', 'GitPorch');
  const work = await makeGitSource(root);
  const p = await preparePublicBatch(c, 'PhiOS,GitPorch', data);
  const report = await importApprovedPublicBatch(c, 'PhiOS,GitPorch', p.planSha256, data,
    async (_c, name, dir) => importMirrorFromSource(name, work, dir));
  assert.equal(report.status, 'LOCAL_GIT_IMPORTS_COMPLETED_ONLY');
  assert.deepEqual(report.summary, { selected: 2, imported: 2, failed: 0, notAttempted: 0 });
  assert.deepEqual((await readdir(join(data, 'repos'))).sort(), ['GitPorch.git', 'PhiOS.git']);
  assert.equal(report.repositories.every(r => r.refCount === 2), true);
  assert.equal(report.acceptance.remoteRefParityVerified, false);
  await assert.rejects(preparePublicBatch(c, 'PhiOS,GitPorch', data), /NOT_LOCAL/);
}));

test('restricted clone environment never inherits Git askpass, injected config or tokens', () => {
  const before = process.env.GIT_ASKPASS;
  const token = process.env.GH_TOKEN;
  const count = process.env.GIT_CONFIG_COUNT;
  try {
    process.env.GIT_ASKPASS = 'secret-askpass';
    process.env.GH_TOKEN = 'secret-token';
    process.env.GIT_CONFIG_COUNT = '8';
    const env = publicCloneEnv();
    assert.equal(env.GIT_ASKPASS, undefined);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.GIT_CONFIG_COUNT, undefined);
    assert.equal(env.GIT_ALLOW_PROTOCOL, 'https');
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  } finally {
    if (before === undefined) delete process.env.GIT_ASKPASS; else process.env.GIT_ASKPASS = before;
    if (token === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = token;
    if (count === undefined) delete process.env.GIT_CONFIG_COUNT; else process.env.GIT_CONFIG_COUNT = count;
  }
});

test('CLI preview is offline and batch import demands both review hash and explicit approval', async () => fixture(async root => {
  const dir = join(root, 'catalog');
  const data = join(root, 'data');
  await mkdir(dir);
  const saved = await saveCatalog(catalog('PhiOS', 'GitPorch'), dir);
  const cli = join(process.cwd(), 'src', 'homenode-bridge-cli.mjs');
  const env = { ...process.env, GITPORCH_DATA_DIR: data };
  const result = await exec(process.execPath, [cli, 'batch-plan', saved.path, 'PhiOS,GitPorch'], { env });
  const plan = JSON.parse(result.stdout);
  assert.match(plan.planSha256, /^[0-9a-f]{64}$/);
  await assert.rejects(lstat(data), { code: 'ENOENT' });
  await assert.rejects(
    exec(process.execPath, [cli, 'batch-import', saved.path, 'PhiOS,GitPorch', plan.planSha256], { env }),
    e => e.code === 1 && /explicit network approval/i.test(e.stderr)
  );
  await assert.rejects(
    exec(process.execPath, [cli, 'batch-import', saved.path, 'PhiOS,GitPorch', 'f'.repeat(64), '--i-approve-public-batch-import'], { env }),
    e => e.code === 1 && /plan changed/i.test(e.stderr)
  );
  await assert.rejects(lstat(data), { code: 'ENOENT' });
}));
