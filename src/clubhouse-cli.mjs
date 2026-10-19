#!/usr/bin/env node
import { getDataDir } from './git.mjs';
import { register,propose,recordDecision,summary } from './clubhouse.mjs';
const [cmd,...args]=process.argv.slice(2);
const help='GitPorch Clubhouse (LOCAL CLI ONLY)\n'
+'  node src/clubhouse-cli.mjs register <id> <builder|tester|reviewer|researcher> <display name>\n'
+'  node src/clubhouse-cli.mjs propose <id> <local-repo> <full-commit-sha> <summary>\n'
+'  node src/clubhouse-cli.mjs decide <proposal-id> <ACCEPTED|DECLINED> <note> --confirm-local-review\n'
+'  node src/clubhouse-cli.mjs list\n\n'
+'This is a local record, not authenticated bot identity, CI certification, or a merge.\n';
async function run(){
 const dataDir=getDataDir();
 let result;
 switch(cmd){
  case 'register': if(args.length!==3)throw Error(help);result=await register(dataDir,...args);break;
  case 'propose': if(args.length!==4)throw Error(help);result=await propose(dataDir,...args);break;
  case 'decide': if(args.length!==4 || args[3]!=='--confirm-local-review')throw Error(help);result=await recordDecision(dataDir,args[0],args[1],args[2],true);break;
  case 'list': if(args.length)throw Error(help);result=await summary(dataDir);break;
  default:console.log(help);return;
 }
 console.log(JSON.stringify(result,null,2));
}
run().catch(e=>{console.error('[GitPorch Clubhouse]',e.message);process.exitCode=1});
