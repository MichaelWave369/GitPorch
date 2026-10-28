// R0.6: deliberately scoped, network-silent Git-tip external dependency census.
// No file downloads, Git LFS smudge, submodule update, release API, app execution or writes.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, isAbsolute } from 'node:path';
import { getDataDir } from './git.mjs';
import { offlineRestoreGitEnv } from './homenode-restore-drill.mjs';
import { parseBatchNames } from './homenode-batch.mjs';
import { auditPublicMirrors } from './homenode-mirror-audit.mjs';

const exec = promisify(execFile);
const OWNER = 'MichaelWave369';
const SCHEMA = 'gitporch.public-external-asset-gaps.v0.1';
const HEAD_LIMIT = 8;
const TREE_ENTRY_LIMIT = 30_000;
const ATTR_FILE_LIMIT = 64;
const POINTER_FILE_LIMIT = 128;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LFS_VERSION = 'version https://git-lfs.github.com/spec/v1';
const GREP_LFS = '^version https://git-lfs.github.com/spec/v1$';

function deny(message) { throw new Error(message); }
async function localGit(args, maxBuffer = 1024 * 1024, noMatchOk = false) {
  try {
    const { stdout } = await exec('git', args, {
      env: offlineRestoreGitEnv(), timeout: 120_000, windowsHide: true, maxBuffer,
    });
    return stdout;
  } catch (e) {
    if (noMatchOk && e?.code === 1 && !e?.stderr) return '';
    throw new Error('Local Git inspection failed or exceeded safety limits');
  }
}
function validateCatalog(catalog) {
  if (!catalog || catalog.schema !== 'gitporch.public-catalog.v1' ||
      catalog.owner !== OWNER || catalog.visibility !== 'PUBLIC_ONLY' ||
      !Array.isArray(catalog.repositories) || catalog.count !== catalog.repositories.length ||
      catalog.count > 3000 || catalog.count < 1) {
    deny('Exact-owner public-only catalog is required');
  }
  const seen = new Set();
  for (const r of catalog.repositories) {
    if (!r || typeof r.name !== 'string' ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(r.name) ||
        typeof r.eligible !== 'boolean' || seen.has(r.name.toLowerCase())) {
      deny('Unsafe or duplicate public catalog entry');
    }
    seen.add(r.name.toLowerCase());
  }
}
function parseTree(output) {
  const entries = [];
  for (const line of output.split('\0')) {
    if (!line) continue;
    const split = line.indexOf('\t');
    if (split < 0) deny('Invalid Git tree row');
    const fields = line.slice(0, split).split(' ');
    const path = line.slice(split + 1);
    if (fields.length !== 3 || !OID.test(fields[2]) ||
        !/^(100644|100755|120000|160000)$/.test(fields[0]) ||
        !path || path.includes('\0')) deny('Unrecognized Git tree row');
    entries.push({ mode: fields[0], oid: fields[2], path });
    if (entries.length > TREE_ENTRY_LIMIT) deny('Tip tree exceeds bounded inspection limit');
  }
  return entries;
}
function parsePointer(text) {
  if (typeof text !== 'string' || text.length > 512) return null;
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines.length !== 3 || lines[0] !== LFS_VERSION ||
      !/^oid sha256:[0-9a-f]{64}$/.test(lines[1]) ||
      !/^size (?:0|[1-9][0-9]{0,15})$/.test(lines[2])) return null;
  const size = Number(lines[2].slice(5));
  return Number.isSafeInteger(size) ? { oid: lines[1].slice(11), size } : null;
}

async function inspectMirrorTip(name, dataDir) {
  const bare = join(resolve(dataDir), 'repos', name + '.git');
  const base = ['--git-dir', bare];
  const tips = (await localGit([...base, 'for-each-ref', '--format=%(objectname)%09%(refname)',
    'refs/heads'], 64 * 1024)).trim().split('\n').filter(Boolean).sort();
  if (!tips.length) {
    return { status: 'NO_BRANCH_HEADS_UNVERIFIED', headCount: 0, headsInspected: 0 };
  }
  const headOids = tips.map(line => {
    const a = line.split('\t');
    if (a.length !== 2 || !OID.test(a[0]) || !a[1].startsWith('refs/heads/')) {
      deny('Malformed branch ref');
    }
    return a[0];
  });
  const picked = [...new Set(headOids)].slice(0, HEAD_LIMIT);
  const pointerIds = new Set();
  const gitlinks = new Set();
  let attributesLfsDeclared = false;
  let submoduleConfigPresent = false;
  let pointers = 0;
  let pointerBytes = 0;
  for (const oid of picked) {
    const entries = parseTree(await localGit([...base, 'ls-tree', '-r', '-z', oid], 4 * 1024 * 1024));
    for (const entry of entries) {
      if (entry.mode === '160000') gitlinks.add(entry.path);
      if (entry.path === '.gitmodules') submoduleConfigPresent = true;
    }
    const attrs = entries.filter(entry =>
      entry.mode !== '160000' && entry.mode !== '120000' &&
      (entry.path === '.gitattributes' || entry.path.endsWith('/.gitattributes')));
    if (attrs.length > ATTR_FILE_LIMIT) deny('Too many attributes files for bounded inspection');
    for (const entry of attrs) {
      const contents = await localGit([...base, 'show', oid + ':' + entry.path], 32 * 1024);
      if (/(?:^|\s)filter=lfs(?:\s|$)/m.test(contents)) attributesLfsDeclared = true;
    }

    const matches = await localGit([...base, 'grep', '-l', '-z', '-I', '-e', GREP_LFS, oid, '--'],
      256 * 1024, true);
    const files = matches.split('\0').filter(Boolean);
    if (files.length > POINTER_FILE_LIMIT) deny('Too many LFS pointer candidates for bounded inspection');
    for (const match of files) {
      if (!match.startsWith(oid + ':')) deny('Unexpected Git grep result');
      const path = match.slice(oid.length + 1);
      const content = await localGit([...base, 'show', oid + ':' + path], 1024);
      const pointer = parsePointer(content);
      if (!pointer) deny('LFS candidate is not a canonical three-line pointer');
      const dedupe = pointer.oid;
      if (!pointerIds.has(dedupe)) {
        pointerIds.add(dedupe);
        pointers++;
        pointerBytes += pointer.size;
        if (!Number.isSafeInteger(pointerBytes)) deny('LFS declared byte count exceeded safe range');
      }
    }
  }
  const truncated = [...new Set(headOids)].length > HEAD_LIMIT;
  return {
    status: truncated ? 'TIP_SCAN_LIMITED_UNVERIFIED' : 'TIP_SCAN_EVIDENCE_ONLY',
    headCount: tips.length, uniqueTipTrees: new Set(headOids).size,
    headsInspected: picked.length, lfsPointerObjectsFound: pointers,
    lfsDeclaredBytes: pointerBytes, lfsAttributesDeclared: attributesLfsDeclared,
    submoduleGitlinksFound: gitlinks.size, submoduleConfigPresent,
    releaseAssets: 'UNKNOWN_NOT_PART_OF_GIT',
    lfsPayloadBytesPreserved: false, submoduleTargetReposPreserved: false,
    releaseAssetBytesPreserved: false, historyBeyondInspectedBranchTipsScanned: false,
    tipInspectionCompleteWithinLimits: !truncated,
  };
}

/**
 * @param {object} catalog A locally saved explicit-public GitPorch catalog.
 * @param {string} namesCsv 1-5 exact public catalog names, comma-separated.
 * @param {string} dataDir Absolute GitPorch local data directory.
 */
export async function auditPublicExternalAssetGaps(catalog, namesCsv, dataDir = getDataDir()) {
  validateCatalog(catalog);
  const names = parseBatchNames(namesCsv);
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) deny('Absolute local GitPorch data directory required');
  const exactNames = new Map(catalog.repositories.map(r => [r.name, r]));
  for (const name of names) {
    const entry = exactNames.get(name);
    if (!entry || !entry.eligible) deny('Selected name absent/unsupported by exact-owner public catalog');
  }
  // Only scan explicitly requested public names; do not enumerate unrelated
  // local directories in returned JSON or touch network. Reuse R0.2 fsck guards.
  const scoped = {
    schema: catalog.schema, owner: catalog.owner, visibility: catalog.visibility,
    count: names.length, repositories: names.map(name => exactNames.get(name)),
  };
  const local = await auditPublicMirrors(scoped, dataDir);
  const results = [];
  for (const item of local.repositories) {
    if (item.status !== 'LOCAL_GIT_OBJECTS_VERIFIED_ONLY') {
      results.push({ name: item.name, status: 'MIRROR_UNAVAILABLE_UNVERIFIED',
        mirrorStatus: item.status, releaseAssets: 'UNKNOWN_NOT_PART_OF_GIT' });
      continue;
    }
    try {
      results.push({ name: item.name, mirrorStatus: item.status,
        ...await inspectMirrorTip(item.name, dataDir) });
    } catch {
      results.push({ name: item.name, mirrorStatus: item.status,
        status: 'TIP_SCAN_ERROR_UNVERIFIED', releaseAssets: 'UNKNOWN_NOT_PART_OF_GIT' });
    }
  }
  return {
    schema: SCHEMA, mode: 'OFFLINE_READ_ONLY_SCOPED_TIP_ASSET_GAP_AUDIT',
    owner: OWNER, selected: names.length,
    findings: {
      scannedWithTipEvidence: results.filter(r => r.status === 'TIP_SCAN_EVIDENCE_ONLY').length,
      limitedOrFailed: results.filter(r => r.status !== 'TIP_SCAN_EVIDENCE_ONLY').length,
      lfsPointerObjectsFound: results.reduce((n, r) => n + (r.lfsPointerObjectsFound ?? 0), 0),
      submoduleGitlinksFound: results.reduce((n, r) => n + (r.submoduleGitlinksFound ?? 0), 0),
    },
    acceptance: {
      fullHistoryScanned: false, lfsPayloadVerified: false,
      submoduleTargetReposVerified: false, githubReleasesInventoried: false,
      releaseBytesArchived: false, completeExternalAssetsBackup: false,
      physicallyIndependentBackupVerified: false, offlinePhiOSBootVerified: false,
    },
    notice: 'Only selected existing public bare Git branch tips were inspected; max eight unique tip trees per repo. Pointer declarations are not LFS file contents. Gitlink objects are not target submodule repositories. Releases are external to Git. No network or writes; incomplete/errors fail unverified.',
    repositories: results,
  };
}
