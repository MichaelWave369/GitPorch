import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../src/vault-cli.mjs',import.meta.url));
const run=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',input:'simulated secret input\n',timeout:10000});
test('encrypted keygen refuses piped passwords and requires a TTY',()=>{
 const result=run(['keygen','--i-accept-password-vault']);
 assert.equal(result.status,1);
 assert.match(result.stderr,/real interactive terminal is required/);
 assert.doesNotMatch(result.stdout,/BEGIN PRIVATE KEY/);
});
test('no passphrase accepted as an extra command-line argument',()=>{
 const result=run(['keygen','--i-accept-password-vault','bad-secret']);
 assert.equal(result.status,1);
 assert.match(result.stderr,/GitPorch encrypted operator key/);
 assert.doesNotMatch(result.stderr,/simulated secret input/);
});
