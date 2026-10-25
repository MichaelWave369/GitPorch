import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = name => readFile(new URL('../docs/'+name,import.meta.url),'utf8');
test('GitPorch front porch has a deliberate Xi source-only doorway',async()=>{
 const html=await read('index.html');
 assert.match(html,/href="\.\/xi-bridge-reference\.html"/);
 assert.match(html,/PUBLIC COLLABORATION · NO LIVE Xi GRANT/);
 assert.match(html,/Neither GitPorch nor Xi is granted runtime access/);
});
test('Xi reference is static, non-network, evidence-labeled',async()=>{
 const html=await read('xi-bridge-reference.html');
 assert.match(html,/Source references above are externally navigated only when clicked/);
 assert.match(html,/NOT CONNECTED · NOT AUTHORIZED · SOURCE ONLY/);
 assert.match(html,/https:\/\/github\.com\/MichaelWave369\/xi-vessel-bridge/);
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/<script\b|\bfetch\(|\biframe\b|\bWebSocket\b/);
 assert.doesNotMatch(html, /<form\b|private key|Bearer /i);
});
