// PhiOS R0.13: offline evidence composition. Observations are NOT a physical restore.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, resolve } from 'node:path';
import { getDataDir } from './git.mjs';
import { publicBackupCoverage } from './homenode-backup-coverage.mjs';
import { auditLfsRecoveryManifest } from './homenode-lfs-manifest.mjs';
import { auditSubmoduleRecovery } from './homenode-submodule-ledger.mjs';
import { loadSavedReleaseInventory, verifyReleaseAssetArchive } from './homenode-release-archive.mjs';
import { offlineRestoreGitEnv } from './homenode-restore-drill.mjs';

const exec = promisify(execFile);
const OWNER = 'MichaelWave369';
const SCHEMA = 'gitporch.offline-readiness-evidence.v0.1';
const MAX_RELEASE_OBJECTS = 16;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA = /^[a-f0-9]{64}$/;
function deny(message) { throw new Error(message); }
function hash(obj) { return createHash('sha256').update(JSON.stringify(obj)).digest('hex'); }
function safeBranch(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 100 &&
    /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(s) &&
    !s.endsWith('.') && !s.endsWith('/') && !s.endsWith('.lock') &&
    !s.includes('..') && !s.includes('//');
}
function scopedCatalog(c, name) {
  if (!c || c.owner !== OWNER || c.schema !== 'gitporch.public-catalog.v1' ||
      c.visibility !== 'PUBLIC_ONLY' || !Array.isArray(c.repositories) ||
      c.count !== c.repositories.length || c.count < 1 || c.count > 3000 ||
      typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
    deny('Exact-owner public-only catalog and name required');
  }
  const seen = new Set();
  for (const row of c.repositories) {
    if (!row || typeof row.name !== 'string' ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(row.name) ||
        typeof row.eligible !== 'boolean' || seen.has(row.name.toLowerCase())) {
      deny('Unsafe or duplicate public catalog entry');
    }
    seen.add(row.name.toLowerCase());
  }
  const selected = c.repositories.find(r => r.name === name && r.eligible);
  if (!selected) deny('Selected name is not eligible public catalog entry');
  return { schema: c.schema, owner: c.owner, visibility: c.visibility,
    count: 1, repositories: [selected] };
}
async function currentTip(name, branch, dataDir) {
  try {
    const { stdout } = await exec('git', [
      '--git-dir', join(resolve(dataDir), 'repos', name + '.git'),
      'rev-parse', '--verify', 'refs/heads/' + branch + '^{commit}',
    ], { env: offlineRestoreGitEnv(), timeout: 120000,
      windowsHide: true, maxBuffer: 4096 });
    const oid = stdout.trim();
    if (GIT_SHA.test(oid)) return oid;
  } catch { /* no network, fail closed */ }
  deny('Unable to pin local Git branch after evidence scan');
}
function verifyManifestFingerprint(m) {
  if (!m || m.schema !== 'gitporch.public-release-asset-inventory.v0.1' ||
      m.owner !== OWNER || !Array.isArray(m.releases) ||
      !SHA.test(m.manifestSha256 ?? '')) deny('Saved R0.11 release manifest is malformed');
  const { manifestSha256, ...rest } = m;
  if (hash(rest) !== manifestSha256) deny('Saved R0.11 manifest fingerprint mismatch');
}
async function releaseGate(catalog, name, releaseManifest, releaseStore, dataDir) {
  if (releaseManifest === 'none' && releaseStore === 'none') {
    return {
      status: 'NOT_SUPPLIED_UNVERIFIED', observedSatisfied: false,
      listed: null, verified: 0, missingOrUnverified: null,
      notice: 'No R0.11 release metadata snapshot supplied. Release asset coverage is unknown.',
    };
  }
  if (releaseManifest === 'none' || releaseStore === 'none') {
    deny('Release manifest and archive root must be supplied together or both be none');
  }
  const manifest = await loadSavedReleaseInventory(releaseManifest);
  verifyManifestFingerprint(manifest);
  if (manifest.repository !== name) deny('Release inventory does not belong to selected public repo');
  if (!Array.isArray(manifest.releases) || manifest.releases.length > 20) {
    deny('Release inventory has too many releases');
  }
  const listed = [];
  const seen = new Set();
  for (const release of manifest.releases) {
    if (!release || !Number.isSafeInteger(release.releaseId) || release.releaseId < 1 ||
        !Array.isArray(release.assets) || release.assets.length > 100) {
      deny('Untrusted R0.11 release record');
    }
    for (const asset of release.assets) {
      if (!asset || !Number.isSafeInteger(asset.assetId) || asset.assetId < 1 ||
          seen.has(asset.assetId)) deny('Untrusted or repeated release asset ID');
      seen.add(asset.assetId);
      listed.push({ releaseId: release.releaseId, assetId: asset.assetId,
        publishedSha256: asset.publishedSha256, bytes: asset.declaredBytes });
    }
  }
  if (listed.length > MAX_RELEASE_OBJECTS) {
    return {
      status: 'OVER_16_ASSETS_UNVERIFIED', observedSatisfied: false,
      listed: listed.length, verified: 0, missingOrUnverified: listed.length,
      notice: 'This bounded composition checks at most 16 release assets. No partial pass is allowed.',
    };
  }
  const objects = [];
  for (const row of listed) {
    if (!SHA.test(row.publishedSha256 ?? '') ||
        !Number.isSafeInteger(row.bytes) || row.bytes < 0 ||
        row.bytes > 64 * 1024 * 1024) {
      objects.push({ releaseId: row.releaseId, assetId: row.assetId,
        status: 'UNSUPPORTED_SHA_OR_SIZE_UNVERIFIED' });
      continue;
    }
    try {
      const proof = await verifyReleaseAssetArchive(catalog, releaseManifest, name,
        String(row.assetId), releaseStore, dataDir);
      objects.push({ releaseId: row.releaseId, assetId: row.assetId,
        status: proof.status });
    } catch {
      objects.push({ releaseId: row.releaseId, assetId: row.assetId,
        status: 'UNSAFE_OR_UNVERIFIED_LOCAL_RELEASE_OBJECT' });
    }
  }
  const verified = objects.filter(x =>
    x.status === 'LOCAL_RELEASE_BYTES_SHA256_VERIFIED_ONLY').length;
  return {
    status: !listed.length ? 'NO_ASSETS_LISTED_IN_SAVED_SNAPSHOT_UNVERIFIED' :
      verified === listed.length ? 'ALL_LISTED_ASSETS_SHA256_VERIFIED_ONLY' :
        'RELEASE_ASSET_COVERAGE_GAPS',
    observedSatisfied: listed.length > 0 && verified === listed.length,
    listed: listed.length, verified, missingOrUnverified: listed.length - verified,
    snapshotSha256: manifest.manifestSha256, objects,
    notice: 'Offline comparison to a saved unsigned R0.11 inventory. GitHub source freshness, deleted releases and release publisher identity remain unknown.',
  };
}
/**
 * Composes existing R0.5/0.9/0.10/0.12 checks for one public repo.
 * The backup verifier may create temporary Git clones (removed by itself);
 * no network, no changes to source repositories, backups, or asset stores.
 */
export async function offlineRecoveryReadiness(
  catalog, name, branch, backupRoot, lfsRoot, releaseManifest, releaseStore,
  dataDir = getDataDir(), checks = {},
) {
  const selected = scopedCatalog(catalog, name);
  if ((releaseManifest === 'none') !== (releaseStore === 'none')) {
    deny('Release inventory and archive root must be supplied together or both be none');
  }
  if (!safeBranch(branch)) deny('Unsafe branch');
  for (const [label, path] of [['backupRoot', backupRoot], ['lfsRoot', lfsRoot]]) {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      deny(label + ' must be an existing absolute path');
    }
  }
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) {
    deny('Absolute local GitPorch data directory required');
  }
  const coverage = await (checks.coverage ?? publicBackupCoverage)(selected, backupRoot, dataDir);
  const gitRow = coverage.repositories?.find(r => r.name === name);
  if (coverage.schema !== 'gitporch.public-backup-coverage.v0.1' ||
      coverage.catalogCount !== 1 || coverage.repositories?.length !== 1 ||
      !gitRow) deny('Unexpected R0.5 backup coverage evidence');
  const lfs = await (checks.lfs ?? auditLfsRecoveryManifest)(catalog, name, branch, lfsRoot, dataDir);
  const sub = await (checks.submodule ?? auditSubmoduleRecovery)(catalog, name, branch, dataDir);
  if (lfs.schema !== 'gitporch.local-lfs-recovery-manifest.v0.1' ||
      sub.schema !== 'gitporch.public-submodule-recovery-ledger.v0.1' ||
      lfs.name !== name || sub.parent !== name ||
      lfs.branch !== branch || sub.branch !== branch ||
      !GIT_SHA.test(lfs.pinnedCommit) || sub.pinnedCommit !== lfs.pinnedCommit) {
    deny('Composed Git/LFS/submodule evidence is inconsistent or unpinned');
  }
  const release = await (checks.release ?? releaseGate)(
    catalog, name, releaseManifest, releaseStore, dataDir);
  const after = await (checks.tip ?? currentTip)(name, branch, dataDir);
  if (after !== lfs.pinnedCommit) deny('Local public branch moved during readiness check; discard report');

  const gates = {
    currentGitBundle: {
      status: gitRow.backupStatus,
      satisfiedForLocalScope: gitRow.backupStatus === 'VERIFIED_SNAPSHOT_MATCHES_LOCAL_REFS',
      verifiedBundleSha256: gitRow.verifiedBundleSha256 ?? null,
    },
    selectedTipLfs: {
      status: lfs.status,
      satisfiedForLocalScope: lfs.status === 'ALL_DETECTED_TIP_LFS_BYTES_VERIFIED_ONLY' ||
        lfs.status === 'NO_CANONICAL_TIP_LFS_POINTERS_DETECTED_UNVERIFIED',
      found: lfs.summary.uniqueLfsObjects, verified: lfs.summary.verifiedObjects,
      evidenceSha256: lfs.manifestSha256,
    },
    selectedTipSubmodules: {
      status: sub.status,
      satisfiedForLocalScope: sub.status === 'ALL_DETECTED_TIP_GITLINK_COMMITS_LOCALLY_PRESENT_ONLY' ||
        sub.status === 'NO_GITLINKS_AT_SELECTED_TIP_UNVERIFIED',
      found: sub.summary.gitlinks,
      locallyAvailable: sub.summary.locallyVerifiedTargetCommits,
      evidenceSha256: sub.reportSha256,
    },
    savedReleaseAssetBytes: {
      status: release.status, satisfiedForLocalScope: release.observedSatisfied,
      listed: release.listed, verified: release.verified,
      snapshotSha256: release.snapshotSha256 ?? null,
    },
    physicalDetachedRestore: {
      status: 'NOT_TESTED_REQUIRES_OPERATOR_AND_SEPARATE_MEDIA',
      satisfiedForLocalScope: false,
    },
    actualPhiOSOfflineLaunch: {
      status: 'NOT_TESTED_REQUIRES_OPERATOR',
      satisfiedForLocalScope: false,
    },
  };
  const localScopes = ['currentGitBundle', 'selectedTipLfs',
    'selectedTipSubmodules', 'savedReleaseAssetBytes'];
  const boundedLocalEvidenceSatisfied = localScopes.every(k => gates[k].satisfiedForLocalScope);
  const report = {
    schema: SCHEMA, owner: OWNER, name, branch, pinnedCommit: lfs.pinnedCommit,
    mode: 'NO_NETWORK_BOUNDED_LOCAL_RECOVERY_EVIDENCE',
    status: boundedLocalEvidenceSatisfied ?
      'BOUNDED_LOCAL_EVIDENCE_PRESENT_NOT_OFFLINE_QUALIFIED' :
      'LOCAL_RECOVERY_EVIDENCE_GAPS',
    summary: {
      boundedLocalEvidenceSatisfied,
      passedLocalGates: localScopes.filter(k => gates[k].satisfiedForLocalScope).length,
      localGateCount: localScopes.length,
      noDetectedTipLfsObjects: lfs.summary.uniqueLfsObjects === 0,
      noDetectedTipSubmodules: sub.summary.gitlinks === 0,
      offlineReady: false,
    },
    gates,
    acceptance: {
      allGitHistoryCovered: false, sourceGitHubParityVerified: false,
      allReleaseHistoryCovered: false, nestedDependencyCoverageVerified: false,
      offHostPhysicalRestoreVerified: false, wanDisconnectedVerified: false,
      PhiOSOfflineBootVerified: false, completeEcosystemOfflineReady: false,
    },
    notice: 'Only the selected branch tip, current local Git refs, and saved public release snapshot are checked. Bundle verification uses cleaned-up temporary local Git clones. No network, automatic download, binary execution, source/backup writes or physical restoration. Even all four local gates passing is NOT an offline PhiOS boot certification.',
  };
  return { ...report, reportSha256: hash(report) };
}
