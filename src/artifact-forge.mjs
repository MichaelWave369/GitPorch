// GitPorch R1-F1: operator-approved SOURCE archive from a locally reported passing Docker test.
// No repository command execution, remote writes, signed build claims or auto-publication.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readdir,lstat,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {git,repoRoot,validSlug,listRepos} from './git.mjs';
import {snapshot as testSnapshot} from './sandbox-ci.mjs';

const RECIPE='GIT_COMMIT_SOURCE_TAR_V1';
const SCHEMA='gitporch-source-artifact/0.1';
const SHA=/^[0-9a-f]{40}$/;
const HEX=/^[0-9a-f]{64}$/;
const ID=/^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BYTES=8*1024*1024;
const MAX_ARTIFACTS=30;
const digest=value=>createHash('sha256').update(value).digest('hex');
const root=d=>join(d,'artifacts');
const filename=id=>id+'.tar';
const manifest=id=>id+'.json';
function requireId(id){if(typeof id!=='string'||!ID.test(id))throw Error('Invalid artifact or test job ID');}
function seal(body){return {...body,checksum:digest(JSON.stringify(body))};}
function unpack(value,id){
 if(!value||typeof value!=='object'||typeof value.checksum!=='string')throw Error('Artifact receipt missing checksum');
 const {checksum,...body}=value;
 if(checksum!==digest(JSON.stringify(body)))throw Error('Artifact receipt changed');
 if(body.schema!==SCHEMA||body.id!==id||body.recipe!==RECIPE||!validSlug(body.repo)
    ||!SHA.test(body.commit)||!ID.test(body.testJobId)||!HEX.test(body.sha256)
    ||!Number.isSafeInteger(body.bytes)||body.bytes<1||body.bytes>MAX_BYTES
    ||!Number.isFinite(Date.parse(body.createdAt))
    ||body.scope!=='SOURCE_ARCHIVE_NOT_EXECUTABLE_BUILD_NOT_ATTESTED'
    ||typeof body.testImage!=='string'||!body.testImage.length)throw Error('Invalid source artifact receipt');
 return body;
}
async function assertDirectory(d,create=false){
 if(create)await mkdir(root(d),{recursive:true,mode:0o700});
 let info;
 try{info=await lstat(root(d));}catch(e){if(e.code==='ENOENT'&&!create)return false;throw e;}
 if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe artifact storage directory');
 return true;
}
async function archiveRecords(d){
 if(!await assertDirectory(d))return [];
 const entries=await readdir(root(d),{withFileTypes:true});
 if(entries.length>MAX_ARTIFACTS*2)throw Error('Artifact registry capacity exceeded');
 const records=new Set(),archives=new Set();
 for(const entry of entries){
   if(!entry.isFile()||entry.isSymbolicLink())throw Error('Unsafe artifact directory entry');
   if(entry.name.endsWith('.json')){
     const id=entry.name.slice(0,-5);requireId(id);records.add(id);
   }else if(entry.name.endsWith('.tar')){
     const id=entry.name.slice(0,-4);requireId(id);archives.add(id);
   }else throw Error('Unexpected artifact directory entry');
 }
 if(records.size!==archives.size||[...records].some(id=>!archives.has(id)))throw Error('Partial artifact or missing receipt; inspect locally');
 if(records.size>MAX_ARTIFACTS)throw Error('Artifact capacity reached');
 return [...records].sort().reverse();
}
export async function artifactSnapshot(d){
 const ids=await archiveRecords(d),artifacts=[];
 for(const id of ids){
   const name=join(root(d),manifest(id)),raw=await readFile(name,'utf8');
   if(raw.length>4096)throw Error('Oversized artifact receipt');
   const item=unpack(JSON.parse(raw),id);
   const target=join(root(d),filename(id)),stat=await lstat(target);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.bytes)throw Error('Artifact file missing or altered');
   const file=await readFile(target);
   if(file.length!==item.bytes||digest(file)!==item.sha256)throw Error('Artifact digest mismatch');
   artifacts.push({id,repo:item.repo,commit:item.commit,testJobId:item.testJobId,
     testImage:item.testImage,recipe:item.recipe,createdAt:item.createdAt,
     bytes:item.bytes,sha256:item.sha256,status:'SOURCE_BYTES_VERIFIED_NOT_BUILD_ATTESTED'});
 }
 return {mode:'LOCAL_READ_ONLY',assurance:'LOCAL_SHA256_AND_RECEIPT_CHECKSUM_NOT_SIGNED',
   count:artifacts.length,artifacts};
}
function passingTest(job,repo,commit,jobId){
 return job&&job.id===jobId&&job.repo===repo&&job.commit===commit
   &&job.kind==='NODE_BUILTIN_TESTS'&&job.status==='DONE'&&job.outcome==='PASS'
   &&job.counts?.pass>=1&&job.counts?.fail===0
   &&job.evidence?.dockerCliExitCode===0
   &&/^[a-f0-9]{64}$/.test(job.evidence?.stdoutSha256||'')
   &&/^sha256:[a-f0-9]{64}$/.test(job.evidence?.observedImageId||'');
}
async function head(d,repo){
 return (await git(['--git-dir',join(repoRoot(d),repo+'.git'),'rev-parse','--verify','HEAD^{commit}'])).toLowerCase();
}
export async function bundleSource(d,repo,jobId,{approved=false}={}){
 if(approved!==true)throw Error('Explicit --i-approve-source-archive flag required');
 if(!validSlug(repo))throw Error('Invalid repository name');
 requireId(jobId);
 const existing=await artifactSnapshot(d); // refuse to build upon invalid registry
 if(existing.count>=MAX_ARTIFACTS)throw Error('Artifact capacity reached');
 if(!(await listRepos(d)).some(r=>r.name===repo))throw Error('Local repo not found');
 const commit=await head(d,repo);
 if(!SHA.test(commit))throw Error('Invalid HEAD commit');
 const tests=await testSnapshot(d); // verified local receipts, not actual independent execution proof
 const job=tests.jobs.find(j=>passingTest(j,repo,commit,jobId));
 if(!job)throw Error('Require a completed, locally reported PASS Docker test for this exact HEAD and job ID, with output evidence');
 // Fixed recipe. No shell, scripts, dependency installs or network actions.
 const result=spawnSync('git',['--git-dir',join(repoRoot(d),repo+'.git'),'archive','--format=tar',commit],
   {encoding:null,maxBuffer:MAX_BYTES+65536,timeout:30000,windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
 if(result.error||result.status!==0||!Buffer.isBuffer(result.stdout)||result.stdout.length<1
    ||result.stdout.length>MAX_BYTES)throw Error('Bounded source archive failed');
 if((await head(d,repo))!==commit)throw Error('Repository HEAD changed during packaging');
 await assertDirectory(d,true);
 const id=Date.now().toString().padStart(13,'0')+'-'+randomUUID();
 const tar=join(root(d),filename(id)),note=join(root(d),manifest(id));
 const body={schema:SCHEMA,id,recipe:RECIPE,repo,commit,testJobId:jobId,
   testImage:job.evidence.observedImageId,sha256:digest(result.stdout),bytes:result.stdout.length,
   createdAt:new Date().toISOString(),scope:'SOURCE_ARCHIVE_NOT_EXECUTABLE_BUILD_NOT_ATTESTED'};
 let wroteTar=false,wroteNote=false;
 try{
   await writeFile(tar,result.stdout,{flag:'wx',mode:0o600});wroteTar=true;
   if((await head(d,repo))!==commit)throw Error('Repository HEAD changed after archive write');
   await writeFile(note,JSON.stringify(seal(body),null,2)+'\n',{flag:'wx',mode:0o600});wroteNote=true;
 }catch(e){
   if(!wroteNote){await rm(note,{force:true});if(wroteTar)await rm(tar,{force:true});}
   throw e;
 }
 return {id,repo,commit,testJobId:jobId,sha256:body.sha256,bytes:body.bytes,
   status:'SOURCE_BYTES_VERIFIED_NOT_BUILD_ATTESTED',
   location:'LOCAL_PRIVATE_DATA_ARTIFACTS',note:'Source archive only; no compiled build or release'};
}
