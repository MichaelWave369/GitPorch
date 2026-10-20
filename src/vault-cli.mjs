#!/usr/bin/env node
// Interactive only: no password in shell arguments or environment variables.
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {join} from 'node:path';
import {open} from 'node:fs/promises';
import {getDataDir} from './git.mjs';
import {queueSnapshot} from './porch-crew.mjs';
import {snapshot as testSnapshot} from './sandbox-ci.mjs';
import {writeNewEncryptedKey,readVaultPublicInfo} from './key-vault.mjs';
import {rewrapVault,checkRewrappedVault} from './vault-rotation.mjs';
import {signWithEncryptedKey} from './encrypted-signing.mjs';
const HELP='GitPorch encrypted operator key (opt-in, interactive terminal required)\n'
 +'  node src/vault-cli.mjs keygen --i-accept-password-vault\n'
 +'  node src/vault-cli.mjs public\n'
 +'  node src/vault-cli.mjs sign <git|tests> <completed-job-id> --i-confirm-local-signing\n'
 +'  node src/vault-cli.mjs rewrap --i-confirm-new-encrypted-copy\n'
 +'  node src/vault-cli.mjs verify-next\n'
 +'  node src/vault-cli.mjs sign-next <git|tests> <completed-job-id> --i-confirm-local-signing\n'
 +'Rewrap changes the passphrase, NOT the signing key. Old vault is never overwritten, deleted or revoked.\n';
const dataDir=getDataDir();
const vaultPath=join(dataDir,'signer','operator-encrypted.json');
const nextVaultPath=join(dataDir,'signer','operator-encrypted-next.json');
async function promptSecret(label){
 if(!process.stdin.isTTY||!process.stderr.isTTY)throw Error('A real interactive terminal is required; passwords are never accepted on command lines or from environment variables');
 const muted=new Writable({write(chunk,enc,cb){cb();}});
 const rl=createInterface({input:process.stdin,output:muted,terminal:true});
 process.stderr.write(label);
 try{
  return await new Promise((resolve,reject)=>{
   let completed=false;
   rl.question('',answer=>{completed=true;resolve(answer)});
   rl.on('SIGINT',()=>{if(!completed)reject(Error('Cancelled'))});
   rl.on('close',()=>{if(!completed)reject(Error('Input closed'))});
  });
 }finally{rl.close();process.stderr.write('\n');}
}
async function loadSnapshot(root,lane){
 if(lane==='git')return queueSnapshot(root);
 if(lane==='tests')return testSnapshot(root);
 throw Error('Invalid lane');
}
async function main(){
 const [cmd,...args]=process.argv.slice(2);let result;
 switch(cmd){
  case 'keygen':{
   if(args.length!==1||args[0]!=='--i-accept-password-vault')throw Error(HELP);
   const p=await promptSecret('New vault passphrase (not echoed): ');
   const confirm=await promptSecret('Confirm passphrase (not echoed): ');
   if(p!==confirm)throw Error('Passphrases did not match');
   result=await writeNewEncryptedKey(vaultPath,p);delete result.publicKeyPem;
   break;
  }
  case 'public':{
   if(args.length)throw Error(HELP);
   const info=await readVaultPublicInfo(vaultPath);
   const publicPath=join(dataDir,'signer','operator-encrypted-public.pem');
   const file=await open(publicPath,'wx',0o644);
   try{await file.writeFile(info.publicKeyPem);await file.sync();}finally{await file.close();}
   result={publicPath,fingerprint:info.fingerprint,assurance:info.assurance};
   break;
  }
  case 'rewrap':{
   if(args.length!==1||args[0]!=='--i-confirm-new-encrypted-copy')throw Error(HELP);
   const prior=await promptSecret('Existing encrypted vault passphrase (not echoed): ');
   const next=await promptSecret('New passphrase for staged vault (not echoed): ');
   const confirmation=await promptSecret('Confirm new staged-vault passphrase (not echoed): ');
   if(next!==confirmation)throw Error('New passphrases did not match');
   result=await rewrapVault(vaultPath,nextVaultPath,prior,next);
   break;
  }
  case 'verify-next':{
   if(args.length!==0)throw Error(HELP);
   const next=await promptSecret('Staged-vault passphrase (not echoed): ');
   result=await checkRewrappedVault(vaultPath,nextVaultPath,next);
   break;
  }
  case 'sign':
  case 'sign-next':{
   if(args.length!==3||args[2]!=='--i-confirm-local-signing')throw Error(HELP);
   const passphrase=await promptSecret('Vault passphrase (not echoed): ');
   if(cmd==='sign-next')await checkRewrappedVault(vaultPath,nextVaultPath,passphrase);
   result=await signWithEncryptedKey(dataDir,args[0],args[1],cmd==='sign-next'?nextVaultPath:vaultPath,passphrase,loadSnapshot);
   break;
  }
  default:console.log(HELP);return;
 }
 console.log(JSON.stringify(result,null,2));
}
main().catch(err=>{console.error('[GitPorch Vault]',err.message);process.exitCode=1;});
