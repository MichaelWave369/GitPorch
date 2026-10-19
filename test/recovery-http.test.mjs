import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHttpServer} from '../src/server.mjs';
test('Recovery Doctor has only GET access, no mutation route',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gitporch-recovery-http-'));
 const server=createHttpServer({dataDir:root});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/recovery');
  assert.equal(response.status,200);
  assert.equal((await response.json()).mode,'READ_ONLY_RECOVERY_DIAGNOSTIC');
  assert.equal((await fetch(base+'/api/recovery',{method:'POST'})).status,405);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  await rm(root,{recursive:true,force:true});
 }
});
