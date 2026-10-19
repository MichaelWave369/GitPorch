import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL('../docs/'+name,import.meta.url),'utf8');
test('Pages has relative static assets for project-base hosting',async()=>{
 const html=await read('index.html');
 assert.match(html,/href="\.\/styles\.css"/);
 assert.match(html,/src="\.\/app\.js"/);
 assert.match(html,/id="repo-filter"/);
 assert.match(html,/PUBLIC SHOWCASE · SYNTHETIC DATA/);
 assert.match(html,/FICTIONAL COMMIT EXAMPLES/);
});
test('Pages JavaScript does not call local or remote APIs',async()=>{
 const script=await read('app.js');
 assert.doesNotMatch(script,/\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b/);
 assert.doesNotMatch(script,/localhost|127\.0\.0\.1|\/api\//);
 assert.match(script,/\bFICTIONAL EXAMPLE\b/);
 assert.match(script,/\bDEMO\b/);
});
test('Pages assets and publishing marker exist',async()=>{
 assert.ok((await read('styles.css')).includes('.demo-toolbar'));
 assert.equal(await read('.nojekyll'),'');
 assert.ok((await read('PAGES.md')).includes('/docs'));
});
