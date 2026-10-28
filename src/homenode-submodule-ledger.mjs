// PhiOS R0.10: read-only public submodule gitlink recovery census.
// Never clones, fetches, follows .gitmodules URLs, initializes submodules or executes hooks.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getDataDir, validSlug } from './git.mjs';
import { auditPublicMirrors } from './homenode-mirror-audit.mjs';
import { offlineRestoreGitEnv } from './homenode-restore-drill.mjs';

const exec = promisify(execFile);
const OWNER = 'MichaelWave369';
const SCHEMA = 'gitporch.public-submodule-recovery-ledger.v0.1';
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_GITLINKS = 24;
const MAX_TREE = 30000;
const MAX_CONFIG_BYTES = 65536;
const MAX_DECLARATIONS = 32;
const MAX_REFS_BYTES = 128 * 1024;
function deny(s) { throw new Error(s); }
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function validBranch(s) {
  return typeof s === 'string' && s.length <= 100 &&
    /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(s) &&
    !s.includes('..') && !s.includes('//') && !s.endsWith('.') &&
    !s.endsWith('/') && !s.endsWith('.lock');
}
function safePath(s) {
  return typeof s === 'string' && s.length <= 240 &&
    s.split('/').length <= 20 &&
    s.split('/').every(p => p && p !== '.' && p !== '..' && /^[A-Za-z0-9._-]+$/.test(p));
}
function validateCatalog(c, name) {
  if (!c || c.schema !== 'gitporch.public-catalog.v1' ||
      c.visibility !== 'PUBLIC_ONLY' || c.owner !== OWNER ||
      !Array.isArray(c.repositories) ||
      !Number.isSafeInteger(c.count) ||
      c.count !== c.repositories.length || c.count < 1 || c.count > 3000 ||
      !validSlug(name)) deny('Exact-owner public catalog required');
  const seen = new Set();
  let chosen = null;
  for (const r of c.repositories) {
    if (!r || typeof r.name !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(r.name) ||
        typeof r.eligible !== 'boolean' || seen.has(r.name.toLowerCase())) {
      deny('Malformed or duplicate public catalog entry');
    }
    seen.add(r.name.toLowerCase());
    if (r.name === name && r.eligible) chosen = r;
  }
  if (!chosen) deny('Requested parent is not an eligible public catalog entry');
  return chosen;
}
async function localGit(args, maxBuffer = 1024 * 1024) {
  try {
    const { stdout } = await exec('git', args, {
      env: offlineRestoreGitEnv(), timeout: 120000, windowsHide: true, maxBuffer,
    });
    return stdout;
  } catch {
    deny('Restricted local Git validation failed');
  }
}
function parseTree(raw) {
  const tree = new Map();
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const i = record.indexOf('\t');
    if (i <= 0) deny('Malformed Git tree entry');
    const [mode, type, oid] = record.slice(0, i).split(' ');
    const path = record.slice(i + 1);
    if (!/^(100644|100755|120000|160000)$/.test(mode) ||
        !OID.test(oid) || !path || tree.has(path) ||
        (mode === '160000' ? type !== 'commit' : type !== 'blob')) {
      deny('Unsupported Git tree entry');
    }
    tree.set(path, { mode, type, oid });
    if (tree.size > MAX_TREE) deny('Tree size cap exceeded; no partial report');
  }
  return tree;
}
// Strict, purposely small subset of the Git config syntax. Nontrivial config
// (includes, continuation, unusual quoting) fails closed rather than guessing.
function parseGitmodules(text) {
  if (!text) return [];
  if (text.length > MAX_CONFIG_BYTES || text.includes('\0')) deny('Unsafe .gitmodules size/encoding');
  const result = [];
  let active = null;
  const names = new Set(), paths = new Set();
  for (let line of text.replace(/\r\n/g, '\n').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[submodule\s+"([^"\r\n]{1,100})"\]$/.exec(line);
    if (section) {
      if (names.has(section[1])) deny('Duplicate .gitmodules section');
      names.add(section[1]);
      active = { name: section[1], path: null, url: null };
      result.push(active);
      if (result.length > MAX_DECLARATIONS) deny('.gitmodules exceeds declaration limit');
      continue;
    }
    if (line.startsWith('[') || !active) deny('Unsupported .gitmodules section/format');
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!kv || /\\$/.test(line)) deny('Unsupported .gitmodules key/value syntax');
    if (kv[1] === 'path' || kv[1] === 'url') {
      if (active[kv[1]] !== null) deny('Duplicate .gitmodules key');
      active[kv[1]] = kv[2];
    }
  }
  for (const section of result) {
    if (!safePath(section.path) || !section.url || section.url.length > 1024) {
      deny('Invalid/missing .gitmodules path or URL');
    }
    if (paths.has(section.path)) deny('Duplicate .gitmodules path');
    paths.add(section.path);
  }
  return result;
}
function classifyUrl(urlText, catalog) {
  // Never emit untrusted .gitmodules URLs into an operator-facing report.
  let url;
  try { url = new URL(urlText); } catch { return { policy: 'UNAPPROVED_TARGET_URL' }; }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' ||
      url.port || url.username || url.password || url.search || url.hash ||
      !/^\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(?:\.git)?\/?$/.test(url.pathname)) {
    return { policy: 'UNAPPROVED_TARGET_URL' };
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const candidate = parts[1].endsWith('.git') ? parts[1].slice(0, -4) : parts[1];
  if (parts[0] !== OWNER) return { policy: 'EXTERNAL_OWNER_UNVERIFIED' };
  const matching = catalog.repositories.find(r => r.name === candidate && r.eligible);
  if (!matching) return { policy: 'TARGET_NOT_IN_PUBLIC_CATALOG' };
  return { policy: 'EXACT_PUBLIC_OWNER_TARGET', targetName: candidate };
}
async function targetStatus(catalog, name, commit, dataDir) {
  const row = catalog.repositories.find(r => r.name === name);
  const result = await auditPublicMirrors({
    schema: catalog.schema, owner: catalog.owner, visibility: catalog.visibility,
    count: 1, repositories: [row],
  }, dataDir);
  const mirror = result.repositories[0].status;
  if (mirror !== 'LOCAL_GIT_OBJECTS_VERIFIED_ONLY') {
    return { status: 'TARGET_MIRROR_UNAVAILABLE_UNVERIFIED', targetMirrorStatus: mirror };
  }
  const base = ['--git-dir', join(resolve(dataDir), 'repos', name + '.git')];
  try {
    const objectType = (await localGit([...base, 'cat-file', '-t', commit])).trim();
    if (objectType !== 'commit') return { status: 'TARGET_COMMIT_NOT_PRESENT' };
    const refs = (await localGit([...base, 'for-each-ref', '--contains=' + commit,
      '--format=%(refname)'], MAX_REFS_BYTES)).trim();
    if (!refs) return { status: 'TARGET_COMMIT_NOT_REACHABLE_FROM_REFS' };
    return { status: 'TARGET_COMMIT_IN_VERIFIED_LOCAL_MIRROR_ONLY' };
  } catch {
    return { status: 'TARGET_COMMIT_CHECK_FAILED_UNVERIFIED' };
  }
}
/**
 * One pinned public parent branch. No network, filesystem mutation, clone,
 * fetch, submodule initialization or remote authenticity assumption.
 */
export async function auditSubmoduleRecovery(
  catalog, parent, branch, dataDir = getDataDir(),
) {
  const parentEntry = validateCatalog(catalog, parent);
  if (!validBranch(branch)) deny('Unsafe branch');
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) deny('Absolute GitPorch data path required');
  const baseData = resolve(dataDir);
  const parentAudit = await auditPublicMirrors({
    schema: catalog.schema, owner: OWNER, visibility: 'PUBLIC_ONLY',
    count: 1, repositories: [parentEntry],
  }, baseData);
  if (parentAudit.repositories[0].status !== 'LOCAL_GIT_OBJECTS_VERIFIED_ONLY') {
    deny('Selected parent mirror not locally verified by R0.2');
  }
  const gitRoot = ['--git-dir', join(baseData, 'repos', parent + '.git')];
  const tip = (await localGit([...gitRoot, 'rev-parse', '--verify',
    'refs/heads/' + branch + '^{commit}'])).trim();
  if (!OID.test(tip)) deny('Invalid branch tip');
  const entries = parseTree(await localGit([...gitRoot, 'ls-tree', '-r', '-z', tip], 4 * 1024 * 1024));
  const gitlinks = [...entries].filter(([, e]) => e.mode === '160000');
  if (gitlinks.length > MAX_GITLINKS) deny('More than 24 Gitlinks; no partial report');
  const configBlob = entries.get('.gitmodules');
  let declared = [];
  if (configBlob) {
    if (configBlob.mode !== '100644' && configBlob.mode !== '100755') {
      deny('.gitmodules must be a regular blob');
    }
    const bytes = Number((await localGit([...gitRoot, 'cat-file', '-s', configBlob.oid])).trim());
    if (!Number.isSafeInteger(bytes) || bytes > MAX_CONFIG_BYTES) deny('Oversized .gitmodules');
    const text = await localGit([...gitRoot, 'cat-file', 'blob', configBlob.oid], MAX_CONFIG_BYTES + 1024);
    declared = parseGitmodules(text);
  }
  const declarations = new Map(declared.map(d => [d.path, d]));
  const records = [];
  for (const [path, link] of gitlinks) {
    if (!safePath(path)) deny('Unsafe Gitlink path; no partial output');
    const section = declarations.get(path);
    let record = { path, commit: link.oid, status: 'GITLINK_WITHOUT_MATCHING_CONFIG_UNVERIFIED' };
    if (section) {
      const classified = classifyUrl(section.url, catalog);
      record = { path, commit: link.oid, urlPolicy: classified.policy,
        status: 'TARGET_SOURCE_NOT_APPROVED_UNVERIFIED' };
      if (classified.targetName) {
        record.targetRepository = classified.targetName;
        record = { ...record, ...await targetStatus(catalog, classified.targetName, link.oid, baseData) };
      }
    }
    records.push(record);
  }
  const paths = new Set(gitlinks.map(([p]) => p));
  const orphan = declared.filter(d => !paths.has(d.path)).length;
  const tipAfter = (await localGit([...gitRoot, 'rev-parse', '--verify',
    'refs/heads/' + branch + '^{commit}'])).trim();
  if (tipAfter !== tip) deny('Parent branch moved during audit; discard results');
  const complete = records.length > 0 && records.every(
    r => r.status === 'TARGET_COMMIT_IN_VERIFIED_LOCAL_MIRROR_ONLY') && orphan === 0;
  const report = {
    schema: SCHEMA, owner: OWNER, parent, branch, pinnedCommit: tip,
    mode: 'OFFLINE_READ_ONLY_SELECTED_TIP_SUBMODULE_CENSUS',
    status: !records.length ? 'NO_GITLINKS_AT_SELECTED_TIP_UNVERIFIED' :
      complete ? 'ALL_DETECTED_TIP_GITLINK_COMMITS_LOCALLY_PRESENT_ONLY' :
        'SUBMODULE_RECOVERY_GAPS',
    summary: {
      declaredSubmodules: declared.length, gitlinks: records.length,
      configPathsWithoutGitlink: orphan,
      locallyVerifiedTargetCommits: records.filter(
        r => r.status === 'TARGET_COMMIT_IN_VERIFIED_LOCAL_MIRROR_ONLY').length,
      missingOrUnverified: records.filter(
        r => r.status !== 'TARGET_COMMIT_IN_VERIFIED_LOCAL_MIRROR_ONLY').length,
      allDetectedTipTargetsAvailableOnly: complete,
    },
    acceptance: {
      sourceGitHubParityVerified: false, submoduleUrlAuthenticityVerified: false,
      targetGitBundlesBackedUp: false, nestedSubmodulesScanned: false,
      targetLfsAssetsPreserved: false, releaseAssetsPreserved: false,
      offHostMediaVerified: false, wanDisconnectVerified: false,
      offlinePhiOSBootVerified: false,
    },
    notice: 'Only one parent branch tip and exact public-owner target mirrors. Never opens URLs, imports repos, follows nested dependencies or proves independent backup media. Digest is unsigned.',
    submodules: records,
  };
  return { ...report, reportSha256: hash(report) };
}
