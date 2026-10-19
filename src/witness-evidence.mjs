// R1-D3 offline second-key witness.
// A witness confirms the operator report signature and hashes that report.
// This never asserts the underlying job ran honestly or independently.
import {createHash,createPrivateKey,createPublicKey,generateKeyPairSync,sign,verify} from 'node:crypto';
import {mkdir,open,readFile} from 'node:fs/promises';
import {join,dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,verifyEnvelope} from './evidence-signatures.mjs';

export const WITNESS_SCHEMA='gitporch-offline-witness/v1';
const DIGEST=/^[0-9a-f]{64}$/;
const FINGERPRINT=/^sha256:[0-9a-f]{64}$/;
const CLAIM='OPERATOR_SIGNATURE_CHECKED_REPORT_BOUND_NOT_RUN_ATTESTATION';
const MAX_JSON=16384;
function fingerprint(key){
 const pub=key.type==='public'?key:createPublicKey(key);
 if(pub.asymmetricKeyType!=='ed25519')throw Error('Witness keys must be Ed25519');
 return 'sha256:'+createHash('sha256').update(pub.export({type:'spki',format:'der'})).digest('hex');
}
function reportHash(report){
 // Bind the entire operator report, including the original operator signature.
 return createHash('sha256').update(canonical(report),'utf8').digest('hex');
}
// Never generate keys in the repository's tracked tree or GitHub Pages.
const sourceRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
function inside(root,path){
 const rel=relative(root,path);
 return rel===''||(!rel.startsWith('..'+requireSeparator())&&rel!=='..'&&!isAbsolute(rel));
}
function requireSeparator(){return process.platform==='win32'?'\\':'/';}
function keyDirectoryAllowed(directory){
 const target=resolve(directory);
 if(inside(sourceRoot,target)&&!inside(join(sourceRoot,'data'),target))
  throw Error('Private witness keys must be outside tracked source (or under Git-ignored data/)');
 return target;
}
async function fresh(path,value,mode=0o600){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const fd=await open(path,'wx',mode);
 try{await fd.writeFile(value);await fd.sync();}finally{await fd.close();}
}
export async function generateWitnessKeys(dir){
 dir=keyDirectoryAllowed(dir);
 await mkdir(dir,{recursive:true,mode:0o700});
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const privatePath=join(dir,'witness-private.pem');
 const publicPath=join(dir,'witness-public.pem');
 // Exclusive creation prevents replacing existing signing keys.
 await fresh(privatePath,privateKey.export({type:'pkcs8',format:'pem'}),0o600);
 await fresh(publicPath,publicKey.export({type:'spki',format:'pem'}),0o644);
 return {privatePath,publicPath,fingerprint:fingerprint(publicKey),privateKeyUnencrypted:true};
}
export function witnessReport(report,operatorPublicPem,witnessPrivatePem,at=new Date().toISOString()){
 const inspected=verifyEnvelope(report,operatorPublicPem);
 const privateKey=createPrivateKey(witnessPrivatePem);
 if(privateKey.asymmetricKeyType!=='ed25519')throw Error('Witness signing key must be Ed25519');
 const witnessId=fingerprint(privateKey);
 if(witnessId===inspected.trustedKeyFingerprint)throw Error('Witness and operator cannot use the same signing key');
 if(!Number.isFinite(Date.parse(at)))throw Error('Invalid witness time');
 const body={
  schema:WITNESS_SCHEMA,algorithm:'Ed25519',witnessFingerprint:witnessId,
  operatorFingerprint:inspected.trustedKeyFingerprint,operatorReportSha256:reportHash(report),
  observedOutcome:inspected.subject.outcome,observedJobId:inspected.subject.jobId,
  witnessedAt:at,claim:CLAIM
 };
 return {body,signature:sign(null,Buffer.from(canonical(body),'utf8'),privateKey).toString('base64')};
}
export function verifyWitness(report,witness,operatorPublicPem,witnessPublicPem){
 const operator=verifyEnvelope(report,operatorPublicPem);
 const trustedWitness=createPublicKey(witnessPublicPem);
 if(trustedWitness.asymmetricKeyType!=='ed25519')throw Error('Trusted witness key must be Ed25519');
 const trustedId=fingerprint(trustedWitness);
 if(trustedId===operator.trustedKeyFingerprint)throw Error('Operator and witness trust anchors must be distinct');
 const body=witness?.body;
 if(!body||body.schema!==WITNESS_SCHEMA||body.algorithm!=='Ed25519'||
    body.claim!==CLAIM||body.witnessFingerprint!==trustedId||
    body.operatorFingerprint!==operator.trustedKeyFingerprint||
    !DIGEST.test(body.operatorReportSha256)||body.operatorReportSha256!==reportHash(report)||
    !FINGERPRINT.test(body.witnessFingerprint)||body.observedOutcome!==operator.subject.outcome||
    body.observedJobId!==operator.subject.jobId||
    typeof body.witnessedAt!=='string'||!Number.isFinite(Date.parse(body.witnessedAt))||
    typeof witness.signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(witness.signature))
  throw Error('Witness report mismatch or missing trusted key');
 const signature=Buffer.from(witness.signature,'base64');
 if(signature.length!==64||!verify(null,Buffer.from(canonical(body),'utf8'),trustedWitness,signature))
  throw Error('Witness signature verification failed');
 return {
  operatorSignatureValid:true,witnessSignatureValid:true,
  operatorKeyFingerprint:operator.trustedKeyFingerprint,witnessKeyFingerprint:trustedId,
  reportSha256:body.operatorReportSha256,outcome:operator.subject.outcome,
  jobId:operator.subject.jobId,
  assurance:'TWO_DISTINCT_KEY_SIGNATURES_NOT_INDEPENDENT_EXECUTION_PROOF'
 };
}
async function loadJson(path){
 const src=await readFile(path,'utf8');
 if(src.length>MAX_JSON)throw Error('Signed report too large');
 return JSON.parse(src);
}
export async function signWitnessFile(reportPath,operatorPublicPath,witnessPrivatePath,outputPath){
 const [report,operatorPublic,witnessPrivate]=await Promise.all([
  loadJson(reportPath),readFile(operatorPublicPath,'utf8'),readFile(witnessPrivatePath,'utf8')
 ]);
 const envelope=witnessReport(report,operatorPublic,witnessPrivate);
 await fresh(outputPath,JSON.stringify(envelope,null,2)+'\n',0o600);
 return {outputPath,witnessFingerprint:envelope.body.witnessFingerprint,
   observedOutcome:envelope.body.observedOutcome,assurance:'OFFLINE_COUNTERSIGNATURE_ONLY'};
}
export async function verifyWitnessFiles(reportPath,witnessPath,operatorPublicPath,witnessPublicPath){
 const [report,witness,operatorPublic,witnessPublic]=await Promise.all([
  loadJson(reportPath),loadJson(witnessPath),readFile(operatorPublicPath,'utf8'),readFile(witnessPublicPath,'utf8')
 ]);
 return verifyWitness(report,witness,operatorPublic,witnessPublic);
}
