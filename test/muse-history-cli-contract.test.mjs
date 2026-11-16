import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureReadbacks, eventsFromNDJSON, verifyReadbacks } from '../src/muse-history-verify.mjs';

const gitSha = 'd'.repeat(40);
const commitId = 'a'.repeat(64);
const snapshotId = 'b'.repeat(64);
const objectId = 'c'.repeat(64);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-r07-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const muse = path.join(root, 'muse');
  fs.mkdirSync(bin);
  fs.mkdirSync(muse);
  fs.mkdirSync(path.join(muse, '.muse'));
  const trace = path.join(root, 'calls.log');
  // Fake *strict* Muse 0.2.2rc9 plumbing CLI: default output is JSON and
  // --format json fails as in actual workflow run #43976504464.
  const fake = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const argv = process.argv.slice(2);",
    "fs.appendFileSync(process.env.MUSE_CALL_TRACE, JSON.stringify(argv) + '\\n');",
    "if (argv.length === 1 && argv[0] === '--version') { console.log('muse 0.2.2rc9'); process.exit(0); }",
    "if (argv.length !== 2 || !/^[a-f0-9]{64}$/.test(argv[1])) { console.error('muse: error: unrecognized arguments'); process.exit(2); }",
    "if (argv[0] === 'read-commit' && argv[1] === " + JSON.stringify(commitId) + ") {",
    " console.log(JSON.stringify({commit_id:" + JSON.stringify(commitId) + ",metadata:{git_sha:" + JSON.stringify(gitSha) + "},parent_commit_id:null,parent2_commit_id:null,snapshot_id:" + JSON.stringify(snapshotId) + "})); process.exit(0);",
    "}",
    "if (argv[0] === 'read-snapshot' && argv[1] === " + JSON.stringify(snapshotId) + ") {",
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
  });
  return { muse, trace };
}

function source() {
  const baseline = {
    schema: 'gitporch.muse-git-history-baseline.v1',
    commits: [{ gitSha, parents: [], files: [{ path: 'README.md', sha256: objectId, mode: '100644' }] }]
  };
  const events = eventsFromNDJSON([
    JSON.stringify({ event: 'commit', git_sha: gitSha, muse_commit_id: 'sha256:' + commitId }),
    JSON.stringify({ event: 'done', total_commits_written: 1, dry_run: false, exec_bit_not_kept: [] })
  ].join('\n'));
  return { baseline, events };
}

test('R0.7 actual CLI contract: default JSON, bare CLI IDs, prefixed receipt IDs, bare manifest hashes', t => {
  const f = fixture(t);
  const { baseline, events } = source();
  const got = captureReadbacks(f.muse, events);
  assert.equal(got.records.length, 1);
  assert.equal(got.museVersion, 'muse 0.2.2rc9');
  assert.equal(verifyReadbacks(baseline, events, got).status, 'PASS_DAG_AND_HISTORICAL_BLOBS_ONLY');
  const calls = fs.readFileSync(f.trace, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls, [
    ['read-commit', commitId], ['read-snapshot', snapshotId], ['--version']
  ]);
});

test('R0.7 still rejects a truly incorrect SHA-256 blob', t => {
  const f = fixture(t);
  const { baseline, events } = source();
  const got = captureReadbacks(f.muse, events);
  got.records[0].snapshot.manifest['README.md'] = 'e'.repeat(64);
  const r = verifyReadbacks(baseline, events, got);
  assert.equal(r.status, 'FAIL_OR_INCOMPLETE_HISTORY');
  assert.ok(r.problems.some(x => x.code === 'WRONG_BLOB'));
});
