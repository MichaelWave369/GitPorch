// Porch Crew R1-B: operator-only, opt-in Docker-backed Node test jobs.
// Requires a preloaded immutable image; never runs repository test code on the host.
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,open,readFile,readdir,rename,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {git,repoRoot,listRepos,validSlug} from './git.mjs';
import {parseTap,verifyImageIdentity,executionEvidence,evidenceShapeValid} from './runner-evidence.mjs';
export {parseTap} from './runner-evidence.mjs';

const SCHEMA='gitporch-isolated-tests/0.1';
const IMAGE=/^(?:sha256:[0-9a-f]{64}|node:22-alpine@sha256:[0-9a-f]{64})$/;
const SHA=/^[0-9a-f]{40}$/;
const FILE=/^\d{13}-[0-9a-f-]{36}\.json$/;
const STATES=['pending','running','done'];
const DIGEST=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const dir=(d,kind)=>join(d,'isolated-tests',kind);
const makeRecord=x=>({...x,checksum:DIGEST(x)});
function verifyRecord(obj){
 if(!obj||typeof obj!=='object'||typeof obj.checksum!=='string')throw Error('Missing test receipt checksum');
 const {checksum,...body}=obj;
 if(checksum!==DIGEST(body))throw Error('Test receipt checksum mismatch');
 return body;
}
async function ensure(d){await Promise.all([...STATES,'results'].map(k=>mkdir(dir(d,k),{recursive:true,mode:0o700})));}
async function put(path,data){
 const h=await open(path,'wx',0o600);
 try{await h.writeFile(JSON.stringify(data,null,2)+'\n');await h.sync();}finally{await h.close();}
}
async function get(path){
 const raw=await readFile(path,'utf8');
 if(raw.length>8192)throw Error('Oversized test receipt');
 return verifyRecord(JSON.parse(raw));
}
async function names(d,kind){
 let all;
 try{all=await readdir(dir(d,kind),{withFileTypes:true});}
 catch(e){if(e.code==='ENOENT')return [];throw e;}
 if(all.length>250||all.some(e=>!e.isFile()||!FILE.test(e.name)))throw Error('Unexpected test receipt directory entry');
 return all.map(x=>x.name).sort();
}
function assertJob(j,id){
 if(j.schema!==SCHEMA||j.id!==id||j.type!=='NODE_BUILTIN_TESTS'||!validSlug(j.repo)||!SHA.test(j.commit)||!IMAGE.test(j.image)||!Number.isFinite(Date.parse(j.queuedAt)))throw Error('Invalid isolated test job');
}
function assertResult(r,id){
 if(r.schema!==SCHEMA||r.id!==id||!['PASS','FAIL','ERROR','STALE','NO_TESTS'].includes(r.outcome)||!Number.isInteger(r.durationMs)||r.durationMs<0)throw Error('Invalid isolated test result');
 if(r.evidence!=null&&!evidenceShapeValid(r.evidence))throw Error('Invalid container evidence metadata');
 if(r.outcome==='PASS'&&(!r.counts||!Number.isSafeInteger(r.counts.pass)||r.counts.pass<1||r.evidence?.dockerCliExitCode!==0&&r.evidence!=null))throw Error('Invalid passing test evidence');
}
export async function snapshot(d){
 const [pending,running,done,results]=await Promise.all([...STATES,'results'].map(k=>names(d,k)));
 const seen=new Map();
 for(const [state,arr] of [['QUEUED',pending],['RUNNING_UNCERTAIN',running],['DONE',done]])
  for(const name of arr){if(seen.has(name))throw Error('Duplicate test state');seen.set(name,state);}
 for(const name of results)if(!seen.has(name))throw Error('Orphan test result');
 const found=new Set(results),jobs=[];
 for(const [name,state] of seen){
  const id=name.slice(0,-5),kind=state==='QUEUED'?'pending':state==='DONE'?'done':'running';
  const j=await get(join(dir(d,kind),name));assertJob(j,id);
  let outcome=null,counts=null,evidence=null;
  if(found.has(name)){
   const r=await get(join(dir(d,'results'),name));assertResult(r,id);
   if(state==='QUEUED')throw Error('Queued job already has result');
   if(state==='DONE'){outcome=r.outcome;counts=r.counts;evidence=r.evidence??null;}
  }else if(state==='DONE')throw Error('Completed test job lacks a result');
  jobs.push({id,repo:j.repo,commit:j.commit,image:j.image,queuedAt:j.queuedAt,status:state,outcome,counts,evidence,kind:j.type});
 }
 jobs.sort((a,b)=>b.id.localeCompare(a.id));
 return {mode:'LOCAL_OPERATOR_ONLY',assurance:'DOCKER_EXIT_AND_TAP_NOT_SIGNED_ATTESTATION',
  counts:{queued:pending.length,runningUncertain:running.length,done:done.length},jobs};
}
export async function enqueue(d,repo,image){
 if(!validSlug(repo))throw Error('Invalid repo name');
 if(typeof image!=='string'||!IMAGE.test(image))throw Error('Immutable node image digest or ID required');
 await ensure(d);
 if((await snapshot(d)).jobs.length>=250)throw Error('Isolated test queue capacity reached');
 if(!(await listRepos(d)).some(x=>x.name===repo))throw Error('Repository not found');
 const commit=(await git(['--git-dir',join(repoRoot(d),repo+'.git'),'rev-parse','--verify','HEAD^{commit}'])).toLowerCase();
 if(!SHA.test(commit))throw Error('Invalid HEAD commit');
 const id=Date.now().toString().padStart(13,'0')+'-'+randomUUID();
 const j={schema:SCHEMA,id,type:'NODE_BUILTIN_TESTS',repo,commit,image,queuedAt:new Date().toISOString()};
 await put(join(dir(d,'pending'),id+'.json'),makeRecord(j));
 return {id,repo,commit,image,status:'QUEUED',kind:'NODE_BUILTIN_TESTS'};
}
// A plan, not an ability to run arbitrary shell commands. All switches are fixed.
export function dockerPlan(image,archive,name){
 if(!IMAGE.test(image))throw Error('A pinned Node 22 image is required');
 if(!/^[a-z0-9-]{10,80}$/.test(name))throw Error('Invalid container name');
 if(!archive||/[,\r\n]/.test(archive))throw Error('Unsafe archive mount path');
 const script='tar -xf /source.tar -C /workspace && cd /workspace && exec node --test --test-reporter=tap';
 return ['run','--rm','--pull=never','--name',name,
   '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
   '--pids-limit','64','--memory','512m','--cpus','1','--user','65534:65534',
   '--tmpfs','/workspace:rw,nosuid,nodev,noexec,size=128m',
   '--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=32m',
   '--mount','type=bind,source='+archive+',target=/source.tar,readonly',
   '--workdir','/workspace','--entrypoint','/bin/sh',
   image,'-ec',script];
}
function runCommand(exe,args,timeoutMs=90000,maxOutput=256*1024){
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
  let stdout='',stderr='',size=0,closed=false,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
  const receive=(which,data)=>{
   size+=data.length;
   if(size>maxOutput){timedOut=true;child.kill();return;}
   if(which==='out')stdout+=String(data);else stderr+=String(data);
  };
  child.stdout.on('data',b=>receive('out',b));
  child.stderr.on('data',b=>receive('err',b));
  child.on('error',e=>{clearTimeout(timer);if(!closed){closed=true;reject(e);}});
  child.on('close',(code,signal)=>{
   clearTimeout(timer);
   if(closed)return;closed=true;
   resolve({exitCode:code??-1,stdout,stderr,timeout:timedOut,signal});
  });
 });
}
async function archiveCommit(repoPath,commit,target){
 // Stream Git's binary tar into a local staging file with an output cap.
 const out=await open(target,'wx',0o644);
 const child=spawn('git',['--git-dir',repoPath,'archive','--format=tar',commit],{stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
 let count=0,errors='',failure;
 try{
  for await(const chunk of child.stdout){
   count+=chunk.length;
   if(count>20*1024*1024){child.kill();throw Error('Archive exceeded 20 MiB cap');}
   let offset=0;
   while(offset<chunk.length){
    const {bytesWritten}=await out.write(chunk,offset,chunk.length-offset);
    if(bytesWritten<=0)throw Error('Archive write made no progress');
    offset+=bytesWritten;
   }
  }
  for await(const b of child.stderr)errors+=String(b).slice(0,1024);
  const exit=await new Promise((res,rej)=>{
   if(child.exitCode!==null)return res(child.exitCode);
   child.once('error',rej);child.once('close',res);
  });
  if(exit!==0)throw Error('Git archive failed');
  await out.sync();
 }finally{await out.close();}
 await chmod(target,0o644);
}
async function head(d,repo){
 return (await git(['--git-dir',join(repoRoot(d),repo+'.git'),'rev-parse','--verify','HEAD^{commit}'])).toLowerCase();
}
export async function workOnce(d,{execute=runCommand}={}){
 await ensure(d);
 const lockFile=join(d,'isolated-tests','worker.lock');
 let lock;
 try{lock=await open(lockFile,'wx',0o600);}
 catch(e){if(e.code==='EEXIST')return {status:'BUSY',note:'Worker lock exists; inspect before recovery'};throw e;}
 try{
  await snapshot(d);
  for(const file of await names(d,'pending')){
   try{await rename(join(dir(d,'pending'),file),join(dir(d,'running'),file));}
   catch(e){if(e.code==='ENOENT')continue;throw e;}
   const id=file.slice(0,-5),job=await get(join(dir(d,'running'),file));assertJob(job,id);
   const start=Date.now();
   let outcome='ERROR',counts=null,evidence=null;
   const stage=await mkdtemp(join(tmpdir(),'gitporch-isolated-'));
   try{
    if((await head(d,job.repo))!==job.commit)outcome='STALE';
    else{
     const tar=join(stage,'source.tar');
     await archiveCommit(join(repoRoot(d),job.repo+'.git'),job.commit,tar);
     if((await head(d,job.repo))!==job.commit)outcome='STALE';
     else{
      // Refuse to pull any image. No Docker daemon socket mounted in the container.
      const inspected=await execute('docker',['image','inspect','--format','{{json .}}',job.image],10000);
      if(inspected.exitCode!==0||inspected.timeout)throw Error('Pinned local Docker image unavailable');
      const verifiedImage=verifyImageIdentity(job.image,inspected.stdout);
      const result=await execute('docker',dockerPlan(job.image,tar,'gitporch-ci-'+id),90000);
      if(result.timeout){
        // Killing Docker's CLI is not enough: remove the named container as well.
        await execute('docker',['rm','-f','gitporch-ci-'+id],10000).catch(()=>{});
        throw Error('Container timed out or exceeded log cap');
      }
      const parsed=parseTap(result.stdout,result.exitCode);
      outcome=parsed.outcome;counts=parsed.counts;
      evidence=executionEvidence(result,verifiedImage);
      if((await head(d,job.repo))!==job.commit)outcome='STALE';
     }
    }
   }catch(e){outcome='ERROR';counts=null;}
   finally{await rm(stage,{recursive:true,force:true});}
   const receipt=makeRecord({schema:SCHEMA,id,outcome,counts,evidence,completedAt:new Date().toISOString(),
     durationMs:Date.now()-start,scope:'NODE_TEST_IN_DOCKER_NO_NETWORK_NO_HOST_EXEC'});
   await put(join(dir(d,'results'),file),receipt);
   await rename(join(dir(d,'running'),file),join(dir(d,'done'),file));
   return {status:'DONE',id,outcome,counts,scope:receipt.scope};
  }
  return {status:'IDLE',note:'No queued container test jobs'};
 }finally{await lock.close();await rm(lockFile,{force:true});}
}
