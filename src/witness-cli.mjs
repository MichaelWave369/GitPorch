#!/usr/bin/env node
// Standalone offline witness workflow: does not import or execute a worker.
import {generateWitnessKeys,signWitnessFile,verifyWitnessFiles} from './witness-evidence.mjs';

const help=[
 'The GitPorch R1-D3 independent-key witness (OFFLINE)',
 '  node src/witness-cli.mjs keygen <witness-key-directory> --i-accept-unencrypted-witness-key',
 '  node src/witness-cli.mjs sign <operator-report.json> <trusted-operator-public.pem> <witness-private.pem> <witness-output.json> --i-confirm-signature-only',
 '  node src/witness-cli.mjs verify <operator-report.json> <witness-report.json> <trusted-operator-public.pem> <trusted-witness-public.pem>',
 'Witnessing verifies a signature, NOT that tests actually ran.',
 'For independent custody, use a separate trusted computer and separate signing key.'
].join('\n');

async function main(){
 const [command,...args]=process.argv.slice(2);
 let result;
 if(command==='keygen'&&args.length===2&&args[1]==='--i-accept-unencrypted-witness-key')
  result=await generateWitnessKeys(args[0]);
 else if(command==='sign'&&args.length===5&&args[4]==='--i-confirm-signature-only')
  result=await signWitnessFile(...args.slice(0,4));
 else if(command==='verify'&&args.length===4)
  result=await verifyWitnessFiles(...args);
 else throw Error(help);
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error('[GitPorch Witness]',e.message);process.exitCode=1;});
