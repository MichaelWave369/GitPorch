// R1-D1: local-only, manually confirmed disposition for interrupted jobs.
// Never starts containers, reruns jobs, clears another worker's lock, or reports PASS.
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,readdir,rename,lstat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {queueSnapshot} from './porch-crew.mjs';
import {snapshot as testSnapshot} from './sandbox-ci.mjs';

const ID=/^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex');
const LANES={
  git:{path:'porch-crew',schema:'gitporch-crew/0.1',snapshot:queueSnapshot},
  tests:{path:'isolated-tests',schema:'gitporch-isolated-tests/0.1',snapshot:testSnapshot}
};
const laneOf=name=>{
  if(!Object.hasOwn(LANES,name))throw Error('Lane must be git or tests');
  return LANES[name];
};
const root=(dataDir,lane)=>join(dataDir,lane.path);
function verifyNote(value){
 if(typeof value!=='string'||!value.trim()||value.length>240||/[\x00-\x1f\x7f]/.test(value))
   throw Error('Recovery note must be 1-240 printable characters on one line');
 return value.trim();
}
async function present(file){
 try{const st=await lstat(file);return {exists:true,isFile:st.isFile(),isSymlink:st.isSymbolicLink()};}
 catch(e){if(e.code==='ENOENT')return {exists:false};throw e;}
}
async function readSealed(path){
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||st.size>8192)throw Error('Unsafe recovery receipt file');
 const body=JSON.parse(await readFile(path,'utf8'));
 if(!body||typeof body!=='object'||typeof body.checksum!=='string')throw Error('Invalid recovery receipt');
 const {checksum,...unsigned}=body;
 if(checksum!==hash(unsigned))throw Error('Recovery receipt checksum mismatch');
 return unsigned;
}
async function exclusiveWrite(path,content){
 const fd=await open(path,'wx',0o600);
 try{await fd.writeFile(JSON.stringify({...content,checksum:hash(content)},null,2)+'\n');await fd.sync();}
 finally{await fd.close();}
}
export async function doctor(dataDir){
 const findings={mode:'READ_ONLY_RECOVERY_DIAGNOSTIC',note:'LOCK_PRESENT does not prove that the worker is alive',lanes:{}};
 for(const [name,lane] of Object.entries(LANES)){
  const lock=await present(join(root(dataDir,lane),'worker.lock'));
  const state={workerLock:lock.exists?'LOCK_PRESENT_ACTIVITY_UNKNOWN':'NO_LOCK',integrity:'UNKNOWN',
    queued:null,runningUncertain:null,completed:null,uncertainJobs:[]};
  if(lock.isSymlink||lock.exists&&!lock.isFile){
    state.integrity='INVALID_LOCK_ENTRY';
  }else{
    try{
      const receipt=await lane.snapshot(dataDir);
      state.integrity='CHECKSUMS_AND_STRUCTURES_ACCEPTED_NOT_SIGNED';
      state.queued=receipt.counts.queued;
      state.runningUncertain=receipt.counts.runningUncertain;
      state.completed=receipt.counts.done;
      state.uncertainJobs=receipt.jobs.filter(j=>j.status==='RUNNING_UNCERTAIN').map(j=>({
        id:j.id,repo:j.repo,commit:j.commit,status:'RUNNING_UNCERTAIN'
      }));
    }catch(e){
      state.integrity='INVALID_OR_UNREADABLE';
      state.diagnostic=String(e.message).slice(0,180);
    }
  }
  findings.lanes[name]=state;
 }
 return findings;
}
export async function abandonUncertain(dataDir,laneName,id,note,confirmed=false){
 const lane=laneOf(laneName);
 if(typeof id!=='string'||!ID.test(id))throw Error('Invalid job ID');
 note=verifyNote(note);
 if(confirmed!==true)throw Error('Explicit operator confirmation required');
 const home=root(dataDir,lane);
 await mkdir(home,{recursive:true,mode:0o700});
 // Workers use this exact exclusive path. Never steal or clear a worker's lock.
 const lockPath=join(home,'worker.lock');
 let lock;
 try{lock=await open(lockPath,'wx',0o600);}
 catch(e){
   if(e.code==='EEXIST')throw Error('Worker lock exists; refusing recovery. Inspect processes and containers first.');
   throw e;
 }
 try{
  await lock.writeFile('operator recovery lock; do not remove during recovery\n');
  await lock.sync();
  // Fail closed if any existing queue receipt is malformed.
  const state=await lane.snapshot(dataDir);
  const job=state.jobs.find(j=>j.id===id);
  if(!job)throw Error('Job not found');
  if(job.status!=='RUNNING_UNCERTAIN')throw Error('Only interrupted running jobs can be abandoned');
  const filename=id+'.json';
  const running=join(home,'running',filename);
  const resultFile=join(home,'results',filename);
  const resultState=await present(resultFile);
  if(resultState.exists){
    // A crash may have written the ABORTED_UNVERIFIED receipt but not moved the job.
    // A genuine test result in running/ must NOT be replaced or relabeled.
    const old=await readSealed(resultFile);
    if(old.schema!==lane.schema||old.id!==id||old.outcome!=='ABORTED_UNVERIFIED'
       ||old.scope!=='OPERATOR_MANUAL_RECOVERY_NO_EXECUTION'||old.reason!==note)
      throw Error('Existing result cannot be relabeled. Inspect partial worker completion manually.');
  }else{
    const record={schema:lane.schema,id,outcome:'ABORTED_UNVERIFIED',
      completedAt:new Date().toISOString(),durationMs:0,
      ...(laneName==='tests'?{counts:null,evidence:null}:{}),
      scope:'OPERATOR_MANUAL_RECOVERY_NO_EXECUTION',reason:note};
    await exclusiveWrite(resultFile,record);
  }
  await rename(running,join(home,'done',filename));
  return {id,lane:laneName,status:'DONE',outcome:'ABORTED_UNVERIFIED',
    note:'Operator closed an uncertain job without retrying or verifying it'};
 }finally{
  await lock.close();
  await unlink(lockPath);
 }
}
