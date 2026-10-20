// Opt-in encrypted signer; decrypted key remains in process memory, never written to disk.
import {open,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {unlockEncryptedKeyFile} from './key-vault.mjs';
import {subjectFromJob,signSubject} from './evidence-signatures.mjs';
const ID=/^\d{13}-[0-9a-f-]{36}$/;
export async function signWithEncryptedKey(dataDir,lane,id,keyFile,passphrase,loadSnapshot){
 if(!['git','tests'].includes(lane)||typeof id!=='string'||!ID.test(id))throw Error('Invalid lane or job ID');
 const snapshot=await loadSnapshot(dataDir,lane);
 const job=snapshot.jobs.find(record=>record.id===id);
 if(!job)throw Error('Completed job not found');
 const subject=subjectFromJob(lane,job); // refuses queued, unfinished and unsigned outcomes
 const pem=await unlockEncryptedKeyFile(keyFile,passphrase);
 const envelope=signSubject(subject,pem);
 const outputDir=join(dataDir,'signed-reports');
 await mkdir(outputDir,{recursive:true,mode:0o700});
 const output=join(outputDir,lane+'-'+id+'-encrypted-signer.json');
 const handle=await open(output,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(envelope,null,2)+'\n');await handle.sync();}
 finally{await handle.close();}
 return {output,jobId:id,outcome:job.outcome,fingerprint:envelope.body.keyFingerprint,
  assurance:'LOCALLY_SIGNED_USING_PASSPHRASE_ENCRYPTED_KEY_NOT_INDEPENDENT_RUN_PROOF'};
}
