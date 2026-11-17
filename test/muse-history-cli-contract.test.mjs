import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { captureReadbacks, eventsFromNDJSON, verifyReadbacks } from '../src/muse-history-verify.mjs';

const gitSha = 'd'.repeat(40);
const commitId = 'a'.repeat(64);
const snapshotId = 'b'.repeat(64);
const objectId = 'c'.repeat(64);
const originalBytes = Buffer.from('Git source file bytes\\n', 'utf8');
const originalSha256 = crypto.createHash('sha256').update(originalBytes).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-r07-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const muse = path.join(root, 'muse');
  fs.mkdirSync(bin);
  fs.mkdirSync(muse);
  fs.mkdirSync(path.join(muse, '.muse'));
  const trace = path.join(root, 'calls.log');
  // Strict synthetic CLI that reproduces three real R0.7 failures:
  // #2: --format json rejected; #3: bare commit IDs rejected;
  // #4: default read-commit stdout was a bare "sha256:..." string,
  //     not a JSON object. Explicit --json returns a structured record.
  const fake = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const argv = process.argv.slice(2);",
    "fs.appendFileSync(process.env.MUSE_CALL_TRACE, JSON.stringify(argv) + '\\n');",
    "if (argv.length === 1 && argv[0] === '--version') { console.log('muse 0.2.2rc9'); process.exit(0); }",
    "if (!['read-commit', 'read-snapshot', 'cat-object'].includes(argv[0])) process.exit(3);",
    "if (!/^sha256:[a-f0-9]{64}$/.test(argv[1] || '')) { console.error('Invalid reference: use canonical sha256:<hex>'); process.exit(2); }",
    "if (argv[0] === 'cat-object') { if (argv.length !== 2 || argv[1] !== " + JSON.stringify('sha256:' + objectId) + ") process.exit(3); process.stdout.write(Buffer.from('Git source file bytes\\n', 'utf8')); process.exit(0); }",
    "if (argv.length === 2 || process.env.MUSE_MOCK_FORCE_TEXT === '1') { console.log(argv[1]); process.exit(0); }",
    "if (argv.length !== 3 || argv[2] !== '--json') { console.error('unrecognized arguments'); process.exit(2); }",
    "if (argv[0] === 'read-commit' && argv[1] === " + JSON.stringify('sha256:' + commitId) + ") {",
    " console.log(JSON.stringify({commit_id:" + JSON.stringify(commitId) + ",metadata:{git_sha:" + JSON.stringify(gitSha) + "},parent_commit_id:null,parent2_commit_id:null,snapshot_id:" + JSON.stringify(snapshotId) + "})); process.exit(0);",
    "}",
    "if (argv[0] === 'read-snapshot' && argv[1] === " + JSON.stringify('sha256:' + snapshotId) + ") {",
    " console.log(JSON.stringify({snapshot_id:'sha256:" + snapshotId + "',manifest:{'README.md':" + JSON.stringify(objectId) + "}})); process.exit(0);",
    "}",
    "process.exit(3);"
  ].join('\n') + '\n';
  const executable = path.join(bin, 'muse');
  fs.writeFileSync(executable, fake, { mode: 0o755 });
  const oldPath = process.env.PATH;
  const oldTrace = process.env.MUSE_CALL_TRACE;
  process.env.PATH = bin + path.delimiter + (oldPath || '');
  process.env.MUSE_CALL_TRACE = trace;
  t.after(() => {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldTrace === undefined) delete process.env.MUSE_CALL_TRACE; else process.env.MUSE_CALL_TRACE = oldTrace;
    delete process.env.MUSE_MOCK_FORCE_TEXT;
  });
  return { muse, trace, root };
}

function source() {
  const baseline = {
    schema: 'gitporch.muse-git-history-baseline.v1',
    commits: [{ gitSha, parents: [], files: [{ path: 'README.md', sha256: originalSha256, mode: '100644' }] }]
  };
  const events = eventsFromNDJSON([
    JSON.stringify({ event: 'commit', git_sha: gitSha, muse_commit_id: 'sha256:' + commitId }),
    JSON.stringify({ event: 'done', total_commits_written: 1, dry_run: false, exec_bit_not_kept: [] })
  ].join('\n'));
  return { baseline, events };
}

test('real failure #4: default read-commit returns an identifier rather than JSON', t => {
  const f = fixture(t);
  const result = spawnSync('muse', ['read-commit', 'sha256:' + commitId], { cwd: f.muse, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'sha256:' + commitId);
  assert.throws(() => JSON.parse(result.stdout), SyntaxError);
});

test('R0.7 requests explicit --json, preserves raw CLI evidence and validates imported hashes', t => {
  const f = fixture(t);
  const { baseline, events } = source();
  const got = captureReadbacks(f.muse, events, f.root);
  assert.equal(got.records.length, 1);
  assert.equal(got.museVersion, 'muse 0.2.2rc9');
  assert.equal(verifyReadbacks(baseline, events, got).status, 'PASS_DAG_AND_HISTORICAL_BLOBS_ONLY');
  const calls = fs.readFileSync(f.trace, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.slice(-3), [
    ['read-commit', 'sha256:' + commitId, '--json'],
    ['read-snapshot', 'sha256:' + snapshotId, '--json'],
    ['cat-object', 'sha256:' + objectId],
    ['--version']
  ]);
  for (const [command, id] of [['read-commit', commitId], ['read-snapshot', snapshotId]]) {
  assert.equal(got.blobs[objectId].sha256, originalSha256);
  assert.notEqual(objectId, originalSha256, 'Muse object ID must differ from raw-file SHA256 for this test');
  const blobEvidence = fs.readFileSync(path.join(f.root, 'muse-cat-object-' + objectId + '.txt'), 'utf8');
  assert.match(blobEvidence, new RegExp('raw_sha256=' + originalSha256));
    const evidence = fs.readFileSync(path.join(f.root, 'muse-' + command + '-' + id + '.txt'), 'utf8');
    assert.match(evidence, /exit_code=0/);
    assert.match(evidence, /stdout:\n\{/);
  }
});

test('R0.7 retains exact synthetic stdout evidence even when explicit --json emits non-JSON', t => {
  const f = fixture(t);
  const { events } = source();
  process.env.MUSE_MOCK_FORCE_TEXT = '1';
  assert.throws(() => captureReadbacks(f.muse, events, f.root), /did not emit JSON with --json/);
  const evidence = fs.readFileSync(path.join(f.root, 'muse-read-commit-' + commitId + '.txt'), 'utf8');
  assert.match(evidence, /stdout:\nsha256:aaaaaaaa/);
});

test('R0.7 refuses diagnostic writes inside the Muse repository', t => {
  const f = fixture(t);
  const { events } = source();
  assert.throws(() => captureReadbacks(f.muse, events, path.join(f.muse, '.muse')), /outside the Muse repository/);
  assert.equal(fs.readdirSync(path.join(f.muse, '.muse')).length, 0);
});

test('R0.7 still rejects a genuinely incorrect snapshot blob SHA-256', t => {
  const f = fixture(t);
  const { baseline, events } = source();
  const got = captureReadbacks(f.muse, events);
  got.blobs[objectId].sha256 = 'e'.repeat(64);
  const r = verifyReadbacks(baseline, events, got);
  assert.equal(r.status, 'FAIL_OR_INCOMPLETE_HISTORY');
  assert.ok(r.problems.some(x => x.code === 'WRONG_BLOB_BYTES'));
});
