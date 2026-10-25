import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCompanionConfig, loadCompanionTrust, selectCompanionMode } from '../src/homenode-companion.mjs';

const TOKEN = '0123456789abcdef'.repeat(4);
const PAYLOAD = {
  schema: 'gitporch.homenode.capabilities.v1',
  mode: 'EXPERIMENTAL_AUTHENTICATED_READ_ONLY',
  transport: 'HTTPS_WITH_OPERATOR_TRUSTED_CERTIFICATE',
  capabilities: {
    localGitStorage: true, localSnapshots: true, publicGitHubImport: true,
    remoteRepositoryRead: false, remoteGitPush: false, remoteBuilds: false,
    browserAccess: false, automaticSync: false,
  },
};
const ENV = { GITPORCH_COMPANION_IP: '127.0.0.1', GITPORCH_COMPANION_PORT: '3743',
  GITPORCH_COMPANION_CERT_SHA256: 'a'.repeat(64),
  GITPORCH_COMPANION_CERT_FILE: '/dev/null', GITPORCH_COMPANION_TOKEN_FILE: '/dev/zero' };

test('OFFLINE and PUBLIC modes do not make a network request or pretend service health', async () => {
  let attempted = false;
  const options = { env: {}, probe: () => { attempted = true; throw Error('network should never run'); } };
  const offline = await selectCompanionMode('offline', options);
  const publicMode = await selectCompanionMode('public', options);
  assert.equal(attempted, false);
  assert.equal(offline.status, 'OFFLINE_SELECTED_NOT_VERIFIED');
  assert.equal(publicMode.status, 'PUBLIC_SELECTED_NOT_PROBED');
  assert.equal(offline.localGatewayVerified, false);
  await assert.rejects(selectCompanionMode('automatic'), /Mode must/);
});

test('LOCAL rejects public IPs and reports conservative fallback without offline-service success', async () => {
  const env = { ...ENV, GITPORCH_COMPANION_IP: '8.8.8.8' };
  const result = await selectCompanionMode('local', { env });
  assert.equal(result.effectiveMode, 'OFFLINE');
  assert.equal(result.failure, 'LOCAL_CONFIGURATION_REQUIRED');
  assert.equal(result.offlineServicesVerified, false);
  assert.equal(result.capabilities, null);
  assert.throws(() => parseCompanionConfig({ ...ENV, GITPORCH_COMPANION_PORT: '80' }), /port/);
  assert.throws(() => parseCompanionConfig({ ...ENV, GITPORCH_COMPANION_CERT_SHA256: '' }), /fingerprint/);
});

test('real pinned TLS local client accepts only expected HomeNode schema and trust', async t => {
  const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8', timeout: 5000 });
  if (openssl.error || openssl.status !== 0) return t.skip('OpenSSL CLI missing');
  const dir = await mkdtemp(join(tmpdir(), 'gitporch-companion-'));
  let server;
  try {
    const cert = join(dir, 'cert.pem'), key = join(dir, 'key.pem'), token = join(dir, 'token.txt');
    const out = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', key, '-out', cert, '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
      { encoding: 'utf8', timeout: 30000 });
    if (out.error || out.status !== 0) throw Error('OpenSSL certificate fixture failed');
    await writeFile(token, TOKEN);
    const certPem = await readFile(cert);
    const pin = createHash('sha256').update(new X509Certificate(certPem).raw).digest('hex');
    let responsePayload = PAYLOAD;
    server = https.createServer({ cert: certPem, key: await readFile(key) }, (req, res) => {
      if (req.url !== '/v1/capabilities' || req.headers.authorization !== 'Bearer ' + TOKEN) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'AUTH_REQUIRED' }));
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(responsePayload));
      }
    });
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const port = String(server.address().port);
    const env = { GITPORCH_COMPANION_IP: '127.0.0.1', GITPORCH_COMPANION_PORT: port,
      GITPORCH_COMPANION_CERT_SHA256: pin, GITPORCH_COMPANION_CERT_FILE: cert,
      GITPORCH_COMPANION_TOKEN_FILE: token };
    const good = await selectCompanionMode('local', { env });
    assert.equal(good.effectiveMode, 'LOCAL');
    assert.equal(good.status, 'LOCAL_GATEWAY_VERIFIED_ONLY');
    assert.equal(good.capabilities.localGitStorage, true);
    assert.equal(JSON.stringify(good).includes(TOKEN), false);
    const badPin = await selectCompanionMode('local', { env: { ...env, GITPORCH_COMPANION_CERT_SHA256: 'f'.repeat(64) } });
    assert.equal(badPin.failure, 'LOCAL_UNTRUSTED');
    await writeFile(token, 'x'.repeat(64));
    const badToken = await selectCompanionMode('local', { env });
    assert.equal(badToken.failure, 'LOCAL_REJECTED');
    await writeFile(token, TOKEN);
    responsePayload = { ...PAYLOAD, schema: 'evil.v1' };
    const wrongSchema = await selectCompanionMode('local', { env });
    assert.equal(wrongSchema.failure, 'LOCAL_BAD_RESPONSE');
    responsePayload = { ...PAYLOAD, capabilities: { ...PAYLOAD.capabilities, remoteGitPush: true } };
    const unsafe = await selectCompanionMode('local', { env });
    assert.equal(unsafe.failure, 'LOCAL_BAD_RESPONSE');
    try {
      const alias = join(dir, 'symlink-to-token');
      await symlink(token, alias);
      await assert.rejects(loadCompanionTrust(parseCompanionConfig({ ...env, GITPORCH_COMPANION_TOKEN_FILE: alias })), /invalid credential file/);
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    }
    await new Promise(resolve => server.close(resolve)); server = null;
    const down = await selectCompanionMode('local', { env });
    assert.equal(down.effectiveMode, 'OFFLINE');
    assert.equal(down.failure, 'LOCAL_UNAVAILABLE');
    assert.equal(down.offlineServicesVerified, false);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
