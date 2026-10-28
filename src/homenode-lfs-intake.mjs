// PhiOS R0.7: opt-in, one-object Git LFS byte preservation from a local file.
// Never downloads from GitHub, invokes Git LFS, runs source code, or overwrites.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, realpath, rm, unlink } from 'node:fs/promises';
import { devNull } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { getDataDir, validSlug } from './git.mjs';
import { auditPublicMirrors } from './homenode-mirror-audit.mjs';
import { offlineRestoreGitEnv } from './homenode-restore-drill.mjs';

const exec = promisify(execFile);
const OWNER = 'MichaelWave369';
const SCHEMA = 'gitporch.local-lfs-byte-plan.v0.1';
const MAX_BYTES = 64 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const POINTER_HEADER = 'version https://git-lfs.github.com/spec/v1';
function deny(reason) { throw new Error(reason); }
function key(p) { const x = resolve(p); return process.platform === 'win32' ? x.toLowerCase() : x; }
function within(parent, child) {
  const rel = relative(key(parent), key(child));
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}
async function kind(p) {
  try { return await lstat(p); }
  catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
}
async function realDir(p, label) {
  if (typeof p !== 'string' || !isAbsolute(p)) deny(label + ' must be an existing absolute directory');
  const full = resolve(p);
  const st = await lstat(full);
  if (!st.isDirectory() || st.isSymbolicLink() || key(await realpath(full)) !== key(full)) {
    deny(label + ' cannot be a symlink or redirected directory');
  }
  return full;
}
async function realFile(p, label) {
  if (typeof p !== 'string' || !isAbsolute(p)) deny(label + ' must be an absolute regular file');
  const full = resolve(p);
  const st = await lstat(full);
  if (!st.isFile() || st.isSymbolicLink() || key(await realpath(full)) !== key(full)) {
    deny(label + ' cannot be a symlink or redirected file');
  }
  return { full, st };
}
async function digestFile(p) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(p)) hash.update(chunk);
  return hash.digest('hex');
}
function digestJSON(x) { return createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function safeBranch(x) {
  return typeof x === 'string' && x.length <= 100 &&
    /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(x) && !x.endsWith('/') &&
    !x.endsWith('.') && !x.includes('..') && !x.includes('//') &&
    !x.endsWith('.lock');
}
function safeRepoPath(x) {
  return typeof x === 'string' && x.length <= 240 && !x.includes('\\') &&
    x.split('/').length <= 20 &&
    x.split('/').every(p => p && p !== '.' && p !== '..' && /^[A-Za-z0-9._-]+$/.test(p));
}
function validateCatalog(catalog, name) {
  if (!catalog || catalog.schema !== 'gitporch.public-catalog.v1' ||
      catalog.visibility !== 'PUBLIC_ONLY' || catalog.owner !== OWNER ||
      !Array.isArray(catalog.repositories) || catalog.count !== catalog.repositories.length ||
      catalog.count < 1 || catalog.count > 3000 ||
      !validSlug(name)) deny('Exact-owner public-only catalog and Windows-safe repo required');
  const names = new Set();
  for (const r of catalog.repositories) {
    if (!r || typeof r.name !== 'string' ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(r.name) ||
        typeof r.eligible !== 'boolean' || names.has(r.name.toLowerCase())) {
      deny('Invalid or duplicated catalog source');
    }
    names.add(r.name.toLowerCase());
  }
  if (!catalog.repositories.some(r => r.name === name && r.eligible)) {
    deny('Repository not eligible or not present in public catalog');
  }
}
function parsePointer(text) {
  if (text.length > 512) deny('LFS pointer exceeds bounded size');
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines.length !== 3 || lines[0] !== POINTER_HEADER ||
      !/^oid sha256:[0-9a-f]{64}$/.test(lines[1]) ||
      !/^size (?:0|[1-9][0-9]{0,15})$/.test(lines[2])) deny('Not a canonical three-line LFS pointer');
  const bytes = Number(lines[2].slice(5));
  if (!Number.isSafeInteger(bytes)) deny('LFS byte size invalid');
  if (bytes > MAX_BYTES) deny('LFS file exceeds 64MiB per-object pilot cap');
  return { oid: lines[1].slice(11), bytes };
}
async function localGit(args) {
  try {
    const r = await exec('git', args, {
      env: offlineRestoreGitEnv(), windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
    });
    return r.stdout.trimEnd();
  } catch { deny('Offline Git source verification failed'); }
}
async function pointerFromTrustedMirror(catalog, name, branch, path, dataDir) {
  validateCatalog(catalog, name);
  if (!safeBranch(branch) || !safeRepoPath(path)) deny('Unsupported branch or tracked file path');
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) deny('Absolute GitPorch data directory required');
  const scoped = {
    schema: catalog.schema, owner: catalog.owner, visibility: catalog.visibility,
    count: 1, repositories: [catalog.repositories.find(r => r.name === name)],
  };
  const audit = await auditPublicMirrors(scoped, dataDir);
  if (audit.repositories[0].status !== 'LOCAL_GIT_OBJECTS_VERIFIED_ONLY') {
    deny('Source bare Git mirror not locally verified by R0.2');
  }
  const base = ['--git-dir', join(resolve(dataDir), 'repos', name + '.git')];
  const sha = (await localGit([...base, 'rev-parse', '--verify', 'refs/heads/' + branch + '^{commit}'])).trim();
  if (!COMMIT.test(sha)) deny('Invalid commit resolved from branch');
  const rows = (await localGit([...base, 'ls-tree', '-z', sha, '--', path])).split('\0').filter(Boolean);
  if (rows.length !== 1) deny('Tracked pointer path not found or ambiguous');
  const parts = rows[0].split('\t');
  if (parts.length !== 2 || parts[1] !== path ||
      !/^100(?:644|755) blob (?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(parts[0])) {
    deny('Selected tracked item must be a regular Git blob, not a link or submodule');
  }
  const pointer = parsePointer(await localGit([...base, 'show', sha + ':' + path]));
  return { name, branch, path, commit: sha, ...pointer };
}
async function assetRootCheck(assetRoot, dataDir) {
  const root = await realDir(assetRoot, 'Asset root');
  try {
    const source = await realpath(dataDir);
    if (within(source, root) || within(root, source)) {
      deny('LFS asset root must be outside live GitPorch data tree');
    }
  } catch (e) { if (e?.code !== 'ENOENT') throw e; }
  return root;
}
async function checkedStorePath(root, oid, makeDirs = false) {
  const parts = ['objects', 'sha256', oid.slice(0, 2)];
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    let st = await kind(path);
    if (!st && makeDirs) {
      try { await mkdir(path, { mode: 0o700 }); }
      catch (e) { if (e?.code !== 'EEXIST') throw e; }
      st = await kind(path);
    }
    if (!st) return null;
    if (!st.isDirectory() || st.isSymbolicLink() ||
        key(await realpath(path)) !== key(path)) deny('Asset store has unsafe directory layout');
  }
  return join(path, oid);
}
async function storedStatus(root, pointer) {
  const target = await checkedStorePath(root, pointer.oid);
  if (!target) return 'NOT_STORED';
  const st = await kind(target);
  if (!st) return 'NOT_STORED';
  if (!st.isFile() || st.isSymbolicLink() || key(await realpath(target)) !== key(target)) {
    return 'STORED_OBJECT_UNSAFE_OR_INVALID';
  }
  if (st.size !== pointer.bytes || (await digestFile(target)) !== pointer.oid) {
    return 'STORED_OBJECT_UNSAFE_OR_INVALID';
  }
  return 'LOCAL_LFS_BYTES_VERIFIED_ONLY';
}
export async function verifyLocalLfsObject(catalog, name, branch, path, assetRoot, dataDir = getDataDir()) {
  const pointer = await pointerFromTrustedMirror(catalog, name, branch, path, dataDir);
  const root = await assetRootCheck(assetRoot, dataDir);
  const status = await storedStatus(root, pointer);
  return {
    schema: 'gitporch.local-lfs-byte-verification.v0.1', name, branch,
    commit: pointer.commit, oid: pointer.oid, expectedBytes: pointer.bytes, status,
    acceptance: { sourceGitHubParityVerified: false, completeLfsCoverage: false,
      externalDiskVerified: false, wanDisconnectVerified: false, executableSafe: false },
    notice: 'Offline local byte digest and size verification against selected branch-tip LFS pointer. No GitHub LFS API, history sweep, source authenticity, execution or full application recovery.',
  };
}
export async function planLocalLfsIntake(
  catalog, name, branch, path, payloadFile, assetRoot, dataDir = getDataDir(),
) {
  const pointer = await pointerFromTrustedMirror(catalog, name, branch, path, dataDir);
  const root = await assetRootCheck(assetRoot, dataDir);
  const source = await realFile(payloadFile, 'Operator-selected payload');
  if (within(root, source.full)) deny('Payload must come from outside the asset store');
  if (source.st.size !== pointer.bytes) deny('Local payload does not match LFS declared size');
  const sha256 = await digestFile(source.full);
  if (sha256 !== pointer.oid) deny('Payload SHA-256 does not match tracked Git LFS pointer');
  const stored = await storedStatus(root, pointer);
  if (stored === 'STORED_OBJECT_UNSAFE_OR_INVALID') deny('Existing object conflicts with expected LFS hash');
  const basis = { schema: SCHEMA, owner: OWNER, name, branch, path,
    commit: pointer.commit, oid: pointer.oid, bytes: pointer.bytes, payloadSha256: sha256,
    sourcePath: source.full, assetRoot: root, currentStorage: stored };
  return { ...basis, planSha256: digestJSON(basis), status:
    stored === 'LOCAL_LFS_BYTES_VERIFIED_ONLY' ? 'ALREADY_VERIFIED_NO_WRITE_NEEDED' :
      'EXPLICIT_APPROVAL_REQUIRED', networkUsed: false, writesMade: false,
    maxSinglePayloadBytes: MAX_BYTES,
    notice: 'Source bytes read locally and verified against a local Git pointer. The hash guards this specific plan, not GitHub provenance or physical backup media.',
  };
}
export async function intakeLocalLfsObject(
  catalog, name, branch, path, payloadFile, assetRoot, expectedPlanSha256,
  dataDir = getDataDir(),
) {
  if (typeof expectedPlanSha256 !== 'string' || !HEX64.test(expectedPlanSha256)) {
    deny('Exact fresh 64-character plan hash required');
  }
  const plan = await planLocalLfsIntake(catalog, name, branch, path, payloadFile, assetRoot, dataDir);
  if (plan.planSha256 !== expectedPlanSha256) deny('Intake plan changed; review and approve a fresh plan');
  if (plan.status !== 'EXPLICIT_APPROVAL_REQUIRED') deny('No fresh intake required');
  const root = await assetRootCheck(assetRoot, dataDir);
  const dest = await checkedStorePath(root, plan.oid, true);
  if (await kind(dest)) deny('Destination appeared during intake; never overwrite');
  const tmp = join(resolve(dest, '..'), '.' + plan.oid + '.incoming-' + randomUUID());
  try {
    await pipeline(createReadStream(plan.sourcePath),
      createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
    const st = await lstat(tmp);
    if (st.size !== plan.bytes || (await digestFile(tmp)) !== plan.oid) {
      deny('Payload changed while copying; refusing publish');
    }
    // Hard-link promotion is atomic and fails if the destination already exists.
    // If the asset filesystem cannot hard-link, fail closed rather than rename
    // over a concurrently created object.
    await link(tmp, dest);
  } finally { await rm(tmp, { force: true }); }
  const result = await verifyLocalLfsObject(catalog, name, branch, path, root, dataDir);
  if (result.status !== 'LOCAL_LFS_BYTES_VERIFIED_ONLY') {
    deny('Published file failed local readback verification');
  }
  return {
    schema: 'gitporch.local-lfs-byte-intake.v0.1', name, branch,
    oid: plan.oid, bytes: plan.bytes, status: result.status,
    networkUsed: false, payloadExecuted: false,
    acceptance: result.acceptance,
    notice: 'One locally supplied LFS object preserved by digest; not a GitHub download, whole-repository LFS backup, remote parity check or independent disk test.',
  };
}
