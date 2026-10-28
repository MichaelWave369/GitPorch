// PhiOS R0.16: offline restored-source runtime preflight.
// Source inspection, NOT a build, install, execution, app launch or boot proof.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, resolve } from 'node:path';
import { getDataDir } from './git.mjs';
import { offlineRestoreGitEnv } from './homenode-restore-drill.mjs';
import { composeOfflineFieldEvidence } from './homenode-field-evidence.mjs';

const exec = promisify(execFile);
const SCHEMA = 'gitporch.restored-source-launch-preflight.v0.1';
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_ENTRIES = 30000;
const MAX_TREE_BYTES = 6 * 1024 * 1024;
const MAX_SOURCE_JSON_BYTES = 128 * 1024;
const MAX_ENTRY_HTML_BYTES = 128 * 1024;
function deny(s) { throw new Error(s); }
function hash(x) { return createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function branchSafe(s) {
  return typeof s === 'string' && s.length <= 100 &&
    /^[A-Za-z0-9][A-Za-z0-9_.\/-]*$/.test(s) &&
    !s.endsWith('.') && !s.endsWith('/') && !s.endsWith('.lock') &&
    !s.includes('..') && !s.includes('//');
}
async function git(root, args, cap = 1024 * 1024) {
  try {
    const { stdout } = await exec('git', ['--git-dir', root, ...args], {
      env: offlineRestoreGitEnv(), timeout: 120000, windowsHide: true,
      maxBuffer: cap,
    });
    return stdout;
  } catch {
    deny('Restricted local recovered-Git inspection failed or exceeded bounded scope');
  }
}
function treeMap(output) {
  const entries = new Map();
  for (const row of output.split('\0')) {
    if (!row) continue;
    const tab = row.indexOf('\t');
    if (tab <= 0) deny('Malformed recovered Git tree');
    const fields = row.slice(0, tab).split(' ');
    const name = row.slice(tab + 1);
    if (fields.length !== 3 || !/^(100644|100755|120000|160000)$/.test(fields[0]) ||
        !OID.test(fields[2]) || !name || name.includes('\0') ||
        entries.has(name) ||
        (fields[0] === '160000' ? fields[1] !== 'commit' : fields[1] !== 'blob')) {
      deny('Unsupported recovered Git tree entry');
    }
    entries.set(name, { mode: fields[0], oid: fields[2] });
    if (entries.size > MAX_ENTRIES) deny('Recovered tree exceeds 30,000-entry cap');
  }
  return entries;
}
function regular(tree, path) {
  const row = tree.get(path);
  if (!row) return false;
  if (row.mode !== '100644' && row.mode !== '100755') {
    deny('Runtime entry is symlinked or unsupported; cannot classify safely');
  }
  return true;
}
async function blob(root, tree, path, cap) {
  if (!regular(tree, path)) return null;
  const oid = tree.get(path).oid;
  const rawSize = (await git(root, ['cat-file', '-s', oid], 1024)).trim();
  if (!/^\d+$/.test(rawSize) || Number(rawSize) > cap) {
    deny('Runtime source metadata exceeds inspection cap');
  }
  return await git(root, ['cat-file', 'blob', oid], cap + 1024);
}
function packageEvidence(pack, path) {
  if (!pack) return null;
  let parsed;
  try { parsed = JSON.parse(pack); }
  catch { deny('Recovered package.json contains invalid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      (parsed.scripts !== undefined &&
       (typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)))) {
    deny('Recovered package.json metadata unsupported');
  }
  const dep = parsed.dependencies && typeof parsed.dependencies === 'object' ?
    parsed.dependencies : {};
  const dev = parsed.devDependencies && typeof parsed.devDependencies === 'object' ?
    parsed.devDependencies : {};
  return {
    path,
    viteDeclared: Object.hasOwn(dep, 'vite') || Object.hasOwn(dev, 'vite') ||
      typeof parsed.scripts?.build === 'string' && /\bvite\s+build\b/.test(parsed.scripts.build),
    typescriptDeclared: Object.hasOwn(dep, 'typescript') || Object.hasOwn(dev, 'typescript'),
    hasBuildScript: typeof parsed.scripts?.build === 'string',
    dependenciesDeclared: Object.keys(dep).length + Object.keys(dev).length,
    packagesInstalledAndVerified: false,
    buildExecuted: false,
  };
}
function webEntryEvidence(tree, sitePackage, html) {
  const built = regular(tree, 'site/dist/index.html') ||
    regular(tree, 'dist/index.html');
  const src = regular(tree, 'site/index.html') ||
    regular(tree, 'index.html');
  const entryPath = regular(tree, 'site/index.html') ? 'site/index.html' :
    regular(tree, 'index.html') ? 'index.html' : null;
  const htmlUsesSource = Boolean(html &&
    /<script\b[^>]*\b(?:src)=["'](?:\/src\/|\.\/src\/|src\/)[^"']+\.(?:ts|tsx)["']/i.test(html));
  const packages = Boolean(sitePackage);
  let status;
  if (built) status = 'BUILT_HTML_TRACKED_RUNTIME_NOT_VERIFIED';
  else if (packages && (sitePackage.viteDeclared || htmlUsesSource)) {
    status = 'VITE_OR_TYPED_SOURCE_REQUIRES_OFFLINE_BUILD';
  } else if (src) status = 'WEB_SOURCE_ENTRY_PRESENT_EXECUTION_NOT_VERIFIED';
  else status = 'NO_WEB_ENTRY_DETECTED_UNVERIFIED';
  return { status, sourceEntryPath: entryPath,
    builtHtmlTrackedInGit: built, sourceHtmlTrackedInGit: src,
    viteSourceEntryDetected: htmlUsesSource, runtimeServed: false,
    browserLoaded: false, assetsClosureVerified: false,
    dependenciesInstalledOffline: false };
}
/**
 * Only reads a previously verified portable kit and restored bare repo via
 * R0.15, then inspects one pinned Git tree. Never extracts or launches code.
 */
export async function preflightRecoveredRuntime(
  manifestFile, copiedKitRoot, restoredBareRepo, branch,
  dataDir = getDataDir(), checks = {},
) {
  if (!branchSafe(branch)) deny('A safe exact branch is required');
  if (typeof restoredBareRepo !== 'string' || !isAbsolute(restoredBareRepo)) {
    deny('Absolute restored bare repository path required');
  }
  const restored = resolve(restoredBareRepo);
  const field = await (checks.field ?? composeOfflineFieldEvidence)(
    manifestFile, copiedKitRoot, restored, 'none', dataDir);
  if (field.schema !== 'gitporch.offline-field-evidence.v0.1' ||
      field.status !== 'COPIED_KIT_AND_RESTORED_GIT_TECHNICALLY_RECHECKED_ONLY' ||
      field.restoredGit?.gitRefParityWithCopiedSnapshot !== true ||
      field.acceptance?.completeOfflineRecoveryVerified !== false) {
    deny('R0.15 copied-kit/restored-Git checks have not passed');
  }
  const pinned = (await git(restored, ['rev-parse', '--verify',
    'refs/heads/' + branch + '^{commit}'], 1024)).trim();
  if (!OID.test(pinned)) deny('Invalid recovered branch commit');
  const tree = treeMap(await git(restored, ['ls-tree', '-r', '-z', pinned], MAX_TREE_BYTES));
  const selectedPackagePath = regular(tree, 'site/package.json') ?
    'site/package.json' : regular(tree, 'package.json') ? 'package.json' : null;
  const pkg = selectedPackagePath ?
    packageEvidence(await blob(restored, tree, selectedPackagePath,
      MAX_SOURCE_JSON_BYTES), selectedPackagePath) : null;
  const htmlPath = regular(tree, 'site/index.html') ? 'site/index.html' :
    regular(tree, 'index.html') ? 'index.html' : null;
  const html = htmlPath ? await blob(restored, tree, htmlPath, MAX_ENTRY_HTML_BYTES) : null;
  const locks = ['site/package-lock.json', 'site/pnpm-lock.yaml', 'site/yarn.lock',
    'site/bun.lock', 'site/bun.lockb', 'package-lock.json', 'pnpm-lock.yaml',
    'yarn.lock', 'bun.lock', 'bun.lockb'].filter(path => regular(tree, path));
  const python = ['pyproject.toml', 'requirements.txt', 'setup.py',
    'Pipfile.lock', 'poetry.lock', 'uv.lock'].filter(path => regular(tree, path));
  const os = ['build/build_iso.sh', 'packaging/linux/release.json',
    'build/archiso-profile/profiledef.sh'].filter(path => regular(tree, path));
  const web = webEntryEvidence(tree, pkg, html);
  const branchAfter = (await git(restored, ['rev-parse', '--verify',
    'refs/heads/' + branch + '^{commit}'], 1024)).trim();
  if (branchAfter !== pinned) deny('Recovered Git branch moved during runtime preflight');
  const report = {
    schema: SCHEMA, repository: field.repository, branch,
    pinnedCommit: pinned,
    mode: 'OFFLINE_RESTORED_GIT_SOURCE_INSPECTION_ONLY',
    status: 'LAUNCH_PREREQUISITES_IDENTIFIED_NOT_EXECUTED',
    foundation: {
      copiedKitSha256: field.kit.manifestSha256,
      restoredBundleSha256: field.kit.bundleSha256,
      restoredGitRefsVerified: field.restoredGit.gitRefParityWithCopiedSnapshot,
      sourceGitCommitPinned: true,
    },
    web: {
      ...web,
      packageEvidence: pkg,
      lockfilesTracked: locks,
      lockfileTracked: locks.length > 0,
      lockfileCoversAllDependencies: false,
    },
    python: {
      trackedDependencyOrBuildManifests: python,
      interpreterPresentOnTestMachine: null,
      venvReconstructedOffline: false,
      importsVerifiedOffline: false,
    },
    linuxOS: {
      trackedBuildOrReleaseSources: os,
      liveISOImageVerifiedPresent: false,
      bootableInstalledOSTested: false,
      actualHardwareQualified: false,
    },
    tree: {
      totalTrackedEntries: tree.size,
      symlinkEntries: [...tree.values()].filter(v => v.mode === '120000').length,
      gitlinkEntries: [...tree.values()].filter(v => v.mode === '160000').length,
    },
    acceptance: {
      offlineNpmBuildPassed: false,
      siteServedAndBrowserVerifiedOffline: false,
      offlinePythonRuntimeExecuted: false,
      linuxOSBootedOffline: false,
      physicalWanDisconnectionVerified: false,
      separateMediaIdentityVerified: false,
      completePhiOSRecoveryVerified: false,
    },
    notice: 'Only pinned recovered Git source and tracked metadata are inspected. Local node_modules, installed wheels, pip/npm caches, generated dist artifacts outside Git, native packages, runtime APIs, all submodules and network calls are NOT verified. A source index.html referencing TSX is not a standalone offline site. No install, build, code extraction, execution, network or persistent write. CI fixtures do not qualify real hardware.',
  };
  return { ...report, reportSha256: hash(report) };
}
