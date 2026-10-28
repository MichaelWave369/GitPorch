import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { git } from '../src/git.mjs';
import { saveCatalog } from '../src/homenode-bridge.mjs';
import { planGitHubLfsDownload, acquireGitHubLfsObject } from '../src/homenode-lfs-download.mjs';
import { verifyLocalLfsObject } from '../src/homenode-lfs-intake.mjs';

const exec = promisify(execFile);
const MEDIA = 'https://media.github.com/lfs/test-object';
function catalog(...names) {
  return { schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
    visibility: 'PUBLIC_ONLY', count: names.length,
    repositories: names.map(name => ({ name, eligible: true })) };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r08-'));
  try {
    const f = { root, data: join(root, 'data'), assets: join(root, 'assets'),
      catalogs: join(root, 'catalogs') };
    await mkdir(f.assets);
    await mkdir(f.catalogs);
    return await fn(f);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function setup(f) {
  const bytes = Buffer.from('this is the real asset, not a pointer or a filename\n');
  const oid = createHash('sha256').update(bytes).digest('hex');
  const bare = join(f.data, 'repos', 'PhiOS.git'), work = join(f.root, 'working');
  await mkdir(dirname(bare), { recursive: true });
  await git(['init', '--bare', '--initial-branch=main', bare]);
  await git(['init', '--initial-branch=main', work]);
  await mkdir(join(work, 'models'));
  await writeFile(join(work, 'models', 'mesh.bin'),
    'version https://git-lfs.github.com/spec/v1\n' +
    'oid sha256:' + oid + '\nsize ' + bytes.length + '\n');
  // Store the literal tracked LFS pointer without any Git LFS clean or hook.
  const blob = await git(['-C', work, 'hash-object', '-w', '--no-filters', 'models/mesh.bin']);
  await git(['-C', work, 'update-index', '--add', '--cacheinfo',
    '100644,' + blob + ',models/mesh.bin']);
  await git(['-C', work, '-c', 'user.name=R08', '-c', 'user.email=fixture@example.invalid',
    'commit', '-m', 'LFS pointer']);
  await git(['-C', work, '-c', 'core.hooksPath=' + join(f.root, 'no-hooks'),
    'push', bare, 'main']);
  return { bytes, oid, c: catalog('PhiOS'), work };
}
function expectedBatch(s, override = {}) {
  return { transfer: 'basic', objects: [{
    oid: s.oid, size: s.bytes.length,
    actions: { download: { href: MEDIA } }, ...override,
  }] };
}
function mockFetcher(s, opts = {}) {
  const calls = [];
  return {
    calls,
    async run(url, init) {
      calls.push({ url, method: init.method, redirect: init.redirect,
        authorization: init.headers.Authorization, body: init.body });
      if (calls.length === 1) {
        if (opts.throwBatch) throw new Error('secret token might be included here');
        if (opts.batchRedirect) return new Response('', { status: 302, headers: { location: 'https://evil.invalid/' } });
        const batch = opts.batch ?? expectedBatch(s);
        return new Response(JSON.stringify(batch), { status: 200 });
      }
      if (opts.throwDownload) throw new Error('a signed URL secret');
      if (opts.downloadRedirect) return new Response('', { status: 302, headers: { location: 'https://evil.invalid/' } });
      const bytes = opts.bytes ?? s.bytes;
      return new Response(bytes, { status: 200,
        headers: { 'content-length': String(opts.lengthHeader ?? bytes.length) } });
    },
  };
}
const request = (f, s) => [s.c, 'PhiOS', 'main', 'models/mesh.bin', f.assets, f.data];

test('offline plan does not contact GitHub or mutate asset store', async () => fixture(async f => {
  const s = await setup(f);
  const p = await planGitHubLfsDownload(...request(f, s));
  assert.equal(p.schema, 'gitporch.github-lfs-download-plan.v0.1');
  assert.equal(p.oid, s.oid);
  assert.equal(p.size, s.bytes.length);
  assert.equal(p.approvalRequired, true);
  assert.equal(p.networkUsed, false);
  assert.equal(p.filesWritten, false);
  assert.match(p.planSha256, /^[0-9a-f]{64}$/);
  assert.equal(p.endpoint, 'https://github.com/MichaelWave369/PhiOS.git/info/lfs/objects/batch');
  assert.deepEqual(await readdir(f.assets), []);
}));

test('only approved two-request LFS flow publishes exact bytes into content-addressed store', async () => fixture(async f => {
  const s = await setup(f);
  const mock = mockFetcher(s);
  const p = await planGitHubLfsDownload(...request(f, s));
  const result = await acquireGitHubLfsObject(
    s.c, 'PhiOS', 'main', 'models/mesh.bin', f.assets, p.planSha256, f.data, mock.run,
  );
  assert.equal(result.status, 'LOCAL_LFS_BYTES_VERIFIED_ONLY');
  assert.equal(result.networkUsed, true);
  assert.equal(result.payloadExecuted, false);
  assert.equal(result.acceptance.githubSourceAuthenticityVerified, false);
  assert.equal(result.acceptance.fullLfsHistoryComplete, false);
  assert.equal(result.oid, s.oid);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].method, 'POST');
  assert.equal(mock.calls[1].method, 'GET');
  assert.equal(mock.calls[0].redirect, 'manual');
  assert.equal(mock.calls[1].redirect, 'manual');
  const file = join(f.assets, 'objects', 'sha256', s.oid.slice(0, 2), s.oid);
  assert.deepEqual(await readFile(file), s.bytes);
  const independentlyVerified = await verifyLocalLfsObject(...request(f, s));
  assert.equal(independentlyVerified.status, 'LOCAL_LFS_BYTES_VERIFIED_ONLY');
  const later = await planGitHubLfsDownload(...request(f, s));
  assert.equal(later.approvalRequired, false);
  await assert.rejects(acquireGitHubLfsObject(
    s.c, 'PhiOS', 'main', 'models/mesh.bin', f.assets, later.planSha256, f.data, mock.run,
  ), /No acquisition required/);
  assert.equal(mock.calls.length, 2);
}));

test('stale or malformed approvals refuse before any network or writes', async () => fixture(async f => {
  const s = await setup(f), mock = mockFetcher(s);
  const p = await planGitHubLfsDownload(...request(f, s));
  await assert.rejects(acquireGitHubLfsObject(
    s.c, 'PhiOS', 'main', 'models/mesh.bin', f.assets, 'f'.repeat(64), f.data, mock.run,
  ), /plan changed/);
  await assert.rejects(acquireGitHubLfsObject(
    s.c, 'PhiOS', 'main', 'models/mesh.bin', f.assets, 'no', f.data, mock.run,
  ), /plan SHA-256/);
  assert.equal(mock.calls.length, 0);
  assert.deepEqual(await readdir(f.assets), []);
}));

test('hostile batch action URLs and supplied auth headers never cause a download', async () => fixture(async f => {
  const s = await setup(f);
  const p = await planGitHubLfsDownload(...request(f, s));
  const urls = [
    'http://media.github.com/something',
    'https://media.github.com.evil.invalid/payload',
    'https://127.0.0.1/payload',
    'https://user:password@media.github.com/payload',
    'https://objects.githubusercontent.com:444/payload',
    'https://evil.invalid/payload',
  ];
  for (const href of urls) {
    const mock = mockFetcher(s, { batch: expectedBatch(s, {
      actions: { download: { href } },
    }) });
    await assert.rejects(acquireGitHubLfsObject(
      s.c, 'PhiOS', 'main', 'models/mesh.bin', f.assets, p.planSha256, f.data, mock.run,
    ), /LFS action host/);
    assert.equal(mock.calls.length, 1);
  }
  const mock = mockFetcher(s, { batch: expectedBatch(s, {
    actions: { download: { href: 'https://github-cloud.s3.amazonaws.com/bucket',
      header: { Authorization: 'Bearer secret' } } },
  }) });
  await assert.rejects(acquireGitHubLfsObject(
    s.c, 'PhiOS', 'main', 'models/mesh.bin', f.assets, p.planSha256, f.data, mock.run,
  ), /credentials cannot be sent to CDN/);
  assert.equal(mock.calls.length, 1);
}));

test('redirects, batch mismatches, and corrupted payload cannot be promoted', async () => fixture(async f => {
  const s = await setup(f), p = await planGitHubLfsDownload(...request(f, s));
  const attempts = [
    [mockFetcher(s, { batchRedirect: true }), /batch response/],
    [mockFetcher(s, { downloadRedirect: true }), /content download failed/],
    [mockFetcher(s, { batch: expectedBatch(s, { oid: '0'.repeat(64) }) }), /object mismatched/],
    [mockFetcher(s, { batch: expectedBatch(s, { size: s.bytes.length + 1 }) }), /object mismatched/],
    [mockFetcher(s, { bytes: Buffer.alloc(s.bytes.length, 1) }), /do not match/],
    [mockFetcher(s, { lengthHeader: s.bytes.length + 1 }), /content-length/],
  ];
  for (const [mock, expected] of attempts) {
    await assert.rejects(acquireGitHubLfsObject(
      s.c, 'PhiOS', 'main', 'models/mesh.bin', f.assets, p.planSha256, f.data, mock.run,
    ), expected);
    const path = join(f.assets, 'objects', 'sha256', s.oid.slice(0, 2));
    const names = await readdir(path).catch(() => []);
    assert.deepEqual(names, []);
  }
}));

test('GitHub optional token stays only on batch request and never enters results or CDN request', async () => fixture(async f => {
  const s = await setup(f), p = await planGitHubLfsDownload(...request(f, s));
  const oldToken = process.env.GITPORCH_LFS_TOKEN;
  const oldUser = process.env.GITPORCH_LFS_USERNAME;
  try {
    process.env.GITPORCH_LFS_TOKEN = 'test-token-not-to-leak';
    process.env.GITPORCH_LFS_USERNAME = 'x-access-token';
    const mock = mockFetcher(s);
    const result = await acquireGitHubLfsObject(
      s.c, 'PhiOS', 'main', 'models/mesh.bin', f.assets, p.planSha256, f.data, mock.run,
    );
    assert.match(mock.calls[0].authorization, /^Basic /);
    assert.equal(mock.calls[1].authorization, undefined);
    assert.equal(JSON.stringify(result).includes('test-token-not-to-leak'), false);
    assert.equal(JSON.stringify(result).includes(f.root), false);
  } finally {
    if (oldToken === undefined) delete process.env.GITPORCH_LFS_TOKEN;
    else process.env.GITPORCH_LFS_TOKEN = oldToken;
    if (oldUser === undefined) delete process.env.GITPORCH_LFS_USERNAME;
    else process.env.GITPORCH_LFS_USERNAME = oldUser;
  }
}));

test('selected Git commit drift aborts before publishing after network phase', async () => fixture(async f => {
  const s = await setup(f), p = await planGitHubLfsDownload(...request(f, s));
  const mock = mockFetcher(s);
  const altering = async (url, init) => {
    const r = await mock.run(url, init);
    if (mock.calls.length === 2) {
      await git(['-C', s.work, '-c', 'user.name=R08', '-c', 'user.email=fixture@example.invalid',
        'commit', '--allow-empty', '-m', 'changed branch']);
      await git(['-C', s.work, '-c', 'core.hooksPath=' + join(f.root, 'no-hooks'),
        'push', join(f.data, 'repos', 'PhiOS.git'), 'main']);
    }
    return r;
  };
  await assert.rejects(acquireGitHubLfsObject(
    s.c, 'PhiOS', 'main', 'models/mesh.bin', f.assets, p.planSha256, f.data, altering,
  ), /pointer or asset state changed/);
  assert.deepEqual(await readdir(f.assets), []);
}));

test('operator CLI refuses missing approval, foreign catalog and malformed arg count', async () => fixture(async f => {
  const s = await setup(f);
  const saved = await saveCatalog(s.c, f.catalogs);
  const env = { ...process.env, GITPORCH_DATA_DIR: f.data };
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const args = [saved.path, 'PhiOS', 'main', 'models/mesh.bin', f.assets];
  const plan = JSON.parse((await exec(process.execPath, [cli, 'lfs-fetch-plan', ...args], { env })).stdout);
  assert.equal(plan.approvalRequired, true);
  await assert.rejects(exec(process.execPath, [cli, 'lfs-fetch', ...args, plan.planSha256], { env }),
    e => e.code === 1 && /Invalid arguments/.test(e.stderr));
  assert.deepEqual(await readdir(f.assets), []);
  await assert.rejects(planGitHubLfsDownload({ ...s.c, visibility: 'PRIVATE' },
    'PhiOS', 'main', 'models/mesh.bin', f.assets, f.data));
}));
