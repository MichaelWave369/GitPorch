#!/usr/bin/env node
// GitPorch R0.7: read-only comparison of stored Muse DAG and historical blobs.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const gitRe = /^[a-f0-9]{40}$/;
const museRe = /^(?:sha256:)?[a-f0-9]{64}$/;
function bareMuseId(value) { return typeof value === 'string' && museRe.test(value) ? value.replace(/^sha256:/, '') : null; }
function canonicalMuseId(value) { const bare = bareMuseId(value); if (bare === null) throw new Error('Invalid Muse object ID'); return 'sha256:' + bare; }
function sameMuseId(a, b) {
  if (a == null || b == null) return a == null && b == null;
  const aId = bareMuseId(a);
  return aId !== null && aId === bareMuseId(b);
}
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
function readMuse(cwd, command, arg, diagnosticsDir) {
  // Live 0.2.2rc9 run #4 returned text starting "sha256:" when read-commit
  // lacked --json. --format json was rejected in run #2. Request JSON
  // explicitly with the --json flag used in upstream Muse issue repros.
  const args = command === '--version' ? ['--version'] : [command, canonicalMuseId(arg), '--json'];
  const r = spawnSync('muse', args, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: MAX, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (diagnosticsDir && command !== '--version') {
    // Evidence is synthetic-only and written OUTSIDE .muse and Git worktrees.
    // Capture the bounded exact CLI response even if the parser rejects it.
    const name = 'muse-' + command + '-' + bareMuseId(arg) + '.txt';
    fs.writeFileSync(path.join(diagnosticsDir, name), [
      'command=' + command, 'object_id=' + canonicalMuseId(arg),
      'exit_code=' + (r.status ?? 'unavailable'),
      'stdout:', r.stdout ?? '', 'stderr:', r.stderr ?? ''
    ].join('\n'), { flag: 'wx', mode: 0o600 });
  }
  if (r.error || r.status !== 0) throw new Error('Muse read-only ' + command + ' failed: ' + (r.stderr || r.error?.message || '').slice(0, 240));
  if (command === '--version') return r.stdout.trim();
  let parsed;
  try { parsed = JSON.parse(r.stdout); }
  catch {
    throw new Error('Muse ' + command + ' did not emit JSON with --json; diagnostic stdout/stderr captured for review');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Muse ' + command + ' JSON must be an object');
  return parsed;
}
function readStoredBlob(cwd, id, diagnosticsDir) {
  // A Muse snapshot manifest maps paths to *Muse object IDs*, not the
  // SHA-256 of raw file bytes. Read the original blob bytes and hash those.
  // muse cat-object emits raw bytes, so NEVER decode stdout as UTF-8.
  const canonical = canonicalMuseId(id);
  const r = spawnSync('muse', ['cat-object', canonical], {
    cwd, encoding: null, timeout: 15000, maxBuffer: MAX, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
  const stderr = Buffer.isBuffer(r.stderr) ? r.stderr.toString('utf8') : String(r.stderr ?? '');
  const stdout = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.alloc(0);
  const digest = r.status === 0 && !r.error ? crypto.createHash('sha256').update(stdout).digest('hex') : null;
  if (diagnosticsDir) {
    // Capture the digest and status, not the raw source bytes. One report per
    // unique blob, in the same ephemeral synthetic-only evidence directory.
    fs.writeFileSync(path.join(diagnosticsDir, 'muse-cat-object-' + bareMuseId(id) + '.txt'), [
      'command=cat-object', 'object_id=' + canonical, 'exit_code=' + (r.status ?? 'unavailable'),
      'byte_length=' + stdout.length, 'raw_sha256=' + (digest ?? 'UNAVAILABLE'),
      'stderr:', stderr.slice(0, 1024)
    ].join('\n'), { flag: 'wx', mode: 0o600 });
  }
  if (r.error || r.status !== 0) {
    throw new Error('Muse cat-object failed for ' + canonical + ': ' + (stderr || r.error?.message || '').slice(0, 220));
  }
  return { sha256: digest, byteLength: stdout.length };
}
export function captureReadbacks(cwd, events, diagnosticsDir) {
  if (!path.isAbsolute(cwd) || !fs.statSync(path.join(cwd, '.muse')).isDirectory()) throw new Error('Expected absolute Muse repository directory');
  if (diagnosticsDir !== undefined) {
    if (!path.isAbsolute(diagnosticsDir) || !fs.statSync(diagnosticsDir).isDirectory()) throw new Error('Diagnostics directory must exist and be absolute');
    const museRoot = fs.realpathSync(cwd);
    const diagnosticsRoot = fs.realpathSync(diagnosticsDir);
    const relative = path.relative(museRoot, diagnosticsRoot);
    if (relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw new Error('Diagnostics must be stored outside the Muse repository');
  }
  const imported = events.filter(e => e.event === 'commit');
  if (imported.length < 1 || imported.length > 96) throw new Error('Expected 1-96 imported commits');
  const records = [];
  // A content-addressed Muse snapshot can legitimately be shared by MANY
  // distinct Git commits (e.g. a metadata-only commit or an unchanged tree).
  // Capture each unique immutable snapshot only once, then compare its stored
  // bytes against EVERY corresponding Git commit in verifyReadbacks below.
  // readMuse uses exclusive ('wx') evidence files, so reading the same object
  // repeatedly into the same diagnostic name is also correctly avoided.
  const snapshots = new Map();
  const seenGitCommits = new Set();
  const seenMuseCommits = new Set();
  for (const e of imported) {
    if (!gitRe.test(e.git_sha) || !museRe.test(e.muse_commit_id)) throw new Error('Invalid import event');
    const museCommitKey = bareMuseId(e.muse_commit_id);
    if (seenGitCommits.has(e.git_sha) || seenMuseCommits.has(museCommitKey)) {
      throw new Error('Duplicate Git/Muse commit import event: refusing ambiguous readback evidence');
    }
    seenGitCommits.add(e.git_sha);
    seenMuseCommits.add(museCommitKey);
    const commit = readMuse(cwd, 'read-commit', e.muse_commit_id, diagnosticsDir);
    if (!museRe.test(commit.snapshot_id)) throw new Error('Invalid Muse snapshot ID');
    const snapshotKey = bareMuseId(commit.snapshot_id);
    let snapshot = snapshots.get(snapshotKey);
    if (!snapshot) {
      snapshot = readMuse(cwd, 'read-snapshot', commit.snapshot_id, diagnosticsDir);
      snapshots.set(snapshotKey, snapshot);
    }
    records.push({ muse_commit_id: e.muse_commit_id, commit, snapshot });
  }
  const uniqueObjects = new Set();
  for (const row of records) {
    for (const id of Object.values(row.snapshot.manifest ?? {})) {
      if (!museRe.test(id)) throw new Error('Invalid Muse blob ID in stored snapshot');
      uniqueObjects.add(bareMuseId(id));
    }
  }
  if (uniqueObjects.size > 256) throw new Error('Unexpectedly many unique blobs in disposable history fixture');
  const blobs = {};
  for (const id of uniqueObjects) blobs[id] = readStoredBlob(cwd, id, diagnosticsDir);
  return { schema: 'gitporch.muse-readbacks.v2', museVersion: readMuse(cwd, '--version'), records, blobs };
}
export function verifyReadbacks(baseline, events, capture) {
  if (baseline?.schema !== 'gitporch.muse-git-history-baseline.v1' || !Array.isArray(baseline.commits) || baseline.commits.length < 1 || baseline.commits.length > 96 || !Array.isArray(events) || !Array.isArray(capture?.records)) throw new Error('Invalid baseline, events or captured Muse records');
  // Absence of blob byte readbacks is an incomplete audit, never a success.
  // v1 captures must not be interpreted as proof of historical byte parity.
  if (!capture.blobs || typeof capture.blobs !== 'object' || Array.isArray(capture.blobs)) throw new Error('Missing actual Muse cat-object byte digests (R0.7 v2 required)');
  const problems = [];
  const git = new Map();
  for (const c of baseline.commits) {
    if (!gitRe.test(c.gitSha) || git.has(c.gitSha) || !Array.isArray(c.parents) || !Array.isArray(c.files)) throw new Error('Invalid baseline commit');
    git.set(c.gitSha, c);
  }
  const mapping = new Map(), usedMuse = new Set();
  for (const e of events.filter(e => e.event === 'commit')) {
    if (!gitRe.test(e.git_sha) || !museRe.test(e.muse_commit_id) || mapping.has(e.git_sha) || usedMuse.has(bareMuseId(e.muse_commit_id))) {
      problems.push({ code: 'DUPLICATE_OR_INVALID_IMPORT', gitSha: e.git_sha }); continue;
    }
    mapping.set(e.git_sha, e.muse_commit_id); usedMuse.add(bareMuseId(e.muse_commit_id));
    if (!git.has(e.git_sha)) problems.push({ code: 'UNEXPECTED_IMPORT', gitSha: e.git_sha });
  }
  const done = events.filter(e => e.event === 'done');
  if (done.length !== 1 || done[0].total_commits_written !== git.size || done[0].dry_run !== false) problems.push({ code: 'INCOMPLETE_IMPORT_RECEIPT' });
  const captures = new Map();
  for (const item of capture.records) {
    if (!museRe.test(item?.muse_commit_id) || captures.has(bareMuseId(item.muse_commit_id))) { problems.push({ code: 'INVALID_OR_DUPLICATE_READBACK' }); continue; }
    captures.set(bareMuseId(item.muse_commit_id), item);
  }
  const checked = [];
  for (const c of baseline.commits) {
    const id = mapping.get(c.gitSha), row = captures.get(bareMuseId(id));
    if (!row?.commit || !row?.snapshot) { problems.push({ code: 'MISSING_MUSE_READBACK', gitSha: c.gitSha }); continue; }
    const m = row.commit, s = row.snapshot;
    if (!sameMuseId(m.commit_id, id)) problems.push({ code: 'COMMIT_ID', gitSha: c.gitSha });
    if (m.metadata?.git_sha !== c.gitSha) problems.push({ code: 'GIT_SHA_METADATA', gitSha: c.gitSha, actual: m.metadata?.git_sha ?? null });
    const parents = c.parents.map(p => mapping.get(p));
    const actual = [m.parent_commit_id ?? null, m.parent2_commit_id ?? null];
    if (c.parents.length > 2 || parents.some(x => !x) || !sameMuseId(parents[0] ?? null, actual[0]) || !sameMuseId(parents[1] ?? null, actual[1])) problems.push({ code: 'PARENT_DAG', gitSha: c.gitSha, expected: parents, actual });
    if (!museRe.test(m.snapshot_id) || !sameMuseId(s.snapshot_id, m.snapshot_id) || !s.manifest || typeof s.manifest !== 'object' || Array.isArray(s.manifest)) { problems.push({ code: 'SNAPSHOT_SCHEMA', gitSha: c.gitSha }); continue; }
    const wanted = new Map(c.files.map(f => [f.path, f.sha256]));
    if (wanted.size !== c.files.length) throw new Error('Duplicate Git snapshot paths');
    for (const [p, hash] of wanted) {
      if (!Object.hasOwn(s.manifest, p)) problems.push({ code: 'MISSING_PATH', gitSha: c.gitSha, path: p });
      else if (!museRe.test(s.manifest[p])) problems.push({ code: 'INVALID_BLOB_ID', gitSha: c.gitSha, path: p, actual: s.manifest[p] });
      else {
        const id = bareMuseId(s.manifest[p]);
        const raw = capture.blobs[id];
        if (!raw || !/^[a-f0-9]{64}$/.test(raw.sha256) || !Number.isSafeInteger(raw.byteLength) || raw.byteLength < 0) {
          problems.push({ code: 'MISSING_BLOB_BYTES', gitSha: c.gitSha, path: p, museBlobId: s.manifest[p] });
        } else if (raw.sha256 !== hash) {
          problems.push({ code: 'WRONG_BLOB_BYTES', gitSha: c.gitSha, path: p, museBlobId: s.manifest[p], expectedRawSha256: hash, observedRawSha256: raw.sha256, observedByteLength: raw.byteLength });
        }
      }
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
    verified: ['Stored Muse parent DAG under --preserve-merge-commits', 'Historical tracked paths and cat-object raw byte SHA-256 when PASS'],
    unverified: ['Git executable modes and other file metadata', 'Author and committer history', 'Signatures and provenance', 'Remote sync and production compatibility'],
    execution: { writesAttempted: false, pushesAttempted: false },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, gitFile, eventsFile, source, diagnosticsDir, ...extra] = process.argv.slice(2);
    if (!['capture', 'audit'].includes(action) || !gitFile || !eventsFile || !source || extra.length || (action === 'audit' && diagnosticsDir)) throw new Error('Usage: node src/muse-history-verify.mjs capture <baseline.json> <import.ndjson> <museDir> [absolute-diagnosticsDir] | audit <baseline.json> <import.ndjson> <readbacks.json>');
    const git = JSON.parse(loaded(gitFile)), events = eventsFromNDJSON(loaded(eventsFile));
    const raw = action === 'capture' ? captureReadbacks(source, events, diagnosticsDir) : JSON.parse(loaded(source));
    const captured = raw.records ? raw : raw.capture;
    const result = verifyReadbacks(git, events, captured);
    process.stdout.write(JSON.stringify({ ...result, capture: captured }, null, 2) + '\n');
    if (result.status !== 'PASS_DAG_AND_HISTORICAL_BLOBS_ONLY') process.exitCode = 2;
  } catch (error) { process.stderr.write('[Muse R0.7] ' + error.message + '\n'); process.exitCode = 1; }
}
