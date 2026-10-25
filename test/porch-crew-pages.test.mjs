import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const get=name=>readFile(new URL('../docs/'+name,import.meta.url),'utf8');
test('public GitPage describes future CI truthfully without connecting to local worker',async()=>{
 const html=await get('index.html');
 assert.match(html,/R1-A provides real local Git integrity checks/);
 assert.match(html,/R1-B adds manually approved Node.js test runs/);
 assert.match(html,/static public page does not connect/);
 assert.match(html,/FICTIONAL COMMIT EXAMPLES/);
 const js=await get('app.js'),bot=await get('clubhouse.js');
 assert.doesNotMatch(js+bot,/\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b/);
});
