#!/usr/bin/env node
import {getDataDir} from './git.mjs';
import {artifactSnapshot,bundleSource} from './artifact-forge.mjs';
const HELP=`Artifact Forge R1-F1 · bounded, operator-approved SOURCE packaging
  npm run artifacts -- list
  npm run artifacts -- bundle <repo> <completed-docker-test-job-id> --i-approve-source-archive

Requires the selected repo HEAD to have a matching locally reported Docker test PASS
with execution metadata. Not a compiled build, independent attestation, or release.
The archive never publishes, deploys, pushes or executes repository scripts.
`;
async function main(){
 const [command,...args]=process.argv.slice(2),d=getDataDir();
 if(!command||command==='help'||command==='--help'){console.log(HELP);return;}
 let data;
 if(command==='list'&&args.length===0)data=await artifactSnapshot(d);
 else if(command==='bundle'&&args.length===3&&args[2]==='--i-approve-source-archive')
   data=await bundleSource(d,args[0],args[1],{approved:true});
 else throw Error(HELP);
 console.log(JSON.stringify(data,null,2));
}
main().catch(e=>{console.error('[Artifact Forge]',e.message);process.exitCode=1;});
