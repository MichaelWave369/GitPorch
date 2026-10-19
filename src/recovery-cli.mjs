#!/usr/bin/env node
import {getDataDir} from './git.mjs';
import {doctor,abandonUncertain} from './recovery.mjs';
const help='The Porch Crew R1-D1 · local recovery\n'
 +'  node src/recovery-cli.mjs doctor\n'
 +'  node src/recovery-cli.mjs abandon <git|tests> <job-id> <one-line-reason> --i-confirm-no-worker-running\n'
 +'No automatic retries, Docker runs, lock removal or PASS promotion.\n';
async function main(){
 const [action,...args]=process.argv.slice(2);
 let result;
 if(action==='doctor'&&args.length===0)result=await doctor(getDataDir());
 else if(action==='abandon'&&args.length===4&&args[3]==='--i-confirm-no-worker-running')
   result=await abandonUncertain(getDataDir(),args[0],args[1],args[2],true);
 else throw Error(help);
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error('[Porch Crew Recovery]',e.message);process.exitCode=1;});
