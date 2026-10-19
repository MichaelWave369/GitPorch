#!/usr/bin/env node
// R1-D2: human-triggered local signing; offline verification with a trusted public key.
import {join} from 'node:path';
import {getDataDir} from './git.mjs';
import {queueSnapshot} from './porch-crew.mjs';
import {snapshot as testSnapshot} from './sandbox-ci.mjs';
import {generateLocalSigner,signCompletedJob,verifyFile} from './evidence-signatures.mjs';

const help=[
 'GitPorch R1-D2: Ed25519 signed LOCAL result reports',
 '  node src/evidence-cli.mjs keygen --i-accept-unencrypted-private-key',
 '  node src/evidence-cli.mjs sign <git|tests> <job-id> <output.json> --i-attest-local-result',
 '  node src/evidence-cli.mjs verify <report.json> <trusted-public.pem>',
 '',
 'Verification is OFFLINE. Use a trusted public key delivered independently.',
 'A valid signature is NOT proof the original test was truthful or independent.',
].join('\n');
async function loadSnapshot(d,lane) {
 if(lane==='git')return queueSnapshot(d);
 if(lane==='tests')return testSnapshot(d);
 throw Error('Lane must be git or tests');
}
async function main(){
 const [command,...args]=process.argv.slice(2);
 const directory=join(getDataDir(),'signer');
 let result;
 switch(command){
  case 'keygen':
   if(args.length!==1||args[0]!=='--i-accept-unencrypted-private-key')throw Error(help);
   result=await generateLocalSigner(directory);break;
  case 'sign':
   if(args.length!==4||args[3]!=='--i-attest-local-result')throw Error(help);
   result=await signCompletedJob(getDataDir(),args[0],args[1],join(directory,'operator-private.pem'),args[2],loadSnapshot);break;
  case 'verify':
   if(args.length!==2)throw Error(help);
   result=await verifyFile(args[0],args[1]);break;
  default:console.log(help);return;
 }
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error('[GitPorch Signed Evidence]',e.message);process.exitCode=1;});
