import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRepo,git} from '../src/git.mjs';
import {enqueue as enqueueTests} from '../src/sandbox-ci.mjs';
import {bundleSource} from '../src/artifact-forge.mjs';
import {staticDockerPlan,buildStaticPage,buildSnapshot} from '../src/isolated-build.mjs';

const IMAGE='sha256:'+'a'.repeat(64);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const recipe=fileURLToPath(new URL('../src/recipes/static-web.cjs',import.meta.url));
const originalHtml='<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body><p>Garden</p><script src="./app.js" defer></script></body></html>';
async function localPass(d,job){
 const file=job.id+'.json';
 await rename(join(d,'isolated-tests','pending',file),join(d,'isolated-tests','done',file));
 const base={schema:'gitporch-isolated-tests/0.1',id:job.id,outcome:'PASS',
   counts:{tests:1,pass:1,fail:0,cancelled:0,skipped:0,todo:0},
   evidence:{schema:'gitporch-container-evidence/0.1',observedImageId:IMAGE,
     stdoutSha256:'b'.repeat(64),stderrSha256:'c'.repeat(64),dockerCliExitCode:0,
     scope:'LOCAL_DOCKER_OUTPUT_HASHES_NOT_SIGNED'},
   completedAt:new Date().toISOString(),durationMs:1,
   scope:'NODE_TEST_IN_DOCKER_NO_NETWORK_NO_HOST_EXEC'};
 await writeFile(join(d,'isolated-tests','results',file),
   JSON.stringify({...base,checksum:sha(base)},null,2)+'\n');
}
async function fixture(){
 const d=await mkdtemp(join(tmpdir(),'gitporch-buildtest-'));
 const {path}=await createRepo(d,'Garden'),work=join(d,'work');
 await git(['init','--initial-branch=main',work]);
 await mkdir(join(work,'docs'));
 await writeFile(join(work,'docs','index.html'),originalHtml);
 await writeFile(join(work,'docs','styles.css'),'body { color: tomato; }');
 await writeFile(join(work,'docs','app.js'),'window.garden=1;');
 await git(['-C',work,'add','docs']);
 await git(['-C',work,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
   'commit','-m','static fixture']);
 await git(['-C',work,'push',path,'HEAD:main']);
 const queued=await enqueueTests(d,'Garden',IMAGE);
 await localPass(d,queued); // test fixture only: not real Docker execution
 const source=await bundleSource(d,'Garden',queued.id,{approved:true});
 return {d,work,source};
}
test('static-web recipe truly transforms three files without executing site JS',async()=>{
 const home=await mkdtemp(join(tmpdir(),'gitporch-recipe-'));
 try{
   await mkdir(join(home,'docs'));
   await writeFile(join(home,'docs','index.html'),originalHtml);
   await writeFile(join(home,'docs','styles.css'),'body {color: red}');
   await writeFile(join(home,'docs','app.js'),'window.secret=42;');
   const result=spawnSync(process.execPath,[recipe],{cwd:home,encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
   const output=JSON.parse(result.stdout);
   const html=Buffer.from(output.htmlBase64,'base64').toString('utf8');
   assert.match(html,/<style data-gitporch-recipe/);
   assert.match(html,/body \{color: red\}/);
   assert.match(html,/window.secret=42/);
   assert.doesNotMatch(html,/href="\.\/styles\.css"/);
   assert.doesNotMatch(html,/src="\.\/app\.js"/);
   await writeFile(join(home,'docs','app.js'),'</script> unsafe');
   const fail=spawnSync(process.execPath,[recipe],{cwd:home,encoding:'utf8'});
   assert.notEqual(fail.status,0);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('Docker execution plan stays networkless and has fixed entrypoint',()=>{
 const args=staticDockerPlan(IMAGE,'/tmp/source.tar','/tmp/recipe.cjs','gitporch-web-fixture');
 assert.ok(args.includes('none'));
 assert.ok(args.includes('--read-only'));
 assert.ok(args.includes('--cap-drop'));
 assert.ok(args.includes('--pull=never'));
 assert.ok(args.includes('--user'));
 assert.ok(args.at(-1).includes('node /recipe.cjs'));
 assert.throws(()=>staticDockerPlan('node:latest','/tmp/source.tar','/tmp/recipe','bad'),/Pinned/);
});
test('R1-F2 refuses work without explicit operator approval',async()=>{
 const {d,source}=await fixture();
 try{
   await assert.rejects(buildStaticPage(d,source.id),/approve/);
   assert.equal((await buildSnapshot(d)).count,0);
 }finally{await rm(d,{recursive:true,force:true});}
});
test('verified source bundle produces private, hash-checked local HTML',async()=>{
 const {d,source}=await fixture();
 try{
   let calls=0;
   const execute=async(exe,args)=>{
     calls++;assert.equal(exe,'docker');
     if(args[0]==='image')return {exitCode:0,stdout:JSON.stringify({Id:IMAGE,RepoDigests:[]}),stderr:'',timeout:false};
     assert.equal(args[0],'run');
     const bytes=Buffer.from('<!doctype html><title>fixture generated in mocked container</title>','utf8');
     return {exitCode:0,stdout:JSON.stringify({schema:'gitporch-static-web-output/0.1',
       recipe:'STATIC_WEB_ONEFILE_V1',htmlBase64:bytes.toString('base64')})+'\n',
       stderr:'',timeout:false};
   };
   const created=await buildStaticPage(d,source.id,{approved:true,execute});
   assert.equal(calls,2);
   assert.equal(created.status,'LOCAL_OUTPUT_BYTES_VERIFIED_NOT_ATTESTED');
   const first=await buildSnapshot(d);
   assert.equal(first.count,1);
   assert.equal(first.builds[0].sourceArtifactId,source.id);
   assert.equal(first.builds[0].sha256,created.sha256);
   await writeFile(join(d,'builds',created.id+'.html'),'tampered');
   await assert.rejects(buildSnapshot(d),/altered|mismatch/);
 }finally{await rm(d,{recursive:true,force:true});}
});
test('failed Docker builds never create passing records',async()=>{
 const {d,source}=await fixture();
 try{
   const execute=async(exe,args)=>args[0]==='image'
     ?{exitCode:0,stdout:JSON.stringify({Id:IMAGE}),stderr:'',timeout:false}
     :{exitCode:1,stdout:'',stderr:'recipe failed',timeout:false};
   await assert.rejects(buildStaticPage(d,source.id,{approved:true,execute}),/failed/);
   assert.equal((await buildSnapshot(d)).count,0);
 }finally{await rm(d,{recursive:true,force:true});}
});
test('a changed Git HEAD invalidates old bundle as a build input',async()=>{
 const {d,work,source}=await fixture();
 try{
   await git(['-C',work,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
     'commit','--allow-empty','-m','new head']);
   await git(['-C',work,'push',join(d,'repos','Garden.git'),'HEAD:main']);
   await assert.rejects(buildStaticPage(d,source.id,{approved:true}),/HEAD/);
 }finally{await rm(d,{recursive:true,force:true});}
});
