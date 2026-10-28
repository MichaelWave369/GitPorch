// PhiOS R0.15: no-network field evidence composition.
// Technical checks are recomputed; human observations are explicitly NOT verified.
// Never operates the network, executes restored code, or certifies PhiOS offline boot.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getDataDir, validSlug } from './git.mjs';
import { offlineRestoreGitEnv } from './homenode-restore-drill.mjs';
import { verifyPortableRecoveryKit } from './homenode-portable-kit.mjs';

const exec = promisify(execFile);
const SCHEMA = 'gitporch.offline-field-evidence.v0.1';
const OBS_SCHEMA = 'gitporch.operator-field-observations.v0.1';
const SHA = /^[0-9a-f]{64}$/;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_OBSERVATIONS_BYTES = 8 * 1024;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_REFS = 100000;
function deny(s) { throw new Error(s); }
function fingerprint(v) { return createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
function canonical(p) {
  const v = resolve(p);
  return process.platform === 'win32' ? v.toLowerCase() : v;
}
function within(parent, child) {
  const rel = relative(canonical(parent), canonical(child));
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}
async function kind(p) {
  try { return await lstat(p); }
  catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
}
async function realDir(path, name) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    deny(name + ' must be an existing absolute directory');
  }
  const p = resolve(path);
  const st = await lstat(p);
  if (!st.isDirectory() || st.isSymbolicLink() ||
      canonical(await realpath(p)) !== canonical(p)) {
    deny(name + ' is missing or has redirected components');
  }
  return p;
}
async function readSafeFile(p, label, cap) {
  if (typeof p !== 'string' || !isAbsolute(p)) deny(label + ' must be an absolute file');
  const path = resolve(p);
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() ||
      canonical(await realpath(path)) !== canonical(path) || st.size > cap) {
    deny(label + ' is not a bounded, non-symlink file');
  }
  return await readFile(path, 'utf8');
}
function safeDisplay(s, cap) {
  return typeof s === 'string' && s.length > 0 && s.length <= cap &&
    !/[\x00-\x1f\x7f]/.test(s);
}
function parseObservations(x) {
  if (!x || x.schema !== OBS_SCHEMA ||
      JSON.stringify(Object.keys(x).sort()) !== JSON.stringify([
        'componentLaunchOutcome', 'componentName', 'mediaLabel',
        'observedAt', 'operatorNotes', 'schema',
        'separatePhysicalDeviceObserved', 'wanDisconnectedObserved',
      ].sort()) ||
      typeof x.separatePhysicalDeviceObserved !== 'boolean' ||
      typeof x.wanDisconnectedObserved !== 'boolean' ||
      !['PASS', 'FAIL', 'NOT_RUN'].includes(x.componentLaunchOutcome) ||
      !safeDisplay(x.componentName, 100) ||
      !safeDisplay(x.mediaLabel, 80) ||
      typeof x.operatorNotes !== 'string' || x.operatorNotes.length > 500 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x.operatorNotes) ||
      typeof x.observedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(x.observedAt) ||
      !Number.isFinite(Date.parse(x.observedAt))) {
    deny('Malformed operator observations; use the exact R0.15 template');
  }
  return {
    observedAt: x.observedAt,
    mediaLabel: x.mediaLabel,
    separatePhysicalDeviceClaim: x.separatePhysicalDeviceObserved ?
      'OPERATOR_REPORTED_TRUE_NOT_INDEPENDENTLY_VERIFIED' :
      'NOT_REPORTED_OR_NEGATIVE',
    detachedWanClaim: x.wanDisconnectedObserved ?
      'OPERATOR_REPORTED_TRUE_NOT_INDEPENDENTLY_VERIFIED' :
      'NOT_REPORTED_OR_NEGATIVE',
    selectedComponent: x.componentName,
    launchClaim: x.componentLaunchOutcome === 'PASS' ?
      'OPERATOR_REPORTED_PASS_NOT_INDEPENDENTLY_VERIFIED' :
      x.componentLaunchOutcome === 'FAIL' ? 'OPERATOR_REPORTED_FAILURE' :
        'NOT_RUN',
    notes: x.operatorNotes,
  };
}
async function restoreCheck(repoPath, snapshot, dataDir, copiedKitRoot) {
  const restored = await realDir(repoPath, 'Restored bare repo');
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) {
    deny('GitPorch local data path must be absolute');
  }
  if (within(resolve(dataDir), restored) || within(restored, resolve(dataDir)) ||
      within(copiedKitRoot, restored) || within(restored, copiedKitRoot)) {
    deny('Restored bare repo must be separate from the kit and live GitPorch data');
  }
  for (const [name, type] of [
    ['HEAD', 'file'], ['config', 'file'], ['objects', 'directory'], ['refs', 'directory'],
  ]) {
    const p = join(restored, name), st = await kind(p);
    if (!st || st.isSymbolicLink() ||
        (type === 'file' ? !st.isFile() : !st.isDirectory()) ||
        canonical(await realpath(p)) !== canonical(p)) {
      deny('Restored bare repo has unsafe filesystem layout');
    }
  }
  if (await kind(join(restored, 'objects', 'info', 'alternates'))) {
    deny('Restored repo uses external alternate object storage');
  }
  const cfg = await readFile(join(restored, 'config'), 'utf8');
  if (cfg.length > 128 * 1024 ||
      /(?:\[\s*(?:remote|include|includeif|filter)\b|\b(?:promisor|partialclone|alternaterefscommand|fsmonitor)\b)/i.test(cfg)) {
    deny('Restored repo contains remote or unsafe object storage configuration');
  }
  const pack = await kind(join(restored, 'objects', 'pack'));
  if (pack) {
    if (!pack.isDirectory() || pack.isSymbolicLink()) deny('Unsafe pack directory');
    const entries = await readdir(join(restored, 'objects', 'pack'), { withFileTypes: true });
    if (entries.some(e => e.isSymbolicLink() || e.name.endsWith('.promisor'))) {
      deny('Unsupported promisor or redirected pack file');
    }
  }
  async function git(args, buffer = 2 * 1024 * 1024) {
    try {
      const { stdout } = await exec('git', ['--git-dir', restored, ...args], {
        env: offlineRestoreGitEnv(), timeout: 180000, maxBuffer: buffer, windowsHide: true,
      });
      return stdout.trimEnd();
    } catch { deny('Restored bare repository Git verification failed'); }
  }
  if ((await git(['rev-parse', '--is-bare-repository'])) !== 'true') {
    deny('Restore target is not a bare repository');
  }
  await git(['fsck', '--full', '--strict', '--no-reflogs']);
  const raw = await git(['for-each-ref', '--format=%(refname)%09%(objectname)'], 4 * 1024 * 1024);
  const rows = raw.split('\n').filter(Boolean).map(line => {
    const parts = line.split('\t');
    if (parts.length !== 2 || !parts[0].startsWith('refs/') ||
        /[\x00-\x1f\x7f]/.test(parts[0]) || !OID.test(parts[1])) {
      deny('Restored repo has malformed Git refs');
    }
    return { name: parts[0], oid: parts[1] };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (rows.length < 1 || rows.length > MAX_REFS) deny('Restored repo refs exceed bounded scope');
  const expected = snapshot.refs;
  if (!Array.isArray(expected) || expected.length !== rows.length ||
      expected.length > MAX_REFS || expected.some(r =>
        !r || typeof r.name !== 'string' || !r.name.startsWith('refs/') || !OID.test(r.oid))) {
    deny('Saved snapshot does not contain valid Git refs');
  }
  expected.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (JSON.stringify(rows) !== JSON.stringify(expected)) {
    deny('Restored bare repo ref OIDs differ from copied kit snapshot');
  }
  return {
    status: 'RESTORED_BARE_GIT_FSCK_AND_REFS_MATCH_COPIED_KIT',
    restoredRefs: rows.length,
    refsSha256: fingerprint(rows),
    remoteOriginAbsent: true,
    gitFsckPassed: true,
    gitRefParityWithCopiedSnapshot: true,
    gitHistoryOnly: true,
  };
}
/**
 * Rechecks copied kit bytes and retained restored bare repo, then associates
 * optional human observations. Never claims to have measured WAN or launch.
 */
export async function composeOfflineFieldEvidence(
  manifestFile, copiedKitRoot, restoredBareRepo, observationFile = 'none',
  dataDir = getDataDir(),
) {
  const root = await realDir(copiedKitRoot, 'Copied kit');
  const kit = await verifyPortableRecoveryKit(manifestFile, root);
  if (kit.status !== 'PORTABLE_KIT_BYTES_AND_GIT_BUNDLE_VERIFIED_ONLY' ||
      !SHA.test(kit.bundleSha256)) deny('Portable kit verification did not pass');
  const snapshotText = await readSafeFile(
    join(root, 'snapshot', 'snapshot.json'), 'Copied snapshot manifest', MAX_SNAPSHOT_BYTES);
  let snapshot;
  try { snapshot = JSON.parse(snapshotText); }
  catch { deny('Copied snapshot JSON invalid'); }
  if (snapshot.schema !== 'gitporch.homenode.snapshot.v1' ||
      !validSlug(snapshot.repository) || snapshot.repository !== kit.repository ||
      snapshot.sha256 !== kit.bundleSha256) {
    deny('Copied snapshot identity or bundle digest disagrees with verified kit');
  }
  const restored = await restoreCheck(restoredBareRepo, snapshot, dataDir, root);
  let operator = {
    status: 'NO_OPERATOR_OBSERVATIONS_SUPPLIED',
    observations: null,
  };
  if (observationFile !== 'none') {
    let parsed;
    try {
      parsed = JSON.parse(await readSafeFile(
        observationFile, 'Operator observation file', MAX_OBSERVATIONS_BYTES));
    } catch { deny('Operator observation JSON invalid or unsafe'); }
    operator = {
      status: 'UNSIGNED_OPERATOR_OBSERVATIONS_RECORDED_NOT_MEASURED',
      observations: parseObservations(parsed),
    };
  }
  const body = {
    schema: SCHEMA, repository: kit.repository,
    mode: 'OFFLINE_TECHNICAL_RECHECK_PLUS_UNVERIFIED_HUMAN_OBSERVATIONS',
    status: 'COPIED_KIT_AND_RESTORED_GIT_TECHNICALLY_RECHECKED_ONLY',
    kit: { manifestSha256: kit.manifestSha256, bundleSha256: kit.bundleSha256,
      fileCount: kit.summary.files, byteCount: kit.summary.bytes,
      status: kit.status },
    restoredGit: restored,
    operator,
    acceptance: {
      copiedKitByteEqualityVerified: true,
      copiedGitBundleCloneFsckVerified: true,
      restoredBareGitFsckAndRefsVerified: true,
      independentPhysicalMediaProvenByTool: false,
      wanDisconnectionMeasuredByTool: false,
      selectedComponentExecutionMeasuredByTool: false,
      externalObservationAuthenticated: false,
      releasePublisherProvenanceVerified: false,
      fullPhiOSOfflineBootVerified: false,
      allEcosystemDependenciesComplete: false,
      completeOfflineRecoveryVerified: false,
    },
    notice: 'Human statements are unsigned and NOT independent measurements. A valid copied kit and restored Git commit refs do not prove physical drive independence, actual WAN disconnection, runtime launch, publisher provenance, LFS completeness or full PhiOS recovery. This command neither executes code nor writes permanent files.',
  };
  return { ...body, reportSha256: fingerprint(body) };
}
