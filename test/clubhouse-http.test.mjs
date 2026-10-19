import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer } from '../src/server.mjs';
import { register } from '../src/clubhouse.mjs';
test('local clubhouse endpoint serves receipts read-only',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'gitporch-club-http-'));
 const server=createHttpServer({dataDir});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  await register(dataDir,'fixture','builder','Fixture Member');
  const origin='http://127.0.0.1:'+server.address().port;
  const r=await fetch(origin+'/api/clubhouse');
  assert.equal(r.status,200);
  assert.equal((await r.json()).members[0].displayName,'Fixture Member');
  assert.equal((await fetch(origin+'/api/clubhouse',{method:'POST'})).status,405);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});}
});
