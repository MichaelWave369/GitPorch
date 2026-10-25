import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway } from '../src/homenode-gateway.mjs';

const TOKEN = '0123456789abcdef'.repeat(4);

async function availablePort() {
  const s = net.createServer();
  await new Promise((resolve, reject) => s.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}

function secureGet(port, ca, path, token, origin) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (origin) headers.Origin = origin;
    const req = https.get({
      hostname: '127.0.0.1', port, path,
      ca, rejectUnauthorized: true, headers, timeout: 5000,
    }, res => {
      const chunks = [];
      res.on('data', part => chunks.push(part));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.once('error', reject);
    req.once('timeout', () => req.destroy(new Error('TLS probe timeout')));
  });
}

test('real TLS listener requires a trusted certificate and bearer token', async t => {
  const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8', timeout: 5000 });
  if (openssl.error || openssl.status !== 0) return t.skip('OpenSSL CLI not available in this environment');
  const dir = await mkdtemp(join(tmpdir(), 'gitporch-gateway-tls-'));
  let server;
  try {
    const key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem'), token = join(dir, 'token.txt');
    const gen = spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', key, '-out', cert, '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1',
    ], { encoding: 'utf8', timeout: 30000 });
    if (gen.error || gen.status !== 0) return t.skip('Installed OpenSSL cannot generate an IP-SAN certificate');
    await writeFile(token, TOKEN);
    const port = await availablePort();
    server = await startGateway({ bind: '127.0.0.1', port, files: { certificate: cert, privateKey: key, token } });
    const trustedCA = await readFile(cert);
    const allowed = await secureGet(port, trustedCA, '/v1/capabilities', TOKEN);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.capabilities.remoteGitPush, false);
    assert.equal(allowed.headers['access-control-allow-origin'], undefined);
    assert.equal((await secureGet(port, trustedCA, '/v1/health', null)).status, 401);
    assert.equal((await secureGet(port, trustedCA, '/v1/capabilities', TOKEN, 'https://enterthefield.org')).status, 403);
    await assert.rejects(secureGet(port, Buffer.from('not-a-trusted-ca'), '/v1/capabilities', TOKEN));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
