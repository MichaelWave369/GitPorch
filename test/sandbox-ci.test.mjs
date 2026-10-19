import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRepo,git} from '../src/git.mjs';
import {dockerPlan,parseTap,enqueue,workOnce,snapshot} from '../src/sandbox-ci.mjs';
const IMAGE='sha256:'+'a'.repeat(64);
const TAP='TAP version 13\nok 1 - test one\n1..1\n# tests 1\n# pass 1\n# fail 0\n# skipped 0\n';
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'porch-sandbox-test-'));
 try{
  const {path}=await createRepo(root,'Garden'),work=join(root,'work');
  await git(['init','--initial-branch=main',work]);
  await git(['-C',work,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','fixture']);
  await git(['-C',work,'push',path,'HEAD:main']);
  await fn(root,{path,work});
 }finally{await rm(root,{force:true,recursive:true});}
}
const mock=(e,args)=> {
 if(e!=='docker')throw Error('Unexpected binary');
 if(args[0]==='image')return Promise.resolve({exitCode:0,stdout:JSON.stringify({Id:IMAGE,RepoDigests:[]}),timeout:false});
 assert.equal(args[0],'run');
 assert.ok(args.includes('none'));
 assert.ok(args.includes('--cap-drop'));
 assert.ok(args.includes('no-new-privileges'));
 assert.ok(args.includes('--pull=never'));
 assert.ok(args.includes('--read-only'));
 assert.ok(args.includes('65534:65534'));
 return Promise.resolve({exitCode:0,stdout:TAP,timeout:false});
};
test('Docker invocation is fixed, offline and least-privilege',()=>{
 const args=dockerPlan(IMAGE,'/tmp/test.tar','gitporch-ci-12345678');
 assert.ok(args.includes('--network')&&args.includes('none'));
 assert.ok(args.includes('--pids-limit')&&args.includes('64'));
 assert.ok(args.includes('--memory')&&args.includes('512m'));
 assert.ok(args.includes('--cap-drop')&&args.includes('ALL'));
 assert.ok(args.includes('--pull=never'));
 assert.ok(!args.includes('--privileged'));
 assert.throws(()=>dockerPlan('node:latest','/tmp/test.tar','gitporch-ci-12345678'));
});
test('TAP parser rejects zero tests and nonzero exit codes',()=>{
 assert.equal(parseTap(TAP,0).outcome,'PASS');
 assert.equal(parseTap('TAP version 13\n# tests 0\n# pass 0\n# fail 0\n# skipped 0\n',0).outcome,'NO_TESTS');
 assert.equal(parseTap(TAP,1).outcome,'FAIL');
 assert.equal(parseTap('random output',0).outcome,'ERROR');
});
test('real pinned Git archive + fake Docker runner yields labeled result only',()=>fixture(async root=>{
 const job=await enqueue(root,'Garden',IMAGE);
 assert.equal(job.status,'QUEUED');
 const result=await workOnce(root,{execute:mock});
 assert.equal(result.outcome,'PASS');
 assert.equal(result.counts.tests,1);
 assert.ok((await snapshot(root)).jobs[0].evidence?.stdoutSha256);
 const jobs=await snapshot(root);
 assert.equal(jobs.jobs[0].status,'DONE');
 assert.equal(jobs.assurance,'DOCKER_EXIT_AND_TAP_NOT_SIGNED_ATTESTATION');
}));
test('stale commit does not enter container and cannot pass',()=>fixture(async(root,{path,work})=>{
 await enqueue(root,'Garden',IMAGE);
 await git(['-C',work,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','new']);
 await git(['-C',work,'push',path,'HEAD:main']);
 const result=await workOnce(root,{execute:()=>{throw Error('should not run Docker')}});
 assert.equal(result.outcome,'STALE');
}));
test('bad receipt content fails closed',()=>fixture(async root=>{
 const job=await enqueue(root,'Garden',IMAGE);
 const path=join(root,'isolated-tests','pending',job.id+'.json');
 const r=JSON.parse(await readFile(path,'utf8'));r.repo='changed';await writeFile(path,JSON.stringify(r));
 await assert.rejects(snapshot(root),/checksum mismatch/);
 await assert.rejects(workOnce(root,{execute:mock}),/checksum mismatch/);
}));
test('interrupted job remains uncertain; no speculative green',()=>fixture(async root=>{
 const job=await enqueue(root,'Garden',IMAGE);
 await rename(join(root,'isolated-tests','pending',job.id+'.json'),join(root,'isolated-tests','running',job.id+'.json'));
 const s=await snapshot(root);assert.equal(s.jobs[0].status,'RUNNING_UNCERTAIN');assert.equal(s.jobs[0].outcome,null);
 assert.equal((await workOnce(root,{execute:mock})).status,'IDLE');
}));
test('explicit immutable image and genuine commit required',()=>fixture(async root=>{
 await assert.rejects(enqueue(root,'Garden','node:22-alpine'),/Immutable/);
 await assert.rejects(enqueue(root,'missing',IMAGE),/not found/);
}));

test('mismatched local image metadata is an ERROR, never a passing test',()=>fixture(async root=>{
 await enqueue(root,'Garden',IMAGE);
 let ran=false;
 const response=await workOnce(root,{execute:async(binary,args)=>{
  if(args[0]==='image')return {exitCode:0,stdout:JSON.stringify({Id:'sha256:'+'b'.repeat(64)}),timeout:false};
  ran=true;return {exitCode:0,stdout:TAP,timeout:false};
 }});
 assert.equal(response.outcome,'ERROR');assert.equal(ran,false);
}));
