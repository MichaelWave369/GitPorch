// PhiOS R0.14: offline, read-only portable recovery kit file and Git-bundle audit.
// No external network, copying, system install, executable launch, or WAN-state changes.
// A byte-identical kit is NOT evidence of physically independent media or a PhiOS boot.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { verifyBackup } from './homenode.mjs';
import { validSlug } from './git.mjs';

const OWNER = 'MichaelWave369';
const SCHEMA = 'gitporch.portable-recovery-kit.v0.1';
const SHA = /^[a-f0-9]{64}$/;
const MAX_FILES = 130;    // 2 Git snapshot files + at most 128 content-addressed assets
const MAX_DIRS = 160;
const MAX_SINGLE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
function deny(s) { throw new Error(s); }
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function canonical(p) { const v = resolve(p); return process.platform === 'win32' ? v.toLowerCase() : v; }
function within(parent, child) {
  const rel = relative(canonical(parent), canonical(child));
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}
async function realDir(p, label) {
  if (typeof p !== 'string' || !isAbsolute(p)) deny(label + ' must be an existing absolute directory');
  const full = resolve(p), st = await lstat(full);
  if (!st.isDirectory() || st.isSymbolicLink() || canonical(await realpath(full)) !== canonical(full)) {
    deny(label + ' must have no symlink or redirected parent');
  }
  return full;
}
function validateCatalog(c, name) {
  if (!c || c.schema !== 'gitporch.public-catalog.v1' ||
      c.owner !== OWNER || c.visibility !== 'PUBLIC_ONLY' ||
      !Array.isArray(c.repositories) || !Number.isSafeInteger(c.count) ||
      c.count !== c.repositories.length || c.count < 1 || c.count > 3000 ||
      !validSlug(name)) deny('Exact-owner PUBLIC_ONLY catalog required');
  const names = new Set();
  let eligible = false;
  for (const r of c.repositories) {
    if (!r || typeof r.name !== 'string' ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(r.name) ||
        typeof r.eligible !== 'boolean' || names.has(r.name.toLowerCase())) {
      deny('Malformed/duplicate public catalog entry');
    }
    names.add(r.name.toLowerCase());
    if (r.name === name && r.eligible) eligible = true;
  }
  if (!eligible) deny('Selected repository is not an eligible public source');
}
function permittedDirectory(rel) {
  return rel === 'snapshot' ||
    ['lfs', 'lfs/objects', 'lfs/objects/sha256',
      'releases', 'releases/releases', 'releases/releases/sha256'].includes(rel) ||
    /^lfs\/objects\/sha256\/[a-f0-9]{2}$/.test(rel) ||
    /^releases\/releases\/sha256\/[a-f0-9]{2}$/.test(rel);
}
function fileClass(rel) {
  if (rel === 'snapshot/snapshot.json' || rel === 'snapshot/repository.bundle') return 'GIT_SNAPSHOT';
  const matched = /^(lfs\/objects\/sha256|releases\/releases\/sha256)\/([a-f0-9]{2})\/([a-f0-9]{64})$/.exec(rel);
  if (!matched) return null;
  if (matched[3].slice(0, 2) !== matched[2]) return null;
  return matched[1].startsWith('lfs/') ? 'GIT_LFS_PAYLOAD' : 'GITHUB_RELEASE_ASSET';
}
async function shaFile(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}
async function scanKit(root, name) {
  const files = [];
  let dirs = 0, total = 0;
  async function enter(dir, segments) {
    if (++dirs > MAX_DIRS) deny('Portable kit directory count exceeded safety cap');
    const list = await readdir(dir, { withFileTypes: true });
    for (const item of list) {
      const parts = [...segments, item.name];
      const rel = parts.join('/');
      // All path components come from readdir; nevertheless, never accept
      // alternate separators, .git internals, or Windows-reserved tricks.
      if (!item.name || item.name === '.' || item.name === '..' ||
          /[\\/:*?"<>|\x00-\x1f]/.test(item.name) ||
          item.name.endsWith('.') || item.name.endsWith(' ')) {
        deny('Unsafe or unsupported portable kit path');
      }
      const full = join(dir, item.name);
      const st = await lstat(full);
      if (st.isSymbolicLink() || canonical(await realpath(full)) !== canonical(full)) {
        deny('Portable kit contains a symlink or redirected entry');
      }
      if (st.isDirectory()) {
        if (!permittedDirectory(rel)) deny('Portable kit has an unexpected directory');
        await enter(full, parts);
      } else if (st.isFile()) {
        const type = fileClass(rel);
        if (!type) deny('Portable kit has an unexpected file');
        if (++total > MAX_FILES || st.size > MAX_SINGLE_BYTES) {
          deny('Portable kit exceeds file-count or per-file size cap');
        }
        files.push({ path: rel, kind: type, bytes: st.size,
          sha256: await shaFile(full) });
      } else {
        deny('Portable kit contains an unsupported special filesystem entry');
      }
    }
  }
  await enter(root, []);
  const names = files.map(f => f.path);
  if (!names.includes('snapshot/snapshot.json') ||
      !names.includes('snapshot/repository.bundle')) {
    deny('Portable kit requires the exact Git snapshot files');
  }
  if (files.length > MAX_FILES) deny('Portable kit has too many files');
  let bytes = 0, lfs = 0, releases = 0;
  for (const f of files) {
    bytes += f.bytes;
    if (!Number.isSafeInteger(bytes) || bytes > MAX_TOTAL_BYTES) {
      deny('Portable kit exceeds total size safety cap');
    }
    if (f.kind === 'GIT_LFS_PAYLOAD' || f.kind === 'GITHUB_RELEASE_ASSET') {
      if (f.sha256 !== f.path.slice(-64)) deny('Content-addressed asset file has incorrect SHA-256');
      if (f.kind === 'GIT_LFS_PAYLOAD') ++lfs;
      else ++releases;
    }
  }
  if (lfs + releases > 128) deny('Portable kit exceeds 128 real asset payloads');
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  // Independent bundle reconstruction and fsck, not merely manifest SHA-256.
  // Existing R0.1 verifier uses an automatically deleted temporary Git clone.
  let proof;
  try { proof = await verifyBackup(join(root, 'snapshot')); }
  catch { deny('Portable kit Git bundle failed independent local restore verification'); }
  if (!proof?.verified || proof.repository !== name || !SHA.test(proof.sha256)) {
    deny('Portable kit Git snapshot repository or bundle integrity mismatched');
  }
  const bundle = files.find(f => f.path === 'snapshot/repository.bundle');
  if (bundle.sha256 !== proof.sha256 || bundle.bytes !== proof.bytes) {
    deny('Portable kit bundle checksum disagrees with verified restore');
  }
  return {
    files, summary: { files: files.length, bytes,
      lfsObjects: lfs, releaseObjects: releases,
      gitSnapshotFiles: 2, gitBundleRefsVerified: proof.refs },
    bundleSha256: proof.sha256,
  };
}
function validateManifest(m) {
  if (!m || m.schema !== SCHEMA || m.owner !== OWNER || !validSlug(m.repository) ||
      !SHA.test(m.manifestSha256 ?? '') || !Array.isArray(m.files) ||
      m.files.length < 2 || m.files.length > MAX_FILES ||
      !m.summary || !Number.isSafeInteger(m.summary.files) ||
      m.summary.files !== m.files.length ||
      !SHA.test(m.bundleSha256 ?? '')) deny('Saved portable kit manifest malformed');
  const { manifestSha256, ...body } = m;
  if (digest(body) !== manifestSha256) deny('Portable kit manifest fingerprint does not match');
  const names = new Set();
  for (const f of m.files) {
    if (!f || typeof f.path !== 'string' || names.has(f.path) ||
        !fileClass(f.path) || f.kind !== fileClass(f.path) ||
        !SHA.test(f.sha256 ?? '') || !Number.isSafeInteger(f.bytes) ||
        f.bytes < 0 || f.bytes > MAX_SINGLE_BYTES) {
      deny('Saved portable kit manifest contains malformed file metadata');
    }
    names.add(f.path);
  }
  return body;
}
async function readManifest(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    deny('Saved kit manifest must be a real absolute file');
  }
  const p = resolve(path), st = await lstat(p);
  if (!st.isFile() || st.isSymbolicLink() ||
      canonical(await realpath(p)) !== canonical(p) ||
      st.size > MAX_MANIFEST_BYTES) deny('Saved kit manifest is unsafe or oversized');
  let m;
  try { m = JSON.parse(await readFile(p, 'utf8')); }
  catch { deny('Saved kit manifest is invalid JSON'); }
  validateManifest(m);
  return m;
}
/** Offline, read-only kit index with independently checked Git bundle. */
export async function planPortableRecoveryKit(catalog, repository, kitRoot) {
  validateCatalog(catalog, repository);
  const root = await realDir(kitRoot, 'Source kit');
  const checked = await scanKit(root, repository);
  const body = {
    schema: SCHEMA, owner: OWNER, repository,
    scope: 'SELECTED_EXPLICIT_PORTABLE_KIT_CONTENTS_ONLY',
    bundleSha256: checked.bundleSha256, summary: checked.summary,
    files: checked.files,
  };
  return {
    ...body, manifestSha256: digest(body),
    status: 'KIT_FILE_BYTES_AND_GIT_BUNDLE_VERIFIED_ONLY',
    networkUsed: false, persistentFilesWritten: false,
    // Keep all assertions false until the operator performs the field exercise.
    acceptance: { physicallyIndependentDeviceVerified: false, detachedWanVerified: false,
      actualPhiOSComponentLaunched: false, completeEcosystemRecovered: false },
    notice: 'This is an unsigned local content inventory; source, full history, external asset coverage, physical media independence and PhiOS boot are NOT certified. Keep the manifest outside the kit root.',
  };
}
/**
 * Recompute the original manifest from its field subset; presentation fields do
 * not affect the digest. No snapshot or asset storage is changed.
 */
export async function verifyPortableRecoveryKit(manifestFile, copiedKitRoot) {
  const manifest = await readManifest(manifestFile);
  const root = await realDir(copiedKitRoot, 'Copied kit');
  if (within(root, resolve(manifestFile))) {
    deny('Reference kit manifest must live outside the copied kit');
  }
  const actual = await scanKit(root, manifest.repository);
  const expectedFiles = manifest.files;
  if (JSON.stringify(actual.files) !== JSON.stringify(expectedFiles) ||
      JSON.stringify(actual.summary) !== JSON.stringify(manifest.summary) ||
      actual.bundleSha256 !== manifest.bundleSha256) {
    deny('Copied portable kit does not match reference: missing, extra or altered bytes');
  }
  return {
    schema: 'gitporch.portable-recovery-kit-verify.v0.1',
    repository: manifest.repository, manifestSha256: manifest.manifestSha256,
    bundleSha256: actual.bundleSha256, summary: actual.summary,
    status: 'PORTABLE_KIT_BYTES_AND_GIT_BUNDLE_VERIFIED_ONLY',
    networkUsed: false, persistentFilesWritten: false, payloadsExecuted: false,
    acceptance: { matchingBytesAtChosenPath: true,
      gitBundleCloneAndFsckPassed: true,
      physicallyIndependentDeviceVerified: false, detachedWanVerified: false,
      actualPhiOSComponentLaunched: false, allDependenciesPreserved: false,
      completeEcosystemRecovered: false },
    notice: 'The selected kit matches the saved unsigned file list and independently cloned Git bundle. Filesystem path and SHA-256 alone do NOT establish separate physical media or an unplugged-WAN restore; a human-operated field test is still required.',
  };
}
