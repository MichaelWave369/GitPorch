import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, lstat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_LOCAL_REPOSITORIES, LOCAL_REPOSITORY_SCAN_CONCURRENCY, validLocalRepositoryName, assertLocalRepositoryCapacity } from './repository-policy.mjs';

const exec = promisify(execFile);
const here = fileURLToPath(new URL('..', import.meta.url));
export const defaultDataDir = resolve(here, 'data');
export const validSlug = validLocalRepositoryName;

export function getDataDir(value = process.env.GITPORCH_DATA_DIR) {
  return value ? resolve(value) : defaultDataDir;
}

export function repoRoot(dataDir) { return resolve(dataDir, 'repos'); }

function repoPath(dataDir, name) {
  if (!validSlug(name)) throw new Error('Invalid repo name (letters, numbers, dot, dash, underscore; max 48)');
  const root = repoRoot(dataDir);
  const path = resolve(root, `${name}.git`);
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel) || !rel) throw new Error('Unsafe repository path');
  return path;
}

export async function git(args, options = {}) {
  const { stdout } = await exec('git', args, {
    timeout: options.timeout ?? 8000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    cwd: options.cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trimEnd();
}

async function ensureRepos(dataDir) {
  const base = repoRoot(dataDir);
  await mkdir(base, { recursive: true });
  if (!(await lstat(base)).isDirectory()) throw new Error('Repository root is not a directory');
  return base;
}

export async function createRepo(dataDir, name) {
  const root = await ensureRepos(dataDir);
  const path = repoPath(dataDir, name);
  const existing = await readdir(root);
  if (existing.some((entry) => entry.toLowerCase() === `${name}.git`.toLowerCase())) {
    throw new Error('Repository already exists (names are case-insensitive)');
  }
  if (existing.filter(entry => entry.toLowerCase().endsWith('.git')).length >= MAX_LOCAL_REPOSITORIES) {
    throw new Error('GitPorch ' + MAX_LOCAL_REPOSITORIES + '-repository capacity reached; refusing create');
  }
  // No shell, no user-provided flags, explicit path position, bare only.
  await git(['init', '--bare', '--initial-branch=main', '--', path]);
  return { name, path };
}

async function findBareRepos(dataDir) {
  const root = await ensureRepos(dataDir);
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = entries.filter(ent => ent.isDirectory() && ent.name.toLowerCase().endsWith('.git'));
  // Never silently drop unsupported repo directories: they may contain the only copy.
  const unsupported = candidates.filter(ent => !validSlug(ent.name.slice(0, -4)));
  if (unsupported.length) throw new Error('Unsupported local Git repository directory; inspect manually: ' +
    unsupported[0].name);
  assertLocalRepositoryCapacity(candidates.length);
  const repos = candidates.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return repos.map(ent => ({ name: ent.name.slice(0, -4), path: join(root, ent.name) }));
}

async function boundedMap(items, limit, fn) {
  const values = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      values[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return values;
}

export async function listRepos(dataDir) {
  const repos = await findBareRepos(dataDir);
  return boundedMap(repos, LOCAL_REPOSITORY_SCAN_CONCURRENCY, async ({ name, path }) => {
    const [head, output] = await Promise.all([
      git(['--git-dir', path, 'symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => 'main'),
      git(['--git-dir', path, 'for-each-ref', '--sort=-committerdate',
        '--format=%(refname:short)%09%(objectname:short)%09%(subject)%09%(committerdate:iso8601-strict)', 'refs/heads/']),
    ]);
    const lines = output ? output.split('\n').filter(Boolean) : [];
    const branches = lines.map(line => line.split('\t')[0]);
    const parts = lines[0]?.split('\t') ?? [];
    return {
      name, defaultBranch: head, branches,
      latest: parts.length >= 4 ? { branch: parts[0], hash: parts[1], subject: parts[2], date: parts[3] } : null,
      cloneUrl: `git://127.0.0.1:${getGitPort()}/${encodeURIComponent(name)}.git`,
      localPushPath: path,
    };
  });
}

export async function readCommits(dataDir, name, limit = 12) {
  const path = repoPath(dataDir, name);
  const available = await findBareRepos(dataDir);
  if (!available.some(x => x.name === name)) return null;
  const n = Math.min(Math.max(Number(limit) || 12, 1), 30);
  const output = await git(['--git-dir', path, 'log', '--all', `--max-count=${n}`,
    '--date=iso-strict', '--format=%h%x1f%an%x1f%aI%x1f%s']);
  return output ? output.split('\n').filter(Boolean).map(line => {
    const [hash, author, date, subject] = line.split('\x1f');
    return { hash, author, date, subject };
  }) : [];
}

export async function verifyRepo(dataDir, name) {
  const path = repoPath(dataDir, name);
  const available = await findBareRepos(dataDir);
  if (!available.some(x => x.name === name)) throw new Error('Repository not found');
  await git(['--git-dir', path, 'fsck', '--full', '--no-reflogs'], { timeout: 30000 });
  return { name, status: 'PASS', verification: 'git fsck --full --no-reflogs', note: 'Integrity check, not a CI test or security attestation' };
}

export function getHttpPort() {
  const port = Number(process.env.GITPORCH_HTTP_PORT ?? 3690);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid GITPORCH_HTTP_PORT');
  return port;
}
export function getGitPort() {
  const port = Number(process.env.GITPORCH_GIT_PORT ?? 9418);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid GITPORCH_GIT_PORT');
  return port;
}
