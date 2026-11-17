#!/usr/bin/env node
/**
 * GitPorch x Muse R0.9: READ-ONLY selection of an authentic, ancestry-complete
 * historical slice of the public Vibe Git repository.
 *
 * No clone, checkout, fetch, Muse invocation, writes, pushes, or hooks.
 * The separately approved disposable runner performs Git checkout/import.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HEX40 = /^[a-f0-9]{40}$/;
export const MAX_PILOT_COMMITS = 48;
const MAX_BUFFER = 8 * 1024 * 1024;

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], {
    encoding: null, timeout: 30000, maxBuffer: MAX_BUFFER, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status !== 0) {
    throw new Error('Git preflight ' + args[0] + ' failed: ' +
      (result.error?.message || result.stderr?.toString('utf8') || 'exit ' + result.status).trim().slice(0, 240));
  }
  return result.stdout;
}

function txt(cwd, args) { return git(cwd, args).toString('utf8').trim(); }

function gitRoot(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Source must be an absolute Git working-tree path');
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Source must be a regular directory, not a symlink');
  const root = fs.realpathSync(directory);
  if (fs.realpathSync(txt(root, ['rev-parse', '--show-toplevel'])) !== root) throw new Error('Expected the Git working-tree root');
  if (txt(root, ['rev-parse', '--is-bare-repository']) !== 'false') throw new Error('Bare repositories are not eligible');
  return root;
}

function pathsAt(cwd, sha) {
  const raw = git(cwd, ['ls-tree', '--full-tree', '-r', '-z', '--name-only', sha]);
  return raw.toString('utf8').split('\0').filter(Boolean);
}

export function planVibeHistorySlice(directory, expectedSha) {
  if (typeof expectedSha !== 'string' || !HEX40.test(expectedSha)) throw new Error('Expected an explicit pinned 40-hex Vibe main SHA');
  const root = gitRoot(directory);
  const current = txt(root, ['rev-parse', '--verify', 'refs/heads/main^{commit}']);
  if (current !== expectedSha) throw new Error('Vibe main moved or pinned SHA mismatch; refusing unreviewed history');
  if (txt(root, ['status', '--porcelain=v1', '--untracked-files=all'])) throw new Error('Source working tree is not clean');
  if (txt(root, ['rev-parse', '--is-shallow-repository']) !== 'false') throw new Error('Shallow Git history is unsupported: complete ancestry required');

  const ordered = txt(root, ['rev-list', '--reverse', '--topo-order', 'refs/heads/main']).split('\n').filter(Boolean);
  if (!ordered.length || ordered.some(sha => !HEX40.test(sha))) throw new Error('Invalid Git SHA history');
  const firstParent = new Set(txt(root, ['rev-list', '--first-parent', 'refs/heads/main']).split('\n'));
  const historicalWindow = ordered.slice(0, MAX_PILOT_COMMITS);
  let selected = null;
  for (const sha of historicalWindow.slice().reverse()) {
    if (!firstParent.has(sha)) continue;
    const files = pathsAt(root, sha);
    const specs = files.filter(file => file.endsWith('.vibe'));
    if (!specs.length || files.length > 256) continue;
    selected = { sha, paths: files.length, vibeSpecPaths: specs.sort() };
    break;
  }
  if (!selected) throw new Error('BLOCKED_NO_ELIGIBLE_VIBE_HISTORY: no first-parent main revision with a .vibe file and <=256 tracked paths inside the earliest 48 reachable commits');
  const sliceCount = Number(txt(root, ['rev-list', '--count', selected.sha]));
  if (!Number.isSafeInteger(sliceCount) || sliceCount < 1 || sliceCount > MAX_PILOT_COMMITS) {
    throw new Error('Selected historical slice exceeds 48 complete-ancestry commits');
  }
  if (txt(root, ['merge-base', '--is-ancestor', selected.sha, current]).length !== 0) {
    // "merge-base --is-ancestor" prints nothing when successful; a nonzero exit
    // already throws in git(). This conditional never upgrades an error to pass.
    throw new Error('Selected tip is not reachable from the pinned head');
  }
  return {
    schema: 'gitporch.muse-vibe-r09-slice-plan.v1',
    status: 'READ_ONLY_AUTHENTIC_HISTORY_SLICE_PLAN',
    repository: 'MichaelWave369/Vibe',
    pinnedMainSha: current,
    fullReachableCommitCount: ordered.length,
    selectedGitTip: selected.sha,
    selectedReachableCommitCount: sliceCount,
    selectedTrackedPaths: selected.paths,
    selectedVibeSpecPaths: selected.vibeSpecPaths,
    selectedIsCurrentMain: selected.sha === current,
    historyScope: selected.sha === current ? 'FULL_CURRENT_MAIN_AT_PIN' : 'HISTORICAL_MAIN_ANCESTOR_ONLY_NOT_CURRENT_MAIN',
    sourceMayContainOtherBranches: true,
    caveats: [
      'The selected commit and its complete reachable Git DAG are genuine original Vibe commits; no rewritten history',
      'If selectedIsCurrentMain is false, subsequent Vibe history and recent features are NOT tested',
      'Import/render of .vibe files does NOT prove Muse understands Vibe intent semantics',
      'The existing R0.4 and R0.7 history/blob limits still apply and may fail closed',
      'Planning does not invoke Muse, run source code, fetch remotes, modify Git or push',
    ],
    execution: { writesAttempted: false, networkUsed: false, museInvoked: false, pushesAttempted: false },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, dir, sha, ...extra] = process.argv.slice(2);
    if (action !== 'inspect' || !dir || !sha || extra.length) {
      throw new Error('Usage: node src/muse-vibe-slice.mjs inspect <absolute-existing-public-Vibe-clone> <pinned-main-40hex>');
    }
    console.log(JSON.stringify(planVibeHistorySlice(dir, sha), null, 2));
  } catch (error) {
    console.error('[Muse Vibe R0.9] ' + error.message);
    process.exitCode = 1;
  }
}
