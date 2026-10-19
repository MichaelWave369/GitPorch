import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createRepo, git, repoRoot } from '../src/git.mjs';

async function unusedPort() {
  const s=net.createServer();
  await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
  const port=s.address().port;
  await new Promise(resolve=>s.close(resolve));
  return port;
}
async function waitForGit(port,child) {
  for (let n=0;n<30;n++) {
    if (child.exitCode!==null) throw new Error('Git daemon exited');
    const live=await new Promise(resolve=>{
      const socket=net.connect({host:'127.0.0.1',port});
      socket.once('connect',()=>{socket.destroy();resolve(true)});
      socket.once('error',()=>{socket.destroy();resolve(false)});
    });
    if (live) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Git transport did not open');
}
test('loopback clone works, but remote git protocol pushes are rejected',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'gitporch-transport-'));
  const port=await unusedPort();
  let daemon;
  try {
    const repo=await createRepo(dataDir,'garden');
    const work=join(dataDir,'work');
    await git(['init','--initial-branch=main',work]);
    await git(['-C',work,'-c','user.name=Porch Tester','-c','user.email=test@example.invalid','commit','--allow-empty','-m','a real commit']);
    await git(['-C',work,'push',repo.path,'HEAD:main']);
    daemon=spawn('git',['daemon','--reuseaddr',`--base-path=${repoRoot(dataDir)}`,
      '--export-all','--listen=127.0.0.1',`--port=${port}`,
      '--enable=upload-pack','--disable=receive-pack','--disable=upload-archive',
      '--log-destination=stderr',repoRoot(dataDir)],{stdio:['ignore','ignore','pipe']});
    await waitForGit(port,daemon);
    const clone=join(dataDir,'clone');
    await git(['clone',`git://127.0.0.1:${port}/garden.git`,clone]);
    assert.equal(await git(['-C',clone,'log','-1','--format=%s']),'a real commit');
    await assert.rejects(git(['-C',work,'push',`git://127.0.0.1:${port}/garden.git`,'HEAD:unauthorized'],{timeout:4000}));
    assert.equal(await git(['--git-dir',repo.path,'branch','--list','unauthorized']),'');
  }finally {daemon?.kill();await rm(dataDir,{recursive:true,force:true});}
});
