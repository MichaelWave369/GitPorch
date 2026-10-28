// PhiOS R0.3: explicit public GitHub mirror batches, never a background sync.
// No private catalog, no automatic imports. Preview is network-silent and read-only.
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { auditPublicMirrors } from './homenode-mirror-audit.mjs';
import { importPublicRepository } from './homenode-bridge.mjs';
import { getDataDir, validSlug } from './git.mjs';
import { MAX_LOCAL_REPOSITORIES } from './repository-policy.mjs';

const OWNER = 'MichaelWave369';
const SCHEMA = 'gitporch.public-batch-plan.v1';
const REPORT_SCHEMA = 'gitporch.public-batch-result.v1';
export const MAX_PUBLIC_BATCH = 5;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_ENV = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TMP', 'TEMP', 'TMPDIR',
];
function hash(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function deny(message) { throw new Error(message); }
function verifyCatalog(catalog) {
  if (!catalog || catalog.schema !== 'gitporch.public-catalog.v1' ||
      catalog.visibility !== 'PUBLIC_ONLY' || catalog.owner !== OWNER ||
      !Array.isArray(catalog.repositories) || catalog.count !== catalog.repositories.length ||
      catalog.repositories.length === 0 || catalog.repositories.length > 3000) {
    deny('Batch requires a nonempty, public-only catalog for the exact approved owner');
  }
  const seen = new Set();
  for (const r of catalog.repositories) {
    if (!r || typeof r.name !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(r.name) ||
        seen.has(r.name.toLowerCase()) || typeof r.eligible !== 'boolean') {
      deny('Catalog has unsafe, duplicate or malformed public repository entries');
    }
    seen.add(r.name.toLowerCase());
  }
}
export function parseBatchNames(value) {
  if (typeof value !== 'string') deny('A comma-separated, explicit selection is required');
  const names = value.split(',');
  if (names.length < 1 || names.length > MAX_PUBLIC_BATCH ||
      names.some(name => !validSlug(name)) ||
      new Set(names.map(name => name.toLowerCase())).size !== names.length) {
    deny('Select 1 to 5 distinct, Windows-safe repository names (no globs or spaces)');
  }
  return names;
}

// Secure environment for the single HTTPS clone performed by the established
// importer. Do not inherit operator Git credential helpers or environment-based
// Git config, OAuth tokens, askpass programs, transport overrides or URL rewrites.
export function publicCloneEnv() {
  const env = Object.fromEntries(SAFE_ENV.filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]]));
  return {
    ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull, GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https', GIT_LFS_SKIP_SMUDGE: '1',
    GIT_OPTIONAL_LOCKS: '0',
  };
}
async function countLocalRepos(dataDir) {
  let entries;
  try {
    entries = await readdir(join(resolve(dataDir), 'repos'), { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    deny('Cannot inspect local GitPorch repository capacity');
  }
  return entries.filter(entry => entry.name.toLowerCase().endsWith('.git')).length;
}

export async function preparePublicBatch(catalog, namesInput, dataDir = getDataDir()) {
  verifyCatalog(catalog);
  const names = Array.isArray(namesInput) ? parseBatchNames(namesInput.join(',')) : parseBatchNames(namesInput);
  const eligible = new Map(catalog.repositories.map(r => [r.name, r]));
  for (const name of names) {
    const row = eligible.get(name);
    if (!row || !row.eligible) deny('Selected name is absent or unsupported by the public catalog');
  }

  // This checks every catalog entry against local bare Git storage, including
  // unexpected links and false local integrity claims, without making a new dir.
  const audit = await auditPublicMirrors(catalog, dataDir);
  const audited = new Map(audit.repositories.map(r => [r.name, r.status]));
  const selected = names.map(name => ({ name, status: audited.get(name) }));
  if (selected.some(row => row.status !== 'NOT_LOCAL')) {
    deny('Batch refused: each selected public source must be NOT_LOCAL, not already present or unsafe');
  }
  const localEntries = await countLocalRepos(dataDir);
  if (localEntries > MAX_LOCAL_REPOSITORIES ||
      localEntries + names.length > MAX_LOCAL_REPOSITORIES) {
    deny('Insufficient local GitPorch repository capacity for the entire batch');
  }
  const catalogSha256 = hash({
    schema: catalog.schema, owner: catalog.owner, visibility: catalog.visibility,
    capturedAt: catalog.capturedAt ?? null, count: catalog.count,
    sources: catalog.repositories.map(r => ({ name: r.name, eligible: r.eligible })),
  });
  const basis = {
    schema: SCHEMA, owner: OWNER, catalogSha256,
    selected, existingLocalCount: localEntries,
  };
  return {
    ...basis, planSha256: hash(basis),
    status: 'NEEDS_EXPLICIT_OPERATOR_APPROVAL',
    maxBatch: MAX_PUBLIC_BATCH, expectedNetworkClones: selected.length,
    networkUsed: false, filesystemWritten: false,
    notice: 'Read-only local preview. Hash is a plan-change guard, NOT Github authentication or authorization; repos remain offline-UNVERIFIED until separately restored.',
  };
}

export async function importApprovedPublicBatch(
  catalog, namesInput, expectedPlanSha256, dataDir = getDataDir(),
  importer = (c, n, d, options) => importPublicRepository(c, n, d, options),
) {
  if (typeof expectedPlanSha256 !== 'string' || !HEX64.test(expectedPlanSha256)) {
    deny('A valid 64-hex SHA256 from a fresh batch-plan is required');
  }
  const plan = await preparePublicBatch(catalog, namesInput, dataDir);
  if (plan.planSha256 !== expectedPlanSha256) {
    deny('Batch plan changed: re-run batch-plan and review before approving imports');
  }
  const results = [];
  for (let i = 0; i < plan.selected.length; i++) {
    const name = plan.selected[i].name;
    try {
      const result = await importer(catalog, name, dataDir, { cloneEnv: publicCloneEnv() });
      if (result?.name !== name || result?.status !== 'IMPORTED_VERIFIED' ||
          !Number.isSafeInteger(result.refs) || result.refs < 1) {
        deny('Importer did not return expected local verification result');
      }
      // Never export local paths, environment, GitHub credentials, or Git stderr.
      results.push({ name, status: 'IMPORTED_GIT_OBJECTS_VERIFIED_ONLY', refCount: result.refs });
    } catch {
      results.push({ name, status: 'FAILED_UNVERIFIED' });
      for (const untouched of plan.selected.slice(i + 1)) {
        results.push({ name: untouched.name, status: 'NOT_ATTEMPTED_AFTER_FAILURE' });
      }
      break; // First failure halts further network use; no retry.
    }
  }
  const imported = results.filter(r => r.status === 'IMPORTED_GIT_OBJECTS_VERIFIED_ONLY').length;
  const succeeded = imported === plan.selected.length;
  return {
    schema: REPORT_SCHEMA, planSha256: plan.planSha256,
    scope: 'PUBLIC_ONLY_SEQUENTIAL_EXPLICIT_SELECTION',
    summary: {
      selected: plan.selected.length, imported, failed: results.filter(r => r.status === 'FAILED_UNVERIFIED').length,
      notAttempted: results.filter(r => r.status === 'NOT_ATTEMPTED_AFTER_FAILURE').length,
    },
    status: succeeded ? 'LOCAL_GIT_IMPORTS_COMPLETED_ONLY' : 'PARTIAL_OR_FAILED_REVIEW_REQUIRED',
    acceptance: {
      githubSourceAuthenticated: false, remoteRefParityVerified: false,
      lfsAndSubmodulesVerified: false, offHostRestoreVerified: false,
      wanDisconnectedTested: false, fullOfflineReady: false,
    },
    notice: 'No updates, overwrites or auto-retries. On interruption, run the read-only audit before planning any new batch. Local Git clone/fsck is not a complete backup.',
    repositories: results,
  };
}
