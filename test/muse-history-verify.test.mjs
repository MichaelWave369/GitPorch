import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsFromNDJSON, verifyReadbacks } from '../src/muse-history-verify.mjs';
const gs = ['a','b','c','d'].map(x=>x.repeat(40));
const ms = ['a','b','c','d'].map(x=>'sha256:'+x.repeat(64));
const blob = x=>'sha256:'+x.repeat(64);
const files = (paths)=>paths.map(([p,h])=>({path:p,mode:p.endsWith('.sh')?'100755':'100644',sha256:h.repeat(64)}));
const baseline={schema:'gitporch.muse-git-history-baseline.v1',commits:[
 {gitSha:gs[0],parents:[],files:files([['README.md','1']])},
 {gitSha:gs[1],parents:[gs[0]],files:files([['README.md','2']])},
 {gitSha:gs[2],parents:[gs[0]],files:files([['README.md','1'],['src/feature.js','3']])},
 {gitSha:gs[3],parents:[gs[1],gs[2]],files:files([['README.md','2'],['src/feature.js','3'],['scripts/run.sh','4']])},
 ]};
const raw=gs.map((g,i)=>JSON.stringify({event:'commit',git_sha:g,muse_commit_id:ms[i]})).join('\n')+'\n'+JSON.stringify({event:'done',total_commits_written:4,dry_run:false,exec_bit_not_kept:['scripts/run.sh']});
const events=eventsFromNDJSON(raw);
function captured(){return {museVersion:'muse 0.2.2rc9', records:baseline.commits.map((c,i)=>({muse_commit_id:ms[i],commit:{commit_id:ms[i],metadata:{git_sha:c.gitSha},parent_commit_id:ms[gs.indexOf(c.parents[0])]??null,parent2_commit_id:ms[gs.indexOf(c.parents[1])]??null,snapshot_id:ms[i]},snapshot:{snapshot_id:ms[i],manifest:Object.fromEntries(c.files.map(f=>[f.path,blob(f.sha256[0])]))}}))};}
test('independent Git DAG and complete historical blobs pass, modes remain unverified',()=>{const r=verifyReadbacks(baseline,events,captured());assert.equal(r.status,'PASS_DAG_AND_HISTORICAL_BLOBS_ONLY');assert.equal(r.museReadbackCount,4);assert.deepEqual(r.importWarnings.exec_bit_not_kept,['scripts/run.sh']);assert.ok(r.checked[3].executableModeUnverified.includes('scripts/run.sh'));});
test('flattened merge is detected',()=>{const c=captured();c.records[3].commit.parent2_commit_id=null;assert.ok(verifyReadbacks(baseline,events,c).problems.some(x=>x.code==='PARENT_DAG'));});
test('side-branch tree contamination is detected',()=>{const c=captured();c.records[1].snapshot.manifest['src/feature.js']=blob('3');assert.ok(verifyReadbacks(baseline,events,c).problems.some(x=>x.code==='EXTRA_PATH'));});
test('historical content, missing paths and wrong metadata are separate findings',()=>{const c=captured();c.records[0].snapshot.manifest['README.md']=blob('5');delete c.records[2].snapshot.manifest['README.md'];c.records[1].commit.metadata.git_sha=gs[0];const codes=verifyReadbacks(baseline,events,c).problems.map(x=>x.code);for(const code of ['WRONG_BLOB','MISSING_PATH','GIT_SHA_METADATA'])assert.ok(codes.includes(code));});
test('missing readback and duplicate import are caught',()=>{const c=captured();c.records.pop();const r=verifyReadbacks(baseline,[...events,events[0]],c);assert.ok(r.problems.some(x=>x.code==='MISSING_MUSE_READBACK'));assert.ok(r.problems.some(x=>x.code==='DUPLICATE_OR_INVALID_IMPORT'));});
test('bad NDJSON input fails closed',()=>{assert.throws(()=>eventsFromNDJSON('bad\n'),SyntaxError);assert.throws(()=>eventsFromNDJSON('x'.repeat(1024*1024+1)),/Oversized/);});
