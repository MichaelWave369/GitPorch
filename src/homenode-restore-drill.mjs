// PhiOS R0.4: deliberate offline Git bundle recovery into a separate directory.
// Writes a NEW, isolated bare repository. No GitHub, server, import, push or overwrite.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { devNull } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getDataDir, validSlug } from './git.mjs';

const exec = promisify(execFile);
const SCHEMA = 'gitporch.homenode.snapshot.v1';
const RECEIPT = 'gitporch.offline-restore-drill.v0.1';
const BUNDLE = 'repository.bundle';
const MANIFEST = 'snapshot.json';
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_REFS = 100_000;
const MAX_DURATION_MS = 180_000;
const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const EXPECTED_KEYS = [
  'schema', 'repository', 'createdAt', 'bundle', 'bytes', 'sha256', 'refs', 'scope',
].sort();
const SAFE_ENV = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
  'COMSPEC', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TMP',
  'TEMP', 'TMPDIR',
];
function fail(message) { throw new Error(message); }
function key(path) { return process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path); }
function contained(parent, child) {
  const rel = relative(key(parent), key(child));
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}
async function realDirectory(path, label) {
  if (!path || typeof path !== 'string' || !isAbsolute(path)) fail(label + ' requires an absolute path');
  const canonical = resolve(path);
  const st = await lstat(canonical);
  if (!st.isDirectory() || st.isSymbolicLink() || key(await realpath(canonical)) !== key(canonical)) {
    fail(label + ' must be a non-symlink, existing directory without redirected parents');
  }
  return canonical;
}
async function fileStat(path, label) {
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink()) fail(label + ' must be a regular file');
  return st;
}
async function sha256File(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}
function offlineEnv() {
  const env = Object.fromEntries(SAFE_ENV.filter(k => process.env[k] !== undefined)
    .map(k => [k, process.env[k]]));
  return {
    ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull, GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1',
    GIT_ALLOW_PROTOCOL: 'file', GIT_PROTOCOL_FROM_USER: '0',
    GIT_OPTIONAL_LOCKS: '0', GIT_LFS_SKIP_SMUDGE: '1',
  };
}
async function gitOffline(args) {
  const { stdout } = await exec('git', args, {
    env: offlineEnv(), timeout: MAX_DURATION_MS, windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trimEnd();
}
function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m) ||
      JSON.stringify(Object.keys(m).sort()) !== JSON.stringify(EXPECTED_KEYS) ||
      m.schema !== SCHEMA || !validSlug(m.repository) || m.bundle !== BUNDLE ||
      typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt)) ||
      !Number.isSafeInteger(m.bytes) || m.bytes < 1 ||
      typeof m.sha256 !== 'string' || !SHA256.test(m.sha256) ||
      !Array.isArray(m.refs) || !m.refs.length || m.refs.length > MAX_REFS ||
      typeof m.scope !== 'string' || m.scope.length > 512) {
    fail('Snapshot manifest rejected');
  }
  const refs = [];
  const names = new Set();
  for (const r of m.refs) {
    if (!r || typeof r !== 'object' || Array.isArray(r) ||
        Object.keys(r).sort().join() !== 'name,oid' ||
        typeof r.name !== 'string' || !r.name.startsWith('refs/') ||
        typeof r.oid !== 'string' || !HEX.test(r.oid) || names.has(r.name)) {
      fail('Snapshot ref manifest rejected');
    }
    names.add(r.name);
    refs.push({ name: r.name, oid: r.oid });
  }
  refs.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return refs;
}
function parseGitRefs(output) {
  const refs = output.split('\n').filter(Boolean).map(line => {
    const parts = line.split('\t');
    if (parts.length !== 2 || !parts[0].startsWith('refs/') || !HEX.test(parts[1])) {
      fail('Restored repository refs rejected');
    }
    return { name: parts[0], oid: parts[1] };
  });
  return refs.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export async function restoreBundleDrill(snapshotDir, restoreParent, options = {}) {
  const src = await realDirectory(snapshotDir, 'Snapshot');
  const dest = await realDirectory(restoreParent, 'Restore parent');
  if (contained(src, dest) || contained(dest, src)) {
    fail('Restore target must be outside the snapshot tree');
  }
  const dataPath = options.dataDir ?? getDataDir();
  // Never restore into a live GitPorch data tree, even under an innocuous-looking name.
  try {
    const data = await realpath(dataPath);
    if (contained(data, dest) || contained(dest, data)) {
      fail('Restore target must be separate from the live GitPorch data directory');
    }
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  const manifestPath = join(src, MANIFEST);
  const bundlePath = join(src, BUNDLE);
  const manifestStat = await fileStat(manifestPath, 'Snapshot manifest');
  const bundleStat = await fileStat(bundlePath, 'Snapshot bundle');
  if (manifestStat.size > MAX_MANIFEST_BYTES) fail('Snapshot manifest exceeds size limit');
  const m = JSON.parse(await readFile(manifestPath, 'utf8'));
  const expectedRefs = validateManifest(m);
  if (bundleStat.size !== m.bytes || (await sha256File(bundlePath)) !== m.sha256) {
    fail('Snapshot bundle checksum or size mismatch');
  }
  const staging = await mkdtemp(join(dest, '.gitporch-restore-pending-'));
  let installed = false;
  let result;
  try {
    const restored = join(staging, 'restored.git');
    await gitOffline(['clone', '--mirror', '--', bundlePath, restored]);
    const bare = await gitOffline(['--git-dir', restored, 'rev-parse', '--is-bare-repository']);
    if (bare !== 'true') fail('Restored repository is not a bare Git repository');
    await gitOffline(['--git-dir', restored, 'fsck', '--full', '--strict', '--no-reflogs']);
    const actualRefs = parseGitRefs(await gitOffline([
      '--git-dir', restored, 'for-each-ref', '--format=%(refname)%09%(objectname)',
    ]));
    if (JSON.stringify(actualRefs) !== JSON.stringify(expectedRefs)) {
      fail('Restored refs do not match recorded snapshot manifest');
    }
    // A recovery must be self-contained. Never retain a reference to the
    // original backup bundle on a removable disk as a live fetch remote.
    await gitOffline(['--git-dir', restored, 'config', '--remove-section', 'remote.origin']);
    if ((await sha256File(bundlePath)) !== m.sha256) {
      fail('Snapshot changed during restore drill');
    }
    const final = join(dest, 'gitporch-restored-' + m.repository + '-' + randomUUID() + '.git');
    // UUID-based destination and explicit no-existing-entry guard. The
    // destination is operator-trusted, not an adversarial concurrent writer.
    const siblings = await readdir(dest);
    if (siblings.some(name => name.toLowerCase() === final.slice(dest.length + 1).toLowerCase())) {
      fail('Restore destination already exists');
    }
    await rename(restored, final);
    installed = true;
    result = {
      schema: RECEIPT, repository: m.repository,
      status: 'LOCAL_RESTORE_DRILL_VERIFIED_ONLY',
      restoredBareRepository: final,
      bundleSha256: m.sha256, refCount: actualRefs.length,
      refsSha256: createHash('sha256').update(JSON.stringify(actualRefs)).digest('hex'),
      evidence: {
        bundleChecksumVerified: true, independentLocalCloneVerified: true,
        gitFsckPassed: true, manifestRefsMatched: true,
        originDetached: true, offHostDeviceVerified: false,
        physicalWanDisconnectVerified: false, sourceAuthenticityVerified: false,
        lfsAndGitHubMetadataBackedUp: false, phiosBootVerified: false,
      },
      notice: 'Recovery into a separate, retained local bare Git directory, not a bootable OS, off-device attestation or complete ecosystem restore. This receipt is unsigned and remains on stdout only.',
    };
  } finally {
    // After a successful rename the staging parent is now empty.
    // On failure it contains only this invocation's temporary clone.
    await rm(staging, { recursive: true, force: true });
  }
  if (!installed) fail('Restore was not installed');
  return result;
}
