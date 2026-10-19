import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRepo,git} from '../src/git.mjs';
import {enqueue} from '../src/sandbox-ci.mjs';
import {createHttpServer} from '../src/server.mjs';
const IMAGE='sha256:'+'f'.repeat(64);
test('local sandbox test status endpoint is read-only',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'porch-test-http-'));
 const server=createHttpServer({dataDir});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const {path}=await createRepo(dataDir,'Garden'),work=join(dataDir,'work');
  await git(['init','--initial-branch=main',work]);
  await git(['-C',work,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','fixture']);
  await git(['-C',work,'push',path,'HEAD:main']);
  await enqueue(dataDir,'Garden',IMAGE);
  const root='http://127.0.0.1:'+server.address().port;
  const result=await fetch(root+'/api/sandbox-tests');
  assert.equal(result.status,200);const data=await result.json();
  assert.equal(data.counts.queued,1);
  assert.equal(data.jobs[0].status,'QUEUED');
  assert.equal(data.jobs[0].outcome,null);
  assert.equal((await fetch(root+'/api/sandbox-tests',{method:'POST'})).status,405);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});}
});
