import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRepo,git} from '../src/git.mjs';
import {register,propose,recordDecision,summary} from '../src/clubhouse.mjs';
async function isolated(fn){const root=await mkdtemp(join(tmpdir(),'gitporch-crew-'));try{await fn(root);}finally{await rm(root,{force:true,recursive:true});}}
test('register and review real commit, without executing it',()=>isolated(async root=>{
 const created=await createRepo(root,'porch');
 const work=join(root,'work');await git(['init','--initial-branch=main',work]);
 await git(['-C',work,'-c','user.email=fixture@example.invalid','-c','user.name=Tester','commit','--allow-empty','-m','fixture']);
 await git(['-C',work,'push',created.path,'HEAD:main']);
 const sha=await git(['-C',work,'rev-parse','HEAD']);
 await register(root,'bot-1','builder','Sample Bot');
 const r=await propose(root,'bot-1','porch',sha,'Requests review only');
 const id=r.payload.id;
 let state=await summary(root);
 assert.equal(state.proposals[0].decision,'PENDING_OPERATOR_REVIEW');
 assert.equal(state.proposals[0].commit,sha);
 assert.equal(state.proposals[0].commitObjectObserved,true);
 await assert.rejects(recordDecision(root,id,'ACCEPTED','Not yet',false),/confirmation/);
 const reviewed=await recordDecision(root,id,'ACCEPTED','Operator reviewed proposal',true);
 assert.equal(reviewed.payload.scope,'LOCAL_OPERATOR_NOTE_ONLY_NO_MERGE');
 state=await summary(root);assert.equal(state.proposals[0].decision,'ACCEPTED');
 await assert.rejects(recordDecision(root,id,'DECLINED','Again',true),/Already reviewed/);
 await assert.rejects(register(root,'bot-1','tester','Duplicate'),/EEXIST/);
}));
test('fail closed on invalid identifiers and unregistered contributors',()=>isolated(async root=>{
 await assert.rejects(register(root,'../outside','builder','Intruder'),/Invalid member/);
 await assert.rejects(register(root,'member','boss','Not a role'),/Invalid role/);
 await assert.rejects(propose(root,'missing','repo','a'.repeat(40),'hello'),/Register/);
 await register(root,'bot2','reviewer','Sample');
 await assert.rejects(propose(root,'bot2','repo','a'.repeat(40),'not a repo'),/not found/);
 await assert.rejects(propose(root,'bot2','repo','ABC','short'),/Invalid repository/);
}));
test('detect tampered receipt before later operations',()=>isolated(async root=>{
 await register(root,'bot3','tester','Fixture Tester');
 const path=join(root,'crew','members','bot3.json');
 const edited=JSON.parse(await readFile(path,'utf8'));edited.payload.role='builder';await writeFile(path,JSON.stringify(edited));
 await assert.rejects(summary(root),/checksum mismatch/);
 await assert.rejects(register(root,'bot4','tester','New Member'),/checksum mismatch/);
}));
