import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { isAbsolute, resolve } from 'node:path';
import { HOMENODE_SCHEMA, validBindAddress } from './homenode-gateway.mjs';

const HEX_SHA256 = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43,256}$/;
const MAX_RESPONSE = 16 * 1024;
export const COMPANION_SCHEMA = 'gitporch.homenode.companion.v1';

function sha256(bytes) { return createHash('sha256').update(bytes).digest(); }
function matches(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function parseCompanionConfig(env = process.env) {
  const ip = env.GITPORCH_COMPANION_IP;
  if (!validBindAddress(ip)) throw new Error('LOCAL_CONFIGURATION_REQUIRED: private or loopback IPv4 required');
  const port = Number(env.GITPORCH_COMPANION_PORT ?? 3743);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('LOCAL_CONFIGURATION_REQUIRED: invalid port');
  const pin = env.GITPORCH_COMPANION_CERT_SHA256?.toLowerCase();
  if (!HEX_SHA256.test(pin ?? '')) throw new Error('LOCAL_CONFIGURATION_REQUIRED: SHA-256 certificate fingerprint required');
  const certificate = env.GITPORCH_COMPANION_CERT_FILE;
  const token = env.GITPORCH_COMPANION_TOKEN_FILE;
  if (![certificate, token].every(p => typeof p === 'string' && isAbsolute(p)))
    throw new Error('LOCAL_CONFIGURATION_REQUIRED: certificate and token must have absolute private file paths');
  if (resolve(certificate) === resolve(token)) throw new Error('LOCAL_CONFIGURATION_REQUIRED: distinct credential files required');
  return { ip, port, pin, certificate: resolve(certificate), token: resolve(token) };
}

async function readRegular(path, limit) {
  const info = await lstat(path);
  if (!info.isFile() || info.size < 1 || info.size > limit)
    throw new Error('LOCAL_CONFIGURATION_REQUIRED: invalid credential file');
  return readFile(path);
}

export async function loadCompanionTrust(config) {
  const [pem, rawToken] = await Promise.all([
    readRegular(config.certificate, 1024 * 1024),
    readRegular(config.token, 1024),
  ]);
  const token = rawToken.toString('utf8').replace(/[\r\n]+$/, '');
  if (!TOKEN.test(token)) throw new Error('LOCAL_CONFIGURATION_REQUIRED: invalid secret format');
  const cert = new X509Certificate(pem);
  const pinned = Buffer.from(config.pin, 'hex');
  if (!matches(sha256(cert.raw), pinned)) throw new Error('LOCAL_UNTRUSTED: pinned certificate mismatch');
  if (cert.checkIP(config.ip) !== config.ip) throw new Error('LOCAL_UNTRUSTED: certificate IP SAN mismatch');
  const now = Date.now();
  if (!(now >= Date.parse(cert.validFrom) && now <= Date.parse(cert.validTo)))
    throw new Error('LOCAL_UNTRUSTED: certificate validity period failed');
  return { ca: pem, token, pin: pinned };
}

function probeCapabilities(config, trust) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = error => { if (!finished) { finished = true; reject(error); } };
    const req = https.request({
      hostname: config.ip, port: config.port, path: '/v1/capabilities', method: 'GET',
      agent: false, timeout: 5000, ca: trust.ca, rejectUnauthorized: true,
      headers: {
        Accept: 'application/json', Authorization: 'Bearer ' + trust.token,
        Host: config.ip + ':' + config.port, Connection: 'close',
      },
      checkServerIdentity: (name, cert) => {
        const badName = checkServerIdentity(name, cert);
        if (badName) return badName;
        if (!cert.raw || !matches(sha256(cert.raw), trust.pin)) {
          return new Error('COMPANION_CERT_PIN_MISMATCH');
        }
        return undefined;
      },
    }, res => {
      if (res.statusCode !== 200) { res.resume(); return fail(new Error('LOCAL_REJECTED')); }
      if (!String(res.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        res.resume(); return fail(new Error('LOCAL_BAD_RESPONSE'));
      }
      let total = 0;
      const chunks = [];
      res.on('data', data => {
        total += data.length;
        if (total > MAX_RESPONSE) {
          res.destroy(new Error('LOCAL_BAD_RESPONSE'));
          return;
        }
        chunks.push(data);
      });
      res.once('error', fail);
      res.on('end', () => {
        if (finished) return;
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const cap = payload?.capabilities;
          if (payload?.schema !== HOMENODE_SCHEMA ||
              payload?.mode !== 'EXPERIMENTAL_AUTHENTICATED_READ_ONLY' ||
              payload?.transport !== 'HTTPS_WITH_OPERATOR_TRUSTED_CERTIFICATE' ||
              !cap || typeof cap !== 'object' ||
              !['localGitStorage','localSnapshots','publicGitHubImport','remoteRepositoryRead',
                'remoteGitPush','remoteBuilds','browserAccess','automaticSync'].every(k => typeof cap[k] === 'boolean') ||
              cap.remoteRepositoryRead || cap.remoteGitPush || cap.remoteBuilds || cap.browserAccess || cap.automaticSync)
            throw new Error('LOCAL_BAD_RESPONSE');
          finished = true;
          resolve({ localGitStorage: cap.localGitStorage, localSnapshots: cap.localSnapshots,
            publicGitHubImport: cap.publicGitHubImport });
        } catch { fail(new Error('LOCAL_BAD_RESPONSE')); }
      });
    });
    req.once('timeout', () => req.destroy(new Error('LOCAL_TIMEOUT')));
    req.once('error', fail);
    req.end();
  });
}

function category(error) {
  const msg = String(error?.message ?? '');
  if (msg.startsWith('LOCAL_CONFIGURATION_REQUIRED')) return 'LOCAL_CONFIGURATION_REQUIRED';
  if (msg.startsWith('LOCAL_UNTRUSTED') || msg.includes('CERT_PIN_MISMATCH') ||
      ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
        'CERT_HAS_EXPIRED', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(error?.code)) return 'LOCAL_UNTRUSTED';
  if (msg === 'LOCAL_BAD_RESPONSE') return 'LOCAL_BAD_RESPONSE';
  if (msg === 'LOCAL_REJECTED') return 'LOCAL_REJECTED';
  if (msg === 'LOCAL_TIMEOUT') return 'LOCAL_TIMEOUT';
  return 'LOCAL_UNAVAILABLE';
}

export async function selectCompanionMode(mode, { env = process.env, probe = probeCapabilities } = {}) {
  const requested = String(mode).toUpperCase();
  if (!['LOCAL', 'PUBLIC', 'OFFLINE'].includes(requested)) throw new Error('Mode must be local, public, or offline');
  const common = { schema: COMPANION_SCHEMA, requestedMode: requested,
    note: 'Mode selection is not proof that Git repos, models, builds or backups are operational.' };
  if (requested === 'OFFLINE') return { ...common, effectiveMode: 'OFFLINE',
    status: 'OFFLINE_SELECTED_NOT_VERIFIED', localGatewayVerified: false, capabilities: null };
  if (requested === 'PUBLIC') return { ...common, effectiveMode: 'PUBLIC',
    status: 'PUBLIC_SELECTED_NOT_PROBED', localGatewayVerified: false, capabilities: null };
  try {
    const config = parseCompanionConfig(env);
    const trust = await loadCompanionTrust(config);
    const cap = await probe(config, trust);
    return { ...common, effectiveMode: 'LOCAL', status: 'LOCAL_GATEWAY_VERIFIED_ONLY',
      localGatewayVerified: true, capabilities: cap };
  } catch (error) {
    return { ...common, effectiveMode: 'OFFLINE', status: 'LOCAL_FAILED_OFFLINE_MODE_SELECTED',
      localGatewayVerified: false, capabilities: null, failure: category(error),
      offlineServicesVerified: false };
  }
}
