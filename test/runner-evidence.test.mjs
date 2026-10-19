import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyImageIdentity,parseTap,executionEvidence,evidenceShapeValid,sha256Text} from '../src/runner-evidence.mjs';
const id='sha256:'+'a'.repeat(64);
const manifest='node:22-alpine@sha256:'+'b'.repeat(64);
const inspect=JSON.stringify({Id:id,RepoDigests:[manifest]});
const ok=['TAP version 13','ok 1 - fixture','1..1','# tests 1','# pass 1','# fail 0','# cancelled 0','# skipped 0','# todo 0'].join('\n')+'\n';
test('image verification pins actual ID or explicitly matching RepoDigest',()=>{
 assert.deepEqual(verifyImageIdentity(id,inspect),{id,requested:id});
 assert.deepEqual(verifyImageIdentity(manifest,inspect),{id,requested:manifest});
 assert.throws(()=>verifyImageIdentity('sha256:'+'c'.repeat(64),inspect),/differs/);
 assert.throws(()=>verifyImageIdentity(manifest,JSON.stringify({Id:id,RepoDigests:[]})),/differs/);
 assert.throws(()=>verifyImageIdentity(id,'garbage'),/did not return JSON/);
});
test('TAP summary must be nonempty, singular, consistent and have successful exit',()=>{
 assert.equal(parseTap(ok,0).outcome,'PASS');
 assert.equal(parseTap(ok,2).outcome,'ERROR');
 assert.equal(parseTap(ok+'# pass 1\n',0).outcome,'ERROR');
 assert.equal(parseTap(ok.replace('# tests 1','# tests 0'),0).outcome,'ERROR');
 assert.equal(parseTap(ok.replace('# pass 1','# pass 0').replace('ok 1','ok 0'),0).outcome,'NO_TESTS');
 assert.equal(parseTap(ok.replace('# fail 0','# fail 1'),1).outcome,'ERROR'); // impossible count sum
 assert.equal(parseTap('TAP version 13\n1..1\nnot ok 1 - fail\n# tests 1\n# pass 0\n# fail 1\n# skipped 0\n',1).outcome,'FAIL');
 assert.equal(parseTap('fake logs # tests 1',0).outcome,'ERROR');
});
test('evidence records only local output hashes, not raw logs or signatures',()=>{
 const e=executionEvidence({exitCode:0,stdout:ok,stderr:''},{id});
 assert.equal(e.stdoutSha256,sha256Text(ok));
 assert.ok(evidenceShapeValid(e));
 assert.ok(!Object.hasOwn(e,'stdout')&&!Object.hasOwn(e,'signature'));
 assert.equal(executionEvidence({exitCode:-1},{id}),null);
});
