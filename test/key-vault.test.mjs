import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {makeEncryptedKey,unlockEncryptedKey,writeNewEncryptedKey,unlockEncryptedKeyFile,readVaultPublicInfo} from '../src/key-vault.mjs';
const PASS='a long and memorable passphrase with 🍋';
async function workspace(callback){const d=await mkdtemp(join(tmpdir(),'gp-vault-'));try{await callback(d)}finally{await rm(d,{recursive:true,force:true})}}
test('encrypted key can sign and verify with its advertised Ed25519 public key',async()=>{
 const data=await makeEncryptedKey(PASS);assert.equal(data.schema,'gitporch-encrypted-ed25519/v1');
 const pem=await unlockEncryptedKey(data,PASS);
 const privateKey=createPrivateKey(pem),pub=createPublicKey(data.publicKeyPem);
 const msg=Buffer.from('signed local report');const sig=sign(null,msg,privateKey);
 assert.equal(verify(null,msg,pub,sig),true);
 assert.equal(verify(null,Buffer.from('tamper'),pub,sig),false);
 assert.equal(JSON.stringify(data).includes('PRIVATE KEY'),false);
});
test('wrong password, tampered ciphertext, metadata and tag are denied',async()=>{
 const data=await makeEncryptedKey(PASS);
 await assert.rejects(unlockEncryptedKey(data,'wrong-but-sufficient-passphrase'),/Wrong passphrase/);
 await assert.rejects(unlockEncryptedKey({...data,tag:Buffer.alloc(16).toString('base64')},PASS),/modified/);
 await assert.rejects(unlockEncryptedKey({...data,ciphertext:Buffer.alloc(12).toString('base64')},PASS),/modified/);
 await assert.rejects(unlockEncryptedKey({...data,fingerprint:'sha256:'+'a'.repeat(64)},PASS),/Invalid encrypted key vault metadata/);
 await assert.rejects(unlockEncryptedKey({...data,kdf:{...data.kdf,N:16777216}},PASS),/Invalid encrypted key vault metadata/);
});
test('exclusive output, no plaintext private key on disk, public metadata readable without passphrase',()=>workspace(async dir=>{
 const file=join(dir,'data','signer','operator-encrypted.json');
 const generated=await writeNewEncryptedKey(file,PASS);
 const bytes=await readFile(file,'utf8');assert.doesNotMatch(bytes,/BEGIN PRIVATE KEY/);
 const pub=await readVaultPublicInfo(file);assert.equal(pub.fingerprint,generated.fingerprint);
 await unlockEncryptedKeyFile(file,PASS);
 await assert.rejects(writeNewEncryptedKey(file,PASS),/EEXIST/);
 await writeFile(file,'not json');await assert.rejects(unlockEncryptedKeyFile(file,PASS));
}));
test('short passwords and invalid vaults never open',async()=>{
 await assert.rejects(makeEncryptedKey('short'),/Passphrase/);
 await assert.rejects(makeEncryptedKey('x'.repeat(1030)),/Passphrase/);
 await assert.rejects(unlockEncryptedKey({schema:'wrong'},PASS));
});
