import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rename,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRepo,git} from '../src/git.mjs';
import {enqueue as enqueueTests} from '../src/sandbox-ci.mjs';
import {bundleSource,artifactSnapshot} from '../src/artifact-forge.mjs';
const IMAGE='sha256:'+'a'.repeat(64);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function fixture(){
 const d=await mkdtemp(join(tmpdir(),'artifact-forge-'));
 const {path}=await createRepo(d,'Garden'),work=join(d,'work');
 await git(['init','--initial-branch=main',work]);
 await git(['-C',work,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','fixture']);
 await git(['-C',work,'push',path,'HEAD:main']);
 const queued=await enqueueTests(d,'Garden',IMAGE);
 return {d,work,queued};
}
// Seed a contract-valid local test fixture without Docker. This tests linkage,
// not a claim that independent container execution was witnessed.
async function seedLocalPass(d,queued,outcome='PASS',withEvidence=true){
 const file=queued.id+'.json';
 await rename(join(d,'isolated-tests','pending',file),join(d,'isolated-tests','done',file));
 const base={schema:'gitporch-isolated-tests/0.1',id:queued.id,
  outcome,counts:{tests:1,pass:outcome==='PASS'?1:0,fail:outcome==='FAIL'?1:0,skipped:0,cancelled:0,todo:0},
  evidence:withEvidence?{schema:'gitporch-container-evidence/0.1',
    observedImageId:IMAGE,stdoutSha256:'b'.repeat(64),stderrSha256:'c'.repeat(64),
    dockerCliExitCode:outcome==='FAIL'?1:0,scope:'LOCAL_DOCKER_OUTPUT_HASHES_NOT_SIGNED'}:null,
  completedAt:new Date().toISOString(),durationMs:1,scope:'NODE_TEST_IN_DOCKER_NO_NETWORK_NO_HOST_EXEC'};
 await writeFile(join(d,'isolated-tests','results',file),
   JSON.stringify({...base,checksum:digest(base)},null,2)+'\n');
}
test('refuses packaging without explicit approval or eligible finished test',async()=>{
 const {d,queued}=await fixture();
 try{
  await assert.rejects(bundleSource(d,'Garden',queued.id),/approval|Explicit/i);
  await assert.rejects(bundleSource(d,'Garden',queued.id,{approved:true}),/Require a completed/);
  assert.equal((await artifactSnapshot(d)).count,0);
 }finally{await rm(d,{recursive:true,force:true});}
});
test('fixed recipe packages real Git commit and verifies source bytes and test linkage',async()=>{
 const {d,queued}=await fixture();
 try{
  await seedLocalPass(d,queued);
  const result=await bundleSource(d,'Garden',queued.id,{approved:true});
  assert.equal(result.testJobId,queued.id);
  assert.equal(result.status,'SOURCE_BYTES_VERIFIED_NOT_BUILD_ATTESTED');
  const snap=await artifactSnapshot(d);
  assert.equal(snap.count,1);
  assert.equal(snap.artifacts[0].sha256,result.sha256);
  assert.equal(snap.artifacts[0].testImage,IMAGE);
  const tar=join(d,'artifacts',result.id+'.tar');
  assert.equal((await readFile(tar)).length,result.bytes);
  await writeFile(tar,'corrupt bytes');
  await assert.rejects(artifactSnapshot(d),/altered|mismatch/i);
 }finally{await rm(d,{recursive:true,force:true});}
});
test('refuses a local FAIL or PASS without output evidence',async()=>{
 for(const [outcome,evidence] of [['FAIL',true],['PASS',false]]){
  const {d,queued}=await fixture();
  try{
   await seedLocalPass(d,queued,outcome,evidence);
   await assert.rejects(bundleSource(d,'Garden',queued.id,{approved:true}),/Require a completed/);
  }finally{await rm(d,{recursive:true,force:true});}
 }
});
test('new HEAD requires a passing job for that new exact commit',async()=>{
 const {d,work,queued}=await fixture();
 try{
  await seedLocalPass(d,queued);
  await git(['-C',work,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','next']);
  await git(['-C',work,'push',join(d,'repos','Garden.git'),'HEAD:main']);
  await assert.rejects(bundleSource(d,'Garden',queued.id,{approved:true}),/Require a completed/);
 }finally{await rm(d,{recursive:true,force:true});}
});
