import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRepo,git} from '../src/git.mjs';
import {enqueueCheck,workOnce} from '../src/porch-crew.mjs';
import {createHttpServer} from '../src/server.mjs';
test('the Workshop exposes only read-only real integrity statuses',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'porchcrew-http-'));
 const server=createHttpServer({dataDir});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const {path}=await createRepo(dataDir,'Garden');const work=join(dataDir,'work');
  await git(['init','--initial-branch=main',work]);
  await git(['-C',work,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','fixture']);
  await git(['-C',work,'push',path,'HEAD:main']);
  await enqueueCheck(dataDir,'Garden');
  const base='http://127.0.0.1:'+server.address().port;
  const before=await (await fetch(base+'/api/porch-crew')).json();
  assert.equal(before.jobs[0].status,'QUEUED');assert.equal(before.jobs[0].outcome,null);
  assert.equal((await fetch(base+'/api/porch-crew',{method:'POST'})).status,405);
  await workOnce(dataDir);
  const after=await (await fetch(base+'/api/porch-crew')).json();
  assert.equal(after.jobs[0].outcome,'PASS');
  assert.equal(after.assurance,'LOCAL_CHECKSUM_NOT_SIGNED_NOT_CI');
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});}
});
