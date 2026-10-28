import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { offlineRecoveryReadiness } from '../src/homenode-offline-readiness.mjs';
import { saveCatalog } from '../src/homenode-bridge.mjs';

const exec = promisify(execFile);
const SHA = 'a'.repeat(40);
const H = 'b'.repeat(64);
const catalog = () => ({
  schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
  visibility: 'PUBLIC_ONLY', count: 1,
  repositories: [{ name: 'PhiOS', eligible: true }],
});
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const coverage = () => ({
  schema: 'gitporch.public-backup-coverage.v0.1', catalogCount: 1,
  repositories: [{ name: 'PhiOS', backupStatus: 'VERIFIED_SNAPSHOT_MATCHES_LOCAL_REFS',
    verifiedBundleSha256: H }],
});
const lfs = () => ({
  schema: 'gitporch.local-lfs-recovery-manifest.v0.1', name: 'PhiOS', branch: 'main',
  pinnedCommit: SHA, status: 'ALL_DETECTED_TIP_LFS_BYTES_VERIFIED_ONLY',
  summary: { uniqueLfsObjects: 2, verifiedObjects: 2 }, manifestSha256: H,
});
const submodule = () => ({
  schema: 'gitporch.public-submodule-recovery-ledger.v0.1',
  parent: 'PhiOS', branch: 'main', pinnedCommit: SHA,
  status: 'ALL_DETECTED_TIP_GITLINK_COMMITS_LOCALLY_PRESENT_ONLY',
  summary: { gitlinks: 1, locallyVerifiedTargetCommits: 1 }, reportSha256: H,
});
const release = () => ({
  status: 'ALL_LISTED_ASSETS_SHA256_VERIFIED_ONLY', observedSatisfied: true,
  listed: 2, verified: 2, snapshotSha256: H,
});
function checks(override = {}) {
  return {
    coverage: async () => coverage(),
    lfs: async () => lfs(),
    submodule: async () => submodule(),
    release: async () => release(),
    tip: async () => SHA,
    ...override,
  };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r13-'));
  try {
    const f = { root, data: join(root, 'local-data'), backup: join(root, 'backups'),
      assets: join(root, 'lfs-assets'), releases: join(root, 'releases'),
      evidence: join(root, 'evidence') };
    await Promise.all([f.backup, f.assets, f.releases, f.evidence].map(p => mkdir(p)));
    return await fn(f);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const run = (f, c = checks()) => offlineRecoveryReadiness(catalog(), 'PhiOS', 'main',
  f.backup, f.assets, 'none', 'none', f.data, c);

test('four bounded local gates can pass while physical restore and offline boot ALWAYS remain unverified', async () => fixture(async f => {
  const result = await run(f);
  assert.equal(result.schema, 'gitporch.offline-readiness-evidence.v0.1');
  assert.equal(result.status, 'BOUNDED_LOCAL_EVIDENCE_PRESENT_NOT_OFFLINE_QUALIFIED');
  assert.equal(result.summary.localGateCount, 4);
  assert.equal(result.summary.passedLocalGates, 4);
  assert.equal(result.summary.boundedLocalEvidenceSatisfied, true);
  assert.equal(result.summary.offlineReady, false);
  assert.equal(result.gates.physicalDetachedRestore.status,
    'NOT_TESTED_REQUIRES_OPERATOR_AND_SEPARATE_MEDIA');
  assert.equal(result.gates.actualPhiOSOfflineLaunch.status, 'NOT_TESTED_REQUIRES_OPERATOR');
  assert.equal(result.gates.actualPhiOSOfflineLaunch.satisfiedForLocalScope, false);
  for (const flag of Object.values(result.acceptance)) assert.equal(flag, false);
  const again = await run(f);
  assert.equal(result.reportSha256, again.reportSha256);
  assert.match(result.reportSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(f.root), false);
}));

test('missing current-ref bundle, missing LFS and submodule commits and releases never yield local pass', async () => fixture(async f => {
  const bad = checks({
    coverage: async () => ({ ...coverage(), repositories: [{
      name: 'PhiOS', backupStatus: 'NO_SNAPSHOT_FOUND',
    }] }),
    lfs: async () => ({ ...lfs(), status: 'DETECTED_TIP_LFS_GAPS',
      summary: { uniqueLfsObjects: 2, verifiedObjects: 1 } }),
    submodule: async () => ({ ...submodule(), status: 'SUBMODULE_RECOVERY_GAPS',
      summary: { gitlinks: 1, locallyVerifiedTargetCommits: 0 } }),
    release: async () => ({
      status: 'RELEASE_ASSET_COVERAGE_GAPS', observedSatisfied: false, listed: 2, verified: 1,
    }),
  });
  const r = await run(f, bad);
  assert.equal(r.status, 'LOCAL_RECOVERY_EVIDENCE_GAPS');
  assert.equal(r.summary.passedLocalGates, 0);
  assert.equal(r.summary.offlineReady, false);
  assert.equal(r.gates.savedReleaseAssetBytes.satisfiedForLocalScope, false);
}));

test('no tip LFS pointers/gitlinks is limited local non-detection, not global recovery proof', async () => fixture(async f => {
  const c = checks({
    lfs: async () => ({ ...lfs(), status: 'NO_CANONICAL_TIP_LFS_POINTERS_DETECTED_UNVERIFIED',
      summary: { uniqueLfsObjects: 0, verifiedObjects: 0 } }),
    submodule: async () => ({ ...submodule(), status: 'NO_GITLINKS_AT_SELECTED_TIP_UNVERIFIED',
      summary: { gitlinks: 0, locallyVerifiedTargetCommits: 0 } }),
  });
  const r = await run(f, c);
  assert.equal(r.summary.noDetectedTipLfsObjects, true);
  assert.equal(r.summary.noDetectedTipSubmodules, true);
  assert.equal(r.gates.selectedTipLfs.status, 'NO_CANONICAL_TIP_LFS_POINTERS_DETECTED_UNVERIFIED');
  assert.equal(r.acceptance.allGitHistoryCovered, false);
  assert.equal(r.acceptance.nestedDependencyCoverageVerified, false);
  assert.equal(r.summary.offlineReady, false);
}));

test('release evidence not supplied is a blocking gate with explicit uncertainty', async () => fixture(async f => {
  const c = checks();
  delete c.release;
  const r = await run(f, c);
  assert.equal(r.status, 'LOCAL_RECOVERY_EVIDENCE_GAPS');
  assert.equal(r.gates.savedReleaseAssetBytes.status, 'NOT_SUPPLIED_UNVERIFIED');
  assert.equal(r.gates.savedReleaseAssetBytes.satisfiedForLocalScope, false);
  assert.equal(r.gates.savedReleaseAssetBytes.listed, null);
}));

test('release snapshot with actual SHA256 stored content can pass its bounded gate offline', async () => fixture(async f => {
  const bytes = Buffer.from('real content in offline release store');
  const oid = createHash('sha256').update(bytes).digest('hex');
  const releaseManifest = {
    schema: 'gitporch.public-release-asset-inventory.v0.1', owner: 'MichaelWave369',
    repository: 'PhiOS', mode: 'EXPLICIT_ONLINE_PUBLIC_RELEASE_METADATA_ONLY',
    status: 'RELEASE_ASSET_METADATA_INVENTORIED_NOT_BACKED_UP',
    releases: [{
      releaseId: 11, tag: 'v1', prerelease: false, publishedAt: '2026-10-28T18:00:00Z',
      assetCount: 1, assets: [{
        releaseId: 11, assetId: 99, name: 'PhiOS.zip',
        declaredBytes: bytes.length, publishedSha256: oid,
        digestStatus: 'SHA256_PUBLISHED_NOT_YET_BYTE_VERIFIED',
        bytesPreservedLocally: false, assetContentVerified: false,
      }],
    }],
  };
  releaseManifest.manifestSha256 = hash(releaseManifest);
  const manifest = join(f.evidence, 'release.json');
  await writeFile(manifest, JSON.stringify(releaseManifest));
  const saved = join(f.releases, 'releases', 'sha256', oid.slice(0, 2), oid);
  await mkdir(dirname(saved), { recursive: true });
  await writeFile(saved, bytes);
  const c = checks();
  delete c.release;
  const res = await offlineRecoveryReadiness(catalog(), 'PhiOS', 'main',
    f.backup, f.assets, manifest, f.releases, f.data, c);
  assert.equal(res.gates.savedReleaseAssetBytes.status, 'ALL_LISTED_ASSETS_SHA256_VERIFIED_ONLY');
  assert.equal(res.gates.savedReleaseAssetBytes.listed, 1);
  assert.equal(res.gates.savedReleaseAssetBytes.verified, 1);
  assert.equal(res.summary.offlineReady, false);
  await writeFile(saved, Buffer.alloc(bytes.length, 3));
  const damaged = await offlineRecoveryReadiness(catalog(), 'PhiOS', 'main',
    f.backup, f.assets, manifest, f.releases, f.data, c);
  assert.equal(damaged.gates.savedReleaseAssetBytes.status, 'RELEASE_ASSET_COVERAGE_GAPS');
  assert.equal(damaged.gates.savedReleaseAssetBytes.verified, 0);
  assert.equal(damaged.status, 'LOCAL_RECOVERY_EVIDENCE_GAPS');
}));

test('more than 16 listed release assets is an explicit blocked scope, never partial pass', async () => fixture(async f => {
  const inventory = {
    schema: 'gitporch.public-release-asset-inventory.v0.1', owner: 'MichaelWave369',
    repository: 'PhiOS', releases: [{
      releaseId: 9, assets: Array.from({ length: 17 }, (_, i) => ({
        assetId: i + 1, declaredBytes: 4, publishedSha256: 'b'.repeat(64),
      })),
    }],
  };
  inventory.manifestSha256 = hash(inventory);
  const path = join(f.evidence, 'many.json');
  await writeFile(path, JSON.stringify(inventory));
  const c = checks(); delete c.release;
  const r = await offlineRecoveryReadiness(catalog(), 'PhiOS', 'main',
    f.backup, f.assets, path, f.releases, f.data, c);
  assert.equal(r.gates.savedReleaseAssetBytes.status, 'OVER_16_ASSETS_UNVERIFIED');
  assert.equal(r.gates.savedReleaseAssetBytes.listed, 17);
  assert.equal(r.summary.offlineReady, false);
}));

test('cross-rung pinned commit disagreement and moving source are rejected, not partially green', async () => fixture(async f => {
  await assert.rejects(run(f, checks({
    submodule: async () => ({ ...submodule(), pinnedCommit: 'c'.repeat(40) }),
  })), /inconsistent or unpinned/);
  await assert.rejects(run(f, checks({ tip: async () => 'd'.repeat(40) })),
    /moved during readiness/);
  await assert.rejects(run(f, checks({
    coverage: async () => ({ ...coverage(), catalogCount: 999 }),
  })), /Unexpected R0.5/);
}));

test('private/foreign/duplicated catalogs and invalid arguments rejected before reading reports', async () => fixture(async f => {
  for (const bad of [
    { ...catalog(), visibility: 'PRIVATE' },
    { ...catalog(), owner: 'Other' },
    { ...catalog(), count: 0 },
    { ...catalog(), count: 2, repositories: [
      ...catalog().repositories, ...catalog().repositories,
    ] },
  ]) {
    await assert.rejects(offlineRecoveryReadiness(bad, 'PhiOS', 'main',
      f.backup, f.assets, 'none', 'none', f.data, checks()));
  }
  await assert.rejects(offlineRecoveryReadiness(catalog(), 'PhiOS', '../main',
    f.backup, f.assets, 'none', 'none', f.data, checks()));
  await assert.rejects(offlineRecoveryReadiness(catalog(), 'PhiOS', 'main',
    f.backup, f.assets, 'none', f.releases, f.data, checks()));
}));

test('CLI refuses absent parameters and exposes safe help without contacting GitHub', async () => fixture(async f => {
  const catalogFile = await saveCatalog(catalog(), f.evidence);
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const env = { ...process.env, GITPORCH_DATA_DIR: f.data };
  await assert.rejects(exec(process.execPath, [
    cli, 'offline-readiness', catalogFile.path, 'PhiOS', 'main',
    f.backup, f.assets, 'none',
  ], { env }), e => e.code === 1 && /Invalid arguments/.test(e.stderr));
  const h = (await exec(process.execPath, [cli, '--help'], { env })).stdout;
  assert.match(h, /offline-readiness/);
  assert.deepEqual((await readdir(f.evidence)).length, 1);
}));
