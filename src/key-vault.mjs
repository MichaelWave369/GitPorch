// R1-D4B1: optional local encrypted Ed25519 private-key custody.
// No plaintext PEM ever written during creation or signing.
import {createCipheriv,createDecipheriv,createPrivateKey,createPublicKey,generateKeyPairSync,randomBytes,scrypt,createHash} from 'node:crypto';
import {open,readFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
const SCHEMA='gitporch-encrypted-ed25519/v1';
const KDF={name:'scrypt',N:32768,r:8,p:1,keyBytes:32};
const CIPHER='aes-256-gcm';
const AD=Buffer.from('GitPorch encrypted private key v1','utf8');
const MAX_VAULT=8192;
const HEX=/^sha256:[a-f0-9]{64}$/;
const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
function validatePassword(pass){
 if(typeof pass!=='string'||pass.length<12||Buffer.byteLength(pass,'utf8')>1024||pass.includes('\0')) throw Error('Passphrase must be 12-1024 UTF-8 bytes, with no NUL');
 return pass;
}
function b64(value,bytes,label){
 if(typeof value!=='string'||!BASE64.test(value))throw Error('Invalid '+label);
 const result=Buffer.from(value,'base64');
 if((bytes!==null&&result.length!==bytes)||result.toString('base64')!==value)throw Error('Invalid '+label);
 return result;
}
function publicFingerprint(publicPem){
 const pub=publicPem?.type==='public' ? publicPem : createPublicKey(publicPem);
 if(pub.asymmetricKeyType!=='ed25519')throw Error('Only Ed25519 public keys allowed');
 return 'sha256:'+createHash('sha256').update(pub.export({type:'spki',format:'der'})).digest('hex');
}
function formatCheck(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||v.schema!==SCHEMA||v.cipher!==CIPHER||
   v.kdf?.name!=='scrypt'||v.kdf.N!==KDF.N||v.kdf.r!==KDF.r||v.kdf.p!==KDF.p||v.kdf.keyBytes!==32||
   typeof v.publicKeyPem!=='string'||!v.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')||
   typeof v.fingerprint!=='string'||!HEX.test(v.fingerprint)||publicFingerprint(v.publicKeyPem)!==v.fingerprint)
  throw Error('Invalid encrypted key vault metadata');
 return {salt:b64(v.salt,16,'salt'),iv:b64(v.iv,12,'IV'),tag:b64(v.tag,16,'tag'),ciphertext:b64(v.ciphertext,null,'ciphertext')};
}
// Encrypt an existing Ed25519 private key *only in memory*. Never write a PEM to disk.
export async function encryptPrivateKeyPem(pem,passphrase){
 validatePassword(passphrase);
 const privateKey=createPrivateKey(pem);
 if(privateKey.asymmetricKeyType!=='ed25519')throw Error('Only Ed25519 private keys may be rewrapped');
 const pub=createPublicKey(privateKey).export({type:'spki',format:'pem'});
 const salt=randomBytes(16),iv=randomBytes(12);
 const key=await derive(passphrase,salt,32,{N:KDF.N,r:KDF.r,p:KDF.p,maxmem:64*1024*1024});
 try{
   const cipher=createCipheriv('aes-256-gcm',key,iv);
   const prefix={schema:SCHEMA,cipher:CIPHER,kdf:{...KDF},publicKeyPem:pub,fingerprint:publicFingerprint(pub)};
   cipher.setAAD(Buffer.concat([AD,Buffer.from(JSON.stringify(prefix),'utf8')]));
   const ciphertext=Buffer.concat([cipher.update(pem,'utf8'),cipher.final()]);
   return {...prefix,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
 }finally{key.fill(0);}
}
// Initial keygen also encrypts immediately. It never writes plaintext PEM.
export async function makeEncryptedKey(passphrase){
 validatePassword(passphrase);
 const {privateKey}=generateKeyPairSync('ed25519');
 return encryptPrivateKeyPem(privateKey.export({type:'pkcs8',format:'pem'}),passphrase);
}
export async function unlockEncryptedKey(vault,passphrase){
 validatePassword(passphrase);
 const {salt,iv,tag,ciphertext}=formatCheck(vault);
 if(ciphertext.length===0||ciphertext.length>4096)throw Error('Invalid encrypted private key length');
 const key=await derive(passphrase,salt,32,{N:KDF.N,r:KDF.r,p:KDF.p,maxmem:64*1024*1024});
 try{
  const prefix={schema:vault.schema,cipher:vault.cipher,kdf:vault.kdf,publicKeyPem:vault.publicKeyPem,fingerprint:vault.fingerprint};
  const dec=createDecipheriv('aes-256-gcm',key,iv);
  dec.setAAD(Buffer.concat([AD,Buffer.from(JSON.stringify(prefix),'utf8')]));
  dec.setAuthTag(tag);
  let pem;
  try{pem=Buffer.concat([dec.update(ciphertext),dec.final()]).toString('utf8');}
  catch{throw Error('Wrong passphrase or encrypted key was modified');}
  const priv=createPrivateKey(pem);
  if(priv.asymmetricKeyType!=='ed25519'||publicFingerprint(createPublicKey(priv))!==vault.fingerprint)throw Error('Private key does not match public identity');
  return pem;
 }finally{key.fill(0);}
}
export async function writeNewEncryptedKey(filepath,passphrase){
 const vault=await makeEncryptedKey(passphrase);
 await mkdir(dirname(filepath),{recursive:true,mode:0o700});
 const fd=await open(filepath,'wx',0o600);
 try{await fd.writeFile(JSON.stringify(vault,null,2)+'\n');await fd.sync();}finally{await fd.close();}
 return {path:filepath,fingerprint:vault.fingerprint,publicKeyPem:vault.publicKeyPem,storage:'AES_256_GCM_SCRYPT_ENCRYPTED',assurance:'PASSPHRASE_ENCRYPTED_LOCAL_KEY_NOT_HARDWARE_BACKED'};
}
export async function unlockEncryptedKeyFile(filepath,passphrase){
 const raw=await readFile(filepath,'utf8');
 if(raw.length>MAX_VAULT)throw Error('Oversized key vault');
 return unlockEncryptedKey(JSON.parse(raw),passphrase);
}
export async function readVaultPublicInfo(filepath){
 const raw=await readFile(filepath,'utf8');
 if(raw.length>MAX_VAULT)throw Error('Oversized key vault');
 const vault=JSON.parse(raw);formatCheck(vault);
 return {fingerprint:vault.fingerprint,publicKeyPem:vault.publicKeyPem,assurance:'PUBLIC_METADATA_ONLY_CIPHERTEXT_NOT_VERIFIED'};
}
