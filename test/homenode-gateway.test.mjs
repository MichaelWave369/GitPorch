import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validBindAddress, parseGatewayConfig, loadGatewayCredentials, makeGatewayHandler, HOMENODE_SCHEMA } from '../src/homenode-gateway.mjs';

const TOKEN = 'abcdef0123456789'.repeat(4);
const BIND = '127.0.0.1';
const PORT = 3743;

function request(handler, { url = '/v1/capabilities', method = 'GET', auth = TOKEN,
  host = BIND + ':' + PORT, encrypted = true, origin, cookie } = {}) {
  const headers = { host };
  if (auth !== null) headers.authorization = 'Bearer ' + auth;
  if (origin !== undefined) headers.origin = origin;
  if (cookie !== undefined) headers.cookie = cookie;
  let status;
  let returnedHeaders;
  let body;
  handler({ method, url, headers, socket: { encrypted } }, {
    writeHead: (code, props) => { status = code; returnedHeaders = props; },
    end: bytes => { body = JSON.parse(bytes); },
  });
  return { status, headers: returnedHeaders, body };
}

test('only explicit RFC1918 / loopback IPv4 binds are accepted', () => {
  for (const address of ['127.0.0.1', '10.24.0.2', '172.16.0.1', '172.31.255.254', '192.168.1.20'])
    assert.equal(validBindAddress(address), true, address);
  for (const address of ['0.0.0.0', '::', '::1', '8.8.8.8', '169.254.1.20', '172.32.0.2',
    '100.64.1.1', 'localhost', '1.2.3.4', '255.255.255.255', undefined, '192.168.1.500'])
    assert.equal(validBindAddress(address), false, String(address));
  assert.throws(() => parseGatewayConfig({}), /specific RFC1918/);
  assert.throws(() => parseGatewayConfig({ GITPORCH_HOMENODE_BIND: '0.0.0.0' }), /specific RFC1918/);
  assert.throws(() => parseGatewayConfig({
    GITPORCH_HOMENODE_BIND: '127.0.0.1',
    GITPORCH_HOMENODE_PORT: '80',
  }), /port/);
});

test('requires existing, separate, local credential files and high-entropy token format', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gitporch-gateway-'));
  try {
    const cert = join(directory, 'cert.pem');
    const key = join(directory, 'key.pem');
    const token = join(directory, 'token.txt');
    await writeFile(cert, 'test-certificate');
    await writeFile(key, 'test-key');
    await writeFile(token, TOKEN + '\n');
    const env = {
      GITPORCH_HOMENODE_BIND: '127.0.0.1',
      GITPORCH_HOMENODE_TLS_CERT_FILE: cert,
      GITPORCH_HOMENODE_TLS_KEY_FILE: key,
      GITPORCH_HOMENODE_TOKEN_FILE: token,
    };
    const config = parseGatewayConfig(env);
    assert.equal(config.port, 3743);
    assert.equal((await loadGatewayCredentials(config.files)).token, TOKEN);
    await writeFile(token, 'weak');
    await assert.rejects(loadGatewayCredentials(config.files), /43-256/);
    await writeFile(token, TOKEN);
    try {
      await symlink(token, join(directory, 'token-symlink.txt'));
      await assert.rejects(loadGatewayCredentials({ ...config.files, token: join(directory, 'token-symlink.txt') }), /regular/);
    } catch (error) {
      // Creating file symlinks may require developer mode or elevated privileges on Windows.
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    }
    await assert.rejects(loadGatewayCredentials({ ...config.files, token: cert }), /43-256|distinct/);
    assert.throws(() => parseGatewayConfig({ ...env, GITPORCH_HOMENODE_TLS_KEY_FILE: 'relative-key.pem' }), /absolute/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('no TLS, wrong host, no auth, browser origins and mutations fail closed', () => {
  const handler = makeGatewayHandler({ bind: BIND, port: PORT, token: TOKEN });
  assert.equal(request(handler, { encrypted: false }).status, 403);
  assert.equal(request(handler, { host: 'evil.example:3743' }).status, 421);
  assert.equal(request(handler, { auth: null }).status, 401);
  assert.equal(request(handler, { auth: '0'.repeat(64) }).status, 401);
  assert.equal(request(handler, { auth: 'short' }).status, 401);
  assert.equal(request(handler, { origin: 'https://enterthefield.org' }).status, 403);
  assert.equal(request(handler, { cookie: 'session=x' }).status, 403);
  assert.equal(request(handler, { method: 'POST' }).status, 405);
  assert.equal(request(handler, { method: 'OPTIONS' }).status, 405);
  assert.equal(request(handler, { url: '/api/repos' }).status, 404);
  assert.equal(request(handler, { url: '/v1/capabilities?token=' + TOKEN }).status, 404);
});

test('authenticated endpoints disclose only bounded metadata and no browser CORS', () => {
  const handler = makeGatewayHandler({ bind: BIND, port: PORT, token: TOKEN });
  const health = request(handler, { url: '/v1/health' });
  const caps = request(handler);
  assert.equal(health.status, 200);
  assert.equal(health.body.availability, 'GATEWAY_RESPONDING_ONLY');
  assert.equal(caps.status, 200);
  assert.equal(caps.body.schema, HOMENODE_SCHEMA);
  assert.equal(caps.body.capabilities.remoteGitPush, false);
  assert.equal(caps.body.capabilities.browserAccess, false);
  assert.equal(caps.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(caps.headers['Cache-Control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(caps.body), /(?:repos\/|private|apiKey|BEGIN)/i);
  assert.equal(JSON.stringify(caps.body).includes(TOKEN), false);
});
