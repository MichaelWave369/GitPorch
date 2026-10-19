// R1-C local runner evidence parsing. No claims of signed or independent attestation.
import {createHash} from 'node:crypto';
const SHA256=/^sha256:[0-9a-f]{64}$/;
const SHAHEX=/^[a-f0-9]{64}$/;
export const sha256Text=text=>createHash('sha256').update(String(text??''),'utf8').digest('hex');

export function verifyImageIdentity(requested,inspectionText){
  let info;
  try{info=JSON.parse(String(inspectionText||''));}catch{throw Error('Docker image inspection did not return JSON');}
  if(!info||typeof info!=='object'||typeof info.Id!=='string'||!SHA256.test(info.Id))throw Error('Missing inspected Docker image ID');
  if(typeof requested!=='string')throw Error('Missing requested image identity');
  const digests=Array.isArray(info.RepoDigests)?info.RepoDigests.filter(s=>typeof s==='string'):[];
  const matched=SHA256.test(requested)?info.Id===requested:
    /^node:22-alpine@sha256:[0-9a-f]{64}$/.test(requested)&&digests.includes(requested);
  if(!matched)throw Error('Docker image identity differs from queued immutable reference');
  return {id:info.Id,requested};
}

export function parseTap(stdout,exitCode){
  const text=String(stdout??'');
  const summary=['tests','pass','fail','cancelled','skipped','todo'];
  const counts={};
  if(!/^TAP version 13\r?$/m.test(text)||!/^1\.\.\d+\r?$/m.test(text))return {outcome:'ERROR',counts:null};
  for(const label of summary){
    const found=[...text.matchAll(new RegExp('^# '+label+' (\\d+)\\r?$','gm'))];
    if(found.length>1)return {outcome:'ERROR',counts:null};
    if(found.length===0){
      if(label==='cancelled'||label==='todo')counts[label]=0;
      else return {outcome:'ERROR',counts:null};
    }else counts[label]=Number(found[0][1]);
  }
  if(Object.values(counts).some(n=>!Number.isSafeInteger(n)||n<0))return {outcome:'ERROR',counts:null};
  if(counts.tests<counts.pass+counts.fail+counts.cancelled+counts.skipped+counts.todo) return {outcome:'ERROR',counts:null};
  if(!Number.isInteger(exitCode)||exitCode<0)return {outcome:'ERROR',counts};
  if(exitCode!==0)return {outcome:counts.fail>0?'FAIL':'ERROR',counts};
  if(counts.fail!==0||counts.cancelled!==0)return {outcome:'ERROR',counts};
  if(counts.pass===0)return {outcome:'NO_TESTS',counts};
  return {outcome:'PASS',counts};
}

export function executionEvidence(run,verifiedImage){
  if(!verifiedImage||!SHA256.test(verifiedImage.id))throw Error('Unverified image identity');
  const exitCode=run?.exitCode;
  if(!Number.isSafeInteger(exitCode)||exitCode<0)return null;
  return {
    schema:'gitporch-container-evidence/0.1',
    observedImageId:verifiedImage.id,
    stdoutSha256:sha256Text(run.stdout),
    stderrSha256:sha256Text(run.stderr),
    dockerCliExitCode:exitCode,
    scope:'LOCAL_DOCKER_OUTPUT_HASHES_NOT_SIGNED',
  };
}
export function evidenceShapeValid(value){
  return value&&value.schema==='gitporch-container-evidence/0.1'
    &&SHA256.test(value.observedImageId)
    &&SHAHEX.test(value.stdoutSha256)&&SHAHEX.test(value.stderrSha256)
    &&Number.isSafeInteger(value.dockerCliExitCode)&&value.dockerCliExitCode>=0
    &&value.scope==='LOCAL_DOCKER_OUTPUT_HASHES_NOT_SIGNED';
}
