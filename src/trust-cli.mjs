#!/usr/bin/env node
// Offline trust registry: policy changes require explicit, human-local actions.
import {join} from 'node:path';
import {getDataDir} from './git.mjs';
import {fingerprintFile,enrollKey,revokeKey,trustState,verifyWithPolicy} from './trust-policy.mjs';
const help=`The GitPorch R1-D4A · Offline trust and key revocation
  node src/trust-cli.mjs fingerprint <public.pem>
  node src/trust-cli.mjs enroll <operator|witness> <public.pem> <exact-fingerprint> --i-verified-fingerprint-out-of-band
  node src/trust-cli.mjs revoke <operator|witness> <fingerprint> <reason> --i-confirm-revocation
  node src/trust-cli.mjs list
  node src/trust-cli.mjs verify <operator-report.json> <witness-report.json>
Requires explicit local key enrollment; revoked keys are never accepted.
The registry is UNSIGNED and has no rollback protection; signatures do not prove test execution.`;
async function main(){
 const [command,...args]=process.argv.slice(2);
 const root=join(getDataDir(),'trust');let result;
 switch(command){
  case 'fingerprint':if(args.length!==1)throw Error(help);result=await fingerprintFile(args[0]);break;
  case 'enroll':if(args.length!==4||args[3]!=='--i-verified-fingerprint-out-of-band')throw Error(help);result=await enrollKey(root,args[0],args[1],args[2],true);break;
  case 'revoke':if(args.length!==4||args[3]!=='--i-confirm-revocation')throw Error(help);result=await revokeKey(root,args[0],args[1],args[2],true);break;
  case 'list':if(args.length)throw Error(help);result=await trustState(root);break;
  case 'verify':if(args.length!==2)throw Error(help);result=await verifyWithPolicy(root,args[0],args[1]);break;
  default:console.log(help);return;
 }
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error('[GitPorch Trust]',e.message);process.exitCode=1;});
