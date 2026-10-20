import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../src/vault-cli.mjs',import.meta.url));
const run=args=>spawnSync(process.execPath,[cli,...args],{
  encoding:'utf8',input:'do not accept a piped password\n',timeout:10000
});
test('passphrase rewrap refuses piped secrets and requires explicit operator flag',()=>{
 const noApproval=run(['rewrap']);
 assert.equal(noApproval.status,1);
 assert.match(noApproval.stderr,/i-confirm-new-encrypted-copy/);
 const approved=run(['rewrap','--i-confirm-new-encrypted-copy']);
 assert.equal(approved.status,1);
 assert.match(approved.stderr,/real interactive terminal is required/);
});
test('staged vault verification and staged signing refuse piped secrets',()=>{
 const verify=run(['verify-next']);
 assert.equal(verify.status,1);
 assert.match(verify.stderr,/real interactive terminal is required/);
 const sign=run(['sign-next','git','1760900000000-123e4567-e89b-42d3-a456-426614174000','--i-confirm-local-signing']);
 assert.equal(sign.status,1);
 assert.match(sign.stderr,/real interactive terminal is required/);
});
test('no new or old passphrases accepted via command line',()=>{
 const failure=run(['rewrap','--i-confirm-new-encrypted-copy','old-secret','new-secret']);
 assert.equal(failure.status,1);
 assert.match(failure.stderr,/GitPorch encrypted operator key/);
 assert.doesNotMatch(failure.stdout,/new-secret/);
});
