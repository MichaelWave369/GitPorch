// PhiOS R0.9: repeatable, offline, read-only LFS recovery coverage manifest.
// Reports only a single selected public branch tip, never all Git history.
// No network, no LFS smudge, no Git hooks, no downloads, no source/asset writes.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getDataDir, validSlug } from './git.mjs';
import { auditPublicMirrors } from './homenode-mirror-audit.mjs';
import { offlineRestoreGitEnv } from './homenode-restore-drill.mjs';

const exec = promisify(execFile);
const OWNER = 'MichaelWave369';
const SCHEMA = 'gitporch.local-lfs-recovery-manifest.v0.1';
const SHA = /^[0-9a-f]{64}$/;
const GIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_TREE_ENTRIES = 30000;
const MAX_CANDIDATES = 256;
const MAX_OBJECTS = 64;
const MAX_ATTRIBUTES = 64;
const MAX_POINTER_BYTES = 512;
const MAX_INSPECTION_BYTES = 256 * 1024 * 1024;
const PILOT_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const LFS_HEADER = 'version https://git-lfs.github.com/spec/v1';
function deny(text) { throw new Error(text); }
function canonical(path) {
  const p = resolve(path);
  return process.platform === 'win32' ? p.toLowerCase() : p;
}
function within(parent, child) {
  const r = relative(canonical(parent), canonical(child));
  return !r || (!r.startsWith('..') && !isAbsolute(r));
}
async function statOrNull(path) {
  try { return await lstat(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
async function realDirectory(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path)) deny(label + ' must be an existing absolute directory');
  const p = resolve(path);
  const st = await lstat(p);
  if (!st.isDirectory() || st.isSymbolicLink() || canonical(await realpath(p)) !== canonical(p)) {
    deny(label + ' must have no symlink or redirected parent');
  }
  return p;
}
function validBranch(branch) {
  return typeof branch === 'string' && branch.length <= 100 &&
    /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(branch) &&
    !branch.endsWith('/') && !branch.endsWith('.') &&
    !branch.endsWith('.lock') && !branch.includes('..') && !branch.includes('//');
}
function validTrackedPath(p) {
  return typeof p === 'string' && p.length <= 240 && p.split('/').length <= 20 &&
    p.split('/').every(part => part.length && part !== '.' && part !== '..' &&
      /^[A-Za-z0-9._-]+$/.test(part));
}
function publicEntry(catalog, name) {
  if (!catalog || catalog.schema !== 'gitporch.public-catalog.v1' ||
      catalog.owner !== OWNER || catalog.visibility !== 'PUBLIC_ONLY' ||
      !Array.isArray(catalog.repositories) ||
      !Number.isSafeInteger(catalog.count) ||
      catalog.count !== catalog.repositories.length || catalog.count < 1 || catalog.count > 3000 ||
      !validSlug(name)) deny('R0.9 requires exact-owner PUBLIC_ONLY GitPorch catalog');
  const seen = new Set();
  let selected = null;
  for (const row of catalog.repositories) {
    if (!row || typeof row.name !== 'string' ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(row.name) ||
        typeof row.eligible !== 'boolean' ||
        seen.has(row.name.toLowerCase())) deny('Malformed or duplicate public catalog entry');
    seen.add(row.name.toLowerCase());
    if (row.name === name && row.eligible) selected = row;
  }
  if (!selected) deny('Selected repo absent or unsupported in public catalog');
  return selected;
}
async function gitLocal(args, maxBuffer = 1024 * 1024, allowNoMatches = false) {
  try {
    const { stdout } = await exec('git', args, {
      env: offlineRestoreGitEnv(), windowsHide: true, timeout: 120000, maxBuffer,
    });
    return stdout;
  } catch (error) {
    if (allowNoMatches && error?.code === 1 && !error?.stderr) return '';
    deny('Offline Git branch-tip inspection failed or exceeded its safety cap');
  }
}
function parseTree(output) {
  const map = new Map();
  for (const line of output.split('\0')) {
    if (!line) continue;
    const split = line.indexOf('\t');
    if (split < 0) deny('Malformed pinned Git tree');
    const parts = line.slice(0, split).split(' ');
    const path = line.slice(split + 1);
    if (parts.length !== 3 || !/^(100644|100755|120000|160000)$/.test(parts[0]) ||
        !GIT_SHA.test(parts[2]) || !path || map.has(path)) deny('Unrecognized tracked Git tree entry');
    map.set(path, { mode: parts[0], type: parts[1], oid: parts[2] });
    if (map.size > MAX_TREE_ENTRIES) deny('Git tree exceeds maximum bounded entries');
  }
  return map;
}
function parsePointer(source) {
  if (source.length > MAX_POINTER_BYTES) deny('Git LFS pointer exceeds bounded size');
  const lines = source.replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines.length !== 3 || lines[0] !== LFS_HEADER ||
      !/^oid sha256:[0-9a-f]{64}$/.test(lines[1]) ||
      !/^size (?:0|[1-9][0-9]{0,15})$/.test(lines[2])) {
    deny('Malformed candidate LFS pointer; manifest incomplete');
  }
  const bytes = Number(lines[2].slice(5));
  if (!Number.isSafeInteger(bytes)) deny('Unbounded LFS pointer byte declaration');
  return { oid: lines[1].slice(11), bytes };
}
function digestJSON(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
async function hashFile(path) {
  const h = createHash('sha256');
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest('hex');
}
async function oneStoredObject(root, record) {
  let p = root;
  for (const name of ['objects', 'sha256', record.oid.slice(0, 2)]) {
    p = join(p, name);
    const st = await statOrNull(p);
    if (!st) return 'NOT_STORED';
    if (!st.isDirectory() || st.isSymbolicLink() ||
        canonical(await realpath(p)) !== canonical(p)) return 'UNSAFE_OR_CORRUPT_LOCAL_OBJECT';
  }
  const file = join(p, record.oid);
  const st = await statOrNull(file);
  if (!st) return 'NOT_STORED';
  if (!st.isFile() || st.isSymbolicLink() ||
      canonical(await realpath(file)) !== canonical(file) ||
      st.size !== record.bytes) return 'UNSAFE_OR_CORRUPT_LOCAL_OBJECT';
  return (await hashFile(file)) === record.oid ?
    'LOCAL_LFS_BYTES_VERIFIED_ONLY' : 'UNSAFE_OR_CORRUPT_LOCAL_OBJECT';
}

/**
 * Output is a SHA-256 fingerprinted, unsigned report to stdout.
 * The object list is bounded; files, refs and the object store are never written.
 */
export async function auditLfsRecoveryManifest(
  catalog, name, branch, assetRoot, dataDir = getDataDir(),
) {
  const entry = publicEntry(catalog, name);
  if (!validBranch(branch)) deny('Invalid selected Git branch');
  const root = await realDirectory(assetRoot, 'Asset root');
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) deny('GitPorch local store must be absolute');
  const dataPath = resolve(dataDir);
  if (within(dataPath, root) || within(root, dataPath)) {
    deny('Asset store must be outside live GitPorch data tree');
  }
  const audit = await auditPublicMirrors({
    schema: 'gitporch.public-catalog.v1',
    owner: OWNER, visibility: 'PUBLIC_ONLY', count: 1, repositories: [entry],
  }, dataPath);
  if (audit.repositories[0].status !== 'LOCAL_GIT_OBJECTS_VERIFIED_ONLY') {
    deny('Selected local bare Git mirror has not passed R0.2 integrity verification');
  }

  const base = ['--git-dir', join(dataPath, 'repos', name + '.git')];
  const pinned = (await gitLocal([...base, 'rev-parse', '--verify',
    'refs/heads/' + branch + '^{commit}'])).trim();
  if (!GIT_SHA.test(pinned)) deny('Selected branch tip did not resolve to a valid commit');
  const tree = parseTree(await gitLocal([...base, 'ls-tree', '-r', '-z', pinned], 4 * 1024 * 1024));
  const attrs = [...tree].filter(([path, item]) =>
    item.type === 'blob' && (path === '.gitattributes' || path.endsWith('/.gitattributes')));
  if (attrs.length > MAX_ATTRIBUTES) deny('Too many LFS attribute files for bounded inspection');
  let lfsAttributeDeclared = false;
  for (const [path, item] of attrs) {
    if (!validTrackedPath(path)) deny('Unsupported Git attributes path');
    const sz = Number((await gitLocal([...base, 'cat-file', '-s', item.oid])).trim());
    if (!Number.isSafeInteger(sz) || sz > 32768) deny('Oversized attributes file; manifest incomplete');
    const source = await gitLocal([...base, 'cat-file', 'blob', item.oid], 32768);
    if (/(?:^|\s)filter=lfs(?:\s|$)/m.test(source)) lfsAttributeDeclared = true;
  }

  // Git grep searches the pinned tree for an exact Git LFS header. Fail closed
  // on grep failure/size cap or malformed header-bearing blobs.
  const matches = (await gitLocal([...base, 'grep', '-l', '-z', '-I',
    '-e', '^version https://git-lfs.github.com/spec/v1$', pinned, '--'],
    256 * 1024, true)).split('\0').filter(Boolean);
  if (matches.length > MAX_CANDIDATES) deny('Too many candidate LFS pointers; no partial manifest emitted');

  const objects = new Map();
  let pointersDetected = 0;
  for (const match of matches) {
    if (!match.startsWith(pinned + ':')) deny('Unrecognized Git pointer match');
    const path = match.slice(pinned.length + 1);
    const item = tree.get(path);
    if (!item || item.type !== 'blob' || !/^(100644|100755)$/.test(item.mode) ||
        !validTrackedPath(path)) deny('Unsafe tracked path or non-regular LFS pointer');
    const size = Number((await gitLocal([...base, 'cat-file', '-s', item.oid])).trim());
    if (!Number.isSafeInteger(size) || size > MAX_POINTER_BYTES) {
      deny('Oversized LFS pointer blob; no partial manifest emitted');
    }
    const pointer = parsePointer(await gitLocal([...base, 'cat-file', 'blob', item.oid], 1024));
    const existing = objects.get(pointer.oid);
    if (existing && existing.bytes !== pointer.bytes) deny('Conflicting LFS sizes for same SHA-256');
    if (existing) existing.trackedPaths.push(path);
    else {
      objects.set(pointer.oid, { oid: pointer.oid, bytes: pointer.bytes, trackedPaths: [path] });
      if (objects.size > MAX_OBJECTS) deny('More than 64 unique LFS objects; no partial manifest emitted');
    }
    pointersDetected++;
  }
  const unique = [...objects.values()].sort((a, b) => a.oid.localeCompare(b.oid));
  const totalBytes = unique.reduce((n, o) => n + o.bytes, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_INSPECTION_BYTES) {
    deny('Selected pointer bytes exceed 256 MiB inspection budget; no partial manifest emitted');
  }
  const records = [];
  for (const entry of unique) {
    const status = await oneStoredObject(root, entry);
    records.push({
      oid: entry.oid, bytes: entry.bytes, trackedPaths: entry.trackedPaths.sort(),
      status, r08PilotDownloadEligible: entry.bytes <= PILOT_DOWNLOAD_BYTES,
    });
  }
  const pinnedAfter = (await gitLocal([...base, 'rev-parse', '--verify',
    'refs/heads/' + branch + '^{commit}'])).trim();
  if (pinnedAfter !== pinned) deny('Selected branch moved during audit; discard incomplete results');

  const summary = {
    treeEntries: tree.size,
    trackedLfsPointersDetected: pointersDetected,
    uniqueLfsObjects: records.length,
    declaredLfsBytes: totalBytes,
    verifiedObjects: records.filter(r => r.status === 'LOCAL_LFS_BYTES_VERIFIED_ONLY').length,
    missingObjects: records.filter(r => r.status === 'NOT_STORED').length,
    unsafeOrCorruptObjects: records.filter(r => r.status === 'UNSAFE_OR_CORRUPT_LOCAL_OBJECT').length,
    unsupportedR08DownloadSize: records.filter(r => !r.r08PilotDownloadEligible).length,
    allDetectedTipObjectsVerified: records.length > 0 &&
      records.every(r => r.status === 'LOCAL_LFS_BYTES_VERIFIED_ONLY'),
  };
  const manifest = {
    schema: SCHEMA, owner: OWNER, name, branch, pinnedCommit: pinned,
    mode: 'OFFLINE_READ_ONLY_SELECTED_BRANCH_TIP_LFS_MANIFEST',
    scope: {
      selectedBranchTipOnly: true, fullGitHistoryScanned: false,
      gitHubReleaseAssetsCovered: false, submoduleReposCovered: false,
      gitLfsFilterDeclaredAtTip: lfsAttributeDeclared,
      networkUsed: false, sourceOrAssetFilesWritten: false,
    },
    status: !records.length ? 'NO_CANONICAL_TIP_LFS_POINTERS_DETECTED_UNVERIFIED' :
      summary.allDetectedTipObjectsVerified ? 'ALL_DETECTED_TIP_LFS_BYTES_VERIFIED_ONLY' :
        'DETECTED_TIP_LFS_GAPS',
    summary,
    acceptance: {
      allGitHistoryLfsComplete: false, githubSourceParityVerified: false,
      sourceAuthenticityVerified: false, releaseAndSubmoduleAssetsPreserved: false,
      independentPhysicalMediaVerified: false, disconnectedWanRestoreVerified: false,
      completePhiOSOfflineRecoveryVerified: false,
    },
    notice: 'Bounded pinned-branch-tip canonical LFS pointer scan only. SHA-256 means local byte integrity, not source provenance, signed release authenticity or full Git history coverage. Report fingerprint is unsigned. No network or file writes.',
    objects: records,
  };
  return { ...manifest, manifestSha256: digestJSON(manifest) };
}
