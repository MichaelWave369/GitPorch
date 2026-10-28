// R0.2: read-only, offline audit of a public GitHub catalog against local bare mirrors.
// No imports, hooks, GitHub fetch, network API, file writes, or execution authority.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { devNull } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getDataDir, validSlug } from './git.mjs';
import { MAX_LOCAL_REPOSITORIES } from './repository-policy.mjs';

const exec = promisify(execFile);
const SCHEMA = 'gitporch.public-mirror-audit.v1';
const CATALOG_SCHEMA = 'gitporch.public-catalog.v1';
const MAX_CATALOG = 3000;
const CONCURRENCY = 4;
const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SAFE_SOURCE_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const VALID_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function reject(message) { throw new Error(message); }
function samePath(a, b) {
  const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
  return canonical(resolve(a)) === canonical(resolve(b));
}
async function kind(path) {
  try { return await lstat(path); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return reject('Cannot safely inspect local store');
  }
}
async function assertRealDirectory(path) {
  const st = await kind(path);
  if (!st || !st.isDirectory() || st.isSymbolicLink() || !samePath(await realpath(path), path)) {
    reject('Local mirror store is missing or redirects through a link');
  }
}
function auditCatalog(catalog) {
  if (!catalog || catalog.schema !== CATALOG_SCHEMA || catalog.visibility !== 'PUBLIC_ONLY' ||
      typeof catalog.owner !== 'string' || !VALID_OWNER.test(catalog.owner) ||
      !Array.isArray(catalog.repositories) || !Number.isSafeInteger(catalog.count) ||
      catalog.count !== catalog.repositories.length || catalog.count > MAX_CATALOG) {
    reject('Untrusted or malformed public catalog');
  }
  const names = new Set();
  for (const r of catalog.repositories) {
    if (!r || typeof r.name !== 'string' || !SAFE_SOURCE_NAME.test(r.name) ||
        r.name === '.' || r.name === '..' || names.has(r.name.toLowerCase())) {
      reject('Unsafe or duplicate public-catalog name');
    }
    names.add(r.name.toLowerCase());
  }
}

const SAFE_ENV_FIELDS = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TMP', 'TEMP', 'TMPDIR',
];
function offlineGitEnv() {
  const env = Object.fromEntries(SAFE_ENV_FIELDS.filter(k => process.env[k] !== undefined)
    .map(k => [k, process.env[k]]));
  return {
    ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull, GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_LFS_SKIP_SMUDGE: '1',
    GIT_ALLOW_PROTOCOL: 'file', GIT_PROTOCOL_FROM_USER: '0',
  };
}
async function localGit(args) {
  const { stdout } = await exec('git', args, {
    env: offlineGitEnv(), windowsHide: true, timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trimEnd();
}
async function hasUnsupportedObjectStorage(path) {
  const alternates = await kind(join(path, 'objects', 'info', 'alternates'));
  if (alternates) return true;
  const config = await readFile(join(path, 'config'), 'utf8');
  if (/\b(?:partialclone|promisor)\b/i.test(config)) return true;
  const packPath = join(path, 'objects', 'pack');
  const packSt = await kind(packPath);
  if (packSt && (!packSt.isDirectory() || packSt.isSymbolicLink())) return true;
  if (packSt) {
    const entries = await readdir(packPath, { withFileTypes: true });
    if (entries.some(d => d.name.endsWith('.promisor') || d.isSymbolicLink())) return true;
  }
  return false;
}
async function inspectMirror(path) {
  try {
    const st = await kind(path);
    if (!st || !st.isDirectory() || st.isSymbolicLink() || !samePath(await realpath(path), path)) {
      return { status: 'LOCAL_UNSAFE_LAYOUT' };
    }
    for (const [name, type] of [['HEAD', 'file'], ['config', 'file'], ['objects', 'dir'], ['refs', 'dir']]) {
      const child = await kind(join(path, name));
      if (!child || child.isSymbolicLink() ||
          !(type === 'file' ? child.isFile() : child.isDirectory())) {
        return { status: 'LOCAL_UNSAFE_LAYOUT' };
      }
    }
    if (await hasUnsupportedObjectStorage(path)) {
      return { status: 'LOCAL_UNSUPPORTED_OBJECT_STORAGE' };
    }
    const bare = await localGit(['--git-dir', path, 'rev-parse', '--is-bare-repository']);
    if (bare !== 'true') return { status: 'LOCAL_VERIFICATION_FAILED' };
    const output = await localGit(['--git-dir', path, 'for-each-ref', '--format=%(refname)%09%(objectname)']);
    const refs = output ? output.split('\n').filter(Boolean).sort() : [];
    if (refs.length === 0 || refs.length > 100_000 || refs.some(line => {
      const parts = line.split('\t');
      return parts.length !== 2 || !parts[0].startsWith('refs/') || !HEX.test(parts[1]);
    })) return { status: 'LOCAL_VERIFICATION_FAILED' };
    await localGit(['--git-dir', path, 'fsck', '--full', '--strict', '--no-reflogs']);
    const sha256 = createHash('sha256').update(refs.join('\n') + '\n', 'utf8').digest('hex');
    return { status: 'LOCAL_GIT_OBJECTS_VERIFIED_ONLY', refCount: refs.length, refsSha256: sha256 };
  } catch {
    // Never place Git errors, local paths or credentials in public-facing output.
    return { status: 'LOCAL_VERIFICATION_FAILED' };
  }
}
async function boundedMap(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// Loads an operator-selected public catalog. Authenticity of the GitHub
// source is NOT independently established by this schema check.
export async function auditPublicMirrors(catalog, dataDir = getDataDir()) {
  auditCatalog(catalog);
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) {
    reject('A local absolute GitPorch data directory is required');
  }
  const base = resolve(dataDir);
  const store = join(base, 'repos');
  const baseStat = await kind(base);
  const storeStat = await kind(store);
  const local = new Map();
  if (baseStat || storeStat) {
    await assertRealDirectory(base);
    await assertRealDirectory(store);
    const entries = await readdir(store, { withFileTypes: true });
    const sourceRepos = entries.filter(entry => entry.name.toLowerCase().endsWith('.git'));
    if (sourceRepos.length > MAX_LOCAL_REPOSITORIES) reject('Local store exceeds capacity');
    for (const entry of sourceRepos) {
      const name = entry.name.slice(0, -4);
      const key = name.toLowerCase();
      if (local.has(key)) {
        local.set(key, { duplicate: true });
      } else {
        local.set(key, { path: join(store, entry.name), safe: entry.isDirectory() && !entry.isSymbolicLink() });
      }
    }
  }
  const results = await boundedMap(catalog.repositories, async r => {
    const match = local.get(r.name.toLowerCase());
    if (!validSlug(r.name)) return { name: r.name, status: 'UNSUPPORTED_NAME' };
    if (!match) return { name: r.name, status: 'NOT_LOCAL' };
    if (match.duplicate || !match.safe) return { name: r.name, status: 'LOCAL_UNSAFE_LAYOUT' };
    return { name: r.name, ...await inspectMirror(match.path) };
  });
  const summary = {
    total: results.length,
    objectsVerifiedOnly: results.filter(r => r.status === 'LOCAL_GIT_OBJECTS_VERIFIED_ONLY').length,
    notLocal: results.filter(r => r.status === 'NOT_LOCAL').length,
    unsupportedNames: results.filter(r => r.status === 'UNSUPPORTED_NAME').length,
    unsafeOrUnsupported: results.filter(r => r.status === 'LOCAL_UNSAFE_LAYOUT' ||
      r.status === 'LOCAL_UNSUPPORTED_OBJECT_STORAGE').length,
    verificationFailed: results.filter(r => r.status === 'LOCAL_VERIFICATION_FAILED').length,
  };
  return {
    schema: SCHEMA, catalogOwner: catalog.owner, catalogCount: catalog.count,
    mode: 'OFFLINE_READ_ONLY_LOCAL_OBJECT_AUDIT',
    summary,
    acceptance: {
      remoteSourceAuthenticated: false, githubRefParityVerified: false,
      lfsAndSubmodulesVerified: false, releasesAndPrMetadataBackedUp: false,
      offHostRestoreVerified: false, wanDisconnectedTested: false, offlineReady: false,
    },
    notice: 'No network, GitHub sync, clone, credential access, mirror modification, or file write. Local Git fsck/ref hash alone does not prove matching GitHub, complete backup or offline recoverability.',
    repositories: results,
  };
}
