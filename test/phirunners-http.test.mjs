import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHttpServer} from '../src/server.mjs';

test('PhiRunners HTTP view is local read-only with no command endpoint',async()=>{
  const home=await mkdtemp(join(tmpdir(),'phirunners-http-'));
  const server=createHttpServer({dataDir:home});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port+'/api/phirunners';
    const response=await fetch(url);
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.service,'PhiRunners');
    assert.equal(data.mode,'LOCAL_READ_ONLY');
    assert.equal(data.totals.queued,0);
    assert.equal((await fetch(url,{method:'POST'})).status,405);
    assert.equal((await fetch(url+'/work',{method:'POST'})).status,405);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    await rm(home,{recursive:true,force:true});
  }
});
