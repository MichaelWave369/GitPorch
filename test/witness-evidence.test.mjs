import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateLocalSigner,signSubject} from '../src/evidence-signatures.mjs';
import {generateWitnessKeys,witnessReport,verifyWitness,signWitnessFile,verifyWitnessFiles} from '../src/witness-evidence.mjs';
const ID='1760900000000-123e4567-e89b-42d3-a456-426614174000';
const subject={lane:'git',jobId:ID,repo:'Garden',commit:'a'.repeat(40),status:'DONE',outcome:'ABORTED_UNVERIFIED',
  check:'GIT_OBJECT_INTEGRITY',durationMs:0,completedAt:'2026-10-19T00:00:00Z'};
async function workspace(fn){
 const root=await mkdtemp(join(tmpdir(),'gitporch-witness-'));
 try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}
}
async function setup(root){
 const operator=await generateLocalSigner(join(root,'operator'));
 const witness=await generateWitnessKeys(join(root,'witness-machine'));
 const privateOperator=await readFile(operator.privateKeyFile,'utf8');
 const operatorPublic=await readFile(operator.publicKeyFile,'utf8');
 const privateWitness=await readFile(witness.privatePath,'utf8');
 const witnessPublic=await readFile(witness.publicPath,'utf8');
 const report=signSubject(subject,privateOperator);
 return {operator,witness,operatorPublic,privateWitness,witnessPublic,report};
}
test('two different keys countersign an operator report without promoting its result',()=>workspace(async root=>{
 const p=await setup(root);
 const receipt=witnessReport(p.report,p.operatorPublic,p.privateWitness);
 const result=verifyWitness(p.report,receipt,p.operatorPublic,p.witnessPublic);
 assert.equal(result.operatorSignatureValid,true);
 assert.equal(result.witnessSignatureValid,true);
 assert.notEqual(result.operatorKeyFingerprint,result.witnessKeyFingerprint);
 assert.equal(result.outcome,'ABORTED_UNVERIFIED');
 assert.equal(result.assurance,'TWO_DISTINCT_KEY_SIGNATURES_NOT_INDEPENDENT_EXECUTION_PROOF');
}));
test('modified outcome, report signature, witness note, or trusted keys fail closed',()=>workspace(async root=>{
 const p=await setup(root);
 const receipt=witnessReport(p.report,p.operatorPublic,p.privateWitness);
 const changed=structuredClone(p.report);changed.body.subject.outcome='PASS';
 assert.throws(()=>verifyWitness(changed,receipt,p.operatorPublic,p.witnessPublic),/signature verification failed/);
 const swapped=structuredClone(p.report);swapped.signature=p.report.signature.slice(0,-3)+'AAA';
 assert.throws(()=>verifyWitness(swapped,receipt,p.operatorPublic,p.witnessPublic));
 const badWitness=structuredClone(receipt);badWitness.body.witnessedAt='2000-01-01T00:00:00Z';
 assert.throws(()=>verifyWitness(p.report,badWitness,p.operatorPublic,p.witnessPublic),/signature verification failed/);
 assert.throws(()=>verifyWitness(p.report,receipt,p.witnessPublic,p.operatorPublic));
}));
test('operator cannot countersign with same key as witness',()=>workspace(async root=>{
 const p=await setup(root);
 const operatorPrivate=await readFile(p.operator.privateKeyFile,'utf8');
 assert.throws(()=>witnessReport(p.report,p.operatorPublic,operatorPrivate),/same signing key/);
 const forged=witnessReport(p.report,p.operatorPublic,p.privateWitness);
 assert.throws(()=>verifyWitness(p.report,forged,p.operatorPublic,p.operatorPublic),/distinct/);
}));
test('file workflow works offline, refuses overwrite, and checks original signature before signing',()=>workspace(async root=>{
 const p=await setup(root);
 const source=join(root,'report.json'),output=join(root,'signed','witness.json');
 await writeFile(source,JSON.stringify(p.report));
 const signed=await signWitnessFile(source,p.operator.publicKeyFile,p.witness.privatePath,output);
 assert.equal(signed.observedOutcome,'ABORTED_UNVERIFIED');
 assert.equal((await verifyWitnessFiles(source,output,p.operator.publicKeyFile,p.witness.publicPath)).witnessSignatureValid,true);
 await assert.rejects(signWitnessFile(source,p.operator.publicKeyFile,p.witness.privatePath,output),/EEXIST/);
 const tampered=structuredClone(p.report);tampered.body.subject.outcome='PASS';
 await writeFile(source,JSON.stringify(tampered));
 await assert.rejects(signWitnessFile(source,p.operator.publicKeyFile,p.witness.privatePath,join(root,'bad.json')),/signature verification failed/);
 await assert.rejects(verifyWitnessFiles(source,output,p.operator.publicKeyFile,p.witness.publicPath));
}));
test('witness generation will not overwrite key files',()=>workspace(async root=>{
 const directory=join(root,'witness');
 await generateWitnessKeys(directory);
 await assert.rejects(generateWitnessKeys(directory),/EEXIST/);
}));
