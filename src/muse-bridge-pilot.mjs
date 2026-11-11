#!/usr/bin/env node
/**
 * GitPorch x Muse: OFFLINE, plan-only compatibility preparation.
 * This module never invokes Muse, fetches a URL, or pushes to a remote.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA_RE = /^[0-9a-f]{40,64}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || result.status !== 0) {
    throw new Error('Git command failed (' + args[0] + '): ' +
      (result.error?.message || result.stderr || 'exit ' + result.status).trim().slice(0, 400));
  }
  return result.stdout.trim();
}

function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(label + ' must be an absolute filesystem path');
  }
  return path.resolve(value);
}

function safeRef(value, label) {
  if (!REF_RE.test(value) || value.includes('..') || value.includes('//') ||
      value.endsWith('.lock') || value.endsWith('.') || value.includes('@{')) {
    throw new Error('Unsafe ' + label + ': ' + value);
  }
  return value;
}

function overlaps(a, b) {
  const relative = path.relative(a, b);
  return relative === '' || (!relative.startsWith('..' + path.sep) &&
    relative !== '..' && !path.isAbsolute(relative));
}

function requireDistinctPaths(paths) {
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      if (overlaps(paths[i], paths[j]) || overlaps(paths[j], paths[i])) {
        throw new Error('Source, Muse destination, and mirror must be disjoint');
      }
    }
  }
}

export function inspectGitRepository(source, branch = 'main') {
  const dir = absolute(source, 'Git source');
  safeRef(branch, 'Git branch');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('Git source does not exist as a directory');
  }
  const root = path.resolve(git(dir, ['rev-parse', '--show-toplevel']));
  if (fs.realpathSync(root) !== fs.realpathSync(dir)) {
    throw new Error('Git source must be the repository root, not a nested path');
  }
  if (git(dir, ['rev-parse', '--is-bare-repository']) !== 'false') {
    throw new Error('This pilot requires an isolated non-bare Git checkout');
  }
  const sha = git(dir, ['rev-parse', '--verify', 'refs/heads/' + branch + '^{commit}']);
  if (!SHA_RE.test(sha)) throw new Error('Unable to verify Git branch commit');
  const dirty = git(dir, ['status', '--porcelain=v1', '--untracked-files=all']);
  const tree = git(dir, ['ls-tree', '-r', branch]).split('\n').filter(Boolean);
  return {
    path: dir,
    branch,
    head: sha,
    clean: dirty.length === 0,
    commitCount: Number(git(dir, ['rev-list', '--count', branch])),
    mergeCount: Number(git(dir, ['rev-list', '--count', '--merges', branch])),
    fileCount: tree.length,
    executableFileCount: tree.filter(line => line.startsWith('100755 ')).length,
    symlinkCount: tree.filter(line => line.startsWith('120000 ')).length,
  };
}

export function makeBridgePlan({ source, museDir, mirrorDir, branch = 'main' }) {
  const gitSource = absolute(source, 'Git source');
  const muse = absolute(museDir, 'Muse destination');
  const mirror = absolute(mirrorDir, 'Git mirror destination');
  requireDistinctPaths([gitSource, muse, mirror]);
  if (fs.existsSync(muse) || fs.existsSync(mirror)) {
    throw new Error('Muse and mirror destinations must NOT exist; use fresh disposable paths');
  }
  const inspected = inspectGitRepository(gitSource, branch);
  if (!inspected.clean) throw new Error('Git source has working-tree changes; use a clean disposable copy');
  return {
    schema: 'gitporch.muse-bridge-readiness.v1',
    status: 'PLAN_ONLY_AWAITING_RELEASE_CANDIDATE',
    createdAt: new Date().toISOString(),
    source: inspected,
    destinations: { muse, mirror },
    commandsForHumanReview: [
      { cwd: muse, argv: ['muse', 'init'], note: 'First create this empty directory manually' },
      { cwd: muse, argv: ['muse', 'bridge', 'git-import', gitSource, '--branch', branch, '--json'] },
      { cwd: muse, argv: ['muse', 'bridge', 'git-status', '--git-dir', gitSource, '--json'] },
      { cwd: muse, argv: ['muse', 'bridge', 'git-export', '--git-dir', mirror,
          '--git-branch', 'muse-mirror', '--no-push', '--json'],
        note: 'First initialize a separate, disposable Git mirror; never export into source' },
    ],
    passCriteria: [
      'Review release-candidate version and documentation before executing anything',
      'Compare imported per-commit metadata against Git SHAs; do not assume merge topology parity',
      'Compare final tracked file snapshots; do not assume executable modes are retained',
      'Export to a disposable Git checkout with --no-push',
      'Inspect exported tree, deletion set, untracked files, and drift report',
      'Keep all production repositories, remotes and GitHub CI untouched',
    ],
    execution: { museInvoked: false, networkUsed: false, gitPushAttempted: false },
  };
}

function write(root, filename, contents) {
  const dest = path.join(root, filename);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, contents, 'utf8');
}

export function createDisposableFixture(directory, approved = false) {
  if (!approved) throw new Error('Fixture creation requires --i-approve-disposable-fixture');
  const target = absolute(directory, 'Fixture target');
  if (fs.existsSync(target)) throw new Error('Fixture target already exists: refusing overwrite');
  if (!fs.existsSync(path.dirname(target))) throw new Error('Fixture parent directory must exist');
  fs.mkdirSync(target);
  git(target, ['init', '--initial-branch=main']);
  git(target, ['config', '--local', 'user.name', 'GitPorch Pilot']);
  git(target, ['config', '--local', 'user.email', 'gitporch-pilot@example.invalid']);
  git(target, ['config', '--local', 'commit.gpgsign', 'false']);
  write(target, 'README.md', '# Synthetic Git/Muse Bridge Fixture\n');
  write(target, 'obsolete.txt', 'Delete me on main.\n');
  git(target, ['add', '.']);
  git(target, ['commit', '-m', 'fixture: starting point']);
  git(target, ['checkout', '-b', 'feature']);
  write(target, 'src/feature.js', 'export const answer = 369;\n');
  git(target, ['add', '.']);
  git(target, ['commit', '-m', 'fixture: feature branch commit']);
  git(target, ['checkout', 'main']);
  write(target, 'README.md', '# Synthetic Git/Muse Bridge Fixture\nMain branch changed.\n');
  git(target, ['add', 'README.md']);
  git(target, ['commit', '-m', 'fixture: main branch diverges']);
  git(target, ['merge', '--no-ff', 'feature', '-m', 'fixture: merge feature']);
  fs.unlinkSync(path.join(target, 'obsolete.txt'));
  git(target, ['add', '-u']);
  git(target, ['commit', '-m', 'fixture: tracked deletion']);
  write(target, 'scripts/run.sh', '#!/bin/sh\necho fixture\n');
  fs.chmodSync(path.join(target, 'scripts/run.sh'), 0o755);
  git(target, ['add', 'scripts/run.sh']);
  git(target, ['update-index', '--chmod=+x', 'scripts/run.sh']);
  git(target, ['commit', '-m', 'fixture: executable file mode']);
  git(target, ['fsck', '--no-reflogs', '--full']);
  return {
    status: 'LOCAL_SYNTHETIC_GIT_FIXTURE_CREATED',
    fixture: inspectGitRepository(target),
    networkUsed: false,
    museInvoked: false,
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'fixture' && args.length === 2 &&
      args[1] === '--i-approve-disposable-fixture') {
    console.log(JSON.stringify(createDisposableFixture(args[0], true), null, 2));
    return;
  }
  if (command === 'plan' && args.length === 3) {
    console.log(JSON.stringify(makeBridgePlan({
      source: args[0], museDir: args[1], mirrorDir: args[2],
    }), null, 2));
    return;
  }
  if (command === 'inspect' && args.length === 1) {
    console.log(JSON.stringify(inspectGitRepository(args[0]), null, 2));
    return;
  }
  throw new Error('Usage:\n' +
    '  node src/muse-bridge-pilot.mjs fixture <new-absolute-path> --i-approve-disposable-fixture\n' +
    '  node src/muse-bridge-pilot.mjs inspect <existing-absolute-git-root>\n' +
    '  node src/muse-bridge-pilot.mjs plan <existing-absolute-git-root> <new-absolute-muse-path> <new-absolute-git-mirror-path>\n' +
    'This pilot NEVER executes Muse or performs Git push.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('[Muse Bridge Pilot] ' + error.message);
    process.exitCode = 1;
  });
}
