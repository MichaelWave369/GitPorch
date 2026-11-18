import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { captureReadbacks, verifyReadbacks } from '../src/muse-history-verify.mjs';

const GIT_A = 'a'.repeat(40);
const GIT_B = 'b'.repeat(40);
const MUSE_A = 'sha256:' + 'c'.repeat(64);
const MUSE_B = 'sha256:' + 'd'.repeat(64);
const SNAPSHOT = 'sha256:' + 'e'.repeat(64);
const BLOB = 'sha256:' + 'f'.repeat(64);
const CONTENT = 'intent Stable {}\n';

// Real R0.9 Vibe run #12 reached Muse 0.2.2rc11, and a historical snapshot
// object was shared by more than one distinct Git commit. This test uses a
// deliberately fake local Muse CLI to exercise evidence capture offline.
// It is NOT evidence of running the real upstream CLI.
test('capture once per immutable snapshot, verify it against every distinct Git commit', { skip: process.platform === 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitporch-muse-shared-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const museDir = path.join(root, 'muse');
  const evidence = path.join(root, 'evidence');
  const separateEvidence = path.join(root, 'duplicate-evidence');
  for (const dir of [bin, museDir, evidence, separateEvidence, path.join(museDir, '.muse')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const fake = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const argv = process.argv.slice(2);",
    "fs.appendFileSync(process.env.MUSE_TEST_TRACE, argv[0] + '\\t' + (argv[1] ?? '') + '\\n');",
    "const commitA = 'sha256:' + 'c'.repeat(64);",
    "const commitB = 'sha256:' + 'd'.repeat(64);",
    "const snapshot = 'sha256:' + 'e'.repeat(64);",
    "const blob = 'sha256:' + 'f'.repeat(64);",
    "const same = (a,b) => String(a).replace(/^sha256:/,'') === String(b).replace(/^sha256:/,'');",
    "let value;",
    "if (argv[0] === '--version') process.stdout.write('muse FAKE/OFFLINE\\n');",
    "else if (argv[0] === 'read-commit' && [commitA,commitB].some(c=>same(c,argv[1])) && argv[2] === '--json') {",
    "  const first = same(argv[1],commitA);",
    "  value = {commit_id:first?commitA:commitB, snapshot_id:snapshot,",
    "    metadata:{git_sha:(first?'a':'b').repeat(40)},",
    "    parent_commit_id:first?null:commitA,parent2_commit_id:null};",
    "  process.stdout.write(JSON.stringify(value));",
    "} else if (argv[0] === 'read-snapshot' && same(argv[1],snapshot) && argv[2] === '--json') {",
    "  process.stdout.write(JSON.stringify({snapshot_id:snapshot,manifest:{'spec.vibe':blob}}));",
    "} else if (argv[0] === 'cat-object' && same(argv[1],blob)) {",
    "  process.stdout.write('intent Stable {}\\n');",
    "} else { console.error('Unexpected fake Muse CLI arguments'); process.exit(2); }",
  ].join('\n') + '\n';
  const executable = path.join(bin, 'muse');
  fs.writeFileSync(executable, fake, { mode: 0o755 });
  fs.chmodSync(executable, 0o755);
  const trace = path.join(root, 'calls.txt');
  const digest = crypto.createHash('sha256').update(CONTENT).digest('hex');
  const file = { path: 'spec.vibe', mode: '100644', sha256: digest };
  const baseline = { schema: 'gitporch.muse-git-history-baseline.v1', commits: [
    { gitSha: GIT_A, parents: [], files: [file] },
    { gitSha: GIT_B, parents: [GIT_A], files: [file] },
  ] };
  const events = [
    { event: 'commit', git_sha: GIT_A, muse_commit_id: MUSE_A },
    { event: 'commit', git_sha: GIT_B, muse_commit_id: MUSE_B },
    { event: 'done', total_commits_written: 2, dry_run: false, exec_bit_not_kept: [] },
  ];
  const oldPath = process.env.PATH;
  const oldTrace = process.env.MUSE_TEST_TRACE;
  try {
    process.env.PATH = bin + path.delimiter + (oldPath ?? '');
    process.env.MUSE_TEST_TRACE = trace;
    const capture = captureReadbacks(museDir, events, evidence);
    const review = verifyReadbacks(baseline, events, capture);
    assert.equal(review.status, 'PASS_DAG_AND_HISTORICAL_BLOBS_ONLY', JSON.stringify(review.problems));
    assert.equal(review.checked.length, 2);
    assert.equal(capture.records.length, 2);
    assert.deepEqual(capture.records.map(r => r.snapshot.snapshot_id), [SNAPSHOT, SNAPSHOT]);
    const calls = fs.readFileSync(trace, 'utf8').trim().split('\n').map(s => s.split('\t')[0]);
    assert.equal(calls.filter(s => s === 'read-commit').length, 2);
    assert.equal(calls.filter(s => s === 'read-snapshot').length, 1);
    assert.equal(calls.filter(s => s === 'cat-object').length, 1);
    const names = fs.readdirSync(evidence);
    assert.equal(names.filter(n => n.startsWith('muse-read-commit-')).length, 2);
    assert.equal(names.filter(n => n.startsWith('muse-read-snapshot-')).length, 1);
    assert.equal(names.filter(n => n.startsWith('muse-cat-object-')).length, 1);
    assert.throws(() => captureReadbacks(museDir, [...events, events[0]], separateEvidence),
      /Duplicate Git\/Muse commit import event/);
    assert.throws(() => captureReadbacks(museDir, events, evidence), /EEXIST/,
      'exclusive evidence creation must still reject accidental overwrite on repeat runs');
  } finally {
    if (oldTrace === undefined) delete process.env.MUSE_TEST_TRACE;
    else process.env.MUSE_TEST_TRACE = oldTrace;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});
