import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRepo,git} from '../src/git.mjs';
import {enqueueCheck,workOnce} from '../src/porch-crew.mjs';
import {enqueue as enqueueTests} from '../src/sandbox-ci.mjs';
import {phirunnersSnapshot} from '../src/phirunners.mjs';

const IMAGE='sha256:'+'f'.repeat(64);
async function fixture(){
  const home=await mkdtemp(join(tmpdir(),'phirunners-'));
  const {path}=await createRepo(home,'Garden');
  const work=join(home,'work');
  await git(['init','--initial-branch=main',work]);
  await git(['-C',work,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','fixture']);
  await git(['-C',work,'push',path,'HEAD:main']);
  return home;
}
test('PhiRunners accurately combines real queued jobs and successful local Git fsck',async()=>{
  const home=await fixture();
  try{
    await enqueueCheck(home,'Garden');
    await enqueueTests(home,'Garden',IMAGE);
    const pending=await phirunnersSnapshot(home);
    assert.equal(pending.health,'LOCAL_RECEIPTS_CHECKED_NOT_ATTESTED');
    assert.equal(pending.totals.queued,2);
    assert.equal(pending.totals.passed,0);
    assert.equal(pending.jobs.filter(j=>j.status==='QUEUED').length,2);
    const executed=await workOnce(home);
    assert.equal(executed.outcome,'PASS');
    const updated=await phirunnersSnapshot(home);
    assert.equal(updated.totals.queued,1);
    assert.equal(updated.totals.done,1);
    assert.equal(updated.totals.passed,1);
    assert.equal(updated.lanes.tests.counts.queued,1);
    assert.equal(updated.lanes.git.jobType,'GIT_OBJECT_INTEGRITY');
    assert.equal(updated.jobs.find(j=>j.lane==='git').outcome,'PASS');
  }finally{await rm(home,{recursive:true,force:true});}
});
test('PhiRunners hides corrupt lane data and does not display partial totals',async()=>{
  const home=await fixture();
  try{
    const task=await enqueueCheck(home,'Garden');
    await enqueueTests(home,'Garden',IMAGE);
    await appendFile(join(home,'porch-crew','pending',task.id+'.json'),'tamper');
    const state=await phirunnersSnapshot(home);
    assert.equal(state.health,'PARTIAL_OR_UNVERIFIED');
    assert.equal(state.totals,null);
    assert.equal(state.lanes.git.counts,null);
    assert.equal(state.lanes.git.health,'UNVERIFIED');
    assert.equal(state.jobs.some(j=>j.lane==='git'),false);
    assert.equal(state.lanes.tests.counts.queued,1);
  }finally{await rm(home,{recursive:true,force:true});}
});
