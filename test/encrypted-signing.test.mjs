import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeNewEncryptedKey} from '../src/key-vault.mjs';
import {signWithEncryptedKey} from '../src/encrypted-signing.mjs';
import {verifyEnvelope} from '../src/evidence-signatures.mjs';
const PASS='a long passphrase, protected from command arguments';
const ID='1760900000000-123e4567-e89b-42d3-a456-426614174000';
const JOB={id:ID,repo:'Garden',commit:'a'.repeat(40),status:'DONE',outcome:'ABORTED_UNVERIFIED',
  check:'GIT_OBJECT_INTEGRITY',durationMs:0,completedAt:'2026-10-19T00:00:00Z'};
async function isolated(fn){
 const root=await mkdtemp(join(tmpdir(),'gitporch-vault-signer-'));
 try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}
}
test('encrypt-first signer produces a normal offline-verifiable report without a plaintext PEM file',()=>isolated(async root=>{
 const path=join(root,'signer','operator-encrypted.json');
 const generated=await writeNewEncryptedKey(path,PASS);
 const snapshot=async()=>({jobs:[JOB]});
 const signed=await signWithEncryptedKey(root,'git',ID,path,PASS,snapshot);
 const report=JSON.parse(await readFile(signed.output,'utf8'));
 assert.equal(signed.outcome,'ABORTED_UNVERIFIED');
 assert.equal(verifyEnvelope(report,generated.publicKeyPem).subject.outcome,'ABORTED_UNVERIFIED');
 assert.equal((await readFile(path,'utf8')).includes('BEGIN PRIVATE KEY'),false);
 await assert.rejects(signWithEncryptedKey(root,'git',ID,path,PASS,snapshot),/EEXIST/);
}));
test('noncompleted jobs, invalid IDs, missing jobs and wrong passphrase never generate reports',()=>isolated(async root=>{
 const path=join(root,'signer','operator-encrypted.json');
 await writeNewEncryptedKey(path,PASS);
 await assert.rejects(signWithEncryptedKey(root,'git',ID,path,PASS,async()=>({jobs:[{...JOB,status:'RUNNING_UNCERTAIN'}]})),/Only completed/);
 await assert.rejects(signWithEncryptedKey(root,'git','../escape',path,PASS,async()=>({jobs:[JOB]})),/Invalid lane/);
 await assert.rejects(signWithEncryptedKey(root,'git',ID,path,PASS,async()=>({jobs:[]})),/not found/);
 await assert.rejects(signWithEncryptedKey(root,'git',ID,path,'wrong but still long enough',async()=>({jobs:[JOB]})),/Wrong passphrase/);
}));
