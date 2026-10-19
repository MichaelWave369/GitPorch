import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const file=p=>readFile(new URL('../docs/'+p,import.meta.url),'utf8');
test('GitHub Pages exposes no local CI or user repo information',async()=>{
 const html=await file('index.html'),js=(await file('app.js'))+(await file('clubhouse.js'));
 assert.match(html,/R1-B/);
 assert.match(html,/static public page does not connect/);
 assert.match(html,/FICTIONAL COMMIT EXAMPLES/);
 assert.doesNotMatch(js,/\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b/);
});
