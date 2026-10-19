// GitPorch Porch Crew R1-A: independent, local-only Git integrity queue.
// No arbitrary job commands, untrusted code execution, network writes, or CI claims.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { git, repoRoot, validSlug, listRepos } from './git.mjs';

const SCHEMA = 'gitporch-crew/0.1';
const STATES = ['pending', 'running', 'done'];
const NAME = /^\d{13}-[0-9a-f-]{36}\.json$/;
const SHA = /^[0-9a-f]{40}$/;
const MAX_JOBS = 500;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const folder = (dataDir, state) => join(dataDir, 'porch-crew', state);
function checkedRepo(value) {
  if (!validSlug(value)) throw new Error('Invalid repository name');
  return value;
}
async function ensure(dataDir) {
  await Promise.all([...STATES, 'results'].map(s => mkdir(folder(dataDir, s), {recursive:true, mode:0o700})));
}
function seal(payload) { return {...payload, checksum:hash(payload)}; }
function assertSeal(record) {
  if (!record || typeof record !== 'object' || typeof record.checksum !== 'string') throw new Error('Missing job checksum');
  const {checksum,...body}=record;
  if (hash(body) !== checksum) throw new Error('Job checksum mismatch');
}
async function writeNew(path, value) {
  const f = await open(path, 'wx', 0o600);
  try { await f.writeFile(JSON.stringify(value,null,2)+'\n'); await f.sync(); }
  finally { await f.close(); }
}
async function readSealed(path) {
  const text = await readFile(path,'utf8');
  if(text.length>8192) throw new Error('Oversized crew receipt');
  const record=JSON.parse(text);assertSeal(record);return record;
}
async function entries(dataDir,state) {
  let all;
  try { all=await readdir(folder(dataDir,state),{withFileTypes:true}); }
  catch(e) { if(e.code==='ENOENT') return []; throw e; }
  if(all.length>MAX_JOBS) throw new Error('Too many crew receipts');
  if(all.some(e=>!e.isFile()||!NAME.test(e.name))) throw new Error('Unexpected crew directory entry');
  return all.map(e=>e.name).sort();
}
function checkJob(record, id) {
  if(record.schema !== SCHEMA || record.id!==id || record.type!=='GIT_OBJECT_INTEGRITY' || !validSlug(record.repo) || !SHA.test(record.commit)) throw new Error('Invalid crew job');
  if(Number.isNaN(Date.parse(record.queuedAt))) throw new Error('Invalid queue timestamp');
}
function checkResult(result, id) {
  if(result.schema!==SCHEMA || result.id!==id || !['PASS','FAIL','ERROR','STALE'].includes(result.outcome)) throw new Error('Invalid crew result');
  if(!Number.isSafeInteger(result.durationMs)||result.durationMs<0)throw new Error('Invalid crew duration');
}
export async function enqueueCheck(dataDir, repoName) {
  repoName=checkedRepo(repoName);
  await ensure(dataDir);
  const all=await queueSnapshot(dataDir);
  if(all.jobs.length>=MAX_JOBS)throw new Error('Crew queue capacity reached');
  const found=(await listRepos(dataDir)).some(r=>r.name===repoName);
  if(!found) throw new Error('Local repository not found');
  const path=join(repoRoot(dataDir),repoName+'.git');
  // HEAD must point to an actual commit at enqueue time. Empty repos cannot pass.
  const commit=(await git(['--git-dir',path,'rev-parse','--verify','HEAD^{commit}'])).toLowerCase();
  if(!SHA.test(commit))throw new Error('Invalid HEAD commit');
  const id=Date.now().toString().padStart(13,'0')+'-'+randomUUID();
  const receipt=seal({schema:SCHEMA,id,type:'GIT_OBJECT_INTEGRITY',repo:repoName,commit,queuedAt:new Date().toISOString()});
  await writeNew(join(folder(dataDir,'pending'),id+'.json'),receipt);
  return {id,repo:repoName,commit,status:'QUEUED',type:receipt.type};
}
export async function queueSnapshot(dataDir) {
  const [pending,running,done,results]=await Promise.all([...STATES,'results'].map(s=>entries(dataDir,s)));
  const positions=new Map();
  for(const [state,items] of [['QUEUED',pending],['RUNNING_UNCERTAIN',running],['DONE',done]]) {
    for(const name of items) {
      if(positions.has(name)) throw new Error('Crew job appears in multiple states');
      positions.set(name,state);
    }
  }
  const resultNames=new Set(results);
  if(results.some(name=>!positions.has(name)))throw new Error('Orphaned crew result');
  const jobs=[];
  for(const [name,state] of positions) {
    const id=name.slice(0,-5);
    const storageState=state==='QUEUED'?'pending':state==='DONE'?'done':'running';
    const r=await readSealed(join(folder(dataDir,storageState),name));checkJob(r,id);
    let outcome=null,completedAt=null,durationMs=null;
    if(resultNames.has(name)) {
      const result=await readSealed(join(folder(dataDir,'results'),name));checkResult(result,id);
      if(state==='QUEUED') throw new Error('Pending job cannot have a result');
      if(state==='DONE'){outcome=result.outcome;completedAt=result.completedAt;durationMs=result.durationMs;}
    } else if(state==='DONE') throw new Error('Completed job has no result');
    jobs.push({id,repo:r.repo,commit:r.commit,queuedAt:r.queuedAt,check:'GIT_OBJECT_INTEGRITY',status:state,outcome,completedAt,durationMs});
  }
  jobs.sort((a,b)=>b.id.localeCompare(a.id));
  return {mode:'LOCAL_ONLY',assurance:'LOCAL_CHECKSUM_NOT_SIGNED_NOT_CI',
    counts:{queued:pending.length,runningUncertain:running.length,done:done.length}, jobs};
}
export async function workOnce(dataDir) {
  await ensure(dataDir);
  const lockPath=join(dataDir,'porch-crew','worker.lock');
  let lock;
  try { lock=await open(lockPath,'wx',0o600); }
  catch(e) { if(e.code==='EEXIST')return {status:'BUSY',message:'Worker lock exists; inspect before manual recovery'};throw e; }
  try {
  // Validate existing receipts before processing to avoid silently ignoring damage.
  await queueSnapshot(dataDir);
  const candidates=await entries(dataDir,'pending');
  for(const name of candidates) {
    const queued=join(folder(dataDir,'pending'),name);
    const running=join(folder(dataDir,'running'),name);
    try { await rename(queued,running); }
    catch(e) { if(e.code==='ENOENT')continue;throw e; }
    // Exactly one worker wins the filesystem rename. Leave RUNNING_UNCERTAIN on crash.
    const id=name.slice(0,-5);
    const record=await readSealed(running);checkJob(record,id);
    const start=Date.now();let outcome='ERROR';
    try {
      const path=join(repoRoot(dataDir),record.repo+'.git');
      const before=(await git(['--git-dir',path,'rev-parse','--verify','HEAD^{commit}'])).toLowerCase();
      if(before!==record.commit) outcome='STALE';
      else {
        try {
          await git(['--git-dir',path,'fsck','--full','--no-reflogs'],{timeout:30000});
          const after=(await git(['--git-dir',path,'rev-parse','--verify','HEAD^{commit}'])).toLowerCase();
          outcome=after===record.commit?'PASS':'STALE';
        }catch(e) {outcome=typeof e.code==='number'?'FAIL':'ERROR';}
      }
    }catch {outcome='ERROR';}
    const result=seal({schema:SCHEMA,id,outcome,completedAt:new Date().toISOString(),durationMs:Date.now()-start,scope:'GIT_FSCK_ONLY_NO_TESTS_RUN_NO_MERGE'});
    await writeNew(join(folder(dataDir,'results'),name),result);
    await rename(running,join(folder(dataDir,'done'),name));
    return {id,status:'DONE',outcome,check:'GIT_OBJECT_INTEGRITY',scope:result.scope};
  }
  return {status:'IDLE',message:'No queued local integrity jobs'};
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
