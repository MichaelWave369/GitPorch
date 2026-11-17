// R0.8: local read-only Muse bridge evidence shelf.
// Explicit CLI intake replays the existing verifier; HTTP exposes ONLY sanitized
// summaries, never raw source paths, CLI output, auth state or private files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { eventsFromNDJSON, verifyReadbacks } from './muse-history-verify.mjs';

const FORMAT = 'gitporch.muse-bridge-receipt.v1';
const HEX40 = /^[0-9a-f]{40}$/;
const MUSE_ID = /^(?:sha256:)?[a-f0-9]{64}$/;
const FILES = Object.freeze({
  baseline: 'git-history-baseline.json',
  events: 'muse-import.log',
  history: 'muse-internal-history-audit.json',
  snapshot: 'snapshot-audit.json',
  status: 'status-audit.json',
  museStatus: 'muse-status.json',
});
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_SHELF_FILES = 64;
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function bad(message) { throw new Error('MUSE_BRIDGE_EVIDENCE_INVALID: ' + message); }
function guardedFile(file, max = MAX_INPUT_BYTES) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max || stat.size < 1) bad('Unsafe, empty or oversized evidence file');
  return fs.readFileSync(file);
}
function guardDirectory(dir, mustExist = true) {
  if (!path.isAbsolute(dir)) bad('Directory must be absolute');
  if (!fs.existsSync(dir)) {
    if (mustExist) bad('Evidence directory missing');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) bad('Evidence directory is not an ordinary directory');
  return dir;
}
function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { bad('Malformed ' + label + ' JSON'); }
}
function normalId(id) { return typeof id === 'string' && MUSE_ID.test(id) ? id.replace(/^sha256:/, '') : null; }
function isZeroDrift(d) {
  return d && d.git_commits_since_import === 0 && d.muse_commits_since_export === 0;
}
function emptyArrays(obj, keys) {
  return obj && keys.every(k => Array.isArray(obj[k]) && obj[k].length === 0);
}
function requireRunId(id) {
  if (!/^[1-9][0-9]{0,18}$/.test(String(id))) bad('Expected an explicit numeric GitHub Actions run ID');
  return String(id);
}

// This checks internal consistency of operator-supplied *unsigned* evidence.
// It is NOT an independently signed attestation, remote status, or live Muse check.
export function summarizeMuseEvidence(inputs, runId) {
  const id = requireRunId(runId);
  const { baseline, eventsText, history, snapshot, status, museStatus } = inputs;
  if (baseline?.schema !== 'gitporch.muse-git-history-baseline.v1' ||
      history?.schema !== 'gitporch.muse-internal-history-audit.v1' ||
      snapshot?.schema !== 'gitporch.muse-snapshot-audit.v1' ||
      status?.schema !== 'gitporch.muse-status-audit.v1') bad('Unexpected evidence schema');
  const events = eventsFromNDJSON(eventsText);
  const independentlyReplayed = verifyReadbacks(baseline, events, history.capture);
  if (independentlyReplayed.status !== 'PASS_DAG_AND_HISTORICAL_BLOBS_ONLY' ||
      history.status !== independentlyReplayed.status ||
      !Array.isArray(history.problems) || history.problems.length !== 0 ||
      history.gitCommitCount !== independentlyReplayed.gitCommitCount ||
      history.museReadbackCount !== independentlyReplayed.museReadbackCount ||
      !Array.isArray(history.checked) || history.checked.length !== independentlyReplayed.checked.length) {
    bad('Historical DAG/byte replay failed or disagrees with saved report');
  }
  for (let i = 0; i < history.checked.length; i++) {
    const a = history.checked[i], b = independentlyReplayed.checked[i];
    if (a.gitSha !== b.gitSha || normalId(a.museCommitId) !== normalId(b.museCommitId)) bad('Stored commit mapping disagrees with replay');
  }
  if (snapshot.status !== 'PASS_SNAPSHOT_ONLY' ||
      !emptyArrays(snapshot.differences, ['missingFromMirror','extraInMirror','contentMismatch','modeMismatch'])) {
    bad('Final Git snapshot did not pass its independent audit');
  }
  if (status.status !== 'PASS_STATUS_RECEIPT_ONLY' ||
      !Array.isArray(status.findings) || status.findings.length !== 0 || !isZeroDrift(status.drift) ||
      !isZeroDrift(museStatus?.drift)) bad('Git/Muse sync receipt is missing, drifting, or inconsistent');
  const head = baseline.source?.head, last = museStatus?.last_import;
  const matchingHead = independentlyReplayed.checked.find(x => x.gitSha === head);
  if (!HEX40.test(head) || baseline.source?.commitCount !== independentlyReplayed.gitCommitCount ||
      !matchingHead || last?.git_sha !== head || last?.commits_written !== independentlyReplayed.gitCommitCount ||
      normalId(last?.muse_commit_id) !== normalId(matchingHead.museCommitId)) {
    bad('Final imported Git/Muse heads disagree with historical evidence');
  }
  const exportReceipt = museStatus?.last_export;
  if (normalId(exportReceipt?.muse_commit_id) !== normalId(matchingHead.museCommitId) ||
      !HEX40.test(exportReceipt?.git_sha)) bad('Final export receipt does not agree with the imported Muse tip');
  const importedAt = last?.imported_at;
  if (typeof importedAt !== 'string' || !Number.isFinite(Date.parse(importedAt))) bad('Invalid import timestamp');
  const warningCount = independentlyReplayed.importWarnings?.exec_bit_not_kept?.length ?? 0;
  const commits = independentlyReplayed.checked.map(c => ({
    gitSha: c.gitSha,
    museCommitId: c.museCommitId,
    parentCount: c.parentsExpected.filter(Boolean).length,
  }));
  return {
    schema: 'gitporch.muse-bridge-status.v1',
    state: 'REPLAYED_PASS_UNSIGNED',
    runId: id,
    runUrl: 'https://github.com/MichaelWave369/GitPorch/actions/runs/' + id,
    museVersion: String(history.museVersion ?? 'unknown').slice(0, 64),
    importedAt,
    gitHead: head,
    museHead: matchingHead.museCommitId,
    commitsChecked: independentlyReplayed.checked.length,
    historicalEntriesChecked: baseline.commits.reduce((n, c) => n + c.files.length, 0),
    distinctMuseBlobsChecked: Object.keys(history.capture.blobs).length,
    drift: { gitCommitsSinceImport: 0, museCommitsSinceExport: 0 },
    finalSnapshot: 'PASS_SNAPSHOT_ONLY',
    ancestryAndHistoricalBytes: 'PASS_DAG_AND_HISTORICAL_BLOBS_ONLY',
    executableWarnings: warningCount,
    commitMappings: commits,
    provenance: 'OPERATOR_SUPPLIED_UNSIGNED_EVIDENCE',
    limitations: [
      'Read-only replay of provided evidence, not a fresh Muse operation',
      'Not a signed or independently witnessed CI attestation',
      'Executable modes inside Muse, signatures, attribution, production sync and arbitrary repositories remain unverified',
      'Muse Git export creates a snapshot mirror, not a reconstruction of original Git ancestry',
    ],
  };
}

export function inspectMuseEvidenceFolder(folder, runId) {
  const base = guardDirectory(path.resolve(folder));
  const inputs = {}, digests = {};
  for (const [key, name] of Object.entries(FILES)) {
    const bytes = guardedFile(path.join(base, name));
    digests[name] = hash(bytes);
    inputs[key === 'events' ? 'eventsText' : key] = key === 'events' ? bytes.toString('utf8') : parseJson(bytes, name);
  }
  return { summary: summarizeMuseEvidence(inputs, runId), sourceDigests: digests };
}
function shelfDir(dataDir, create = false) {
  const root = path.resolve(dataDir);
  if (create) guardDirectory(root, false);
  if (!fs.existsSync(root)) return null;
  guardDirectory(root);
  const dir = path.join(root, 'muse-bridge-receipts');
  if (create) guardDirectory(dir, false);
  if (!fs.existsSync(dir)) return null;
  return guardDirectory(dir);
}
function verifySavedReceipt(file) {
  const bytes = guardedFile(file, 1024 * 1024);
  const base = path.basename(file);
  if (base !== 'receipt-' + hash(bytes) + '.json') bad('Local receipt filename/hash mismatch');
  const data = parseJson(bytes, 'receipt');
  if (data.schema !== FORMAT || data.summary?.schema !== 'gitporch.muse-bridge-status.v1' ||
      data.summary?.state !== 'REPLAYED_PASS_UNSIGNED' || !Array.isArray(data.summary.commitMappings) ||
      data.summary.commitMappings.length !== data.summary.commitsChecked ||
      !Number.isFinite(Date.parse(data.recordedAt)) ||
      !Object.keys(FILES).every(k => /^[a-f0-9]{64}$/.test(data.sourceDigests?.[FILES[k]]))) {
    bad('Local receipt structure or digests invalid');
  }
  return data;
}
export function publishMuseEvidenceFolder(dataDir, folder, runId) {
  const { summary, sourceDigests } = inspectMuseEvidenceFolder(folder, runId);
  const dir = shelfDir(dataDir, true);
  const receipt = { schema: FORMAT, recordedAt: new Date().toISOString(), summary, sourceDigests };
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  const target = path.join(dir, 'receipt-' + hash(bytes) + '.json');
  fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  return { file: target, summary };
}
export function museBridgeShelf(dataDir) {
  let dir;
  try { dir = shelfDir(dataDir); }
  catch { return { state: 'INVALID_RECEIPT_SHELF', receipts: [], caveat: 'Local receipt shelf is unsafe or unreadable' }; }
  if (!dir) return { state: 'NO_RECEIPTS', receipts: [], caveat: 'No operator-imported Muse bridge evidence. No live Muse connection.' };
  try {
    const items = fs.readdirSync(dir);
    if (items.length > MAX_SHELF_FILES || items.some(f => !/^receipt-[a-f0-9]{64}\.json$/.test(f))) bad('Unexpected entries in receipt shelf');
    const receipts = items.map(name => verifySavedReceipt(path.join(dir, name)));
    receipts.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    return {
      state: receipts.length ? 'UNSIGNED_LOCAL_RECEIPTS' : 'NO_RECEIPTS',
      receipts: receipts.slice(0, 12).map(r => ({ ...r.summary, recordedAt: r.recordedAt })),
      caveat: 'Operator-supplied unsigned reports; no authentication, remote sync, or automatic Muse execution',
    };
  } catch {
    return { state: 'INVALID_RECEIPT_SHELF', receipts: [], caveat: 'Receipt validation failed; hiding all results' };
  }
}
