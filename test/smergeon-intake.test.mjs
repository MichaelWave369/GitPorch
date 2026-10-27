// The two reference digests below were calculated independently in Python
// using Smergeon's canonical json.dumps(... sort_keys=True, separators=(',', ':')).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspectSmergeonReceipt, SCHEMA } from '../src/smergeon-intake.mjs';

const STAGED_DIGEST = '705dc363673fe5bae5255613a4a550698a442ef253367299ced4ccdd5507c673';
const DRAFT_DIGEST = '645fa835a0d195bb9bc7a9f0239712e61da1cf1ab5c439eefc8ee5be67de5ac6';
const warning = 'Checksum is not a signature, CI result, authenticated custody, Anti-M completion, GitPorch worker record, or approval to merge.';
function receipt(event='STAGED_ONLY') {
  return {
    schema: SCHEMA,
    body: {
      schema: SCHEMA,
      event,
      source: {
        repository: 'owner/repo',
        pull_request: 7,
        head_sha: 'c'.repeat(40),
        plan_fingerprint: 'a'.repeat(64),
      },
      operation: {
        id: 'b'.repeat(64),
        branch: 'smergeon/repair-pr7-cccccccc-bbbbbbbbbb',
        file_path: 'src/fix.py',
        before_blob_sha: 'd'.repeat(40),
        after_blob_sha: 'e'.repeat(40),
      },
      draft: event === 'STAGED_ONLY'
        ? {number: null, url: null}
        : {number: 8, url: 'https://github.com/owner/repo/pull/8'},
      handoff: {
        gitporch: {
          kind: 'UNSIGNED_REPAIR_PROPOSAL',
          worker_execution_verified: false,
          signed_evidence: false,
          witnessed: false,
          outcome: 'UNVERIFIED',
        },
        anti_m: {
          kind: 'SHADOW_REVIEW_ONLY',
          execution_authority: false,
          closure_authority: false,
          ledger_write: false,
          done: false,
          provenance: 'OPERATOR_REPORT',
        },
      },
      claims: {
        origin: 'LOCAL_SELF_REPORT',
        verified_root_cause: false,
        ci_verified: false,
        independently_witnessed: false,
        source_branch_modified: false,
        merges_performed: 0,
        permission_granted: false,
      },
    },
    checksum_sha256: event === 'STAGED_ONLY' ? STAGED_DIGEST : DRAFT_DIGEST,
    trust: 'UNSIGNED_UNVERIFIED',
    warning,
  };
}
const copy = value => JSON.parse(JSON.stringify(value));

test('Python-produced staged checksum is accepted only as REVIEW_ONLY', () => {
  const result = inspectSmergeonReceipt(receipt());
  assert.equal(result.outcome, 'REVIEW_ONLY');
  assert.equal(result.reason, 'FORMAT_AND_CHECKSUM_CONSISTENT_NOT_AUTHENTICATED');
  assert.equal(result.trust, 'UNSIGNED_UNVERIFIED');
  assert.equal(result.acceptedAsSignedEvidence, false);
  assert.equal(result.verifiedWorkerRun, false);
  assert.equal(result.antiMCompletion, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.draftPullRequest, null);
  assert.equal(result.headSha, 'c'.repeat(40));
});

test('Python-produced draft checksum does not imply merged, tested, or DONE', () => {
  const result = inspectSmergeonReceipt(receipt('DRAFT_CREATED'));
  assert.equal(result.outcome, 'REVIEW_ONLY');
  assert.equal(result.event, 'DRAFT_CREATED');
  assert.equal(result.draftPullRequest, 8);
  assert.equal(result.draftUrl, 'https://github.com/owner/repo/pull/8');
  assert.equal(result.antiMCompletion, false);
  assert.equal(result.mergeAuthority, false);
});

test('independently pinned checksum must match', () => {
  assert.equal(inspectSmergeonReceipt(receipt(), {expectedChecksum: STAGED_DIGEST}).outcome,
    'REVIEW_ONLY');
  assert.equal(inspectSmergeonReceipt(receipt(), {expectedChecksum: '0'.repeat(64)}).outcome,
    'REJECT');
});

test('modified receipt is rejected, including a permitted-looking changed fingerprint', () => {
  const changed = copy(receipt());
  changed.body.source.head_sha = 'f'.repeat(40);
  assert.equal(inspectSmergeonReceipt(changed).outcome, 'REJECT');
  const changed2 = copy(receipt());
  changed2.body.operation.before_blob_sha = 'f'.repeat(40);
  assert.equal(inspectSmergeonReceipt(changed2).reason, 'CHECKSUM_MISMATCH');
});

test('claimed verified worker job, signature, or Anti-M DONE always rejected', () => {
  const changes = [
    r => {r.body.handoff.gitporch.outcome = 'PASS';},
    r => {r.body.handoff.gitporch.signed_evidence = true;},
    r => {r.body.handoff.gitporch.witnessed = true;},
    r => {r.body.handoff.anti_m.done = true;},
    r => {r.body.handoff.anti_m.execution_authority = true;},
    r => {r.body.claims.ci_verified = true;},
    r => {r.body.claims.permission_granted = true;},
    r => {r.body.claims.merges_performed = 1;},
  ];
  for (const change of changes) {
    const data = copy(receipt());
    change(data);
    assert.equal(inspectSmergeonReceipt(data).reason, 'FORBIDDEN_AUTHORITY_CLAIM');
  }
});

test('unsafe file path, wrong branch and noncanonical draft links rejected', () => {
  const changes = [
    r => {r.body.operation.file_path = '../secrets.py';},
    r => {r.body.operation.file_path = '.github/workflows/ci.yml';},
    r => {r.body.operation.branch = 'main';},
    r => {r.body.operation.branch = 'smergeon/repair-pr7-cccccccc-0000000000';},
    r => {r.body.draft.number = 9;},
    r => {r.body.draft.url = 'https://github.com/owner/repo/pull/8?unsafe=1';},
    r => {r.body.draft.url = 'https://evil.example/steal';},
  ];
  for (const change of changes) {
    const data = copy(receipt('DRAFT_CREATED'));
    change(data);
    assert.equal(inspectSmergeonReceipt(data).outcome, 'REJECT');
  }
});

test('unrecognized schemas and extra fields rejected rather than downgraded', () => {
  const cases = [
    r => {r.schema = 'gitporch-offline-evidence/v1';},
    r => {r.body.handoff.extra = {};},
    r => {r.body.source.foo = 'secret';},
    r => {r.debug = 'token';},
    r => {r.body.source.pull_request = true;},
    r => {r.body.source.repository = 'owner/..';},
  ];
  for (const edit of cases) {
    const data = copy(receipt());
    edit(data);
    assert.equal(inspectSmergeonReceipt(data).outcome, 'REJECT');
  }
});

test('CLI uses only local file, emits REVIEW_ONLY without displaying input data', () => {
  const dir = mkdtempSync(join(tmpdir(),'gitporch-smergeon-'));
  try {
    const file = join(dir,'receipt.json');
    writeFileSync(file, JSON.stringify(receipt()));
    const command = spawnSync(process.execPath,
      [resolve('src/smergeon-intake-cli.mjs'),file,'--expected-sha256',STAGED_DIGEST],
      { encoding: 'utf8', timeout: 5000 });
    assert.equal(command.status,0,command.stderr);
    assert.equal(JSON.parse(command.stdout).outcome,'REVIEW_ONLY');
    assert.equal(JSON.parse(command.stdout).mergeAuthority,false);
    assert.equal(readFileSync(file,'utf8'),JSON.stringify(receipt()));
    assert.equal(command.stderr,'');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('CLI refuses large files, bad options and altered receipts', () => {
  const dir = mkdtempSync(join(tmpdir(),'gitporch-smergeon-'));
  try {
    const file = join(dir,'receipt.json');
    writeFileSync(file, JSON.stringify(receipt())+' '.repeat(17000));
    let call = spawnSync(process.execPath,
      [resolve('src/smergeon-intake-cli.mjs'),file],{encoding:'utf8',timeout:5000});
    assert.equal(call.status,2);
    writeFileSync(file, JSON.stringify({...receipt(),trust:'SIGNED'}));
    call = spawnSync(process.execPath,
      [resolve('src/smergeon-intake-cli.mjs'),file],{encoding:'utf8',timeout:5000});
    assert.equal(call.status,1);
    assert.equal(JSON.parse(call.stdout).outcome,'REJECT');
    call = spawnSync(process.execPath,
      [resolve('src/smergeon-intake-cli.mjs'),file,'--execute'],{encoding:'utf8',timeout:5000});
    assert.equal(call.status,2);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
