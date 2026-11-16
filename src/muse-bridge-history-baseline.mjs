#!/usr/bin/env node
/**
 * GitPorch x Muse R0.4: Git-only, read-only history baseline for a disposable
 * source fixture. No Muse execution, remote operations, checkout or mutations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40,64}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const LIMITS = Object.freeze({ commits: 96, filesPerCommit: 512, uniqueBlobs: 2048, blobBytes: 8 * 1024 * 1024, totalBlobBytes: 64 * 1024 * 1024 });

function git(cwd, args, maxBuffer = 2 * 1024 * 1024) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'buffer', timeout: 20000, maxBuffer, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status !== 0) {
    throw new Error('Git ' + args[0] + ' failed: ' +
      (result.error?.message || result.stderr?.toString('utf8') || 'exit ' + result.status).trim().slice(0, 300));
  }
  return result.stdout;
}

function rootOf(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Git root must be an absolute path');
  const real = fs.realpathSync(directory);
  if (!fs.statSync(real).isDirectory()) throw new Error('Git root is not a directory');
  const found = git(real, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  if (fs.realpathSync(found) !== real) throw new Error('Source must be a Git working-tree root, not a nested directory');
  if (git(real, ['rev-parse', '--is-bare-repository']).toString('utf8').trim() !== 'false') {
    throw new Error('Source must be a non-bare Git working tree');
  }
  return real;
}

function branchRef(name) {
  if (typeof name !== 'string' || !REF.test(name) || name.includes('..') || name.includes('//') ||
      name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) {
    throw new Error('Unsafe Git branch name');
  }
  return 'refs/heads/' + name;
}

function blobRows(dir, commitSha, blobCache, budget) {
  const bytes = git(dir, ['ls-tree', '--full-tree', '-r', '-z', commitSha], 2 * 1024 * 1024);
  const rows = [];
  let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(0, offset);
    if (end < 0) throw new Error('Malformed NUL-delimited Git tree');
    const entry = bytes.subarray(offset, end);
    offset = end + 1;
    if (entry.length === 0) continue;
    const tab = entry.indexOf(9);
    if (tab < 0) throw new Error('Malformed Git tree entry');
    const header = entry.subarray(0, tab).toString('ascii');
    const match = /^(100644|100755|120000) blob ([0-9a-f]{40,64})$/.exec(header);
    if (!match) throw new Error('Unsupported Git tree entry: submodules and non-blob modes fail closed');
    const nameBytes = entry.subarray(tab + 1);
    const filename = nameBytes.toString('utf8');
    if (!nameBytes.equals(Buffer.from(filename, 'utf8'))) throw new Error('Non-UTF-8 Git path unsupported');
    if (!filename || filename.includes('\0')) throw new Error('Invalid Git path');
    const oid = match[2];
    if (!blobCache.has(oid)) {
      if (blobCache.size >= LIMITS.uniqueBlobs) throw new Error('Unique blob count exceeds audit cap');
      const sizeText = git(dir, ['cat-file', '-s', oid]).toString('utf8').trim();
      const size = Number(sizeText);
      if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.blobBytes ||
          budget.bytes + size > LIMITS.totalBlobBytes) {
        throw new Error('Git blob size exceeds history audit cap');
      }
      const blob = git(dir, ['cat-file', 'blob', oid], LIMITS.blobBytes + 1024);
      if (blob.length !== size) throw new Error('Git blob byte count differs from declared size');
      budget.bytes += size;
      blobCache.set(oid, createHash('sha256').update(blob).digest('hex'));
    }
    rows.push({ path: filename, mode: match[1], sha256: blobCache.get(oid) });
    if (rows.length > LIMITS.filesPerCommit) throw new Error('Tracked files per commit exceed audit cap');
  }
  return rows;
}

export function createGitHistoryBaseline(directory, branch = 'main') {
  const source = rootOf(directory);
  const ref = branchRef(branch);
  const head = git(source, ['rev-parse', '--verify', ref + '^{commit}']).toString('utf8').trim();
  if (!SHA.test(head)) throw new Error('Unexpected Git head SHA');
  const lines = git(source, ['rev-list', '--reverse', '--topo-order', '--parents', ref]).toString('utf8').trim().split('\n').filter(Boolean);
  if (!lines.length || lines.length > LIMITS.commits) throw new Error('Reachable commit count exceeds audit cap');
  const blobCache = new Map();
  const budget = { bytes: 0 };
  const commits = [];
  const encountered = new Set();
  for (const line of lines) {
    const [gitSha, ...parents] = line.split(' ');
    if (!SHA.test(gitSha) || parents.some(parent => !SHA.test(parent))) throw new Error('Invalid commit SHA in Git history');
    if (encountered.has(gitSha)) throw new Error('Repeated Git commit');
    if (parents.some(parent => !encountered.has(parent))) throw new Error('Git history was not produced in parent-before-child order');
    encountered.add(gitSha);
    const files = blobRows(source, gitSha, blobCache, budget);
    const snapshotSha256 = createHash('sha256').update(JSON.stringify(files.map(file => [file.path, file.mode, file.sha256]))).digest('hex');
    commits.push({ gitSha, parents, isMerge: parents.length > 1, trackedFiles: files.length, snapshotSha256, files });
  }
  if (commits.at(-1)?.gitSha !== head) throw new Error('Git branch head changed or missing during baseline');
  return {
    schema: 'gitporch.muse-git-history-baseline.v1', status: 'GIT_ONLY_BASELINE',
    source: { branch, head, commitCount: commits.length },
    digestRule: 'SHA-256 of UTF-8 JSON array of [path,gitMode,blobSha256] in Git ls-tree ordering',
    commits,
    limits: LIMITS,
    unverified: ['Muse CLI version', 'Muse commit parent mapping', 'Muse historical snapshots',
      'Muse import completeness', 'Muse attribution and signatures', 'Muse-to-Git export behavior'],
    execution: { museInvoked: false, networkUsed: false, writesAttempted: false, pushesAttempted: false },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [root, branch = 'main', ...rest] = process.argv.slice(2);
    if (!root || rest.length) throw new Error('Usage: node src/muse-bridge-history-baseline.mjs <absolute-disposable-Git-root> [branch]');
    process.stdout.write(JSON.stringify(createGitHistoryBaseline(root, branch), null, 2) + '\n');
  } catch (error) {
    process.stderr.write('[Muse Git baseline] ' + error.message + '\n');
    process.exitCode = 1;
  }
}
