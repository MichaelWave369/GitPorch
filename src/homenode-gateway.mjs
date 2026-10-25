import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { isIP } from 'node:net';
import { isAbsolute, resolve } from 'node:path';

export const HOMENODE_SCHEMA = 'gitporch.homenode.capabilities.v1';
export const HOMENODE_DEFAULT_PORT = 3743;

export function validBindAddress(address) {
  if (typeof address !== 'string' || isIP(address) !== 4) return false;
  const parts = address.split('.').map(Number);
  return parts[0] === 127 ||
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

export function parseGatewayConfig(env = process.env) {
  const bind = env.GITPORCH_HOMENODE_BIND;
  if (!validBindAddress(bind)) {
    throw new Error('Set GITPORCH_HOMENODE_BIND to a specific RFC1918 LAN IPv4 address or 127.0.0.1; wildcards/public addresses forbidden');
  }
  const port = Number(env.GITPORCH_HOMENODE_PORT ?? HOMENODE_DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid HomeNode port');
  const files = {};
  for (const [name, key] of [
    ['certificate', 'GITPORCH_HOMENODE_TLS_CERT_FILE'],
    ['privateKey', 'GITPORCH_HOMENODE_TLS_KEY_FILE'],
    ['token', 'GITPORCH_HOMENODE_TOKEN_FILE'],
  ]) {
    const value = env[key];
    if (typeof value !== 'string' || !isAbsolute(value)) {
      throw new Error(key + ' must point to an existing absolute file outside source control');
    }
    files[name] = resolve(value);
  }
  return { bind, port, files };
}

async function checkedFile(path, maxBytes) {
  const st = await lstat(path);
  if (!st.isFile() || st.size === 0 || st.size > maxBytes) throw new Error('Invalid credential file (not regular or unacceptable size)');
  return readFile(path);
}

export async function loadGatewayCredentials(files) {
  const [cert, key, rawToken] = await Promise.all([
    checkedFile(files.certificate, 1024 * 1024),
    checkedFile(files.privateKey, 1024 * 1024),
    checkedFile(files.token, 1024),
  ]);
  const token = rawToken.toString('utf8').replace(/[\r\n]+$/, '');
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(token)) {
    throw new Error('HomeNode bearer token must be 43-256 random base64url/hex characters in its private file');
  }
  if (files.privateKey === files.certificate || files.token === files.certificate || files.token === files.privateKey) {
    throw new Error('Certificate, key and token must have distinct file paths');
  }
  return { cert, key, token };
}

function secureReply(res, code, object) {
  const bytes = JSON.stringify(object);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(bytes);
}

export function makeGatewayHandler({ bind, port, token }) {
  if (!validBindAddress(bind) || !Number.isInteger(port) || port < 1024 || port > 65535 ||
    typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,256}$/.test(token)) {
    throw new Error('Invalid read-only gateway configuration');
  }
  const requiredHost = bind + ':' + port;
  const expected = createHash('sha256').update(token, 'utf8').digest();
  const authorized = header => {
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
    const provided = header.slice(7);
    if (!/^[A-Za-z0-9_-]{43,256}$/.test(provided)) return false;
    const actual = createHash('sha256').update(provided, 'utf8').digest();
    return timingSafeEqual(expected, actual);
  };
  return (req, res) => {
    // The handler is never intended to work under plain HTTP, even behind a proxy.
    if (req.socket?.encrypted !== true) return secureReply(res, 403, { error: 'TLS_REQUIRED' });
    if (req.headers.host !== requiredHost) return secureReply(res, 421, { error: 'UNRECOGNIZED_HOST' });
    // No browser CORS, cookies, Origin access or credentials in URLs.
    if (req.headers.origin !== undefined || req.headers.cookie !== undefined) {
      return secureReply(res, 403, { error: 'BROWSER_ORIGIN_NOT_SUPPORTED' });
    }
    if (!authorized(req.headers.authorization)) {
      return secureReply(res, 401, { error: 'AUTH_REQUIRED' });
    }
    if (req.method !== 'GET') return secureReply(res, 405, { error: 'READ_ONLY' });
    if (req.url === '/v1/health') {
      return secureReply(res, 200, {
        schema: HOMENODE_SCHEMA, service: 'GitPorch HomeNode',
        availability: 'GATEWAY_RESPONDING_ONLY', mode: 'EXPERIMENTAL_AUTHENTICATED_READ_ONLY',
      });
    }
    if (req.url === '/v1/capabilities') {
      return secureReply(res, 200, {
        schema: HOMENODE_SCHEMA,
        service: 'GitPorch HomeNode',
        mode: 'EXPERIMENTAL_AUTHENTICATED_READ_ONLY',
        transport: 'HTTPS_WITH_OPERATOR_TRUSTED_CERTIFICATE',
        capabilities: {
          localGitStorage: true, localSnapshots: true, publicGitHubImport: true,
          remoteRepositoryRead: false, remoteGitPush: false,
          remoteBuilds: false, browserAccess: false, automaticSync: false,
        },
        caveat: 'Capabilities indicate installed GitPorch software features, not completed offline or hardware validation.',
      });
    }
    return secureReply(res, 404, { error: 'NOT_FOUND' });
  };
}

export async function startGateway({ bind, port, files } = parseGatewayConfig()) {
  const { cert, key, token } = await loadGatewayCredentials(files);
  const handler = makeGatewayHandler({ bind, port, token });
  const server = createServer({ cert, key, minVersion: 'TLSv1.2', requestCert: false }, handler);
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  server.keepAliveTimeout = 5_000;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, bind, resolve);
    });
  } catch (error) {
    server.close();
    throw error;
  }
  return server;
}
