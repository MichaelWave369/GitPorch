import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHttpServer} from '../src/server.mjs';
test('build shelf never accepts HTTP mutations or serves compiled output',async()=>{
 const d=await mkdtemp(join(tmpdir(),'gitporch-build-http-'));
 const server=createHttpServer({dataDir:d});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
   const base='http://127.0.0.1:'+server.address().port;
   const response=await fetch(base+'/api/builds');
   assert.equal(response.status,200);
   const state=await response.json();
   assert.equal(state.mode,'LOCAL_READ_ONLY');
   assert.equal(state.count,0);
   assert.equal((await fetch(base+'/api/builds',{method:'POST'})).status,405);
   assert.equal((await fetch(base+'/api/builds/run',{method:'POST'})).status,405);
   assert.equal((await fetch(base+'/api/builds/test.html')).status,404);
 }finally{
   await new Promise(resolve=>server.close(resolve));
   await rm(d,{recursive:true,force:true});
 }
});
