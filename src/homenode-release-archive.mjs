// PhiOS R0.12: explicit one-release-asset download with SHA-256 and offline readback.
// Never executes assets, trusts attachment URLs, or downloads without review.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { getDataDir } from './git.mjs';
import { inventoryPublicReleaseAssets } from './homenode-release-inventory.mjs';

const OWNER = 'MichaelWave369';
const SHA = /^[a-f0-9]{64}$/;
const PLAN_SCHEMA = 'gitporch.public-release-asset-archive-plan.v0.1';
const MAX_SINGLE_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 120000;
const CDN_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
function deny(message) { throw new Error(message); }
function digest(x) { return createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function canonical(p) { const v = resolve(p); return process.platform === 'win32' ? v.toLowerCase() : v; }
function within(a, b) {
  const r = relative(canonical(a), canonical(b));
  return !r || (!r.startsWith('..') && !isAbsolute(r));
}
async function statOrNull(p) {
  try { return await lstat(p); }
  catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
}
async function realDir(p, label) {
  if (typeof p !== 'string' || !isAbsolute(p)) deny(label + ' must be an existing absolute directory');
  const full = resolve(p);
  const st = await lstat(full);
  if (!st.isDirectory() || st.isSymbolicLink() || canonical(await realpath(full)) !== canonical(full)) {
    deny(label + ' redirects or contains an unsafe link');
  }
  return full;
}
async function safeArchiveRoot(p, dataDir, manifestPath) {
  const root = await realDir(p, 'Archive root');
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) deny('GitPorch data path must be absolute');
  if (within(root, resolve(dataDir)) || within(resolve(dataDir), root)) {
    deny('Archive root cannot overlap live GitPorch data');
  }
  if (within(root, resolve(manifestPath))) deny('Source manifest cannot reside in archive root');
  return root;
}
async function objectPath(root, oid, make) {
  let dir = root;
  for (const segment of ['releases', 'sha256', oid.slice(0, 2)]) {
    dir = join(dir, segment);
    let st = await statOrNull(dir);
    if (!st && make) {
      try { await mkdir(dir, { mode: 0o700 }); }
      catch (e) { if (e?.code !== 'EEXIST') throw e; }
      st = await statOrNull(dir);
    }
    if (!st) return null;
    if (!st.isDirectory() || st.isSymbolicLink() || canonical(await realpath(dir)) !== canonical(dir)) {
      deny('Unsafe archive object directory');
    }
  }
  return join(dir, oid);
}
async function shaFile(p) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(p)) h.update(chunk);
  return h.digest('hex');
}
async function archiveStatus(root, chosen) {
  const p = await objectPath(root, chosen.publishedSha256, false);
  if (!p) return 'NOT_STORED';
  const st = await statOrNull(p);
  if (!st) return 'NOT_STORED';
  if (!st.isFile() || st.isSymbolicLink() ||
      canonical(await realpath(p)) !== canonical(p) ||
      st.size !== chosen.declaredBytes ||
      (await shaFile(p)) !== chosen.publishedSha256) {
    return 'UNSAFE_OR_CORRUPT_LOCAL_RELEASE_OBJECT';
  }
  return 'LOCAL_RELEASE_BYTES_SHA256_VERIFIED_ONLY';
}
function chosenAsset(manifest, repo, input) {
  if (!manifest || manifest.schema !== 'gitporch.public-release-asset-inventory.v0.1' ||
      manifest.owner !== OWNER || manifest.repository !== repo ||
      !Array.isArray(manifest.releases) || manifest.releases.length > 20 ||
      manifest.manifestSha256 !== digest(Object.fromEntries(
        Object.entries(manifest).filter(([k]) => k !== 'manifestSha256')))) {
    deny('Untrusted or modified saved release inventory; regenerate approved R0.11 inventory');
  }
  if (typeof input !== 'string' || !/^[1-9][0-9]{0,15}$/.test(input)) {
    deny('Exact positive numeric asset ID required');
  }
  const numeric = Number(input);
  if (!Number.isSafeInteger(numeric)) deny('Asset ID exceeds integer range');
  let selected, count = 0;
  for (const release of manifest.releases) {
    if (!release || !Number.isSafeInteger(release.releaseId) || release.releaseId < 1 ||
        !Array.isArray(release.assets) || release.assets.length > 100) {
      deny('Malformed saved release records');
    }
    count += release.assets.length;
    if (count > 200) deny('Release inventory exceeds bounded asset scope');
    for (const asset of release.assets) {
      if (asset.assetId === numeric) {
        if (selected) deny('Duplicate release asset ID in saved inventory');
        selected = { ...asset, tag: release.tag, releaseId: release.releaseId };
      }
    }
  }
  if (!selected || !Number.isSafeInteger(selected.declaredBytes) ||
      selected.declaredBytes < 0 || !SHA.test(selected.publishedSha256 ?? '') ||
      selected.digestStatus !== 'SHA256_PUBLISHED_NOT_YET_BYTE_VERIFIED' ||
      selected.declaredBytes > MAX_SINGLE_BYTES ||
      typeof selected.name !== 'string' || selected.name.length > 255 ||
      /[\x00-\x1f\\\/]/.test(selected.name)) {
    deny('Asset absent, lacks SHA-256, has unsafe name, or exceeds 64 MiB pilot cap');
  }
  return selected;
}
export async function loadSavedReleaseInventory(file) {
  if (typeof file !== 'string' || !isAbsolute(file)) deny('Saved inventory must be an absolute file');
  const full = resolve(file);
  const st = await lstat(full);
  if (!st.isFile() || st.isSymbolicLink() ||
      canonical(await realpath(full)) !== canonical(full) ||
      st.size > MAX_MANIFEST_BYTES) deny('Inventory must be a bounded, non-symlink regular file');
  try { return JSON.parse((await readFile(full, 'utf8'))); }
  catch { deny('Saved inventory is not valid JSON'); }
}
function basis(manifest, repo, asset, root) {
  return {
    schema: PLAN_SCHEMA, owner: OWNER, repository: repo,
    manifestSha256: manifest.manifestSha256,
    releaseId: asset.releaseId, tag: asset.tag,
    assetId: asset.assetId, assetName: asset.name,
    expectedBytes: asset.declaredBytes, publishedSha256: asset.publishedSha256,
    archiveRoot: root,
  };
}
export async function planReleaseAssetArchive(
  catalog, manifestFile, repo, assetId, archiveRoot, dataDir = getDataDir(),
) {
  const manifest = await loadSavedReleaseInventory(manifestFile);
  const asset = chosenAsset(manifest, repo, assetId);
  const root = await safeArchiveRoot(archiveRoot, dataDir, manifestFile);
  // Check that this exact repo is still in a public-only local catalog before
  // any plan can be produced. Online R0.11 re-checks again at execution.
  if (!catalog || catalog.owner !== OWNER || catalog.visibility !== 'PUBLIC_ONLY' ||
      catalog.schema !== 'gitporch.public-catalog.v1' ||
      !Array.isArray(catalog.repositories) || catalog.count !== catalog.repositories.length ||
      !catalog.repositories.some(r => r.name === repo && r.eligible === true)) {
    deny('Exact-owner public catalog required for release archive plan');
  }
  const storage = await archiveStatus(root, asset);
  if (storage === 'UNSAFE_OR_CORRUPT_LOCAL_RELEASE_OBJECT') {
    deny('Existing release archive object is unsafe/corrupted; never overwrite');
  }
  const selected = basis(manifest, repo, asset, root);
  return {
    ...selected, planSha256: digest({ ...selected, currentStorage: storage }),
    status: storage === 'NOT_STORED' ? 'EXPLICIT_APPROVAL_REQUIRED' : 'ALREADY_VERIFIED_NO_WRITE_NEEDED',
    networkUsed: false, writesMade: false,
    acceptance: { githubReleasePublisherAuthenticated: false, independentDiskVerified: false,
      offlinePhiOSBootVerified: false },
    notice: 'Offline preview from a saved unsigned R0.11 inventory; approval execution will re-query GitHub and compare exact release ID/asset ID/name/size/SHA-256. No download or archive writes yet.',
  };
}
function tokenHeader() {
  const token = process.env.GITPORCH_RELEASE_TOKEN;
  if (!token) return {};
  if (typeof token !== 'string' || token.length > 500 ||
      /[\r\n\0]/.test(token)) deny('Invalid release token environment value');
  return { Authorization: 'Bearer ' + token };
}
function validateCDN(location) {
  let u;
  try { u = new URL(location); } catch { deny('Malformed GitHub release download redirect'); }
  if (u.protocol !== 'https:' || !CDN_HOSTS.has(u.hostname.toLowerCase()) ||
      u.port || u.username || u.password || u.hash) {
    deny('GitHub release redirect host or scheme not allowed');
  }
  return u.toString();
}
function contentResponse(res, expected) {
  if (!res || res.status !== 200 || !res.ok ||
      !res.body || typeof res.body.getReader !== 'function') {
    deny('Release content request did not return a permitted binary stream');
  }
  const length = res.headers?.get?.('content-length');
  if (length !== null && length !== undefined &&
      (!/^\d+$/.test(length) || Number(length) !== expected)) {
    deny('Release response Content-Length disagrees with published metadata');
  }
  const type = res.headers?.get?.('content-type');
  if (typeof type === 'string' && /^application\/(?:json|vnd\.github\+json)/i.test(type)) {
    deny('Release endpoint served JSON rather than binary');
  }
}
async function spoolVerified(res, path, bytes, sha) {
  contentResponse(res, bytes);
  const reader = res.body.getReader();
  const h = createHash('sha256');
  let got = 0;
  const fh = await open(path, 'wx', 0o600);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      got += buf.length;
      if (got > bytes || got > MAX_SINGLE_BYTES) deny('Release asset stream exceeded exact size cap');
      h.update(buf);
      for (let pos = 0; pos < buf.length;) {
        const n = (await fh.write(buf, pos, buf.length - pos)).bytesWritten;
        if (!n) deny('Release archive disk write made no progress');
        pos += n;
      }
    }
    await fh.sync();
  } finally {
    try { await reader.cancel(); } catch {}
    await fh.close();
  }
  if (got !== bytes || h.digest('hex') !== sha ||
      (await shaFile(path)) !== sha) {
    deny('Downloaded release asset failed SHA-256 or byte-length verification');
  }
}
export async function verifyReleaseAssetArchive(
  catalog, manifestFile, repo, assetId, archiveRoot, dataDir = getDataDir(),
) {
  const plan = await planReleaseAssetArchive(catalog, manifestFile, repo, assetId, archiveRoot, dataDir);
  return {
    schema: 'gitporch.public-release-asset-archive-verification.v0.1',
    repository: plan.repository, releaseId: plan.releaseId, assetId: plan.assetId,
    sha256: plan.publishedSha256, bytes: plan.expectedBytes,
    status: plan.status === 'ALREADY_VERIFIED_NO_WRITE_NEEDED' ?
      'LOCAL_RELEASE_BYTES_SHA256_VERIFIED_ONLY' : 'NOT_STORED',
    sourcePublisherSignatureVerified: false, physicallyIndependentMediaVerified: false,
    notice: 'Offline readback of one object against SHA-256 from saved public metadata; not proof of publisher identity, GitHub upstream parity, all release assets, or independently restored media.',
  };
}
/**
 * Explicitly approved single-asset retrieval. HTTP mocks can be injected for
 * testing; CLI always uses global fetch and exact constructed API endpoints.
 */
export async function acquireReleaseAsset(
  catalog, manifestFile, repo, assetId, archiveRoot, approvedPlanSha256,
  dataDir = getDataDir(), fetcher = fetch,
) {
  if (typeof approvedPlanSha256 !== 'string' || !SHA.test(approvedPlanSha256)) {
    deny('Reviewed 64-hex plan SHA-256 is mandatory');
  }
  const plan = await planReleaseAssetArchive(catalog, manifestFile, repo, assetId, archiveRoot, dataDir);
  if (plan.planSha256 !== approvedPlanSha256) deny('Release archive approval is stale or incorrect');
  if (plan.status !== 'EXPLICIT_APPROVAL_REQUIRED') deny('Object is already verified; no download needed');

  // R0.11 re-queries bounded *published* public release metadata. A stale
  // source manifest cannot authorize a changed or deleted remote attachment.
  const fresh = await inventoryPublicReleaseAssets(catalog, repo, fetcher);
  const match = fresh.releases.find(r => r.releaseId === plan.releaseId &&
    r.tag === plan.tag)?.assets.find(a => a.assetId === plan.assetId);
  if (!match || match.name !== plan.assetName ||
      match.declaredBytes !== plan.expectedBytes ||
      match.publishedSha256 !== plan.publishedSha256) {
    deny('GitHub release asset metadata changed since reviewed inventory');
  }

  const url = 'https://api.github.com/repos/' + OWNER + '/' + repo +
    '/releases/assets/' + plan.assetId;
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET', redirect: 'manual',
      headers: { Accept: 'application/octet-stream',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'GitPorch-PhiOS-ReleaseArchive', ...tokenHeader() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch { deny('GitHub release attachment API request failed'); }
  if (response?.status === 302 || response?.status === 307) {
    const location = response.headers?.get?.('location');
    const vetted = validateCDN(location);
    try {
      response = await fetcher(vetted, {
        method: 'GET', redirect: 'manual',
        headers: { 'User-Agent': 'GitPorch-PhiOS-ReleaseArchive' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch { deny('Approved GitHub release CDN request failed'); }
  }
  contentResponse(response, plan.expectedBytes);
  const current = await planReleaseAssetArchive(
    catalog, manifestFile, repo, assetId, archiveRoot, dataDir);
  if (current.planSha256 !== approvedPlanSha256) {
    deny('Release asset source plan or archive state changed during download');
  }

  const root = await safeArchiveRoot(archiveRoot, dataDir, manifestFile);
  const dest = await objectPath(root, plan.publishedSha256, true);
  if (await statOrNull(dest)) deny('Archive object appeared before write; refusing overwrite');
  const pending = join(resolve(dest, '..'), '.' + plan.publishedSha256 + '.pending-' + randomUUID());
  try {
    await spoolVerified(response, pending, plan.expectedBytes, plan.publishedSha256);
    if (await statOrNull(dest)) deny('Archive destination appeared during download');
    await link(pending, dest); // atomic no-overwrite; no automatic extraction
  } finally { await rm(pending, { force: true }); }
  const checked = await verifyReleaseAssetArchive(
    catalog, manifestFile, repo, assetId, archiveRoot, dataDir);
  if (checked.status !== 'LOCAL_RELEASE_BYTES_SHA256_VERIFIED_ONLY') {
    deny('Release object readback validation failed');
  }
  return {
    schema: 'gitporch.public-release-asset-archive-receipt.v0.1',
    repository: repo, releaseId: plan.releaseId, assetId: plan.assetId,
    sha256: plan.publishedSha256, bytes: plan.expectedBytes,
    status: checked.status, networkUsed: true, assetExecuted: false,
    acceptance: {
      bytesMatchPublishedGitHubSha256: true, publisherSignatureVerified: false,
      sourceGitHubParityVerified: false, allReleaseAssetsRecovered: false,
      independentPhysicalMediaVerified: false, disconnectedWanTestVerified: false,
      offlinePhiOSBootVerified: false,
    },
    notice: 'One asset was downloaded and locally verified against published GitHub SHA-256. It was not executed, source-authenticated, restored from off-host media, or deemed safe.',
  };
}
