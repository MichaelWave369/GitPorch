// PhiOS R0.5: operator-run public backup coverage. No backup writes, imports or sync.
// Existing bundle verification uses transient, deleted local Git clones in the OS temp area.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { getDataDir } from './git.mjs';
import { verifyBackup } from './homenode.mjs';
import { auditPublicMirrors } from './homenode-mirror-audit.mjs';

const OWNER = 'MichaelWave369';
const SCHEMA = 'gitporch.public-backup-coverage.v0.1';
const MAX_CANDIDATES = 2048;
const MAX_MANIFEST_BYTES = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function deny(message) { throw new Error(message); }
function pathKey(p) {
  const full = resolve(p);
  return process.platform === 'win32' ? full.toLowerCase() : full;
}
function within(parent, child) {
  const rel = relative(pathKey(parent), pathKey(child));
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}
async function realDir(path, name) {
  if (typeof path !== 'string' || !isAbsolute(path)) deny(name + ' must be an absolute existing directory');
  const full = resolve(path);
  const st = await lstat(full);
  if (!st.isDirectory() || st.isSymbolicLink() ||
      pathKey(await realpath(full)) !== pathKey(full)) {
    deny(name + ' must be a real directory without symlink parents');
  }
  return full;
}
function validateCatalog(catalog) {
  if (!catalog || catalog.owner !== OWNER || catalog.visibility !== 'PUBLIC_ONLY' ||
      catalog.schema !== 'gitporch.public-catalog.v1' ||
      !Array.isArray(catalog.repositories) || !Number.isSafeInteger(catalog.count) ||
      catalog.count !== catalog.repositories.length || catalog.count > 3000) {
    deny('Coverage requires an operator-provided exact-owner, public-only GitPorch catalog');
  }
  const names = new Set();
  for (const r of catalog.repositories) {
    if (!r || typeof r.name !== 'string' ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(r.name) ||
        names.has(r.name.toLowerCase())) deny('Unsupported or duplicate source name');
    names.add(r.name.toLowerCase());
  }
}
function refFingerprint(refs) {
  if (!Array.isArray(refs) || refs.length === 0) deny('Snapshot refs missing');
  const rows = refs.map(r => {
    if (!r || typeof r.name !== 'string' || typeof r.oid !== 'string' ||
        !r.name.startsWith('refs/') || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(r.oid)) {
      deny('Invalid snapshot ref record');
    }
    return r.name + '\t' + r.oid;
  }).sort();
  return createHash('sha256').update(rows.join('\n') + '\n', 'utf8').digest('hex');
}
async function inspectCandidate(directory, repoName, verifier) {
  try {
    const dirStat = await lstat(directory);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink() ||
        pathKey(await realpath(directory)) !== pathKey(directory)) return { valid: false };
    const manifest = join(directory, 'snapshot.json');
    const st = await lstat(manifest);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_MANIFEST_BYTES) {
      return { valid: false };
    }
    const result = await verifier(directory);
    if (result?.verified !== true || result.repository !== repoName ||
        typeof result.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(result.sha256)) {
      return { valid: false };
    }
    const m = JSON.parse(await readFile(manifest, 'utf8'));
    if (m.repository !== repoName || m.sha256 !== result.sha256 ||
        !Number.isSafeInteger(result.refs) || result.refs !== m.refs?.length) {
      return { valid: false };
    }
    return { valid: true, refsSha256: refFingerprint(m.refs), bundleSha256: result.sha256 };
  } catch {
    // Never leak filesystem paths or Git error output in coverage JSON.
    return { valid: false };
  }
}
async function boundedMap(items, fn, workers = 2) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  }));
  return out;
}

/**
 * Uses an existing public discovery catalog and existing HomeNode bundle snapshots.
 * Does not create/modify/delete sources or snapshots. Verifying each bundle
 * creates a temporary local Git clone which is removed by verifyBackup.
 */
export async function publicBackupCoverage(
  catalog, backupRoot, dataDir = getDataDir(), verifier = verifyBackup,
) {
  validateCatalog(catalog);
  const backupPath = await realDir(backupRoot, 'Backup root');
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) {
    deny('Local GitPorch data directory must be absolute');
  }
  try {
    const localRoot = await realpath(dataDir);
    if (within(localRoot, backupPath) || within(backupPath, localRoot)) {
      deny('Backup root must be outside the live GitPorch data tree');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const local = await auditPublicMirrors(catalog, dataDir);
  const publicByKey = new Map(catalog.repositories.map(r => [r.name.toLowerCase(), r.name]));
  const byRepo = new Map(catalog.repositories.map(r => [r.name, []]));
  const entries = await readdir(backupPath, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    // Only inspect canonical HomeNode snapshot names for explicitly public sources.
    const match = /^gitporch-(.+)-([0-9a-f-]{36})$/i.exec(entry.name);
    if (!match || !UUID.test(match[2])) continue;
    const repo = publicByKey.get(match[1].toLowerCase());
    if (!repo || match[1] !== repo) continue;
    candidates.push({ repo, path: join(backupPath, entry.name), safe: entry.isDirectory() && !entry.isSymbolicLink() });
    if (candidates.length > MAX_CANDIDATES) {
      deny('Too many public backup candidates; refuse incomplete coverage result');
    }
  }
  const examined = await boundedMap(candidates, async c => ({
    name: c.repo, result: c.safe ? await inspectCandidate(c.path, c.repo, verifier) : { valid: false },
  }));
  for (const item of examined) byRepo.get(item.name).push(item.result);
  const report = catalog.repositories.map((row, i) => {
    const mirrors = local.repositories[i];
    if (mirrors.name !== row.name) deny('Local audit ordering disagrees with public catalog');
    const snapshots = byRepo.get(row.name);
    const valid = snapshots.filter(s => s.valid);
    let backupStatus;
    let supporting = null;
    if (!snapshots.length) backupStatus = 'NO_SNAPSHOT_FOUND';
    else if (!valid.length) backupStatus = 'SNAPSHOT_CANDIDATES_INVALID';
    else if (mirrors.status !== 'LOCAL_GIT_OBJECTS_VERIFIED_ONLY') {
      backupStatus = 'VERIFIED_SNAPSHOT_LOCAL_COMPARISON_UNAVAILABLE';
      supporting = valid[0];
    } else {
      supporting = valid.find(s => s.refsSha256 === mirrors.refsSha256);
      if (supporting) backupStatus = 'VERIFIED_SNAPSHOT_MATCHES_LOCAL_REFS';
      else {
        backupStatus = 'VERIFIED_SNAPSHOT_REFS_DIFFER_FROM_LOCAL';
        supporting = valid[0];
      }
    }
    return {
      name: row.name, mirrorStatus: mirrors.status, backupStatus,
      examinedSnapshots: snapshots.length, verifiedSnapshots: valid.length,
      ...(supporting ? { verifiedBundleSha256: supporting.bundleSha256,
        snapshotRefsSha256: supporting.refsSha256 } : {}),
    };
  });
  const summary = {
    totalPublic: report.length,
    locallyVerifiedGitObjects: local.summary.objectsVerifiedOnly,
    backedUpCurrentRefs: report.filter(r => r.backupStatus === 'VERIFIED_SNAPSHOT_MATCHES_LOCAL_REFS').length,
    verifiedButNoLocalComparison: report.filter(r => r.backupStatus === 'VERIFIED_SNAPSHOT_LOCAL_COMPARISON_UNAVAILABLE').length,
    verifiedButRefsChanged: report.filter(r => r.backupStatus === 'VERIFIED_SNAPSHOT_REFS_DIFFER_FROM_LOCAL').length,
    noSnapshot: report.filter(r => r.backupStatus === 'NO_SNAPSHOT_FOUND').length,
    invalidSnapshotOnly: report.filter(r => r.backupStatus === 'SNAPSHOT_CANDIDATES_INVALID').length,
    examinedSnapshots: candidates.length,
  };
  return {
    schema: SCHEMA, mode: 'OFFLINE_PUBLIC_BACKUP_COVERAGE_AUDIT',
    owner: OWNER, catalogCount: catalog.count, summary,
    acceptance: {
      physicallyIndependentDiskVerified: false, wanDisconnectedTested: false,
      offHostRestored: false, remoteGitHubParityVerified: false,
      lfsAndExternalAssetsPreserved: false, phiosBootVerified: false,
      fullOfflineReady: false,
    },
    notice: 'Local Git bundle verification uses temporary Git clones, cleaned after each check. No source or backup mutation. A matching ref fingerprint establishes only local snapshot coverage at audit time; it is not authenticated source provenance, independent media, or completed physical recovery.',
    repositories: report,
  };
}
