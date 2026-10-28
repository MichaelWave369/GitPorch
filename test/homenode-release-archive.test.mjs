import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { saveCatalog } from '../src/homenode-bridge.mjs';
import { inventoryPublicReleaseAssets } from '../src/homenode-release-inventory.mjs';
import {
  planReleaseAssetArchive, acquireReleaseAsset, verifyReleaseAssetArchive,
} from '../src/homenode-release-archive.mjs';

const exec = promisify(execFile);
const hash = b => createHash('sha256').update(b).digest('hex');
const RELEASES = 'https://api.github.com/repos/MichaelWave369/PhiOS/releases';
const CDN = 'https://release-assets.githubusercontent.com/signed/asset?token=hidden';
const assetUrl = 'https://api.github.com/repos/MichaelWave369/PhiOS/releases/assets/101';
const catalog = () => ({
  schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369', visibility: 'PUBLIC_ONLY',
  count: 1, repositories: [{ name: 'PhiOS', eligible: true }],
});
async function fixture(fn, opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r12-'));
  try {
    const f = { root, archive: join(root, 'archive'), dataDir: join(root, 'data'),
      inputs: join(root, 'inputs') };
    await mkdir(f.archive);
    await mkdir(f.inputs);
    f.bytes = Buffer.from('a small but real zip-like release byte payload\n');
    f.sha = hash(f.bytes);
    f.c = catalog();
    f.asset = {
      id: 101, name: 'PhiOS-test.zip', state: 'uploaded',
      digest: opts.digest === undefined ? 'sha256:' + f.sha : opts.digest,
      size: opts.size === undefined ? f.bytes.length : opts.size,
    };
    f.release = {
      id: 11, tag_name: 'v1.2.3', draft: false,
      prerelease: false, published_at: '2026-10-28T18:00:00Z',
    };
    f.calls = [];
    f.fetcher = async (url, init = {}) => {
      f.calls.push({ url, headers: init.headers ?? {}, redirect: init.redirect, method: init.method });
      if (opts.override) {
        const replaced = await opts.override(f, url, init);
        if (replaced) return replaced;
      }
      if (url === RELEASES + '?per_page=20&page=1') {
        return Response.json([f.release]);
      }
      if (url === RELEASES + '/11/assets?per_page=100&page=1') {
        return Response.json([f.asset]);
      }
      if (url === assetUrl) {
        if (opts.direct) return new Response(f.bytes, { status: 200,
          headers: { 'Content-Type': 'application/octet-stream',
            'Content-Length': String(f.bytes.length) } });
        return new Response(null, { status: 302, headers: { Location: opts.redirect ?? CDN } });
      }
      if (url === CDN) {
        const b = opts.downloadBytes ?? f.bytes;
        return new Response(b, { status: 200,
          headers: { 'Content-Type': 'application/octet-stream',
            'Content-Length': String(opts.lengthHeader ?? b.length) } });
      }
      throw new Error('Unexpected URL: ' + url);
    };
    const inventory = await inventoryPublicReleaseAssets(f.c, 'PhiOS', f.fetcher);
    f.manifestPath = join(f.inputs, 'release-inventory.json');
    await writeFile(f.manifestPath, JSON.stringify(inventory, null, 2) + '\n');
    f.calls = [];
    return await fn(f);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const plan = f => planReleaseAssetArchive(
  f.c, f.manifestPath, 'PhiOS', '101', f.archive, f.dataDir);
const archive = (f, fingerprint, fetcher = f.fetcher) => acquireReleaseAsset(
  f.c, f.manifestPath, 'PhiOS', '101', f.archive, fingerprint, f.dataDir, fetcher);
const verify = f => verifyReleaseAssetArchive(
  f.c, f.manifestPath, 'PhiOS', '101', f.archive, f.dataDir);

test('offline plan writes nothing, fixes published asset SHA and requires explicit approval', async () => fixture(async f => {
  const before = await readdir(f.archive);
  const p = await plan(f);
  assert.equal(p.schema, 'gitporch.public-release-asset-archive-plan.v0.1');
  assert.equal(p.status, 'EXPLICIT_APPROVAL_REQUIRED');
  assert.equal(p.networkUsed, false);
  assert.equal(p.writesMade, false);
  assert.equal(p.repository, 'PhiOS');
  assert.equal(p.releaseId, 11);
  assert.equal(p.assetId, 101);
  assert.equal(p.expectedBytes, f.bytes.length);
  assert.equal(p.publishedSha256, f.sha);
  assert.match(p.planSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await readdir(f.archive), before);
  assert.equal(f.calls.length, 0);
  assert.equal((await verify(f)).status, 'NOT_STORED');
}));

test('approved CDN redirect downloads exactly once and readback preserves original bytes', async () => fixture(async f => {
  const p = await plan(f);
  const receipt = await archive(f, p.planSha256);
  assert.equal(receipt.status, 'LOCAL_RELEASE_BYTES_SHA256_VERIFIED_ONLY');
  assert.equal(receipt.bytes, f.bytes.length);
  assert.equal(receipt.assetExecuted, false);
  assert.equal(receipt.acceptance.bytesMatchPublishedGitHubSha256, true);
  assert.equal(receipt.acceptance.publisherSignatureVerified, false);
  assert.equal(receipt.acceptance.independentPhysicalMediaVerified, false);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.calls.map(c => c.url), [
    RELEASES + '?per_page=20&page=1',
    RELEASES + '/11/assets?per_page=100&page=1',
    assetUrl, CDN,
  ]);
  assert.equal(f.calls[2].headers.Authorization, undefined);
  assert.equal(f.calls[3].headers.Authorization, undefined);
  assert.equal(f.calls.every(c => c.redirect === 'manual'), true);
  const saved = join(f.archive, 'releases', 'sha256', f.sha.slice(0, 2), f.sha);
  assert.deepEqual(await readFile(saved), f.bytes);
  assert.equal((await verify(f)).status, 'LOCAL_RELEASE_BYTES_SHA256_VERIFIED_ONLY');
  const later = await plan(f);
  assert.equal(later.status, 'ALREADY_VERIFIED_NO_WRITE_NEEDED');
  await assert.rejects(archive(f, later.planSha256), /already verified/);
  assert.equal(f.calls.length, 4);
}));

test('direct 200 octet download is supported without CDN hop', async () => fixture(async f => {
  const p = await plan(f);
  const result = await archive(f, p.planSha256);
  assert.equal(result.status, 'LOCAL_RELEASE_BYTES_SHA256_VERIFIED_ONLY');
  assert.equal(f.calls.length, 3);
}, { direct: true }));

test('bad plan hashes, tampered inventory and missing SHA256 are never approved', async () => {
  await fixture(async f => {
    await assert.rejects(archive(f, 'f'.repeat(64)), /stale or incorrect/);
    await assert.rejects(archive(f, 'whatever'), /64-hex/);
    assert.equal(f.calls.length, 0);
    const manifest = JSON.parse(await readFile(f.manifestPath));
    manifest.releases[0].assets[0].declaredBytes += 5;
    await writeFile(f.manifestPath, JSON.stringify(manifest));
    await assert.rejects(plan(f), /Untrusted or modified saved release inventory/);
    assert.equal(f.calls.length, 0);
  });
  await fixture(async f => {
    await assert.rejects(plan(f), /lacks SHA-256/);
  }, { digest: null });
  await fixture(async f => {
    await assert.rejects(plan(f), /64 MiB/);
  }, { size: 64 * 1024 * 1024 + 1 });
});

test('mismatched byte content, truncated/oversize streams and GitHub metadata drift fail closed', async () => {
  const overrides = [
    { downloadBytes: Buffer.alloc(46, 3) },
    { downloadBytes: Buffer.alloc(3, 4) },
    { lengthHeader: 100 },
  ];
  for (const opts of overrides) {
    await fixture(async f => {
      const p = await plan(f);
      await assert.rejects(archive(f, p.planSha256), /SHA-256|size cap|Content-Length/);
      const stored = await readdir(join(f.archive, 'releases', 'sha256', f.sha.slice(0, 2)))
        .catch(() => []);
      assert.deepEqual(stored, []);
    }, opts);
  }
  await fixture(async f => {
    const p = await plan(f);
    f.asset.name = 'changed-upstream.zip';
    await assert.rejects(archive(f, p.planSha256), /metadata changed/);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(await readdir(f.archive), []);
  });
  await fixture(async f => {
    const p = await plan(f);
    f.asset.digest = 'sha256:' + '9'.repeat(64);
    await assert.rejects(archive(f, p.planSha256), /metadata changed/);
    assert.deepEqual(await readdir(f.archive), []);
  });
});

test('unapproved HTTP redirect hosts, embedded userinfo and redirect chains are refused', async () => {
  const urls = [
    'http://release-assets.githubusercontent.com/file',
    'https://release-assets.githubusercontent.com.evil.invalid/bad',
    'https://127.0.0.1/file',
    'https://user:pw@release-assets.githubusercontent.com/file',
    'https://objects.githubusercontent.com:444/file',
    'https://evil.invalid/file',
  ];
  for (const redirect of urls) {
    await fixture(async f => {
      const p = await plan(f);
      await assert.rejects(archive(f, p.planSha256), /redirect host or scheme not allowed/);
      assert.equal(f.calls.length, 3);
      assert.deepEqual(await readdir(f.archive), []);
    }, { redirect });
  }
  await fixture(async f => {
    const p = await plan(f);
    const redirectAgain = async (url, init) => {
      const response = await f.fetcher(url, init);
      if (url === CDN) return new Response(null, { status: 302,
        headers: { Location: 'https://evil.invalid' } });
      return response;
    };
    await assert.rejects(archive(f, p.planSha256, redirectAgain), /permitted binary stream/);
    assert.deepEqual(await readdir(f.archive), []);
  });
});

test('operator token sent only to exact API content endpoint, never CDN or receipts', async () => fixture(async f => {
  const prior = process.env.GITPORCH_RELEASE_TOKEN;
  try {
    process.env.GITPORCH_RELEASE_TOKEN = 'test-audience-specific-secret-value';
    const p = await plan(f);
    const receipt = await archive(f, p.planSha256);
    assert.equal(f.calls[0].headers.Authorization, undefined);
    assert.equal(f.calls[1].headers.Authorization, undefined);
    assert.equal(f.calls[2].headers.Authorization,
      'Bearer test-audience-specific-secret-value');
    assert.equal(f.calls[3].headers.Authorization, undefined);
    assert.equal(JSON.stringify(receipt).includes('secret-value'), false);
    assert.equal(JSON.stringify(receipt).includes(CDN), false);
  } finally {
    if (prior === undefined) delete process.env.GITPORCH_RELEASE_TOKEN;
    else process.env.GITPORCH_RELEASE_TOKEN = prior;
  }
}));

test('preexisting damaged file cannot be overwritten and symlink cannot count as recovery', async t => {
  await fixture(async f => {
    const target = join(f.archive, 'releases', 'sha256', f.sha.slice(0, 2), f.sha);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.alloc(f.bytes.length, 7));
    await assert.rejects(plan(f), /unsafe\/corrupted/);
    assert.equal(f.calls.length, 0);
  });
  await fixture(async f => {
    const target = join(f.archive, 'releases', 'sha256', f.sha.slice(0, 2), f.sha);
    await mkdir(dirname(target), { recursive: true });
    const source = join(f.root, 'elsewhere');
    await writeFile(source, f.bytes);
    try { await symlink(source, target, 'file'); }
    catch (e) {
      if (['EPERM', 'ENOTSUP', 'EACCES'].includes(e.code)) return t.skip('symlinks unavailable');
      throw e;
    }
    await assert.rejects(plan(f), /unsafe\/corrupted/);
  });
});

test('rejects foreign/private catalog, archive-data overlap and manifest from archive root', async () => fixture(async f => {
  for (const c of [
    { ...f.c, visibility: 'PRIVATE' }, { ...f.c, owner: 'OtherOwner' },
    { ...f.c, repositories: [] },
  ]) {
    await assert.rejects(planReleaseAssetArchive(c, f.manifestPath,
      'PhiOS', '101', f.archive, f.dataDir));
  }
  await mkdir(f.dataDir);
  await assert.rejects(planReleaseAssetArchive(f.c, f.manifestPath,
    'PhiOS', '101', f.dataDir, f.dataDir), /overlap/);
  await assert.rejects(planReleaseAssetArchive(f.c, f.manifestPath,
    'PhiOS', '101', f.inputs, f.dataDir), /manifest cannot reside/);
  assert.equal(f.calls.length, 0);
}));

test('CLI exposes offline plan/readback and refuses missing explicit download flag', async () => fixture(async f => {
  const cDir = join(f.root, 'catalogs');
  await mkdir(cDir);
  const saved = await saveCatalog(f.c, cDir);
  const args = [saved.path, f.manifestPath, 'PhiOS', '101', f.archive];
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const env = { ...process.env, GITPORCH_DATA_DIR: f.dataDir };
  const p = JSON.parse((await exec(process.execPath, [cli, 'release-archive-plan', ...args], { env })).stdout);
  assert.equal(p.status, 'EXPLICIT_APPROVAL_REQUIRED');
  const readback = JSON.parse((await exec(process.execPath, [cli, 'release-archive-verify', ...args], { env })).stdout);
  assert.equal(readback.status, 'NOT_STORED');
  await assert.rejects(exec(process.execPath, [cli, 'release-archive', ...args, p.planSha256], { env }),
    e => e.code === 1 && /Invalid arguments/.test(e.stderr));
  assert.deepEqual(await readdir(f.archive), []);
  assert.equal(f.calls.length, 0);
}));
