#!/usr/bin/env node
import {getDataDir} from './git.mjs';
import {enqueueCheck,workOnce,queueSnapshot} from './porch-crew.mjs';
const usage=`The Porch Crew R1-A · local Git integrity jobs only
  node src/porch-crew-cli.mjs enqueue <repo>
  node src/porch-crew-cli.mjs work-once
  node src/porch-crew-cli.mjs list
No build scripts, automatic merges or remote job submission.
`;
async function main(){
 const [cmd,...rest]=process.argv.slice(2),dir=getDataDir();let result;
 switch(cmd){
  case 'enqueue':if(rest.length!==1)throw Error(usage);result=await enqueueCheck(dir,rest[0]);break;
  case 'work-once':if(rest.length)throw Error(usage);result=await workOnce(dir);break;
  case 'list':if(rest.length)throw Error(usage);result=await queueSnapshot(dir);break;
  default:console.log(usage);return;
 }
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error('[The Porch Crew]',e.message);process.exitCode=1;});
