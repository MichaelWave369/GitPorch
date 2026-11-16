#!/usr/bin/env node
/** Read-only Git snapshot comparison for a disposable GitPorch × Muse bridge pilot.
 * No Muse CLI invocation, network calls, pushes, checkouts, or writes.
 * A matching exported snapshot does NOT prove history, provenance, or sync fidelity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MAX_FILES = 1000;
const MAX_BLOB = 16 * 1024 * 1024;

function callGit(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'buffer', timeout: 30000, maxBuffer: MAX_BLOB + 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Git ${args[0]} failed: ${(result.error?.message || result.stderr?.toString('utf8') || `exit ${result.status}`).trim().slice(0, 300)}`);
  }
  return result.stdout;
}

function gitRoot(value, label) {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  const dir = fs.realpathSync(value);
  if (!fs.statSync(dir).isDirectory()) throw new Error(`${label} is not a directory`);
  const actualRoot = callGit(dir, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  if (fs.realpathSync(actualRoot) !== dir) throw new Error(`${label} must be the Git working-tree root`);
  if (callGit(dir, ['rev-parse', '--is-bare-repository']).toString('utf8').trim() !== 'false') {
    throw new Error(`${label} must be a non-bare Git working tree`);
  }
  return dir;
}

function refName(ref) {
  if (!REF.test(ref) || ref.includes('..') || ref.includes('//') || ref.endsWith('.lock') ||
      ref.endsWith('.') || ref.endsWith('/')) throw new Error(`Invalid branch name: ${ref}`);
  return `refs/heads/${ref}`;
}

function gitTree(dir, branch) {
  const ref = refName(branch);
  const head = callGit(dir, ['rev-parse', '--verify', `${ref}^{commit}`]).toString('utf8').trim();
  if (!/^[0-9a-f]{40,64}$/.test(head)) throw new Error('Unexpected Git commit ID');
  const entries = callGit(dir, ['ls-tree', '-r', '-z', '--full-tree', ref]).toString('utf8').split('\0').filter(Boolean);
  if (entries.length > MAX_FILES) throw new Error(`Audit cap exceeded: >${MAX_FILES} tracked paths`);
  const files = new Map();
  for (const entry of entries) {
    const match = /^(100644|100755|120000) blob ([0-9a-f]{40,64})\t([^\0]+)$/.exec(entry);
    if (!match) throw new Error('Unsupported Git tree entry (submodules and unusual modes fail closed)');
    const [, mode, oid, file] = match;
    if (files.has(file)) throw new Error('Duplicate tracked path');
    const bytes = callGit(dir, ['cat-file', 'blob', oid]);
    if (bytes.length > MAX_BLOB) throw new Error(`Blob exceeds audit cap: ${file}`);
    files.set(file, { mode, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { branch, head, fileCount: files.size, files };
}

function overlaps(a, b) {
  const rel = path.relative(a, b);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function auditBridgeSnapshot(source, mirror, options = {}) {
  const sourceDir = gitRoot(source, 'Source');
  const mirrorDir = gitRoot(mirror, 'Mirror');
  if (overlaps(sourceDir, mirrorDir) || overlaps(mirrorDir, sourceDir)) {
    throw new Error('Source and mirror must be separate Git working trees');
  }
  const a = gitTree(sourceDir, options.sourceBranch ?? 'main');
  const b = gitTree(mirrorDir, options.mirrorBranch ?? 'muse-mirror');
  const differences = { missingFromMirror: [], extraInMirror: [], contentMismatch: [], modeMismatch: [] };
  for (const [file, value] of a.files) {
    const other = b.files.get(file);
    if (!other) { differences.missingFromMirror.push(file); continue; }
    if (value.sha256 !== other.sha256) differences.contentMismatch.push(file);
    if (value.mode !== other.mode) differences.modeMismatch.push(file);
  }
  for (const file of b.files.keys()) if (!a.files.has(file)) differences.extraInMirror.push(file);
  for (const value of Object.values(differences)) value.sort();
  const snapshotMatches = Object.values(differences).every(x => x.length === 0);
  return {
    schema: 'gitporch.muse-snapshot-audit.v1',
    status: snapshotMatches ? 'PASS_SNAPSHOT_ONLY' : 'FAIL_SNAPSHOT',
    source: { path: sourceDir, branch: a.branch, head: a.head, fileCount: a.fileCount },
    mirror: { path: mirrorDir, branch: b.branch, head: b.head, fileCount: b.fileCount },
    differences,
    unverified: ['Muse CLI version', 'Git-to-Muse imported commit coverage', 'merge ancestry',
      'historical snapshots', 'author attribution', 'signatures', 'drift', 'remote synchronization'],
    execution: { sourceMutated: false, mirrorMutated: false, museInvoked: false, networkUsed: false, pushAttempted: false },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source, mirror, ...extra] = process.argv.slice(2);
    if (!source || !mirror || extra.length) throw new Error('Usage: node src/muse-bridge-snapshot-audit.mjs <absolute-source-Git-root> <absolute-disposable-mirror-Git-root>');
    const result = auditBridgeSnapshot(source, mirror);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'PASS_SNAPSHOT_ONLY') process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`[Muse snapshot audit] ${error.message}\n`);
    process.exitCode = 1;
  }
}
