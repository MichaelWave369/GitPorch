import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {signSubject} from '../src/evidence-signatures.mjs';
import {witnessReport} from '../src/witness-evidence.mjs';
import {fingerprintFile,enrollKey,revokeKey,trustState,verifyWithPolicy} from '../src/trust-policy.mjs';

async function isolated(fn){
 const root=await mkdtemp(join(tmpdir(),'gitporch-trust-'));
 try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}
}
async function fixture(root,name){
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const pub=publicKey.export({type:'spki',format:'pem'});
 const path=join(root,name+'.pem');
 await writeFile(path,pub);
 const {fingerprint}=await fingerprintFile(path);
 return {privateKey,privatePem:privateKey.export({type:'pkcs8',format:'pem'}),pub,path,fingerprint};
}
async function pair(root){
 const operator=await fixture(root,'operator'),witness=await fixture(root,'witness');
 const subject={lane:'git',jobId:'1760900000000-123e4567-e89b-42d3-a456-426614174000',
   repo:'Garden',commit:'a'.repeat(40),status:'DONE',outcome:'ABORTED_UNVERIFIED',
   check:'GIT_OBJECT_INTEGRITY',durationMs:0,completedAt:'2026-10-19T00:00:00Z'};
 const report=signSubject(subject,operator.privatePem);
 const countersigned=witnessReport(report,operator.pub,witness.privatePem);
 const rp=join(root,'operator-report.json'),wp=join(root,'witness-report.json');
 await writeFile(rp,JSON.stringify(report));
 await writeFile(wp,JSON.stringify(countersigned));
 return {operator,witness,report,countersigned,rp,wp};
}
test('explicit fingerprint approval is mandatory, unknown keys are not trusted',()=>isolated(async root=>{
 const key=await fixture(root,'operator'),trust=join(root,'trust');
 await assert.rejects(enrollKey(trust,'operator',key.path,key.fingerprint,false),/confirmation/);
 await assert.rejects(enrollKey(trust,'operator',key.path,'sha256:'+'f'.repeat(64),true),/does not match/);
 assert.equal((await trustState(trust)).keys.length,0);
 await enrollKey(trust,'operator',key.path,key.fingerprint,true);
 await assert.rejects(enrollKey(trust,'witness',key.path,key.fingerprint,true),/already enrolled/);
 assert.equal((await trustState(trust)).keys[0].status,'TRUSTED');
}));
test('real signed operator + witness reports require separately enrolled keys',()=>isolated(async root=>{
 const p=await pair(root),trust=join(root,'trust');
 await assert.rejects(verifyWithPolicy(trust,p.rp,p.wp),/UNTRUSTED/);
 await enrollKey(trust,'operator',p.operator.path,p.operator.fingerprint,true);
 await assert.rejects(verifyWithPolicy(trust,p.rp,p.wp),/UNTRUSTED_WITNESS/);
 await enrollKey(trust,'witness',p.witness.path,p.witness.fingerprint,true);
 const result=await verifyWithPolicy(trust,p.rp,p.wp);
 assert.equal(result.operatorSignatureValid,true);
 assert.equal(result.witnessSignatureValid,true);
 assert.equal(result.outcome,'ABORTED_UNVERIFIED');
 assert.equal(result.policyAccepted,true);
}));
test('current revocation vetoes prior signatures and no automatic re-enrollment',()=>isolated(async root=>{
 const p=await pair(root),trust=join(root,'trust');
 await enrollKey(trust,'operator',p.operator.path,p.operator.fingerprint,true);
 await enrollKey(trust,'witness',p.witness.path,p.witness.fingerprint,true);
 await assert.rejects(revokeKey(trust,'witness',p.witness.fingerprint,'Retired',false),/confirmation/);
 await revokeKey(trust,'witness',p.witness.fingerprint,'Retired',true);
 await assert.rejects(verifyWithPolicy(trust,p.rp,p.wp),/REVOKED_WITNESS/);
 await assert.rejects(revokeKey(trust,'witness',p.witness.fingerprint,'Again',true),/already revoked/);
 await assert.rejects(enrollKey(trust,'witness',p.witness.path,p.witness.fingerprint,true),/already enrolled/);
}));
test('invalid signature cannot be made valid by trusting its claimed keys',()=>isolated(async root=>{
 const p=await pair(root),trust=join(root,'trust');
 await enrollKey(trust,'operator',p.operator.path,p.operator.fingerprint,true);
 await enrollKey(trust,'witness',p.witness.path,p.witness.fingerprint,true);
 p.report.body.subject.outcome='PASS';await writeFile(p.rp,JSON.stringify(p.report));
 await assert.rejects(verifyWithPolicy(trust,p.rp,p.wp),/signature verification failed/i);
}));
test('tampering with stored keys or revocations fails closed',()=>isolated(async root=>{
 const p=await pair(root),trust=join(root,'trust');
 await enrollKey(trust,'operator',p.operator.path,p.operator.fingerprint,true);
 await enrollKey(trust,'witness',p.witness.path,p.witness.fingerprint,true);
 await revokeKey(trust,'witness',p.witness.fingerprint,'Retired',true);
 const revPath=join(trust,'revoked',p.witness.fingerprint.slice(7)+'.json');
 const rev=JSON.parse(await readFile(revPath,'utf8'));
 rev.reason='Tampered';await writeFile(revPath,JSON.stringify(rev));
 await assert.rejects(trustState(trust),/checksum mismatch/);
 await assert.rejects(verifyWithPolicy(trust,p.rp,p.wp),/checksum mismatch/);
}));
test('exclusive policy lock prevents concurrent mutation',()=>isolated(async root=>{
 const key=await fixture(root,'operator'),trust=join(root,'trust');
 await mkdir(trust);const lock=await open(join(trust,'policy.lock'),'wx');
 try{await assert.rejects(enrollKey(trust,'operator',key.path,key.fingerprint,true),/Trust policy lock exists/)}
 finally{await lock.close();}
}));
test('role, fingerprint and private-key input mistakes fail closed',()=>isolated(async root=>{
 const key=await fixture(root,'operator'),trust=join(root,'trust');
 await assert.rejects(enrollKey(trust,'tester',key.path,key.fingerprint,true),/Role/);
 await assert.rejects(enrollKey(trust,'operator',key.path,'../outside',true),/fingerprint/);
 const privatePath=join(root,'private.pem');
 await writeFile(privatePath,key.privatePem);
 await assert.rejects(fingerprintFile(privatePath),/Expected public PEM/);
 await assert.rejects(revokeKey(trust,'operator',key.fingerprint,'Bad\nreason',true),/printable/);
}));
