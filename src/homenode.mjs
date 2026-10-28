import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { git, getDataDir, listRepos, repoRoot, validSlug } from './git.mjs';
import { offlineRestoreGitEnv } from './homenode-restore-drill.mjs';
import { MAX_LOCAL_REPOSITORIES } from './repository-policy.mjs';

const SCHEMA = 'gitporch.homenode.snapshot.v1';
const BUNDLE = 'repository.bundle';
const MANIFEST = 'snapshot.json';
const TIMEOUT = 180_000;
const isWithin = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

async function digest(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

function parseRefs(output) {
  return output.split('\n').filter(Boolean).map(line => {
    const pos = line.indexOf('\t');
    if (pos < 0) throw new Error('Malformed Git refs output');
    return { name: line.slice(0, pos), oid: line.slice(pos + 1) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

async function refsFor(barePath, env) {
  return parseRefs(await git(['--git-dir', barePath, 'for-each-ref', '--format=%(refname)%09%(objectname)'], { timeout: TIMEOUT, env }));
}

export async function inventory(dataDir = getDataDir()) {
  const repositories = await listRepos(dataDir);
  return {
    mode: 'LOCAL_ONLY', count: repositories.length,
    notice: 'GitPorch inventories up to ' + MAX_LOCAL_REPOSITORIES + ' supported local repositories without truncation; no GitHub inventory is implied.',
    repositories: repositories.map(r => ({ name: r.name, branches: r.branches, latest: r.latest })),
  };
}

// Makes a NEW self-contained Git history snapshot. Never writes to a source repo.
export async function backupRepo(name, destination, dataDir = getDataDir()) {
  if (!validSlug(name)) throw new Error('Invalid repository name');
  if (!destination || !isAbsolute(destination)) throw new Error('Destination must be an existing absolute directory');
  const destinationPath = resolve(destination);
  if (!(await lstat(destinationPath)).isDirectory()) throw new Error('Backup destination must be a directory, not a symlink');
  const targetRoot = await realpath(destinationPath);
  const dataRoot = await realpath(dataDir);
  const localRoot = await realpath(repoRoot(dataDir));
  if (isWithin(dataRoot, targetRoot)) throw new Error('Backup destination must be outside the GitPorch data directory');
  const matching = (await listRepos(dataDir)).find(repo => repo.name === name);
  if (!matching) throw new Error('Repository not found in local GitPorch');
  const source = await realpath(join(localRoot, name + '.git'));
  if (!isWithin(localRoot, source)) throw new Error('Repository path escapes local store');
  const original = await refsFor(source);
  if (!original.length) throw new Error('Empty repository has no Git refs to bundle; no backup was created');
  const staging = await mkdtemp(join(targetRoot, '.gitporch-pending-'));
  try {
    const bundlePath = join(staging, BUNDLE);
    await git(['--git-dir', source, 'bundle', 'create', bundlePath, '--all'], { timeout: TIMEOUT });
    const after = await refsFor(source);
    if (JSON.stringify(after) !== JSON.stringify(original)) throw new Error('Source refs changed during backup; discard snapshot and retry');
    const manifest = {
      schema: SCHEMA, repository: name, createdAt: new Date().toISOString(),
      bundle: BUNDLE, bytes: (await stat(bundlePath)).size,
      sha256: await digest(bundlePath), refs: original,
      scope: 'Git refs and reachable Git objects only. Excludes LFS content, issues, PRs, releases, CI artifacts, credentials and server config.',
    };
    await writeFile(join(staging, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await verifyBackup(staging);
    const final = join(targetRoot, 'gitporch-' + name + '-' + randomUUID());
    await rename(staging, final);
    return { path: final, repository: name, refs: original.length, sha256: manifest.sha256, verified: true };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyBackup(directory) {
  if (!directory || !isAbsolute(directory)) throw new Error('Snapshot directory must be absolute');
  const folder = resolve(directory);
  if (!(await lstat(folder)).isDirectory()) throw new Error('Snapshot must be a directory, not a symlink');
  const manifestPath = join(folder, MANIFEST);
  const bundlePath = join(folder, BUNDLE);
  if (!(await lstat(manifestPath)).isFile() || !(await lstat(bundlePath)).isFile())
    throw new Error('Snapshot files must be regular files, not symlinks');
  if ((await stat(manifestPath)).size > 1_000_000) throw new Error('Manifest too large');
  const m = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (m.schema !== SCHEMA || !validSlug(m.repository) || m.bundle !== BUNDLE ||
    !Number.isSafeInteger(m.bytes) || m.bytes <= 0 || !/^[a-f0-9]{64}$/.test(m.sha256) ||
    !Array.isArray(m.refs) || !m.refs.length || m.refs.length > 100_000 ||
    m.refs.some(r => !r || typeof r.name !== 'string' || !r.name.startsWith('refs/') || !/^[a-f0-9]{40,64}$/.test(r.oid)))
    throw new Error('Invalid snapshot manifest');
  if ((await stat(bundlePath)).size !== m.bytes || (await digest(bundlePath)) !== m.sha256)
    throw new Error('Snapshot bundle does not match its recorded checksum/size');
  const offlineEnv = offlineRestoreGitEnv();
  const scratch = await mkdtemp(join(tmpdir(), 'gitporch-verify-'));
  try {
    const restored = join(scratch, 'restored.git');
    await git(['clone', '--mirror', '--', bundlePath, restored], { timeout: TIMEOUT, env: offlineEnv });
    await git(['--git-dir', restored, 'fsck', '--full', '--no-reflogs'], { timeout: TIMEOUT, env: offlineEnv });
    const actual = await refsFor(restored, offlineEnv);
    if (JSON.stringify(actual) !== JSON.stringify([...m.refs].sort((a, b) => a.name.localeCompare(b.name, 'en'))))
      throw new Error('Restored refs differ from the recorded snapshot');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return { verified: true, repository: m.repository, refs: m.refs.length, bytes: m.bytes, sha256: m.sha256 };
}
