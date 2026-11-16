#!/usr/bin/env node
// GitPorch R0.7: read-only comparison of stored Muse DAG and historical blobs.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const gitRe = /^[a-f0-9]{40}$/;
const museRe = /^sha256:[a-f0-9]{64}$/;
const MAX = 1024 * 1024;
function loaded(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX) throw new Error('Invalid/oversized evidence file');
  return fs.readFileSync(file, 'utf8');
}
export function eventsFromNDJSON(text) {
  if (Buffer.byteLength(text) > MAX) throw new Error('Oversized import log');
  return text.trim().split(/\r?\n/).map(line => JSON.parse(line));
}
function readMuse(cwd, command, arg) {
  const args = command === '--version' ? ['--version'] : [command, arg, '--format', 'json'];
  const r = spawnSync('muse', args, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: MAX, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.error || r.status !== 0) throw new Error('Muse read-only ' + command + ' failed: ' + (r.stderr || r.error?.message || '').slice(0, 240));
  return command === '--version' ? r.stdout.trim() : JSON.parse(r.stdout);
}
export function captureReadbacks(cwd, events) {
  if (!path.isAbsolute(cwd) || !fs.statSync(path.join(cwd, '.muse')).isDirectory()) throw new Error('Expected absolute Muse repository directory');
  const imported = events.filter(e => e.event === 'commit');
  if (imported.length < 1 || imported.length > 96) throw new Error('Expected 1-96 imported commits');
  const records = [];
  for (const e of imported) {
    if (!gitRe.test(e.git_sha) || !museRe.test(e.muse_commit_id)) throw new Error('Invalid import event');
    const commit = readMuse(cwd, 'read-commit', e.muse_commit_id);
    if (!museRe.test(commit.snapshot_id)) throw new Error('Invalid Muse snapshot ID');
    const snapshot = readMuse(cwd, 'read-snapshot', commit.snapshot_id);
    records.push({ muse_commit_id: e.muse_commit_id, commit, snapshot });
  }
  return { schema: 'gitporch.muse-readbacks.v1', museVersion: readMuse(cwd, '--version'), records };
}
export function verifyReadbacks(baseline, events, capture) {
  if (baseline?.schema !== 'gitporch.muse-git-history-baseline.v1' || !Array.isArray(baseline.commits) || baseline.commits.length < 1 || baseline.commits.length > 96 || !Array.isArray(events) || !Array.isArray(capture?.records)) throw new Error('Invalid baseline, events or captured Muse records');
  const problems = [];
  const git = new Map();
  for (const c of baseline.commits) {
    if (!gitRe.test(c.gitSha) || git.has(c.gitSha) || !Array.isArray(c.parents) || !Array.isArray(c.files)) throw new Error('Invalid baseline commit');
    git.set(c.gitSha, c);
  }
  const mapping = new Map(), usedMuse = new Set();
  for (const e of events.filter(e => e.event === 'commit')) {
    if (!gitRe.test(e.git_sha) || !museRe.test(e.muse_commit_id) || mapping.has(e.git_sha) || usedMuse.has(e.muse_commit_id)) {
      problems.push({ code: 'DUPLICATE_OR_INVALID_IMPORT', gitSha: e.git_sha }); continue;
    }
    mapping.set(e.git_sha, e.muse_commit_id); usedMuse.add(e.muse_commit_id);
    if (!git.has(e.git_sha)) problems.push({ code: 'UNEXPECTED_IMPORT', gitSha: e.git_sha });
  }
  const done = events.filter(e => e.event === 'done');
  if (done.length !== 1 || done[0].total_commits_written !== git.size || done[0].dry_run !== false) problems.push({ code: 'INCOMPLETE_IMPORT_RECEIPT' });
  const captures = new Map();
  for (const item of capture.records) {
    if (!museRe.test(item?.muse_commit_id) || captures.has(item.muse_commit_id)) { problems.push({ code: 'INVALID_OR_DUPLICATE_READBACK' }); continue; }
    captures.set(item.muse_commit_id, item);
  }
  const checked = [];
  for (const c of baseline.commits) {
    const id = mapping.get(c.gitSha), row = captures.get(id);
    if (!row?.commit || !row?.snapshot) { problems.push({ code: 'MISSING_MUSE_READBACK', gitSha: c.gitSha }); continue; }
    const m = row.commit, s = row.snapshot;
    if (m.commit_id !== id) problems.push({ code: 'COMMIT_ID', gitSha: c.gitSha });
    if (m.metadata?.git_sha !== c.gitSha) problems.push({ code: 'GIT_SHA_METADATA', gitSha: c.gitSha, actual: m.metadata?.git_sha ?? null });
    const parents = c.parents.map(p => mapping.get(p));
    const actual = [m.parent_commit_id ?? null, m.parent2_commit_id ?? null];
    if (parents.some(x => !x) || (parents[0] ?? null) !== actual[0] || (parents[1] ?? null) !== actual[1]) problems.push({ code: 'PARENT_DAG', gitSha: c.gitSha, expected: parents, actual });
    if (!museRe.test(m.snapshot_id) || s.snapshot_id !== m.snapshot_id || !s.manifest || typeof s.manifest !== 'object' || Array.isArray(s.manifest)) { problems.push({ code: 'SNAPSHOT_SCHEMA', gitSha: c.gitSha }); continue; }
    const wanted = new Map(c.files.map(f => [f.path, 'sha256:' + f.sha256]));
    if (wanted.size !== c.files.length) throw new Error('Duplicate Git snapshot paths');
    for (const [p, hash] of wanted) {
      if (!Object.hasOwn(s.manifest, p)) problems.push({ code: 'MISSING_PATH', gitSha: c.gitSha, path: p });
      else if (s.manifest[p] !== hash) problems.push({ code: 'WRONG_BLOB', gitSha: c.gitSha, path: p, expected: hash, actual: s.manifest[p] });
    }
    for (const p of Object.keys(s.manifest)) if (!wanted.has(p)) problems.push({ code: 'EXTRA_PATH', gitSha: c.gitSha, path: p });
    checked.push({ gitSha: c.gitSha, museCommitId: id, parentsExpected: parents, parentsObserved: actual, executableModeUnverified: c.files.filter(f => f.mode === '100755').map(f => f.path) });
  }
  for (const id of captures.keys()) if (!usedMuse.has(id)) problems.push({ code: 'UNEXPECTED_MUSE_READBACK', museCommitId: id });
  return {
    schema: 'gitporch.muse-internal-history-audit.v1',
    status: problems.length ? 'FAIL_OR_INCOMPLETE_HISTORY' : 'PASS_DAG_AND_HISTORICAL_BLOBS_ONLY',
    museVersion: capture.museVersion ?? 'UNKNOWN', gitCommitCount: git.size, museReadbackCount: checked.length,
    importWarnings: { exec_bit_not_kept: done.length === 1 ? done[0].exec_bit_not_kept ?? [] : [] },
    problems, checked,
    unverified: ['Git executable modes and other file metadata', 'Author and committer history', 'Signatures and provenance', 'Remote sync and production compatibility'],
    execution: { writesAttempted: false, pushesAttempted: false },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, gitFile, eventsFile, source, ...extra] = process.argv.slice(2);
    if (!['capture', 'audit'].includes(action) || !gitFile || !eventsFile || !source || extra.length) throw new Error('Usage: node src/muse-history-verify.mjs capture|audit <baseline.json> <import.ndjson> <museDir|readbacks.json>');
    const git = JSON.parse(loaded(gitFile)), events = eventsFromNDJSON(loaded(eventsFile));
    const raw = action === 'capture' ? captureReadbacks(source, events) : JSON.parse(loaded(source));
    const captured = raw.records ? raw : raw.capture;
    const result = verifyReadbacks(git, events, captured);
    process.stdout.write(JSON.stringify({ ...result, capture: captured }, null, 2) + '\n');
    if (result.status !== 'PASS_DAG_AND_HISTORICAL_BLOBS_ONLY') process.exitCode = 2;
  } catch (error) { process.stderr.write('[Muse R0.7] ' + error.message + '\n'); process.exitCode = 1; }
}
