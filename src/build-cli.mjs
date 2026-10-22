#!/usr/bin/env node
import {getDataDir} from './git.mjs';
import {buildStaticPage,buildSnapshot} from './isolated-build.mjs';
const USAGE=`GitPorch R1-F2: opt-in isolated static web build
  npm run builds -- list
  npm run builds -- static-web <verified-source-artifact-id> --i-approve-isolated-build

Builds a one-file HTML output from docs/index.html, docs/styles.css and docs/app.js
inside restricted, network-disabled Docker, using the source artifact's pinned image.
Trusted local source only. No arbitrary scripts, online installs, or publishing.
`;
async function main(){
 const [cmd,...args]=process.argv.slice(2),d=getDataDir();
 if(!cmd||cmd==='help'||cmd==='--help'){console.log(USAGE);return;}
 let response;
 if(cmd==='list'&&args.length===0)response=await buildSnapshot(d);
 else if(cmd==='static-web'&&args.length===2&&args[1]==='--i-approve-isolated-build')
   response=await buildStaticPage(d,args[0],{approved:true});
 else throw Error(USAGE);
 console.log(JSON.stringify(response,null,2));
}
main().catch(e=>{console.error('[GitPorch build]',e.message);process.exitCode=1;});
