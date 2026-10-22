#!/usr/bin/env node
// Operator-only facade around the existing Porch Crew workers. No new execution engine.
import {getDataDir} from './git.mjs';
import {phirunnersSnapshot} from './phirunners.mjs';
import {enqueueCheck,workOnce as workGit} from './porch-crew.mjs';
import {enqueue as enqueueTests,workOnce as workTests,preflightImage} from './sandbox-ci.mjs';

const USAGE=`PhiRunners R1-E · local operator command hub
  node src/phirunners-cli.mjs status
  node src/phirunners-cli.mjs enqueue-git <repo>
  node src/phirunners-cli.mjs work-git-once
  node src/phirunners-cli.mjs preflight-image <pinned-node-image-id>
  node src/phirunners-cli.mjs enqueue-tests <repo> <pinned-node-image-id>
  node src/phirunners-cli.mjs work-tests-once --i-approve-container-tests

Only trusted local repositories. One job per explicit work command.
No auto-merges, GitHub triggers, remote network listeners, or host code execution.
`;
async function main(){
  const [command,...args]=process.argv.slice(2),dataDir=getDataDir();
  if(!command||command==='help'||command==='--help'){console.log(USAGE);return;}
  let result;
  switch(command){
    case 'status':
      if(args.length)throw Error(USAGE);
      result=await phirunnersSnapshot(dataDir);
      if(result.health!=='LOCAL_RECEIPTS_CHECKED_NOT_ATTESTED')process.exitCode=2;
      break;
    case 'enqueue-git':
      if(args.length!==1)throw Error(USAGE);
      result=await enqueueCheck(dataDir,args[0]);break;
    case 'work-git-once':
      if(args.length)throw Error(USAGE);
      result=await workGit(dataDir);break;
    case 'preflight-image':
      if(args.length!==1)throw Error(USAGE);
      result=await preflightImage(args[0]);break;
    case 'enqueue-tests':
      if(args.length!==2)throw Error(USAGE);
      result=await enqueueTests(dataDir,...args);break;
    case 'work-tests-once':
      if(args.length!==1||args[0]!=='--i-approve-container-tests')
        throw Error('Explicit container-test approval required.\n'+USAGE);
      result=await workTests(dataDir);break;
    default:throw Error('Unknown PhiRunners command.\n'+USAGE);
  }
  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error('[PhiRunners]',e.message);process.exitCode=1;});
