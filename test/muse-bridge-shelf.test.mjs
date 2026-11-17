import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHttpServer } from '../src/server.mjs';
import { verifyReadbacks } from '../src/muse-history-verify.mjs';
import { summarizeMuseEvidence, inspectMuseEvidenceFolder, publishMuseEvidenceFolder, museBridgeShelf } from '../src/muse-bridge-shelf.mjs';

const git = 'a'.repeat(40), muse = 'sha256:' + 'b'.repeat(64);
const snap = 'sha256:' + 'c'.repeat(64), blob = 'sha256:' + 'd'.repeat(64), rawSha = 'e'.repeat(64);
const runId = '43997723043';
function fixture() {
  const baseline = {
    schema: 'gitporch.muse-git-history-baseline.v1',
    source: { branch: 'main', head: git, commitCount: 1 },
    commits: [{ gitSha: git, parents: [], files: [{path:'README.md', mode:'100644', sha256:rawSha}] }],
  };
  const eventsText = [
    JSON.stringify({event:'commit',git_sha:git,muse_commit_id:muse}),
    JSON.stringify({event:'done',total_commits_written:1,dry_run:false,exec_bit_not_kept:[]}),
  ].join('\n');
  const events = eventsText.split('\n').map(JSON.parse);
  const capture = {
    schema:'gitporch.muse-readbacks.v2',
    museVersion:'muse 0.2.2rc9',
    records:[{
      muse_commit_id:muse,
      commit:{commit_id:muse,metadata:{git_sha:git},parent_commit_id:null,parent2_commit_id:null,snapshot_id:snap,
              author:'TEST-ONLY-SECRET-MUST-NOT-LEAK'},
      snapshot:{snapshot_id:snap,manifest:{'README.md':blob}},
    }],
    blobs:{ ['d'.repeat(64)]:{sha256:rawSha,byteLength:17} },
  };
  const result = verifyReadbacks(baseline, events, capture);
  const history = {...result,capture};
  const snapshot = {schema:'gitporch.muse-snapshot-audit.v1',status:'PASS_SNAPSHOT_ONLY',
    differences:{missingFromMirror:[],extraInMirror:[],contentMismatch:[],modeMismatch:[]}};
  const status = {schema:'gitporch.muse-status-audit.v1',status:'PASS_STATUS_RECEIPT_ONLY',
    findings:[],source:{branch:'main',head:git},mirror:{branch:'muse-mirror',head:'f'.repeat(40)},
    drift:{git_commits_since_import:0,muse_commits_since_export:0}};
  const museStatus = { last_import:{git_sha:git,muse_commit_id:muse,commits_written:1,
      imported_at:'2026-11-17T01:44:09Z',private_note:'TEST-ONLY-SECRET-MUST-NOT-LEAK'},
    last_export:{muse_commit_id:muse,git_sha:'f'.repeat(40)},
    drift:{git_commits_since_import:0,muse_commits_since_export:0} };
  return {baseline,eventsText,history,snapshot,status,museStatus};
}
function root(t, inputs = fixture()) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(),'muse-r08-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const folder = path.join(home,'evidence');
  const data = path.join(home,'data');
  fs.mkdirSync(folder);
  const files = {
    'git-history-baseline.json':JSON.stringify(inputs.baseline),
    'muse-import.log':inputs.eventsText,
    'muse-internal-history-audit.json':JSON.stringify(inputs.history),
    'snapshot-audit.json':JSON.stringify(inputs.snapshot),
    'status-audit.json':JSON.stringify(inputs.status),
    'muse-status.json':JSON.stringify(inputs.museStatus),
  };
  for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(folder,name),text);
  return {home,folder,data,inputs};
}
test('replays all 6 evidence sources into a bounded unsigned read-only summary',()=>{
  const s=summarizeMuseEvidence(fixture(),runId);
  assert.equal(s.state,'REPLAYED_PASS_UNSIGNED');
  assert.equal(s.gitHead,git);
  assert.equal(s.museHead,muse);
  assert.equal(s.commitsChecked,1);
  assert.equal(s.historicalEntriesChecked,1);
  assert.equal(s.distinctMuseBlobsChecked,1);
  assert.equal(s.runUrl,'https://github.com/MichaelWave369/GitPorch/actions/runs/'+runId);
  assert.doesNotMatch(JSON.stringify(s),/TEST-ONLY-SECRET-MUST-NOT-LEAK/);
});
test('no evidence is never displayed as a passing live connection',t=>{
  const f=root(t);
  assert.equal(museBridgeShelf(f.data).state,'NO_RECEIPTS');
  assert.deepEqual(museBridgeShelf(f.data).receipts,[]);
});
test('review-only inspect does not create a receipt or modify files',t=>{
  const f=root(t);
  assert.equal(inspectMuseEvidenceFolder(f.folder,runId).summary.commitsChecked,1);
  assert.equal(fs.existsSync(f.data),false);
});
test('explicit publish stores a sanitized summary and hash-checks it on read',t=>{
  const f=root(t);
  const {file}=publishMuseEvidenceFolder(f.data,f.folder,runId);
  const receipt=museBridgeShelf(f.data);
  assert.equal(receipt.state,'UNSIGNED_LOCAL_RECEIPTS');
  assert.equal(receipt.receipts.length,1);
  assert.equal(receipt.receipts[0].runId,runId);
  assert.doesNotMatch(fs.readFileSync(file,'utf8'),/TEST-ONLY-SECRET-MUST-NOT-LEAK/);
  fs.appendFileSync(file,'\n'); // Hash mismatch is visible even with otherwise valid JSON.
  const blocked=museBridgeShelf(f.data);
  assert.equal(blocked.state,'INVALID_RECEIPT_SHELF');
  assert.equal(blocked.receipts.length,0);
});
test('historical mismatches, tampered claims and drift never publish green',t=>{
  for(const type of ['badBlob','badClaim','drift','badHead']){
    const inputs=fixture();
    if(type==='badBlob')inputs.history.capture.blobs['d'.repeat(64)].sha256='f'.repeat(64);
    if(type==='badClaim')inputs.history.status='FAKE_PASS';
    if(type==='drift')inputs.status.drift.git_commits_since_import=1;
    if(type==='badHead')inputs.museStatus.last_import.git_sha='f'.repeat(40);
    const f=root(t,inputs);
    assert.throws(()=>publishMuseEvidenceFolder(f.data,f.folder,runId),/MUSE_BRIDGE_EVIDENCE_INVALID/);
    assert.equal(fs.existsSync(f.data),false);
  }
});
test('symlinked evidence and symlinked receipt folders are refused',t=>{
  const f=root(t);
  const p=path.join(f.folder,'muse-status.json');
  fs.renameSync(p,p+'.bak');
  fs.symlinkSync(p+'.bak',p);
  assert.throws(()=>inspectMuseEvidenceFolder(f.folder,runId),/MUSE_BRIDGE_EVIDENCE_INVALID/);
  fs.mkdirSync(f.data);
  fs.symlinkSync(f.folder,path.join(f.data,'muse-bridge-receipts'));
  assert.equal(museBridgeShelf(f.data).state,'INVALID_RECEIPT_SHELF');
});
test('invalid run IDs and input traversal do not fabricate provenance',t=>{
  const f=root(t);
  assert.throws(()=>inspectMuseEvidenceFolder(f.folder,'not-a-run'),/run ID/);
  assert.throws(()=>inspectMuseEvidenceFolder(f.folder,'https://notgithub.example/run'),/run ID/);
});
test('GET-only localhost endpoint returns sanitized receipts and refuses browser writes',async t=>{
  const f=root(t);
  publishMuseEvidenceFolder(f.data,f.folder,runId);
  const server=createHttpServer({dataDir:f.data,daemonState:()=> 'stopped'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port+'/api/muse-bridge';
  const get=await fetch(base);
  assert.equal(get.status,200);
  const body=await get.text();
  assert.match(body,/REPLAYED_PASS_UNSIGNED/);
  assert.doesNotMatch(body,/TEST-ONLY-SECRET-MUST-NOT-LEAK/);
  assert.doesNotMatch(body,/\"manifest\"/);
  const post=await fetch(base,{method:'POST',body:'{}'});
  assert.equal(post.status,405);
  assert.equal((await post.json()).error,'READ_ONLY_HTTP');
});
