#!/usr/bin/env node
import {getDataDir} from './git.mjs';
import {enqueue,workOnce,snapshot} from './sandbox-ci.mjs';
const HELP='The Porch Crew R1-B · opt-in isolated Node tests\n'
+'  node src/sandbox-cli.mjs enqueue <repo> <local-node-image-id-or-digest>\n'
+'  node src/sandbox-cli.mjs work-once --i-approve-container-tests\n'
+'  node src/sandbox-cli.mjs list\n'
+'Docker Engine and an already-loaded immutable Node image required.\n'
+'The worker runs node --test in a locked-down container, never on the host.\n';
async function main(){
 const [command,...args]=process.argv.slice(2);
 const d=getDataDir();
 let result;
 switch(command){
  case 'enqueue':if(args.length!==2)throw Error(HELP);result=await enqueue(d,...args);break;
  case 'list':if(args.length)throw Error(HELP);result=await snapshot(d);break;
  case 'work-once':if(args.length!==1||args[0]!=='--i-approve-container-tests')throw Error('Explicit operator approval required.\n'+HELP);result=await workOnce(d);break;
  default:console.log(HELP);return;
 }
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error('[Porch Crew Sandbox]',e.message);process.exitCode=1;});
