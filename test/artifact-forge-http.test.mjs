import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHttpServer} from '../src/server.mjs';
test('Artifact Forge HTTP only exposes read-only metadata',async()=>{
 const d=await mkdtemp(join(tmpdir(),'artifact-forge-http-'));
 const server=createHttpServer({dataDir:d});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/artifacts');
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.mode,'LOCAL_READ_ONLY');
  assert.equal(data.count,0);
  assert.deepEqual(data.artifacts,[]);
  assert.equal((await fetch(base+'/api/artifacts',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/artifacts/bundle',{method:'POST'})).status,405);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(d,{recursive:true,force:true});}
});
