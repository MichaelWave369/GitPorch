// GitPorch R1-D2: offline Ed25519 integrity signatures for operator-reviewed local job receipts.
// A valid signature proves key possession and unchanged signed data, NOT trustworthy execution.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SCHEMA = 'gitporch-offline-evidence/v1';
const SHA = /^[0-9a-f]{40}$/;
const ID = /^\d{13}-[0-9a-f-]{36}$/;
const LANES = new Set(['git', 'tests']);
const STATUSES = new Set(['PASS','FAIL','ERROR','STALE','NO_TESTS','ABORTED_UNVERIFIED']);

export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  throw Error('Unsupported canonical evidence value');
}
function keyFingerprint(key) {
  const publicKey = key?.type === 'public' ? key : createPublicKey(key);
  if (publicKey.asymmetricKeyType !== 'ed25519') throw Error('Only Ed25519 keys are supported');
  const der = publicKey.export({ type:'spki', format:'der' });
  return 'sha256:' + createHash('sha256').update(der).digest('hex');
}
async function writeExclusive(path,text,mode) {
  const fd = await open(path,'wx',mode);
  try { await fd.writeFile(text); await fd.sync(); }
  finally { await fd.close(); }
}
export async function generateLocalSigner(dir) {
  await mkdir(dir,{ recursive:true, mode:0o700 });
  const {privateKey,publicKey} = generateKeyPairSync('ed25519');
  const priv = join(dir,'operator-private.pem');
  const pub = join(dir,'operator-public.pem');
  const privPem = privateKey.export({type:'pkcs8',format:'pem'});
  const pubPem = publicKey.export({type:'spki',format:'pem'});
  // No overwrites of existing private/public key files, even on repeated commands.
  await writeExclusive(priv,privPem,0o600);
  await writeExclusive(pub,pubPem,0o644);
  return {privateKeyFile:priv,publicKeyFile:pub,fingerprint:keyFingerprint(publicKey),privateKeyUnencrypted:true};
}
export function subjectFromJob(lane,job) {
  if (!LANES.has(lane) || !job || job.status!=='DONE' || !STATUSES.has(job.outcome)) throw Error('Only completed local jobs with a recorded outcome may be signed');
  if (!ID.test(job.id) || typeof job.repo!=='string' || !SHA.test(job.commit)) throw Error('Invalid job identity');
  const subject={lane,jobId:job.id,repo:job.repo,commit:job.commit,outcome:job.outcome,status:'DONE'};
  if(lane==='tests'){
    if(typeof job.image!=='string')throw Error('Missing test image identity');
    subject.image=job.image;
    subject.counts=job.counts??null;
    subject.executionEvidence=job.evidence??null;
  } else {
    subject.check='GIT_OBJECT_INTEGRITY';
    subject.durationMs=job.durationMs??null;
    subject.completedAt=job.completedAt??null;
  }
  return subject;
}
export function signSubject(subject,privateKeyPem,at=new Date().toISOString()) {
  const privateKey=createPrivateKey(privateKeyPem);
  if(privateKey.asymmetricKeyType!=='ed25519')throw Error('Only Ed25519 keys may sign');
  const body={schema:SCHEMA,algorithm:'Ed25519',keyFingerprint:keyFingerprint(privateKey),signedAt:at,
    claim:'OPERATOR_SIGNED_LOCAL_RECORD_NOT_INDEPENDENT_RUN_ATTESTATION',subject};
  const signature=sign(null,Buffer.from(canonical(body),'utf8'),privateKey).toString('base64');
  return {body,signature};
}
export async function signCompletedJob(dataDir,lane,id,privateKeyFile,output,loadSnapshot) {
  if(!LANES.has(lane)||!ID.test(id))throw Error('Invalid lane or job ID');
  const snap=await loadSnapshot(dataDir,lane);
  const job=snap.jobs.find(j=>j.id===id);
  if(!job)throw Error('Job not found');
  const subject=subjectFromJob(lane,job);
  const pem=await readFile(privateKeyFile,'utf8');
  const envelope=signSubject(subject,pem);
  await writeExclusive(output,JSON.stringify(envelope,null,2)+'\n',0o600);
  return {output,jobId:id,outcome:subject.outcome,keyFingerprint:envelope.body.keyFingerprint,
    assurance:'SIGNED_LOCAL_REPORT_NOT_INDEPENDENT_EXECUTION_PROOF'};
}
export function verifyEnvelope(envelope,trustedPublicKeyPem) {
  const key=createPublicKey(trustedPublicKeyPem);
  if(key.asymmetricKeyType!=='ed25519')throw Error('Trusted verifier key must be Ed25519');
  const trustedFingerprint=keyFingerprint(key);
  const body=envelope?.body;
  if(!body||body.schema!==SCHEMA||body.algorithm!=='Ed25519'||body.keyFingerprint!==trustedFingerprint||
     body.claim!=='OPERATOR_SIGNED_LOCAL_RECORD_NOT_INDEPENDENT_RUN_ATTESTATION'||
     typeof body.signedAt!=='string'||!Number.isFinite(Date.parse(body.signedAt))||
     typeof envelope.signature!=='string'||!/^[-A-Za-z0-9+/=]+$/.test(envelope.signature))
    throw Error('Envelope metadata or trusted public key mismatch');
  // Validate semantics before reporting a signature as accepted.
  const s=body.subject;
  if(!s || !LANES.has(s.lane) || !ID.test(s.jobId) || !SHA.test(s.commit) ||
     s.status!=='DONE' || !STATUSES.has(s.outcome) || typeof s.repo!=='string' || !s.repo.length)
    throw Error('Malformed attested job identity');
  if(s.lane==='git' && s.check!=='GIT_OBJECT_INTEGRITY')throw Error('Malformed Git check scope');
  if(s.lane==='tests' && typeof s.image!=='string')throw Error('Missing attested test image');
  const bytes=Buffer.from(envelope.signature,'base64');
  if(bytes.length!==64 || !verify(null,Buffer.from(canonical(body),'utf8'),key,bytes))throw Error('Ed25519 signature verification failed');
  return {signatureValid:true,trustedKeyFingerprint:trustedFingerprint,subject:s,
    assurance:'SIGNATURE_VALID_KEY_HOLDER_CLAIM_ONLY_NOT_EXECUTION_PROOF'};
}
export async function verifyFile(attestationPath, trustedPublicKeyPath) {
  const [json,pem]=await Promise.all([readFile(attestationPath,'utf8'),readFile(trustedPublicKeyPath,'utf8')]);
  if(json.length>16384)throw Error('Oversized signed evidence');
  return verifyEnvelope(JSON.parse(json),pem);
}
