// GitPorch R1-D4A: operator-managed OFFLINE public-key allowlist and revocation.
// Revocation is a current local policy veto, NOT retroactive proof or tamper-proof storage.
import {createHash,createPublicKey} from 'node:crypto';
import {mkdir,open,readFile,readdir,lstat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyWitness} from './witness-evidence.mjs';

const ROLES=['operator','witness'];
const FINGERPRINT=/^sha256:([0-9a-f]{64})$/;
const store=(root,role,hex)=>join(root,role,hex+'.pem');
const revoked=(root,hex)=>join(root,'revoked',hex+'.json');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function roleCheck(role){if(!ROLES.includes(role))throw Error('Role must be operator or witness');return role;}
function keyHex(fp){const match=FINGERPRINT.exec(fp);if(!match)throw Error('Invalid Ed25519 fingerprint');return match[1];}
function publicKeyInfo(pem){
 if(typeof pem!=='string'||!pem.trimStart().startsWith('-----BEGIN PUBLIC KEY-----'))throw Error('Expected public PEM only; do not supply a private key');
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='ed25519')throw Error('Only Ed25519 public keys may be trusted');
 const fingerprint='sha256:'+createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
 return {fingerprint,key};
}
export async function fingerprintFile(path){
 const pem=await readFile(path,'utf8');
 if(pem.length>8192)throw Error('Oversized public key');
 return {fingerprint:publicKeyInfo(pem).fingerprint,assurance:'PUBLIC_KEY_FINGERPRINT_ONLY_NOT_IDENTITY'};
}
async function ensure(root){await Promise.all([...ROLES,'revoked'].map(dir=>mkdir(join(root,dir),{recursive:true,mode:0o700})));}
async function fresh(path,data,mode){const handle=await open(path,'wx',mode);try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}}
async function withLock(root,fn){
 await ensure(root);
 const path=join(root,'policy.lock');let handle;
 try{handle=await open(path,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Trust policy lock exists. Inspect before manual recovery');throw e;}
 try{return await fn();}finally{await handle.close();await unlink(path);}
}
function reasonCheck(reason){
 if(typeof reason!=='string'||reason.length>240||!reason.trim()||/[\x00-\x1f\x7f]/.test(reason))throw Error('Reason must be one printable line, up to 240 characters');
 return reason.trim();
}
async function validatedPublic(root,role,hex){
 const path=store(root,role,hex);const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||st.size>8192)throw Error('Invalid trust key entry');
 const pem=await readFile(path,'utf8');
 if(publicKeyInfo(pem).fingerprint!=='sha256:'+hex)throw Error('Trust key fingerprint mismatch');
 return pem;
}
async function revocationInfo(root,hex){
 const path=revoked(root,hex);let st;
 try{st=await lstat(path)}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(!st.isFile()||st.isSymbolicLink()||st.size>8192)throw Error('Invalid revocation entry');
 const record=JSON.parse(await readFile(path,'utf8'));
 if(record?.schema!=='gitporch-revocation/v1'||record.fingerprint!=='sha256:'+hex||!ROLES.includes(record.role)||
   typeof record.reason!=='string'||!record.reason.trim()||typeof record.revokedAt!=='string')throw Error('Malformed revocation');
 const {checksum,...body}=record;
 if(typeof checksum!=='string'||checksum!==sha(body))throw Error('Revocation checksum mismatch');
 return record;
}
export async function enrollKey(root,role,path,confirmedFingerprint,confirmed){
 roleCheck(role);const hex=keyHex(confirmedFingerprint);
 if(confirmed!==true)throw Error('Explicit out-of-band fingerprint confirmation required');
 const pem=await readFile(path,'utf8');
 if(pem.length>8192)throw Error('Oversized public key');
 if(publicKeyInfo(pem).fingerprint!==confirmedFingerprint)throw Error('Provided fingerprint does not match public key');
 return withLock(root,async()=>{
  const all=await trustState(root);
  if(all.keys.some(k=>k.fingerprint===confirmedFingerprint))throw Error('Key already enrolled, including other roles');
  if(await revocationInfo(root,hex))throw Error('Revoked key cannot be re-enrolled');
  await fresh(store(root,role,hex),pem,0o600);
  return {role,fingerprint:confirmedFingerprint,status:'TRUSTED_BY_LOCAL_OPERATOR',assurance:'LOCAL_POLICY_ONLY_NO_INDEPENDENT_IDENTITY'};
 });
}
export async function revokeKey(root,role,fingerprint,reason,confirmed){
 roleCheck(role);const hex=keyHex(fingerprint);reason=reasonCheck(reason);
 if(confirmed!==true)throw Error('Explicit operator revocation confirmation required');
 return withLock(root,async()=>{
  const all=await trustState(root);
  const found=all.keys.find(k=>k.fingerprint===fingerprint&&k.role===role);
  if(!found)throw Error('Key not enrolled for this role');
  if(found.status==='REVOKED')throw Error('Key already revoked');
  const body={schema:'gitporch-revocation/v1',fingerprint,role,reason,revokedAt:new Date().toISOString()};
  await fresh(revoked(root,hex),JSON.stringify({...body,checksum:sha(body)},null,2)+'\n',0o600);
  return {role,fingerprint,status:'REVOKED_NOW_AND_FOR_ALL_LOCAL_VERIFICATIONS',assurance:'LOCAL_UNSIGNED_POLICY_NOT_ROLLBACK_PROOF'};
 });
}
export async function trustState(root){
 const keys=[];const enrolled=new Set();
 for(const role of ROLES){
  let entries;
  try{entries=await readdir(join(root,role),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(entries.length>200)throw Error('Too many enrolled trust keys');
  for(const entry of entries){
   if(!entry.isFile()||!/^([a-f0-9]{64})\.pem$/.test(entry.name))throw Error('Unexpected key directory entry');
   const hex=entry.name.slice(0,-4);
   if(enrolled.has(hex))throw Error('Same key enrolled in multiple roles');
   enrolled.add(hex);
   await validatedPublic(root,role,hex);
   keys.push({role,fingerprint:'sha256:'+hex,status:'TRUSTED'});
  }
 }
 let revocations;
 try{revocations=await readdir(join(root,'revoked'),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')revocations=[];else throw e;}
 if(revocations.length>400)throw Error('Too many revocations');
 for(const entry of revocations){
  if(!entry.isFile()||!/^([a-f0-9]{64})\.json$/.test(entry.name))throw Error('Unexpected revocation directory entry');
  const hex=entry.name.slice(0,-5);const record=await revocationInfo(root,hex);
  const match=keys.find(k=>k.fingerprint===record.fingerprint&&k.role===record.role);
  if(!match)throw Error('Orphan or role-mismatched revocation record');
  match.status='REVOKED';
 }
 keys.sort((a,b)=>a.role.localeCompare(b.role)||a.fingerprint.localeCompare(b.fingerprint));
 return {mode:'OFFLINE_LOCAL_OPERATOR_TRUST_POLICY',assurance:'UNSIGNED_LOCAL_ALLOWLIST_NO_ANTI_ROLLBACK',keys};
}
async function allowedKey(root,role,fingerprint){
 roleCheck(role);const hex=keyHex(fingerprint);
 // Validate the entire policy; fail closed on any corrupt trust or revocation.
 const state=await trustState(root);
 const matched=state.keys.find(x=>x.role===role&&x.fingerprint===fingerprint);
 if(!matched)throw Error('UNTRUSTED_'+role.toUpperCase()+'_KEY');
 if(matched.status==='REVOKED')throw Error('REVOKED_'+role.toUpperCase()+'_KEY');
 return validatedPublic(root,role,hex);
}
async function readJson(path){const s=await readFile(path,'utf8');if(s.length>16384)throw Error('Oversized signed report');return JSON.parse(s);}
export async function verifyWithPolicy(root,reportPath,witnessPath){
 const [report,witness]=await Promise.all([readJson(reportPath),readJson(witnessPath)]);
 const operatorFp=report?.body?.keyFingerprint,witnessFp=witness?.body?.witnessFingerprint;
 const [operatorPem,witnessPem]=await Promise.all([
  allowedKey(root,'operator',operatorFp),allowedKey(root,'witness',witnessFp)
 ]);
 const verified=verifyWitness(report,witness,operatorPem,witnessPem);
 return {...verified,policyAccepted:true,policyAssurance:'CURRENT_LOCAL_ALLOWLIST_WITH_REVOCATION_NOT_SIGNED_OR_ANTI_ROLLBACK'};
}
