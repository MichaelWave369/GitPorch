#!/usr/bin/env node
/**
 * GitPorch x Muse R0.3. Reconcile a saved Muse git-status JSON receipt with
 * two disposable Git refs. Read-only; never invokes Muse or mutates Git.
 * A passing status audit is NOT evidence of history or snapshot fidelity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_RECEIPT_BYTES = 256 * 1024;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA = /^[0-9a-f]{40,64}$/;

function branchRef(value) {
  if (typeof value !== 'string' || !REF.test(value) ||
      value.includes('..') || value.includes('//') || value.endsWith('/') ||
      value.endsWith('.') || value.endsWith('.lock') || value.includes('@{')) {
    throw new Error('Unsafe or missing branch name in Muse receipt');
  }
  return 'refs/heads/' + value;
}

function git(dir, args) {
  const result = spawnSync('git', ['-C', dir, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status !== 0) {
    throw new Error('Git ' + args[0] + ' failed: ' +
      (result.error?.message || result.stderr || 'exit ' + result.status).trim().slice(0, 300));
  }
  return result.stdout.trim();
}

function root(input, label) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error(label + ' must be an absolute path');
  const canonical = fs.realpathSync(input);
  if (!fs.statSync(canonical).isDirectory()) throw new Error(label + ' must be a directory');
  const actual = git(canonical, ['rev-parse', '--show-toplevel']);
  if (fs.realpathSync(actual) !== canonical) throw new Error(label + ' must be the Git working tree root');
  if (git(canonical, ['rev-parse', '--is-bare-repository']) !== 'false') {
    throw new Error(label + ' must be a non-bare Git checkout');
  }
  return canonical;
}

function head(dir, branch) {
  const output = git(dir, ['rev-parse', '--verify', branchRef(branch) + '^{commit}']);
  if (!SHA.test(output)) throw new Error('Git returned an unexpected commit ID');
  return output;
}

function loadReceipt(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Receipt must have an absolute path');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_RECEIPT_BYTES) {
    throw new Error('Receipt must be a nonempty regular file, at most 256 KiB');
  }
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Muse receipt must contain a JSON object');
  }
  return obj;
}

function nonnegativeInt(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function auditMuseStatusReceipt({ source, mirror, receipt }) {
  const sourceRoot = root(source, 'Source');
  const mirrorRoot = root(mirror, 'Mirror');
  if (sourceRoot === mirrorRoot) throw new Error('Source and mirror must be separate checkouts');
  const data = loadReceipt(receipt);
  const imported = data.last_import;
  const exported = data.last_export;
  const drift = data.drift;
  const findings = [];
  if (!imported || typeof imported !== 'object') findings.push('MISSING_IMPORT_RECORD');
  if (!exported || typeof exported !== 'object') findings.push('MISSING_EXPORT_RECORD');

  let sourceHead = null;
  let mirrorHead = null;
  if (imported) {
    sourceHead = head(sourceRoot, imported.git_ref);
    if (typeof imported.git_sha !== 'string' || !SHA.test(imported.git_sha)) {
      findings.push('INVALID_IMPORT_SHA');
    } else if (imported.git_sha !== sourceHead) findings.push('SOURCE_SHA_MISMATCH');
  }
  if (exported) {
    mirrorHead = head(mirrorRoot, exported.git_ref);
    if (typeof exported.git_sha !== 'string' || !SHA.test(exported.git_sha)) {
      findings.push('INVALID_EXPORT_SHA');
    } else if (exported.git_sha !== mirrorHead) findings.push('MIRROR_SHA_MISMATCH');
  }
  if (!drift || typeof drift !== 'object' ||
      !nonnegativeInt(drift.git_commits_since_import) ||
      !nonnegativeInt(drift.muse_commits_since_export)) {
    findings.push('DRIFT_UNVERIFIED');
  } else if (drift.git_commits_since_import !== 0 || drift.muse_commits_since_export !== 0) {
    findings.push('DRIFT_NONZERO');
  }
  const status = findings.length ? 'FAIL_OR_UNVERIFIED_STATUS' : 'PASS_STATUS_RECEIPT_ONLY';
  return {
    schema: 'gitporch.muse-status-audit.v1', status, findings,
    source: { branch: imported?.git_ref ?? null, head: sourceHead },
    mirror: { branch: exported?.git_ref ?? null, head: mirrorHead },
    drift: drift && nonnegativeInt(drift.git_commits_since_import) &&
      nonnegativeInt(drift.muse_commits_since_export) ? {
        git_commits_since_import: drift.git_commits_since_import,
        muse_commits_since_export: drift.muse_commits_since_export,
      } : null,
    unverified: ['Muse receipt authenticity', 'Muse binary identity', 'imported commit coverage',
      'Git merge topology', 'historical snapshot parity', 'file bytes and modes',
      'cryptographic signatures', 'absence of prior side effects'],
    execution: { museInvoked: false, networkUsed: false, writesAttempted: false, pushesAttempted: false },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source, mirror, receipt, ...extra] = process.argv.slice(2);
    if (!source || !mirror || !receipt || extra.length) {
      throw new Error('Usage: node src/muse-bridge-status-audit.mjs <absolute-Git-source-root> <absolute-Git-mirror-root> <absolute-saved-muse-git-status.json>');
    }
    const result = auditMuseStatusReceipt({ source, mirror, receipt });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status !== 'PASS_STATUS_RECEIPT_ONLY') process.exitCode = 2;
  } catch (error) {
    process.stderr.write('[Muse status audit] ' + error.message + '\n');
    process.exitCode = 1;
  }
}
