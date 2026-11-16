#!/usr/bin/env node
/**
 * GitPorch x Muse R0.5, read-only evidence PACKET: compose independent Git
 * checks and hash opaque, operator-supplied Muse CLI logs. This does NOT verify
 * Muse execution, log authenticity, signing, or imported history.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGitHistoryBaseline } from './muse-bridge-history-baseline.mjs';
import { auditBridgeSnapshot } from './muse-bridge-snapshot-audit.mjs';
import { auditMuseStatusReceipt } from './muse-bridge-status-audit.mjs';

const MAX_LOG_BYTES = 1024 * 1024;

function inside(root, entry) {
  const relative = path.relative(root, entry);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function opaqueReceipt(file, label, roots) {
  if (file === undefined || file === null) return null;
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error(label + ' must be an absolute file path');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_LOG_BYTES) {
    throw new Error(label + ' must be a nonempty, non-symlink file no larger than 1 MiB');
  }
  const actual = fs.realpathSync(file);
  if (roots.some(root => inside(root, actual))) throw new Error(label + ' must be stored outside both Git worktrees');
  const data = fs.readFileSync(file);
  if (data.length !== stat.size) throw new Error(label + ' changed while reading');
  return { sha256: sha256(data), bytes: data.length, source: 'OPERATOR_SUPPLIED_UNAUTHENTICATED' };
}

function gitRead(repo, command) {
  const child = spawnSync('git', ['-C', repo, ...command], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  if (child.error || child.status !== 0) throw new Error('Unable to inspect Git checkout safely');
  return child.stdout.trim();
}
function noRemotes(repo) { return gitRead(repo, ['remote']) === ''; }
function cleanWorktree(repo) { return gitRead(repo, ['status', '--porcelain=v1', '--untracked-files=all']) === ''; }

export function assembleMuseEvidencePacket({ source, mirror, statusReceipt, versionLog, importLog, exportLog }) {
  const history = createGitHistoryBaseline(source);
  const snapshot = auditBridgeSnapshot(source, mirror);
  const status = auditMuseStatusReceipt({ source, mirror, receipt: statusReceipt });
  const gitHeadsConsistent = history.source.head === snapshot.source.head &&
    snapshot.source.head === status.source.head && snapshot.mirror.head === status.mirror.head;
  const detachedFromRemotes = noRemotes(snapshot.source.path) && noRemotes(snapshot.mirror.path);
  const cleanWorktrees = cleanWorktree(snapshot.source.path) && cleanWorktree(snapshot.mirror.path);
  const roots = [snapshot.source.path, snapshot.mirror.path];
  const logs = {
    version: opaqueReceipt(versionLog, 'Muse CLI version log', roots),
    import: opaqueReceipt(importLog, 'Muse import log', roots),
    export: opaqueReceipt(exportLog, 'Muse export log', roots),
    status: opaqueReceipt(statusReceipt, 'Muse status receipt', roots),
  };
  const blockers = [];
  if (!detachedFromRemotes) blockers.push('GIT_REMOTE_PRESENT');
  if (!cleanWorktrees) blockers.push('DIRTY_GIT_WORKTREE');
  if (!gitHeadsConsistent) blockers.push('GIT_HEADS_INCONSISTENT');
  if (snapshot.status !== 'PASS_SNAPSHOT_ONLY') blockers.push('SNAPSHOT_MISMATCH');
  if (status.status !== 'PASS_STATUS_RECEIPT_ONLY') blockers.push('STATUS_RECEIPT_MISMATCH_OR_UNVERIFIED');
  for (const [label, log] of Object.entries(logs)) if (!log) blockers.push('MISSING_' + label.toUpperCase() + '_RECEIPT');
  const reviewReady = blockers.length === 0;
  return {
    schema: 'gitporch.muse-evidence-packet.v1',
    status: reviewReady ? 'GIT_CHECKS_PASS_LOGS_PRESENT_HUMAN_REVIEW_REQUIRED' : 'BLOCKED_OR_INCOMPLETE',
    blockers,
    gitBaseline: {
      branch: history.source.branch, head: history.source.head,
      commits: history.source.commitCount,
      mergeCommits: history.commits.filter(c => c.isMerge).length,
      historyManifestSha256: sha256(JSON.stringify(history.commits)),
    },
    snapshot: { status: snapshot.status, differences: snapshot.differences },
    syncReceipt: { status: status.status, findings: status.findings, drift: status.drift },
    checks: { gitHeadsConsistent, detachedFromRemotes, cleanWorktrees },
    opaqueLogs: logs,
    reviewBoundary: 'Even if every Git check passes, operator-supplied logs are NOT authenticated or semantically checked. A real Muse import/export round trip and independent Git-to-Muse DAG/tree comparison remain UNVERIFIED.',
    execution: { museInvoked: false, networkUsed: false, writesAttempted: false, pushesAttempted: false },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source, mirror, statusReceipt, versionLog, importLog, exportLog, ...extra] = process.argv.slice(2);
    if (!source || !mirror || !statusReceipt || extra.length) {
      throw new Error('Usage: node src/muse-bridge-evidence-packet.mjs <absolute-source> <absolute-mirror> <absolute-status.json> [absolute-version.txt] [absolute-import.log] [absolute-export.log]');
    }
    const result = assembleMuseEvidencePacket({ source, mirror, statusReceipt, versionLog, importLog, exportLog });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status !== 'GIT_CHECKS_PASS_LOGS_PRESENT_HUMAN_REVIEW_REQUIRED') process.exitCode = 2;
  } catch (error) {
    process.stderr.write('[Muse evidence packet] ' + error.message + '\n');
    process.exitCode = 1;
  }
}
