import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRepo,git} from '../src/git.mjs';
import {enqueueCheck,workOnce,queueSnapshot} from '../src/porch-crew.mjs';
async function isolated(fn){const root=await mkdtemp(join(tmpdir(),'porchcrew-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
async function seeded(root){
 const repo=await createRepo(root,'Garden');const work=join(root,'work');
 await git(['init','--initial-branch=main',work]);
 await git(['-C',work,'-c','user.name=Tester','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','green ledger']);
 await git(['-C',work,'push',repo.path,'HEAD:main']);
 return {repo,work};
}
test('a worker validates a real Git repo and records the exact check, not a CI pass',()=>isolated(async root=>{
 const {work}=await seeded(root);
 const job=await enqueueCheck(root,'Garden');assert.equal(job.status,'QUEUED');
 assert.equal(job.commit,await git(['-C',work,'rev-parse','HEAD']));
 assert.deepEqual((await queueSnapshot(root)).counts,{queued:1,runningUncertain:0,done:0});
 const result=await workOnce(root);assert.equal(result.status,'DONE');assert.equal(result.outcome,'PASS');
 assert.equal(result.scope,'GIT_FSCK_ONLY_NO_TESTS_RUN_NO_MERGE');
 const jobs=(await queueSnapshot(root)).jobs;assert.equal(jobs.length,1);assert.equal(jobs[0].outcome,'PASS');
 assert.equal(jobs[0].check,'GIT_OBJECT_INTEGRITY');
 assert.equal((await workOnce(root)).status,'IDLE');
}));
test('changed HEAD becomes stale, never a passing receipt',()=>isolated(async root=>{
 const {work,repo}=await seeded(root);
 await enqueueCheck(root,'Garden');
 await git(['-C',work,'-c','user.name=Tester','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','new commit']);
 await git(['-C',work,'push',repo.path,'HEAD:main']);
 assert.equal((await workOnce(root)).outcome,'STALE');
}));
test('strict job names and missing/empty repositories fail closed',()=>isolated(async root=>{
 await assert.rejects(enqueueCheck(root,'../x'),/Invalid repository/);
 await assert.rejects(enqueueCheck(root,'missing'),/not found/);
 await createRepo(root,'empty');
 await assert.rejects(enqueueCheck(root,'empty'));
}));
test('receipt tampering blocks queue processing',()=>isolated(async root=>{
 await seeded(root);const queued=await enqueueCheck(root,'Garden');
 const path=join(root,'porch-crew','pending',queued.id+'.json');
 const r=JSON.parse(await readFile(path,'utf8'));r.repo='evil';await writeFile(path,JSON.stringify(r));
 await assert.rejects(queueSnapshot(root),/checksum mismatch/);
 await assert.rejects(workOnce(root),/checksum mismatch/);
}));
test('in-progress job stays uncertain after a crash, never green',()=>isolated(async root=>{
 await seeded(root);const job=await enqueueCheck(root,'Garden');
 await rename(join(root,'porch-crew','pending',job.id+'.json'),join(root,'porch-crew','running',job.id+'.json'));
 const snap=await queueSnapshot(root);
 assert.equal(snap.jobs[0].status,'RUNNING_UNCERTAIN');assert.equal(snap.jobs[0].outcome,null);
 assert.equal((await workOnce(root)).status,'IDLE');
}));
test('two simultaneous workers claim at most one job and do not double-run',()=>isolated(async root=>{
 await seeded(root);await enqueueCheck(root,'Garden');
 const result=await Promise.all([workOnce(root),workOnce(root)]);
 assert.equal(result.filter(x=>x.status==='DONE').length,1);
 assert.equal((await queueSnapshot(root)).jobs.length,1);
}));
