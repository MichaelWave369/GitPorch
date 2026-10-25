import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { git, getDataDir, repoRoot, validSlug } from './git.mjs';
import { MAX_LOCAL_REPOSITORIES, MAX_REPOSITORY_NAME_LENGTH, assertLocalRepositoryCapacity } from './repository-policy.mjs';

const SCHEMA = 'gitporch.public-catalog.v1';
const LIMIT = 30; // 3,000 public repos; fail rather than silently truncate.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const MAX_BYTES = 4 * 1024 * 1024;

function validOwner(value) { return typeof value === 'string' && OWNER.test(value) && !value.includes('--'); }
function safeName(name) { return typeof name === 'string' && name.length <= 100 && /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..'; }

export async function discoverPublic(owner, fetcher = fetch) {
  if (!validOwner(owner)) throw new Error('Invalid GitHub username');
  const results = [];
  const seen = new Set();
  for (let page = 1; page <= LIMIT; page++) {
    const uri = 'https://api.github.com/users/' + owner + '/repos?per_page=100&page=' + page + '&type=owner&sort=full_name';
    const response = await fetcher(uri, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GitPorch-HomeNode' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response?.ok) throw new Error('GitHub public catalog failed (HTTP ' + (response?.status ?? 'unknown') + '). No incomplete catalog saved.');
    const entries = await response.json();
    if (!Array.isArray(entries) || entries.length > 100) throw new Error('Unexpected GitHub catalog response');
    for (const item of entries) {
      if (!item || typeof item.name !== 'string' || !safeName(item.name) ||
          typeof item.owner?.login !== 'string' || item.owner.login.toLowerCase() !== owner.toLowerCase() ||
          item.private !== false) throw new Error('Unexpected repository entry in public catalog');
      const key = item.name.toLowerCase();
      if (seen.has(key)) throw new Error('Duplicate name detected across catalog pages');
      seen.add(key);
      results.push({
        name: item.name,
        eligible: validSlug(item.name),
        reason: validSlug(item.name) ? null : 'GitPorch requires a Windows-safe slug of ' + MAX_REPOSITORY_NAME_LENGTH + ' characters or fewer',
        archived: Boolean(item.archived), fork: Boolean(item.fork),
        empty: Number.isFinite(item.size) ? item.size === 0 : null,
        sizeKb: Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : null,
        defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : null,
      });
    }
    if (entries.length < 100) break;
    if (page === LIMIT) throw new Error('Public repository count exceeds safety pagination cap; no incomplete catalog saved');
  }
  return { schema: SCHEMA, owner, visibility: 'PUBLIC_ONLY', capturedAt: new Date().toISOString(),
    count: results.length, repositories: results,
    exclusions: 'No private repositories or account secrets, issues, PRs, wiki, release assets, LFS content, or Actions artifacts.',
  };
}

export async function saveCatalog(catalog, destination) {
  if (!destination || !isAbsolute(destination)) throw new Error('Catalog destination must be an existing absolute directory');
  const directory = resolve(destination);
  if (!(await lstat(directory)).isDirectory()) throw new Error('Catalog destination is not a real directory');
  if (!catalog || catalog.schema !== SCHEMA || !validOwner(catalog.owner)) throw new Error('Invalid catalog');
  const path = join(directory, 'gitporch-public-' + catalog.owner + '-' + randomUUID() + '.json');
  await writeFile(path, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { path, count: catalog.count, eligible: catalog.repositories.filter(r => r.eligible).length };
}

export async function loadCatalog(file) {
  if (!file || !isAbsolute(file)) throw new Error('Catalog path must be absolute');
  const details = await lstat(file);
  if (!details.isFile()) throw new Error('Catalog must be a regular file, not a symlink');
  if (details.size > MAX_BYTES) throw new Error('Catalog exceeds maximum size');
  const bytes = await readFile(file);
  const data = JSON.parse(bytes.toString('utf8'));
  if (!data || data.schema !== SCHEMA || !validOwner(data.owner) || data.visibility !== 'PUBLIC_ONLY' ||
      !Array.isArray(data.repositories) || data.count !== data.repositories.length || data.repositories.length > LIMIT * 100) {
    throw new Error('Invalid public catalog format');
  }
  const seen = new Set();
  for (const r of data.repositories) {
    if (!r || !safeName(r.name) || r.eligible !== validSlug(r.name) || seen.has(r.name.toLowerCase()))
      throw new Error('Invalid, duplicate, or inconsistent catalog entry');
    seen.add(r.name.toLowerCase());
  }
  return data;
}

async function existingNames(dataDir) {
  const root = repoRoot(dataDir);
  await mkdir(root, { recursive: true });
  if (!(await lstat(root)).isDirectory()) throw new Error('Repository root must be a real directory');
  const existing = await readdir(root, { withFileTypes: true });
  return { root, names: new Set(existing.filter(x => x.name.toLowerCase().endsWith('.git')).map(x => x.name.toLowerCase())) };
}

export async function planImport(catalog, dataDir = getDataDir()) {
  const { names } = await existingNames(dataDir);
  const repositories = catalog.repositories.map(r => ({ name: r.name,
    status: !r.eligible ? 'UNSUPPORTED_NAME' : names.has((r.name + '.git').toLowerCase()) ? 'ALREADY_LOCAL' : 'READY_TO_IMPORT',
  }));
  return { owner: catalog.owner, source: 'PUBLIC_GITHUB_CATALOG',
    ready: repositories.filter(r => r.status === 'READY_TO_IMPORT').length, repositories,
    notice: 'This is an offline local comparison. No network requests, copies, pushes, or server exposure.' };
}

// Exposed for isolated tests using a local Git source. Not a CLI accepting an arbitrary source URL.
export async function importMirrorFromSource(name, source, dataDir = getDataDir()) {
  if (!validSlug(name)) throw new Error('GitPorch does not support this repository name');
  if (typeof source !== 'string' || !source) throw new Error('Missing Git source');
  const { root, names } = await existingNames(dataDir);
  const target = join(root, name + '.git');
  if (names.has((name + '.git').toLowerCase())) throw new Error('Repository already exists; import will never overwrite');
  assertLocalRepositoryCapacity(names.size);
  if (names.size >= MAX_LOCAL_REPOSITORIES) throw new Error('GitPorch ' + MAX_LOCAL_REPOSITORIES + '-repository capacity reached; import refused');
  const lock = join(root, '.import-lock-' + name.toLowerCase());
  await mkdir(lock); // atomic reservation against concurrent HomeNode importers
  let stage;
  try {
    const second = await existingNames(dataDir);
    if (second.names.has((name + '.git').toLowerCase())) throw new Error('Repository appeared during import; refusing overwrite');
    stage = await mkdtemp(join(root, '.incoming-'));
    const clone = join(stage, 'mirror.git');
    await git(['-c', 'credential.helper=', '-c', 'core.askPass=', 'clone', '--mirror', '--', source, clone], { timeout: 600_000 });
    const refs = await git(['--git-dir', clone, 'for-each-ref', '--format=%(refname)'], { timeout: 180_000 });
    if (!refs.trim()) throw new Error('Source repository has no refs; refusing incomplete mirror');
    await git(['--git-dir', clone, 'fsck', '--full', '--no-reflogs'], { timeout: 180_000 });
    // The imported copy is deliberately detached: subsequent GitHub sync requires separate approval.
    await git(['--git-dir', clone, 'config', '--remove-section', 'remote.origin']);
    const beforePublish = await existingNames(dataDir);
    if (beforePublish.names.has((name + '.git').toLowerCase())) throw new Error('Destination appeared during verification; refusing overwrite');
    await rename(clone, target);
    return { name, status: 'IMPORTED_VERIFIED', refs: refs.split('\n').filter(Boolean).length,
      localPath: target, synchronization: 'DISABLED' };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}

export async function importPublicRepository(catalog, name, dataDir = getDataDir()) {
  if (!catalog || catalog.schema !== SCHEMA || !validOwner(catalog.owner)) throw new Error('Invalid catalog');
  if (!validSlug(name)) throw new Error('Repository name unsupported by GitPorch');
  const item = catalog.repositories.find(x => x.name === name && x.eligible);
  if (!item) throw new Error('Repository is not eligible or not present in the public catalog');
  const source = 'https://github.com/' + catalog.owner + '/' + name + '.git';
  return importMirrorFromSource(name, source, dataDir);
}
