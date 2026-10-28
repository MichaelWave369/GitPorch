import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { saveCatalog } from '../src/homenode-bridge.mjs';
import { inventoryPublicReleaseAssets } from '../src/homenode-release-inventory.mjs';

const exec = promisify(execFile);
const BASE = 'https://api.github.com/repos/MichaelWave369/PhiOS/releases';
const DIGEST = 'a'.repeat(64);
const catalog = (...names) => ({
  schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
  visibility: 'PUBLIC_ONLY', count: names.length,
  repositories: names.map(name => ({ name, eligible: true })),
});
const release = (id = 11) => ({
  id, tag_name: 'v' + id + '.0.0', draft: false, prerelease: false,
  published_at: '2026-10-28T18:00:00Z',
});
const asset = (id = 101, props = {}) => ({
  id, name: 'PhiOS-install-' + id + '.zip', size: 1234,
  state: 'uploaded', digest: 'sha256:' + DIGEST, ...props,
});
function fixtureReply(value, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function fakeGitHub(releases = [release()], assets = [asset()], opt = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (opt.override) return opt.override(url, init, calls.length);
    if (url === BASE + '?per_page=20&page=1') return fixtureReply(releases);
    if (url === BASE + '?per_page=20&page=2') return fixtureReply(opt.releaseOverflow ?? []);
    if (url === BASE + '/11/assets?per_page=100&page=1') return fixtureReply(assets);
    if (url === BASE + '/11/assets?per_page=100&page=2') return fixtureReply(opt.assetOverflow ?? []);
    // Other release IDs get their own page; don't invent a redirect endpoint.
    if (/^https:\/\/api\.github\.com\/repos\/MichaelWave369\/PhiOS\/releases\/\d+\/assets\?per_page=100&page=1$/.test(url)) {
      return fixtureReply(opt.assetsByRelease?.[Number(url.split('/').at(-2))] ?? []);
    }
    throw new Error('Unexpected requested URL ' + url);
  };
  return { calls, fetcher };
}

test('exact public release and SHA256 metadata produce deterministic, unsigned, byte-unverified ledger', async () => {
  const api = fakeGitHub();
  const first = await inventoryPublicReleaseAssets(catalog('PhiOS'), 'PhiOS', api.fetcher);
  assert.equal(first.schema, 'gitporch.public-release-asset-inventory.v0.1');
  assert.equal(first.repository, 'PhiOS');
  assert.equal(first.mode, 'EXPLICIT_ONLINE_PUBLIC_RELEASE_METADATA_ONLY');
  assert.equal(first.status, 'RELEASE_ASSET_METADATA_INVENTORIED_NOT_BACKED_UP');
  assert.equal(first.summary.publishedReleasesObserved, 1);
  assert.equal(first.summary.assetsEnumerated, 1);
  assert.equal(first.summary.declaredAssetBytes, 1234);
  assert.equal(first.summary.assetsWithPublishedSha256, 1);
  assert.equal(first.summary.locallyVerifiedAssetBytes, 0);
  assert.equal(first.releases[0].releaseId, 11);
  assert.equal(first.releases[0].assets[0].assetId, 101);
  assert.equal(first.releases[0].assets[0].publishedSha256, DIGEST);
  assert.equal(first.releases[0].assets[0].bytesPreservedLocally, false);
  assert.equal(first.releases[0].assets[0].assetContentVerified, false);
  assert.match(first.manifestSha256, /^[a-f0-9]{64}$/);
  for (const verified of Object.values(first.acceptance)) assert.equal(verified, false);
  assert.deepEqual(api.calls.map(x => x.url), [
    BASE + '?per_page=20&page=1',
    BASE + '/11/assets?per_page=100&page=1',
  ]);
  assert.equal(api.calls.every(x => x.init.redirect === 'manual' && x.init.method === 'GET'), true);
  assert.equal(api.calls.some(x => x.url.includes('/downloads/') || x.url.includes('browser_download')), false);
  assert.equal((await inventoryPublicReleaseAssets(catalog('PhiOS'), 'PhiOS', api.fetcher)).manifestSha256,
    first.manifestSha256);
  assert.equal(JSON.stringify(first).includes('browser_download_url'), false);
});

test('unpublished/missing SHA256 explicitly stays unverified, never treated as verified contents', async () => {
  const api = fakeGitHub([release()], [
    asset(10, { digest: null }), asset(20, { digest: 'md5:1234' }),
    asset(30, { digest: 'sha256:' + 'F'.repeat(64) }),
  ]);
  const report = await inventoryPublicReleaseAssets(catalog('PhiOS'), 'PhiOS', api.fetcher);
  assert.equal(report.summary.assetsWithoutSupportedSha256, 2);
  assert.equal(report.summary.assetsWithPublishedSha256, 1);
  assert.equal(report.releases[0].assets[0].publishedSha256, null);
  assert.equal(report.releases[0].assets[1].digestStatus, 'NO_SUPPORTED_SHA256_PUBLISHED_UNVERIFIED');
  assert.equal(report.releases[0].assets[2].publishedSha256, 'f'.repeat(64));
  assert.equal(report.acceptance.releaseAssetBytesSHA256Verified, false);
});

test('an empty published-release response is observational uncertainty, not a verified backup', async () => {
  const api = fakeGitHub([]);
  const r = await inventoryPublicReleaseAssets(catalog('PhiOS'), 'PhiOS', api.fetcher);
  assert.equal(r.status, 'NO_PUBLISHED_RELEASES_OBSERVED_UNVERIFIED');
  assert.equal(r.summary.assetsEnumerated, 0);
  assert.equal(r.acceptance.privateOrDraftReleasesCovered, false);
  assert.equal(api.calls.length, 1);
});

test('overflow releases fail before scanning assets and never return partial inventory', async () => {
  const many = Array.from({ length: 20 }, (_, i) => release(i + 1));
  const api = fakeGitHub(many, [], { releaseOverflow: [release(21)] });
  await assert.rejects(inventoryPublicReleaseAssets(catalog('PhiOS'), 'PhiOS', api.fetcher),
    /More than 20 public releases/);
  assert.deepEqual(api.calls.map(x => x.url), [
    BASE + '?per_page=20&page=1', BASE + '?per_page=20&page=2',
  ]);
});

test('asset overflow also refuses partial inventory, including exact 100-item first page', async () => {
  const hundred = Array.from({ length: 100 }, (_, i) => asset(i + 1));
  const api = fakeGitHub([release()], hundred, { assetOverflow: [asset(101)] });
  await assert.rejects(inventoryPublicReleaseAssets(catalog('PhiOS'), 'PhiOS', api.fetcher),
    /More than 100 assets on release/);
  assert.deepEqual(api.calls.map(x => x.url), [
    BASE + '?per_page=20&page=1',
    BASE + '/11/assets?per_page=100&page=1',
    BASE + '/11/assets?per_page=100&page=2',
  ]);
});

test('duplicate release identifiers, duplicate tags, duplicate asset IDs, unsafe names fail closed', async () => {
  const cases = [
    fakeGitHub([release(11), release(11)]),
    fakeGitHub([release(11), { ...release(12), tag_name: 'v11.0.0' }]),
    fakeGitHub([release()], [asset(11), asset(11)]),
    fakeGitHub([release()], [asset(11, { name: '../repo-token.bin' })]),
    fakeGitHub([release()], [asset(11, { size: -1 })]),
    fakeGitHub([release()], [asset(11, { state: 'starter' })]),
    fakeGitHub([{ ...release(), draft: true }]),
    fakeGitHub([{ ...release(), published_at: null }]),
  ];
  for (const api of cases) {
    await assert.rejects(inventoryPublicReleaseAssets(catalog('PhiOS'), 'PhiOS', api.fetcher));
  }
});

test('redirects, JSON API errors and stream caps fail without following links', async () => {
  for (const override of [
    () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid/' } }),
    () => fixtureReply({ message: 'rate limited' }, 403),
    () => new Response('not-json', { status: 200 }),
    () => new Response(JSON.stringify(Array.from({ length: 100000 }, () => 'oversize')), { status: 200 }),
    () => new Response('[]', { status: 200, headers: { 'content-length': '1048577' } }),
  ]) {
    const api = fakeGitHub([], [], { override });
    await assert.rejects(inventoryPublicReleaseAssets(catalog('PhiOS'), 'PhiOS', api.fetcher));
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].init.redirect, 'manual');
  }
});

test('rejects private/foreign/case mismatch catalog before any HTTP', async () => {
  const api = fakeGitHub();
  const invalid = [
    [{ ...catalog('PhiOS'), visibility: 'PRIVATE' }, 'PhiOS'],
    [{ ...catalog('PhiOS'), owner: 'AnotherOwner' }, 'PhiOS'],
    [catalog('PhiOS', 'phios'), 'PhiOS'],
    [catalog('PhiOS'), 'phios'],
    [catalog('PhiOS'), 'NotACatalogRepo'],
    [{ ...catalog('PhiOS'), count: 2 }, 'PhiOS'],
  ];
  for (const [c, n] of invalid) {
    await assert.rejects(inventoryPublicReleaseAssets(c, n, api.fetcher));
  }
  assert.equal(api.calls.length, 0);
});

test('CLI refuses missing literal online approval and malformed arguments without network', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r11-'));
  try {
    const catalogDir = join(root, 'catalog');
    await mkdir(catalogDir);
    const c = await saveCatalog(catalog('PhiOS'), catalogDir);
    const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
    for (const a of [
      ['release-inventory', c.path, 'PhiOS'],
      ['release-inventory', c.path, 'PhiOS', '--wrong-approval'],
      ['release-inventory', c.path],
    ]) {
      await assert.rejects(exec(process.execPath, [cli, ...a]),
        err => err.code === 1 && /Invalid arguments/.test(err.stderr));
    }
    const files = await readdir(catalogDir);
    assert.equal(files.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
