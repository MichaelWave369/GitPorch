import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,open,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {queueSnapshot} from '../src/porch-crew.mjs';
import {snapshot as testSnapshot} from '../src/sandbox-ci.mjs';
import {doctor,abandonUncertain} from '../src/recovery.mjs';

const ID='1760900000000-123e4567-e89b-42d3-a456-426614174000';
const SHA='a'.repeat(40);
const digest=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const wrap=o=>JSON.stringify({...o,checksum:digest(o)},null,2)+'\n';
async function isolated(callback){
 const root=await mkdtemp(join(tmpdir(),'gitporch-recovery-'));
 try{await callback(root);}finally{await rm(root,{recursive:true,force:true});}
}
async function seed(root,lane,where='running'){
 const isGit=lane==='git';
 const base=join(root,isGit?'porch-crew':'isolated-tests');
 for(const s of ['pending','running','done','results'])await mkdir(join(base,s),{recursive:true});
 const entry=isGit?
  {schema:'gitporch-crew/0.1',id:ID,type:'GIT_OBJECT_INTEGRITY',repo:'Garden',commit:SHA,queuedAt:new Date().toISOString()}:
  {schema:'gitporch-isolated-tests/0.1',id:ID,type:'NODE_BUILTIN_TESTS',repo:'Garden',commit:SHA,
   image:'sha256:'+'b'.repeat(64),queuedAt:new Date().toISOString()};
 await writeFile(join(base,where,ID+'.json'),wrap(entry));
 return base;
}
test('doctor diagnoses uncertain jobs in both queues without changing files',()=>isolated(async root=>{
 await seed(root,'git');await seed(root,'tests');
 const report=await doctor(root);
 assert.equal(report.lanes.git.runningUncertain,1);
 assert.equal(report.lanes.tests.runningUncertain,1);
 assert.equal(report.lanes.git.workerLock,'NO_LOCK');
 assert.equal((await queueSnapshot(root)).jobs[0].status,'RUNNING_UNCERTAIN');
}));
test('operator abandonment never turns an interrupted Git job green',()=>isolated(async root=>{
 await seed(root,'git');
 await assert.rejects(abandonUncertain(root,'git',ID,'Operator investigated',false),/confirmation/);
 const r=await abandonUncertain(root,'git',ID,'Operator investigated',true);
 assert.equal(r.outcome,'ABORTED_UNVERIFIED');
 const state=await queueSnapshot(root);
 assert.equal(state.jobs[0].status,'DONE');
 assert.equal(state.jobs[0].outcome,'ABORTED_UNVERIFIED');
 await assert.rejects(abandonUncertain(root,'git',ID,'Again',true),/Only interrupted/);
}));
test('operator abandonment never turns an interrupted Docker job green',()=>isolated(async root=>{
 await seed(root,'tests');
 const r=await abandonUncertain(root,'tests',ID,'Container process confirmed stopped',true);
 assert.equal(r.outcome,'ABORTED_UNVERIFIED');
 const state=await testSnapshot(root);
 assert.equal(state.jobs[0].status,'DONE');
 assert.equal(state.jobs[0].outcome,'ABORTED_UNVERIFIED');
 assert.equal(state.jobs[0].counts,null);
}));
test('existing worker lock blocks recovery and is not deleted',()=>isolated(async root=>{
 const base=await seed(root,'tests');
 const worker=await open(join(base,'worker.lock'),'wx');
 try{
  await assert.rejects(abandonUncertain(root,'tests',ID,'No worker',true),/Worker lock exists/);
  const report=await doctor(root);
  assert.equal(report.lanes.tests.workerLock,'LOCK_PRESENT_ACTIVITY_UNKNOWN');
 }finally{await worker.close();}
}));
test('existing genuine test result is never rewritten',()=>isolated(async root=>{
 const base=await seed(root,'tests');
 const genuine={schema:'gitporch-isolated-tests/0.1',id:ID,outcome:'PASS',counts:{tests:1,pass:1,fail:0},
   durationMs:1,completedAt:new Date().toISOString()};
 const path=join(base,'results',ID+'.json');await writeFile(path,wrap(genuine));
 await assert.rejects(abandonUncertain(root,'tests',ID,'Cannot overwrite',true),/cannot be relabeled/);
 assert.equal(JSON.parse(await readFile(path,'utf8')).outcome,'PASS');
 assert.equal((await testSnapshot(root)).jobs[0].status,'RUNNING_UNCERTAIN');
}));
test('resumes an interrupted manual closure only with matching operator reason',()=>isolated(async root=>{
 const base=await seed(root,'git');
 const entry={schema:'gitporch-crew/0.1',id:ID,outcome:'ABORTED_UNVERIFIED',durationMs:0,
   completedAt:new Date().toISOString(),scope:'OPERATOR_MANUAL_RECOVERY_NO_EXECUTION',reason:'Confirmed stopped'};
 await writeFile(join(base,'results',ID+'.json'),wrap(entry));
 await assert.rejects(abandonUncertain(root,'git',ID,'Different reason',true),/cannot be relabeled/);
 const r=await abandonUncertain(root,'git',ID,'Confirmed stopped',true);
 assert.equal(r.outcome,'ABORTED_UNVERIFIED');
}));
test('queued jobs, tampered receipts, unsafe IDs and control characters fail closed',()=>isolated(async root=>{
 const base=await seed(root,'git','pending');
 await assert.rejects(abandonUncertain(root,'git',ID,'Not started',true),/Only interrupted/);
 await assert.rejects(abandonUncertain(root,'git','../outside','Reason',true),/Invalid job ID/);
 await assert.rejects(abandonUncertain(root,'git',ID,'bad\nreason',true),/printable/);
 const jobPath=join(base,'pending',ID+'.json');
 const bad=JSON.parse(await readFile(jobPath,'utf8'));bad.repo='Changed';
 await writeFile(jobPath,JSON.stringify(bad));
 assert.equal((await doctor(root)).lanes.git.integrity,'INVALID_OR_UNREADABLE');
 await assert.rejects(abandonUncertain(root,'git',ID,'Investigated',true),/checksum mismatch/i);
}));
