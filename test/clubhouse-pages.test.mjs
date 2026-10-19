import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const doc = name => readFile(new URL('../docs/'+name,import.meta.url),'utf8');
test('public clubhouse is fictional, accessible and interactive',async()=>{
 const page=await doc('index.html'),js=await doc('clubhouse.js');
 assert.match(page,/id="phibots"/);assert.match(page,/id="phibot-roster"/);
 assert.match(page,/id="phibot-proposals"/);assert.match(page,/clubhouse\.js/);
 assert.match(page,/DEMO ONLY/);
 assert.match(js,/DEMO-101/);assert.match(js,/FICTIONAL/);
 assert.match(js,/addEventListener/);
});
test('public clubhouse never contacts the local service',async()=>{
 const js=await doc('clubhouse.js');
 assert.doesNotMatch(js,/\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b|localhost|127\.0\.0\.1|\/api\//);
});
