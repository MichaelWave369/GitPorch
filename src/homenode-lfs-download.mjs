// PhiOS R0.8: explicit one-object GitHub LFS download with local-content SHA-256 proof.
// No arbitrary endpoints, no recursive sync, no redirects, no automatic retries, no execution.
import { createHash, randomUUID } from 'node:crypto';
import { open, lstat, mkdir, readFile, realpath, rm, link } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve, isAbsolute, relative } from 'node:path';
import { getDataDir } from './git.mjs';
import { verifyLocalLfsObject } from './homenode-lfs-intake.mjs';

const OWNER = 'MichaelWave369';
const MIME = 'application/vnd.git-lfs+json';
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_BATCH_BYTES = 32 * 1024;
const TIMEOUT_MS = 120_000;
const CDN_HOSTS = new Set([
  'media.github.com', 'objects.githubusercontent.com',
  'media.githubusercontent.com', 'github-cloud.s3.amazonaws.com',
]);
const SHA = /^[0-9a-f]{64}$/;
const fail = text => { throw new Error(text); };
const identity = p => process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p);
const within = (parent, child) => {
  const rel = relative(identity(parent), identity(child));
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
};
const planHash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function kind(p) {
  try { return await lstat(p); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function realDir(p, label) {
  if (!p || typeof p !== 'string' || !isAbsolute(p)) fail(label + ' must be an existing absolute directory');
  const full = resolve(p), st = await lstat(full);
  if (!st.isDirectory() || st.isSymbolicLink() ||
      identity(await realpath(full)) !== identity(full)) fail(label + ' redirects or is unsafe');
  return full;
}
async function assetDirectory(root, oid) {
  let folder = root;
  for (const part of ['objects', 'sha256', oid.slice(0, 2)]) {
    folder = join(folder, part);
    let st = await kind(folder);
    if (!st) {
      try { await mkdir(folder, { mode: 0o700 }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
      st = await kind(folder);
    }
    if (!st.isDirectory() || st.isSymbolicLink() ||
        identity(await realpath(folder)) !== identity(folder)) fail('Unsafe external object-store directory');
  }
  return folder;
}
async function digest(p) {
  const h = createHash('sha256');
  for await (const buf of createReadStream(p)) h.update(buf);
  return h.digest('hex');
}
function validateHttpsAction(url) {
  let u;
  try { u = new URL(url); } catch { fail('LFS action URL malformed'); }
  if (u.protocol !== 'https:' || !CDN_HOSTS.has(u.hostname.toLowerCase()) ||
      u.username || u.password || u.hash || (u.port && u.port !== '443')) {
    fail('LFS action host, scheme, credentials or port rejected by policy');
  }
  return u;
}
async function boundedBytes(response, max) {
  if (!response?.ok || response.status !== 200 || !response.body ||
      typeof response.body.getReader !== 'function') fail('GitHub LFS server refused bounded request');
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > max)) {
    fail('Remote response exceeds permitted limit');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      total += chunk.length;
      if (total > max) fail('Remote response exceeded permitted streaming limit');
      chunks.push(chunk);
    }
  } finally { try { await reader.cancel(); } catch {} }
  return Buffer.concat(chunks, total);
}
function credentials() {
  const token = process.env.GITPORCH_LFS_TOKEN;
  if (!token) return {};
  if (typeof token !== 'string' || token.length > 500 ||
      /[\r\n\0]/.test(token)) fail('Invalid GitHub LFS token input');
  const user = process.env.GITPORCH_LFS_USERNAME || 'x-access-token';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/.test(user)) fail('Invalid GitHub LFS username');
  return { Authorization: 'Basic ' + Buffer.from(user + ':' + token, 'utf8').toString('base64') };
}
function validateBatch(payload, oid, size) {
  if (!payload || payload.transfer && payload.transfer !== 'basic' ||
      !Array.isArray(payload.objects) || payload.objects.length !== 1) fail('Unexpected LFS batch response format');
  const [item] = payload.objects;
  if (!item || item.oid !== oid || item.size !== size || item.error ||
      typeof item.actions?.download?.href !== 'string') fail('LFS batch response object mismatched or unavailable');
  const download = item.actions.download;
  const u = validateHttpsAction(download.href);
  const headers = {};
  const serverHeaders = download.header ?? {};
  if (!serverHeaders || Array.isArray(serverHeaders) || typeof serverHeaders !== 'object' ||
      Object.keys(serverHeaders).some(k => k.toLowerCase() !== 'authorization') ||
      Object.values(serverHeaders).some(v => typeof v !== 'string' || v.length > 2048 || /[\r\n]/.test(v))) {
    fail('Unreviewed LFS action headers rejected');
  }
  if (Object.keys(serverHeaders).length) {
    // A GitHub-issued RemoteAuth download credential is only ever sent back to
    // GitHub's media.github.com, never to a generic CDN or arbitrary URL.
    if (u.hostname !== 'media.github.com') fail('LFS action credentials cannot be sent to CDN');
    headers.Authorization = Object.values(serverHeaders)[0];
  }
  if (download.expires_in !== undefined && (!Number.isInteger(download.expires_in) ||
      download.expires_in <= 0)) fail('Expired LFS download action');
  return { url: u.toString(), headers };
}
async function downloadToTemp(response, filename, expectedSize, expectedOid) {
  if (!response?.ok || response.status !== 200 || !response.body ||
      typeof response.body.getReader !== 'function') fail('LFS content download failed');
  const len = response.headers?.get?.('content-length');
  if (len !== null && len !== undefined && (!/^\d+$/.test(len) || Number(len) !== expectedSize)) {
    fail('LFS content-length conflicts with tracked Git pointer');
  }
  const file = await open(filename, 'wx', 0o600);
  const reader = response.body.getReader();
  const sha = createHash('sha256');
  let got = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const buf = Buffer.from(next.value);
      got += buf.length;
      if (got > expectedSize || got > MAX_BYTES) fail('LFS stream exceeded expected byte size');
      sha.update(buf);
      await file.writeFile(buf);
    }
    await file.sync();
  } finally {
    try { await reader.cancel(); } catch {}
    await file.close();
  }
  if (got !== expectedSize || sha.digest('hex') !== expectedOid ||
      (await digest(filename)) !== expectedOid) {
    fail('Downloaded LFS bytes do not match exact Git pointer digest and size');
  }
}
export async function planGitHubLfsDownload(
  catalog, name, branch, trackedPath, assetRoot, dataDir = getDataDir(),
) {
  const checked = await verifyLocalLfsObject(catalog, name, branch, trackedPath, assetRoot, dataDir);
  if (checked.expectedBytes > MAX_BYTES) fail('Pilot object exceeds 64 MiB limit');
  if (checked.status === 'STORED_OBJECT_UNSAFE_OR_INVALID') fail('Existing LFS object is corrupt; never overwrite');
  const root = await realDir(assetRoot, 'External asset root');
  const localData = resolve(dataDir);
  if (within(localData, root) || within(root, localData)) fail('Asset root must not overlap GitPorch data');
  const basis = {
    schema: 'gitporch.github-lfs-download-plan.v0.1', owner: OWNER,
    name, branch, trackedPath, commit: checked.commit,
    oid: checked.oid, size: checked.expectedBytes, root,
    status: checked.status,
    endpoint: 'https://github.com/' + OWNER + '/' + name + '.git/info/lfs/objects/batch',
  };
  return {
    ...basis, planSha256: planHash(basis),
    approvalRequired: basis.status === 'NOT_STORED',
    networkUsed: false, filesWritten: false,
    notice: 'Offline plan only. Network LFS batch and bounded byte download require explicit approval; optional GitHub token is read only at execution and never printed.',
  };
}

/**
 * Explicit, one-object GitHub LFS acquisition.
 * Tests inject a fake fetcher. The CLI uses global fetch, no external URL input.
 */
export async function acquireGitHubLfsObject(
  catalog, name, branch, trackedPath, assetRoot, approvedSha,
  dataDir = getDataDir(), fetcher = fetch,
) {
  if (typeof approvedSha !== 'string' || !SHA.test(approvedSha)) fail('Explicit reviewed plan SHA-256 required');
  const plan = await planGitHubLfsDownload(catalog, name, branch, trackedPath, assetRoot, dataDir);
  if (plan.planSha256 !== approvedSha) fail('LFS acquisition plan changed; re-preview and approve');
  if (!plan.approvalRequired) fail('No acquisition required for this object');
  // The only outbound API request: GitHub LFS batch for an exact public repo.
  const body = JSON.stringify({
    operation: 'download', transfers: ['basic'],
    objects: [{ oid: plan.oid, size: plan.size }],
    ref: { name: 'refs/heads/' + branch }, hash_algo: 'sha256',
  });
  let response;
  try {
    response = await fetcher(plan.endpoint, {
      method: 'POST', redirect: 'manual',
      headers: { Accept: MIME, 'Content-Type': MIME, ...credentials() },
      body, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch { fail('GitHub LFS batch request failed'); }
  let batch;
  try { batch = JSON.parse((await boundedBytes(response, MAX_BATCH_BYTES)).toString('utf8')); }
  catch { fail('GitHub LFS batch response invalid or too large'); }
  const action = validateBatch(batch, plan.oid, plan.size);
  let downloaded;
  try {
    downloaded = await fetcher(action.url, {
      method: 'GET', redirect: 'manual',
      headers: action.headers, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch { fail('GitHub LFS action download failed'); }

  // Revalidate the locally verified Git ref after network I/O. A stale branch
  // change must never cause newly fetched bytes to be published silently.
  const still = await planGitHubLfsDownload(catalog, name, branch, trackedPath, assetRoot, dataDir);
  if (still.planSha256 !== approvedSha) fail('Local Git pointer or asset state changed during acquisition');
  const folder = await assetDirectory(plan.root, plan.oid);
  const target = join(folder, plan.oid);
  if (await kind(target)) fail('Object appeared during download; refusing overwrite');
  const temp = join(folder, '.' + plan.oid + '.pending-' + randomUUID());
  try {
    await downloadToTemp(downloaded, temp, plan.size, plan.oid);
    await link(temp, target); // atomic, no overwriting an existing object
  } catch (e) {
    // No HTTP errors, signed URLs or tokens in error strings.
    if (e instanceof Error && (e.message.startsWith('LFS') ||
      e.message.startsWith('Downloaded'))) throw e;
    fail('Local LFS object promotion failed');
  } finally {
    await rm(temp, { force: true });
  }
  const proof = await verifyLocalLfsObject(catalog, name, branch, trackedPath, assetRoot, dataDir);
  if (proof.status !== 'LOCAL_LFS_BYTES_VERIFIED_ONLY') fail('Stored LFS object failed final readback');
  return {
    schema: 'gitporch.github-lfs-download-result.v0.1', name, branch,
    oid: plan.oid, bytes: plan.size,
    status: 'LOCAL_LFS_BYTES_VERIFIED_ONLY',
    networkUsed: true, payloadExecuted: false,
    acceptance: {
      contentDigestMatchesLocalGitPointer: true,
      githubSourceAuthenticityVerified: false,
      fullLfsHistoryComplete: false, offHostDiskVerified: false,
      wanDisconnectedTested: false, phiosBootVerified: false,
    },
    notice: 'A single content-addressed LFS payload was fetched via GitHub batch and locally SHA-256 verified. No complete GitHub source provenance, other blobs, physical backup or offline boot is proven.',
  };
}
