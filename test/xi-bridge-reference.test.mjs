import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = name => readFile(new URL('../docs/'+name,import.meta.url),'utf8');
test('GitPorch front porch preserves reviewed Xi engineering doorway',async()=>{
 const html=await read('index.html');
 assert.match(html,/href="\.\/xi-bridge-reference\.html"/);
 assert.match(html,/PUBLIC COLLABORATION · NO LIVE Xi GRANT/);
 assert.match(html,/Neither GitPorch nor Xi is granted runtime access/);
});
test('Xi reference links verified static Pages, evidence and canonical GitHub source',async()=>{
 const html=await read('xi-bridge-reference.html');
 assert.match(html,/https:\/\/michaelwave369\.github\.io\/xi-vessel-bridge\//);
 assert.match(html,/https:\/\/github\.com\/MichaelWave369\/xi-vessel-bridge/);
 assert.match(html,/actions\/runs\/40243474173/);
 assert.match(html,/published static Gateway is verified/);
 assert.match(html,/external Xi protocol and R18 real two-host pilot remain unverified/);
 assert.match(html,/NOT CONNECTED · NOT AUTHORIZED · SOURCE ONLY/);
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/<script\b|\bfetch\(|\biframe\b|\bWebSocket\b/);
 assert.doesNotMatch(html,/<form\b|private key|Bearer /i);
});
