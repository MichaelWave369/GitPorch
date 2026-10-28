// PhiOS R0.11: explicit, read-only GitHub public release asset metadata census.
// Does not download binaries, call arbitrary URLs, execute or preserve any asset.
import { createHash } from 'node:crypto';
import { validSlug } from './git.mjs';

const OWNER = 'MichaelWave369';
const SCHEMA = 'gitporch.public-release-asset-inventory.v0.1';
const BASE = 'https://api.github.com/repos/' + OWNER + '/';
const MAX_RELEASES = 20;
const MAX_ASSETS_PER_RELEASE = 100;
const MAX_TOTAL_ASSETS = 200;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
function deny(message) { throw new Error(message); }
function positiveId(x) { return Number.isSafeInteger(x) && x > 0; }
function printable(s, max) {
  return typeof s === 'string' && s.length > 0 && s.length <= max &&
    !/[\x00-\x1f\x7f]/.test(s);
}
function safeAssetName(name) {
  return printable(name, 255) && name !== '.' && name !== '..' &&
    !name.includes('/') && !name.includes('\\');
}
function safeTag(tag) { return printable(tag, 200); }
function digestOf(x) {
  return createHash('sha256').update(JSON.stringify(x)).digest('hex');
}
function validateCatalog(c, name) {
  if (!c || c.schema !== 'gitporch.public-catalog.v1' ||
      c.owner !== OWNER || c.visibility !== 'PUBLIC_ONLY' ||
      !Array.isArray(c.repositories) || !Number.isSafeInteger(c.count) ||
      c.count !== c.repositories.length || c.count < 1 || c.count > 3000 ||
      !validSlug(name)) deny('An exact-owner PUBLIC_ONLY catalog is required');
  const seen = new Set();
  let selected = false;
  for (const r of c.repositories) {
    if (!r || typeof r.name !== 'string' ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(r.name) ||
        typeof r.eligible !== 'boolean' || seen.has(r.name.toLowerCase())) {
      deny('Invalid or duplicate public catalog entry');
    }
    seen.add(r.name.toLowerCase());
    if (r.name === name && r.eligible) selected = true;
  }
  if (!selected) deny('Repository not eligible in exact-owner public catalog');
}
// Use only constructed, immutable GitHub API URLs, no server-provided next links.
async function requestJSON(url, fetcher) {
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET', redirect: 'manual',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'GitPorch-PhiOS-PublicReleaseInventory',
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch { deny('GitHub release inventory request failed'); }
  if (!response || response.status !== 200 || !response.ok ||
      !response.body || typeof response.body.getReader !== 'function') {
    deny('GitHub release inventory response refused or rate-limited');
  }
  const size = response.headers?.get?.('content-length');
  if (size !== undefined && size !== null &&
      (!/^\d+$/.test(size) || Number(size) > MAX_BODY_BYTES)) {
    deny('GitHub release inventory response exceeds size cap');
  }
  const reader = response.body.getReader();
  let total = 0;
  const pieces = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const buf = Buffer.from(part.value);
      total += buf.length;
      if (total > MAX_BODY_BYTES) deny('GitHub release inventory response exceeded stream cap');
      pieces.push(buf);
    }
  } finally { try { await reader.cancel(); } catch {} }
  try {
    const result = JSON.parse(Buffer.concat(pieces, total).toString('utf8'));
    if (!Array.isArray(result)) deny('Expected GitHub API array');
    return result;
  } catch {
    deny('Unexpected JSON in GitHub release inventory response');
  }
}
function releaseRecord(x) {
  if (!x || !positiveId(x.id) || !safeTag(x.tag_name) ||
      x.draft !== false || typeof x.prerelease !== 'boolean' ||
      typeof x.published_at !== 'string' ||
      !Number.isFinite(Date.parse(x.published_at))) {
    deny('Untrusted or unpublished GitHub release metadata');
  }
  return {
    releaseId: x.id, tag: x.tag_name, prerelease: x.prerelease,
    publishedAt: x.published_at,
  };
}
function assetRecord(x, releaseId) {
  if (!x || !positiveId(x.id) || !safeAssetName(x.name) ||
      !Number.isSafeInteger(x.size) || x.size < 0 || x.size > MAX_ASSET_BYTES ||
      x.state !== 'uploaded') deny('Untrusted or incomplete release asset metadata');
  if (x.digest !== undefined && x.digest !== null && typeof x.digest !== 'string') {
    deny('Unexpected GitHub release asset digest format');
  }
  const digestText = typeof x.digest === 'string' ? x.digest : '';
  const digest = /^sha256:[a-fA-F0-9]{64}$/.test(digestText) ?
    digestText.slice(7).toLowerCase() : null;
  if (digest && !HEX.test(digest)) deny('Malformed GitHub release digest');
  return {
    releaseId, assetId: x.id, name: x.name, declaredBytes: x.size,
    publishedSha256: digest,
    digestStatus: digest ? 'SHA256_PUBLISHED_NOT_YET_BYTE_VERIFIED' :
      'NO_SUPPORTED_SHA256_PUBLISHED_UNVERIFIED',
    bytesPreservedLocally: false, assetContentVerified: false,
  };
}
/**
 * Explicit online enumeration of published release metadata for one public repo.
 * Always checks the overflow page for releases and assets when a page is full.
 * Does not follow pagination links supplied by remote JSON/headers.
 * An absent digest is explicitly unverified, never an empty/checksum-success value.
 */
export async function inventoryPublicReleaseAssets(catalog, name, fetcher = fetch) {
  validateCatalog(catalog, name);
  const prefix = BASE + name + '/releases';
  const first = await requestJSON(prefix + '?per_page=20&page=1', fetcher);
  if (first.length > MAX_RELEASES) deny('Releases exceeded page cap');
  if (first.length === MAX_RELEASES) {
    const next = await requestJSON(prefix + '?per_page=20&page=2', fetcher);
    if (next.length !== 0) deny('More than 20 public releases; no partial inventory emitted');
  }
  const seenReleases = new Set(), seenTags = new Set(), seenAssets = new Set();
  const releases = [];
  let totalAssets = 0, totalBytes = 0;
  for (const rawRelease of first) {
    const release = releaseRecord(rawRelease);
    if (seenReleases.has(release.releaseId) || seenTags.has(release.tag)) {
      deny('Duplicate GitHub release ID or tag');
    }
    seenReleases.add(release.releaseId); seenTags.add(release.tag);
    const assetEndpoint = prefix + '/' + release.releaseId + '/assets';
    const fetched = await requestJSON(assetEndpoint + '?per_page=100&page=1', fetcher);
    if (fetched.length > MAX_ASSETS_PER_RELEASE) deny('Release assets exceed per-page cap');
    if (fetched.length === MAX_ASSETS_PER_RELEASE) {
      const overflow = await requestJSON(assetEndpoint + '?per_page=100&page=2', fetcher);
      if (overflow.length !== 0) deny('More than 100 assets on release; no partial inventory emitted');
    }
    const assets = fetched.map(x => assetRecord(x, release.releaseId));
    for (const a of assets) {
      if (seenAssets.has(a.assetId)) deny('Duplicate GitHub release asset ID');
      seenAssets.add(a.assetId);
      totalAssets++; totalBytes += a.declaredBytes;
      if (totalAssets > MAX_TOTAL_ASSETS || !Number.isSafeInteger(totalBytes)) {
        deny('Total public asset census exceeds bounded cap');
      }
    }
    assets.sort((a, b) => a.assetId - b.assetId);
    releases.push({ ...release, assetCount: assets.length, assets });
  }
  releases.sort((a, b) => a.releaseId - b.releaseId);
  const flattened = releases.flatMap(r => r.assets);
  const report = {
    schema: SCHEMA, owner: OWNER, repository: name,
    mode: 'EXPLICIT_ONLINE_PUBLIC_RELEASE_METADATA_ONLY',
    status: releases.length ? 'RELEASE_ASSET_METADATA_INVENTORIED_NOT_BACKED_UP' :
      'NO_PUBLISHED_RELEASES_OBSERVED_UNVERIFIED',
    summary: {
      publishedReleasesObserved: releases.length,
      assetsEnumerated: totalAssets, declaredAssetBytes: totalBytes,
      assetsWithPublishedSha256: flattened.filter(a => a.publishedSha256 !== null).length,
      assetsWithoutSupportedSha256: flattened.filter(a => a.publishedSha256 === null).length,
      locallyVerifiedAssetBytes: 0,
    },
    acceptance: {
      releaseAssetBytesArchived: false, releaseAssetBytesSHA256Verified: false,
      releaseMetadataAuthenticatedBeyondHTTPS: false,
      privateOrDraftReleasesCovered: false, GitHubActionsArtifactsCovered: false,
      offHostMediaVerified: false, disconnectedWanRestoreVerified: false,
      completePhiOSOfflineRecoveryVerified: false,
    },
    notice: 'Published public GitHub Releases only, within strict enumeration bounds. Metadata digests are claims, not checked bytes. No asset downloads, writes, execution, draft releases, tags without releases, Actions artifacts or physical backup verification. Unsigned manifest digest.',
    releases,
  };
  return { ...report, manifestSha256: digestOf(report) };
}
