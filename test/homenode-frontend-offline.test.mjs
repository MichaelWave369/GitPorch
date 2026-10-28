import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  scanOfflineFrontend, verifyOfflineFrontend, startOfflineFrontendServer,
} from '../src/homenode-frontend-offline.mjs';

const exec = promisify(execFile);
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r17-'));
  try {
    const f = { root, dist: join(root, 'dist'), copied: join(root, 'copied'),
      evidence: join(root, 'evidence') };
    await mkdir(f.dist);
    await mkdir(f.evidence);
    await mkdir(join(f.dist, 'assets'));
    await mkdir(join(f.dist, 'images'));
    await writeFile(join(f.dist, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/PhiOS/assets/site.css"></head>' +
      '<body><img src="/PhiOS/images/phi.svg"><script type="module" src="/PhiOS/assets/main.js"></script></body></html>');
    await writeFile(join(f.dist, 'assets', 'site.css'),
      "body{background-image:url('../images/phi.svg')}");
    await writeFile(join(f.dist, 'assets', 'main.js'),
      "document.body.dataset.ready='true'; console.log('A JS bundle might still fetch external data');");
    await writeFile(join(f.dist, 'images', 'phi.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    return await fn(f);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function prepared(f) {
  const m = await scanOfflineFrontend(f.dist);
  f.manifest = join(f.evidence, 'frontend.json');
  await writeFile(f.manifest, JSON.stringify(m, null, 2));
  return m;
}
function http(host, port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = request({ hostname: '127.0.0.1', port, path, method,
      headers: { Host: host ?? '127.0.0.1:' + port } }, response => {
      const parts = [];
      response.on('data', x => parts.push(x));
      response.on('end', () => resolve({ status: response.statusCode,
        headers: response.headers, text: Buffer.concat(parts).toString('utf8') }));
    });
    r.on('error', reject);
    r.end();
  });
}
async function withServer(f, fn) {
  const s = await startOfflineFrontendServer(f.manifest, f.copied, 0, { allowEphemeralPort: true });
  try { return await fn(s); }
  finally { await new Promise((r, e) => s.server.close(err => err ? e(err) : r())); }
}

test('full dist manifest hashes all bytes, resolves HTML/CSS static refs, does not assert browser works', async () => fixture(async f => {
  const first = await prepared(f);
  assert.equal(first.schema, 'gitporch.offline-static-frontend.v0.1');
  assert.equal(first.basePath, '/PhiOS/');
  assert.equal(first.status, 'STATIC_FILES_VERIFIED_BROWSER_NOT_TESTED');
  assert.equal(first.summary.files, 4);
  assert.equal(first.summary.htmlCssStaticReferencesResolved, 3);
  assert.equal(first.acceptance.capturedFileBytesSHA256Verified, true);
  assert.equal(first.acceptance.htmlCssReferencedLocalAssetsFound, true);
  assert.equal(first.acceptance.dynamicJavaScriptAssetClosureVerified, false);
  assert.equal(first.acceptance.runtimeNetworkCallsAbsent, false);
  assert.equal(first.acceptance.siteRenderedAndNavigationTested, false);
  assert.equal(first.acceptance.completePhiOSOfflineRecoveryVerified, false);
  assert.match(first.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first).includes(f.root), false);
  assert.equal((await scanOfflineFrontend(f.dist)).manifestSha256, first.manifestSha256);
  await cp(f.dist, f.copied, { recursive: true });
  await rm(f.dist, { recursive: true, force: true });
  const checked = await verifyOfflineFrontend(f.manifest, f.copied);
  assert.equal(checked.status, 'FRONTEND_BYTES_AND_DIRECT_STATIC_REFERENCES_REVERIFIED_ONLY');
  assert.equal(checked.manifestSha256, first.manifestSha256);
  assert.equal(checked.browserOpened, false);
}));

test('unavailable local CSS/JS/image paths and remote static links block manifest', async () => {
  await fixture(async f => {
    await rm(join(f.dist, 'images', 'phi.svg'));
    await assert.rejects(scanOfflineFrontend(f.dist), /Referenced local static asset is absent/);
  });
  await fixture(async f => {
    await writeFile(join(f.dist, 'index.html'),
      '<html><script src="https://example.invalid/remote.js"></script></html>');
    await assert.rejects(scanOfflineFrontend(f.dist), /External HTML\/CSS static resource/);
  });
  await fixture(async f => {
    await writeFile(join(f.dist, 'assets', 'site.css'),
      '@import "https://fonts.example.invalid/styles.css";');
    await assert.rejects(scanOfflineFrontend(f.dist), /External HTML\/CSS static resource/);
  });
  await fixture(async f => {
    await writeFile(join(f.dist, 'index.html'),
      '<html><script src="/assets/not-PhiOS.js"></script></html>');
    await assert.rejects(scanOfflineFrontend(f.dist), /outside \/PhiOS/);
  });
});

test('copied manifest tampering, unexpected file, changed byte and symlink fail closed', async t => fixture(async f => {
  await prepared(f);
  await cp(f.dist, f.copied, { recursive: true });
  await writeFile(join(f.copied, 'assets', 'main.js'), 'ALTERED JS');
  await assert.rejects(verifyOfflineFrontend(f.manifest, f.copied),
    /files differ|Referenced local|changed/);
  await cp(f.dist, f.copied, { recursive: true, force: true });
  await writeFile(join(f.copied, 'secret.env'), 'shhh');
  await assert.rejects(verifyOfflineFrontend(f.manifest, f.copied),
    /Unsupported or oversized frontend file/);
  await rm(join(f.copied, 'secret.env'));
  const original = JSON.parse(await readFile(f.manifest, 'utf8'));
  original.files[0].bytes += 1;
  await writeFile(f.manifest, JSON.stringify(original));
  await assert.rejects(verifyOfflineFrontend(f.manifest, f.copied),
    /fingerprint mismatch/);
  const m = await scanOfflineFrontend(f.dist);
  await writeFile(f.manifest, JSON.stringify(m));
  const link = join(f.copied, 'assets', 'main.js');
  await rm(link);
  try { await symlink(join(f.dist, 'assets', 'main.js'), link, 'file'); }
  catch (e) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(e.code)) return t.skip('Symlinks unavailable');
    throw e;
  }
  await assert.rejects(verifyOfflineFrontend(f.manifest, f.copied), /symlink or redirected entry/);
}));

test('localhost server serves only whitelisted exact bytes under PhiOS base with restrictive CSP', async () => fixture(async f => {
  await prepared(f);
  await cp(f.dist, f.copied, { recursive: true });
  await withServer(f, async ({ server, url, status }) => {
    const port = server.address().port;
    assert.equal(url, 'http://127.0.0.1:' + port + '/PhiOS/');
    assert.equal(server.address().address, '127.0.0.1');
    assert.equal(status, 'LOCALHOST_STATIC_PREVIEW_RUNNING_BROWSER_NOT_VERIFIED');
    const html = await http(null, port, '/PhiOS/');
    assert.equal(html.status, 200);
    assert.match(html.text, /site.css/);
    assert.match(html.headers['content-security-policy'], /connect-src 'self'/);
    assert.match(html.headers['content-security-policy'], /object-src 'none'/);
    assert.equal(html.headers['access-control-allow-origin'], undefined);
    assert.equal(html.headers['cache-control'], 'no-store');
    const css = await http(null, port, '/PhiOS/assets/site.css');
    assert.equal(css.status, 200);
    assert.match(css.text, /background-image/);
    assert.match(css.headers['content-type'], /text\/css/);
    const js = await http(null, port, '/PhiOS/assets/main.js', 'HEAD');
    assert.equal(js.status, 200);
    assert.equal(js.text, '');
    assert.equal(await http(null, port, '/assets/main.js').then(x => x.status), 404);
    assert.equal(await http(null, port, '/PhiOS/not-found.js').then(x => x.status), 404);
    assert.equal(await http(null, port, '/PhiOS/%2e%2e/secrets').then(x => x.status), 404);
    assert.equal(await http(null, port, '/PhiOS/../secrets').then(x => x.status), 404);
    assert.equal(await http(null, port, '/PhiOS/assets/main.js', 'POST').then(x => x.status), 405);
    assert.equal(await http('attacker.invalid:9999', port, '/PhiOS/').then(x => x.status), 403);
  });
}));

test('changed files after server starts do not leak newly modified bytes', async () => fixture(async f => {
  await prepared(f);
  await cp(f.dist, f.copied, { recursive: true });
  await withServer(f, async ({ server }) => {
    await writeFile(join(f.copied, 'assets', 'main.js'), "console.log('tampered');");
    const page = await http(null, server.address().port, '/PhiOS/assets/main.js');
    assert.equal(page.status, 409);
    assert.doesNotMatch(page.text, /tampered/);
  });
}));

test('explicit serve approval flag and CLI argument count are mandatory, scan/verify are offline', async () => fixture(async f => {
  await cp(f.dist, f.copied, { recursive: true });
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const result = JSON.parse((await exec(process.execPath, [
    cli, 'frontend-scan', f.dist,
  ])).stdout);
  assert.equal(result.summary.files, 4);
  f.manifest = join(f.evidence, 'frontend.json');
  await writeFile(f.manifest, JSON.stringify(result));
  const check = JSON.parse((await exec(process.execPath, [
    cli, 'frontend-verify', f.manifest, f.copied,
  ])).stdout);
  assert.equal(check.status, 'FRONTEND_BYTES_AND_DIRECT_STATIC_REFERENCES_REVERIFIED_ONLY');
  for (const args of [
    ['frontend-serve', f.manifest, f.copied, '8765'],
    ['frontend-serve', f.manifest, f.copied, '8765', '--not-approved'],
    ['frontend-scan'],
  ]) {
    await assert.rejects(exec(process.execPath, [cli, ...args]),
      e => e.code === 1 && /Invalid arguments/.test(e.stderr));
  }
}));
