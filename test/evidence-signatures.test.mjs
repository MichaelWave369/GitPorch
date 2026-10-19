import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,generateLocalSigner,signSubject,signCompletedJob,verifyEnvelope,verifyFile,subjectFromJob} from '../src/evidence-signatures.mjs';
const ID='1760900000000-123e4567-e89b-42d3-a456-426614174000';
const job={id:ID,repo:'Garden',commit:'a'.repeat(40),status:'DONE',outcome:'PASS',check:'GIT_OBJECT_INTEGRITY',durationMs:7,completedAt:'2026-10-19T00:00:00Z'};
async function temp(fn){const dir=await mkdtemp(join(tmpdir(),'gitporch-signed-'));try{await fn(dir)}finally{await rm(dir,{force:true,recursive:true})}}
test('canonical evidence is key-order independent but rejects unsupported types',()=>{
 assert.equal(canonical({b:[2,{y:1,x:2}],a:'hi'}),canonical({a:'hi',b:[2,{x:2,y:1}]}));
 assert.throws(()=>canonical({undefinedField:undefined}),/Unsupported/);
});
test('explicitly generated Ed25519 keys sign locally verified job records',()=>temp(async dir=>{
 const keys=await generateLocalSigner(dir);
 const pem=await readFile(keys.privateKeyFile,'utf8'),publicKey=await readFile(keys.publicKeyFile,'utf8');
 const envelope=signSubject(subjectFromJob('git',job),pem);
 assert.equal(verifyEnvelope(envelope,publicKey).signatureValid,true);
 assert.equal(keys.privateKeyUnencrypted,true);
 await assert.rejects(generateLocalSigner(dir),/EEXIST/);
}));
test('tampering, swapped public keys, pending work and false PASS are rejected',()=>temp(async dir=>{
 const keys=await generateLocalSigner(join(dir,'one'));
 const another=await generateLocalSigner(join(dir,'two'));
 const pem=await readFile(keys.privateKeyFile,'utf8');
 const trusted=await readFile(keys.publicKeyFile,'utf8');
 const untrusted=await readFile(another.publicKeyFile,'utf8');
 assert.throws(()=>subjectFromJob('git',{...job,status:'RUNNING_UNCERTAIN',outcome:null}),/Only completed/);
 const env=signSubject(subjectFromJob('git',{...job,outcome:'ABORTED_UNVERIFIED'}),pem);
 assert.equal(verifyEnvelope(env,trusted).subject.outcome,'ABORTED_UNVERIFIED');
 assert.throws(()=>verifyEnvelope(env,untrusted),/mismatch/);
 env.body.subject.outcome='PASS';
 assert.throws(()=>verifyEnvelope(env,trusted),/signature verification failed/);
}));
test('signature is portable: another verifier needs only attestation and independently trusted public key',()=>temp(async dir=>{
 const keys=await generateLocalSigner(join(dir,'keys'));
 const output=join(dir,'attestation.json');
 const summary=async()=>({jobs:[job]});
 const signed=await signCompletedJob(dir,'git',ID,keys.privateKeyFile,output,async()=>summary());
 assert.equal(signed.outcome,'PASS');
 assert.equal((await verifyFile(output,keys.publicKeyFile)).signatureValid,true);
 await assert.rejects(signCompletedJob(dir,'git',ID,keys.privateKeyFile,output,async()=>summary()),/EEXIST/);
 const value=JSON.parse(await readFile(output,'utf8'));
 value.body.subject.repo='Intruder';await writeFile(output,JSON.stringify(value));
 await assert.rejects(verifyFile(output,keys.publicKeyFile),/signature verification failed/);
}));
