// R1-F2: one fixed, operator-approved static-web build executed in restricted Docker.
// Consumes verified R1-F1 source tar; no repository-supplied commands are run on host.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readdir,lstat,readFile,writeFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {artifactSnapshot} from './artifact-forge.mjs';
import {verifyImageIdentity} from './runner-evidence.mjs';
import {git,repoRoot} from './git.mjs';

const SCHEMA='gitporch-isolated-build/0.1';
const RECIPE='STATIC_WEB_ONEFILE_V1';
const ID=/^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{40}$/;
const HEX=/^[a-f0-9]{64}$/;
const IMAGE=/^sha256:[a-f0-9]{64}$/;
const LIMIT=128*1024,MAX=25;
const hash=x=>createHash('sha256').update(x).digest('hex');
const root=d=>join(d,'builds');
const recipePath=fileURLToPath(new URL('./recipes/static-web.cjs',import.meta.url));
function idChecked(id){if(typeof id!=='string'||!ID.test(id))throw Error('Invalid artifact/build ID');}
function record(id,fields){const body={schema:SCHEMA,id,recipe:RECIPE,...fields};return {...body,checksum:hash(JSON.stringify(body))};}
function checkRecord(obj,id){
 if(!obj||typeof obj!=='object')throw Error('Missing build receipt');
 const {checksum,...body}=obj;
 if(typeof checksum!=='string'||hash(JSON.stringify(body))!==checksum)throw Error('Build receipt checksum mismatch');
 if(body.schema!==SCHEMA||body.id!==id||body.recipe!==RECIPE
   ||!ID.test(body.sourceArtifactId)||!ID.test(body.testJobId)
   ||typeof body.repo!=='string'||body.repo.length>48||!SHA.test(body.commit)
   ||!IMAGE.test(body.image)||!HEX.test(body.sha256)||!HEX.test(body.stdoutSha256)
   ||!HEX.test(body.stderrSha256)||body.dockerExitCode!==0
   ||!Number.isInteger(body.bytes)||body.bytes<1||body.bytes>LIMIT
   ||!Number.isFinite(Date.parse(body.createdAt))
   ||body.scope!=='LOCAL_DOCKER_STATIC_WEB_BUILD_NOT_ATTESTED')
   throw Error('Invalid build receipt shape');
 return body;
}
async function ensureRoot(d,create=false){
 if(create)await mkdir(root(d),{recursive:true,mode:0o700});
 try{const stat=await lstat(root(d));if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Unsafe build directory');return true;}
 catch(e){if(e.code==='ENOENT'&&!create)return false;throw e;}
}
export async function buildSnapshot(d){
 if(!await ensureRoot(d))return {mode:'LOCAL_READ_ONLY',assurance:'SHA256_AND_LOCAL_RECEIPT_NOT_ATTESTED',count:0,builds:[]};
 const entries=await readdir(root(d),{withFileTypes:true});
 if(entries.length>MAX*2)throw Error('Build registry capacity exceeded');
 const manifests=new Set(),outputs=new Set();
 for(const e of entries){
   if(!e.isFile()||e.isSymbolicLink())throw Error('Unsafe build directory entry');
   if(e.name.endsWith('.json')){const id=e.name.slice(0,-5);idChecked(id);manifests.add(id);}
   else if(e.name.endsWith('.html')){const id=e.name.slice(0,-5);idChecked(id);outputs.add(id);}
   else throw Error('Unexpected build directory entry');
 }
 if(manifests.size!==outputs.size||[...manifests].some(id=>!outputs.has(id))||manifests.size>MAX)
   throw Error('Incomplete build registry; operator inspection required');
 const builds=[];
 for(const id of [...manifests].sort().reverse()){
   const receipt=join(root(d),id+'.json'),raw=await readFile(receipt,'utf8');
   if(raw.length>4096)throw Error('Oversized build receipt');
   const meta=checkRecord(JSON.parse(raw),id);
   const target=join(root(d),id+'.html'),stat=await lstat(target);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==meta.bytes)
     throw Error('Missing or altered static build output');
   const content=await readFile(target);
   if(hash(content)!==meta.sha256)throw Error('Static build digest mismatch');
   builds.push({id,recipe:RECIPE,sourceArtifactId:meta.sourceArtifactId,testJobId:meta.testJobId,
     repo:meta.repo,commit:meta.commit,image:meta.image,sha256:meta.sha256,
     bytes:meta.bytes,createdAt:meta.createdAt,status:'LOCAL_OUTPUT_BYTES_VERIFIED_NOT_ATTESTED'});
 }
 return {mode:'LOCAL_READ_ONLY',assurance:'SHA256_AND_LOCAL_RECEIPT_NOT_ATTESTED',
   count:builds.length,builds};
}
function command(exe,args,timeoutMs=90000,cap=320*1024){
 return new Promise((resolve,reject)=>{
   const child=spawn(exe,args,{stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
   let stdout='',stderr='',n=0,done=false,timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
   function receive(kind,chunk){
     n+=chunk.length;
     if(n>cap){timedOut=true;child.kill();return;}
     if(kind==='out')stdout+=String(chunk);else stderr+=String(chunk);
   }
   child.stdout.on('data',b=>receive('out',b));child.stderr.on('data',b=>receive('err',b));
   child.on('error',e=>{clearTimeout(timer);if(!done){done=true;reject(e);}});
   child.on('close',(code,signal)=>{
     clearTimeout(timer);if(done)return;done=true;
     resolve({exitCode:code??-1,stdout,stderr,timeout:timedOut,signal});
   });
 });
}
export function staticDockerPlan(image,sourceTar,recipeFile,name){
 if(typeof image!=='string'||!IMAGE.test(image)||!/^[a-z0-9-]{10,80}$/.test(name))
   throw Error('Pinned image ID and fixed container name required');
 if([sourceTar,recipeFile].some(s=>typeof s!=='string'||!s||/[,\r\n]/.test(s)))
   throw Error('Invalid readonly mount source');
 return ['run','--rm','--pull=never','--name',name,
   '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
   '--pids-limit','64','--memory','512m','--cpus','1','--user','65534:65534',
   '--tmpfs','/workspace:rw,nosuid,nodev,size=32m',
   '--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=16m',
   '--mount','type=bind,source='+sourceTar+',target=/source.tar,readonly',
   '--mount','type=bind,source='+recipeFile+',target=/recipe.cjs,readonly',
   '--workdir','/workspace','--entrypoint','/bin/sh',image,'-ec',
   'tar -xf /source.tar -C /workspace && cd /workspace && exec node /recipe.cjs'];
}
function parseOutput(output){
 let obj;
 try{obj=JSON.parse(output);}catch{throw Error('Invalid isolated build output');}
 if(obj?.schema!=='gitporch-static-web-output/0.1'||obj.recipe!==RECIPE
   ||typeof obj.htmlBase64!=='string'||obj.htmlBase64.length>190000
   ||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(obj.htmlBase64))
   throw Error('Unexpected isolated build output contract');
 const bytes=Buffer.from(obj.htmlBase64,'base64');
 if(!bytes.length||bytes.length>LIMIT||bytes.toString('base64')!==obj.htmlBase64)
   throw Error('Build output exceeded limit or is noncanonical');
 return bytes;
}
export async function buildStaticPage(d,sourceArtifactId,{approved=false,execute=command}={}){
 if(approved!==true)throw Error('Explicit --i-approve-isolated-build is required');
 idChecked(sourceArtifactId);
 const inventory=await artifactSnapshot(d),source=inventory.artifacts.find(a=>a.id===sourceArtifactId);
 if(!source)throw Error('Verified source artifact not found');
 if(!IMAGE.test(source.testImage))throw Error('Requires immutable observed Docker image ID');
 if((await buildSnapshot(d)).count>=MAX)throw Error('Build shelf capacity reached');
 const current=(await git(['--git-dir',join(repoRoot(d),source.repo+'.git'),'rev-parse','--verify','HEAD^{commit}'])).toLowerCase();
 if(current!==source.commit)throw Error('Source commit is no longer current HEAD');
 const stage=await mkdtemp(join(tmpdir(),'gitporch-static-build-'));
 const name='gitporch-web-'+randomUUID();
 try{
   const tar=join(d,'artifacts',sourceArtifactId+'.tar'),script=join(stage,'recipe.cjs');
   await writeFile(script,await readFile(recipePath),{mode:0o644,flag:'wx'});
   const inspected=await execute('docker',['image','inspect','--format','{{json .}}',source.testImage],10000);
   if(inspected.timeout||inspected.exitCode!==0)throw Error('Pinned Docker image unavailable');
   verifyImageIdentity(source.testImage,inspected.stdout);
   const result=await execute('docker',staticDockerPlan(source.testImage,tar,script,name),90000);
   if(result.timeout){
     await execute('docker',['rm','-f',name],10000).catch(()=>{});
     throw Error('Docker build timed out or exceeded output cap; inspect container state');
   }
   if(result.exitCode!==0)throw Error('Isolated static build failed; no artifact marked successful');
   const bytes=parseOutput(result.stdout.trim());
   // Verify the source archive is still the one the operator approved.
   const latest=(await artifactSnapshot(d)).artifacts.find(a=>a.id===sourceArtifactId);
   if(!latest||latest.sha256!==source.sha256)throw Error('Source artifact changed during build');
   const now=(await git(['--git-dir',join(repoRoot(d),source.repo+'.git'),'rev-parse','--verify','HEAD^{commit}'])).toLowerCase();
   if(now!==source.commit)throw Error('Repository HEAD changed during build');
   await ensureRoot(d,true);
   const id=Date.now().toString().padStart(13,'0')+'-'+randomUUID();
   const file=join(root(d),id+'.html'),receipt=join(root(d),id+'.json');
   const fields={sourceArtifactId,testJobId:source.testJobId,repo:source.repo,commit:source.commit,
     image:source.testImage,sha256:hash(bytes),bytes:bytes.length,
     stdoutSha256:hash(result.stdout),stderrSha256:hash(result.stderr),
     dockerExitCode:0,createdAt:new Date().toISOString(),
     scope:'LOCAL_DOCKER_STATIC_WEB_BUILD_NOT_ATTESTED'};
   let outputWritten=false,receiptWritten=false;
   try{
     await writeFile(file,bytes,{mode:0o600,flag:'wx'});outputWritten=true;
     await writeFile(receipt,JSON.stringify(record(id,fields),null,2)+'\n',{mode:0o600,flag:'wx'});receiptWritten=true;
   }catch(e){
     if(!receiptWritten){await rm(receipt,{force:true});if(outputWritten)await rm(file,{force:true});}
     throw e;
   }
   return {id,recipe:RECIPE,sourceArtifactId,sha256:fields.sha256,bytes:fields.bytes,
     status:'LOCAL_OUTPUT_BYTES_VERIFIED_NOT_ATTESTED',location:'PRIVATE_LOCAL_BUILD_SHELF'};
 }finally{await rm(stage,{recursive:true,force:true});}
}
