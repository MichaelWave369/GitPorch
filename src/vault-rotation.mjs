// R1-D4B2A: nondestructive passphrase rewrap, not cryptographic key identity rotation.
// The old encrypted key is NEVER overwritten, deleted, moved, or revoked.
import {open,mkdir,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {encryptPrivateKeyPem,unlockEncryptedKeyFile,unlockEncryptedKey,readVaultPublicInfo} from './key-vault.mjs';

export async function rewrapVault(originalPath,nextPath,oldPassphrase,newPassphrase){
 if(resolve(originalPath)===resolve(nextPath))throw Error('Old and next vault paths must differ');
 if(oldPassphrase===newPassphrase)throw Error('New vault passphrase must differ from old passphrase');
 const oldInfo=await readVaultPublicInfo(originalPath);
 // Wrong old passphrase, invalid vault, or tampering must fail before any output is written.
 const pem=await unlockEncryptedKeyFile(originalPath,oldPassphrase);
 const next=await encryptPrivateKeyPem(pem,newPassphrase);
 if(next.fingerprint!==oldInfo.fingerprint)throw Error('Rewrap changed the signing identity');
 // Verify ciphertext/tag in memory, and prove both private keys sign under the same public identity.
 const unlocked=await unlockEncryptedKey(next,newPassphrase);
 const message=Buffer.from('GitPorch R1-D4B2A key-continuity self-check','utf8');
 if(!verify(null,message,createPublicKey(next.publicKeyPem),sign(null,message,createPrivateKey(unlocked))))
  throw Error('New key vault did not pass continuity self-check');
 await mkdir(dirname(nextPath),{recursive:true,mode:0o700});
 const fd=await open(nextPath,'wx',0o600);
 try{await fd.writeFile(JSON.stringify(next,null,2)+'\n');await fd.sync();}
 finally{await fd.close();}
 return {nextPath,oldPathPreserved:true,signingKeyFingerprint:next.fingerprint,
   state:'STAGED_NEW_ENCRYPTED_COPY_NOT_AUTO_ACTIVATED',
   assurance:'PASSPHRASE_REWRAP_SAME_SIGNING_IDENTITY_NOT_KEY_ROTATION'};
}
export async function checkRewrappedVault(originalPath,nextPath,nextPassphrase){
 const oldInfo=await readVaultPublicInfo(originalPath);
 const nextInfo=await readVaultPublicInfo(nextPath);
 if(nextInfo.fingerprint!==oldInfo.fingerprint)throw Error('Next vault has a different signing identity');
 const pem=await unlockEncryptedKeyFile(nextPath,nextPassphrase);
 const publicKey=createPublicKey(createPrivateKey(pem));
 const proof=Buffer.from('GitPorch R1-D4B2A staged-vault verification','utf8');
 if(!verify(null,proof,publicKey,sign(null,proof,createPrivateKey(pem))))
  throw Error('Staged vault signature check failed');
 return {ready:true,fingerprint:nextInfo.fingerprint,oldPathPreserved:true,
   assurance:'SAME_KEY_DIFFERENT_ENCRYPTED_VAULT_NO_AUTOMATIC_SWITCH'};
}
