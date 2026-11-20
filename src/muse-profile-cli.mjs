/**
 * GitPorch × MuseHub R0.1: public, read-only identity manifest inspection.
 * No credentials, Muse CLI, local repository access, writes, or remote mutations.
 */
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://musehub.ai';
const MAX_BODY_BYTES = 256 * 1024;
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const IDENTITY_ID = /^sha256:[a-fA-F0-9]{64}$/;
const TYPES = new Set(['human', 'agent', 'org']);

export function validateHandle(handle) {
  if (typeof handle !== 'string' || !HANDLE.test(handle)) {
    throw new Error('Invalid MuseHub handle (letters, numbers, _ or -, 1–64 characters).');
  }
  return handle;
}

/** This is a descriptive view, NOT independent cryptographic verification. */
export function summarizeManifest(raw, expectedHandle) {
  validateHandle(expectedHandle);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('MuseHub returned an invalid profile manifest.');
  }
  if (raw.handle !== expectedHandle || !IDENTITY_ID.test(raw.identityId ?? '') || !TYPES.has(raw.identityType)) {
    throw new Error('MuseHub manifest identity fields are missing or inconsistent.');
  }
  const chain = Array.isArray(raw.trustChain)
    ? raw.trustChain.slice(0, 64).map((link) => ({
        handle: typeof link?.handle === 'string' ? link.handle : null,
        identityType: TYPES.has(link?.identityType) ? link.identityType : null,
        spawnedBy: typeof link?.spawnedBy === 'string' ? link.spawnedBy : null,
      }))
    : [];
  return {
    source: `${BASE_URL}/api/profiles/${encodeURIComponent(expectedHandle)}`,
    handle: raw.handle,
    identityId: raw.identityId,
    identityType: raw.identityType,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : null,
    repoCount: Array.isArray(raw.repos) ? raw.repos.length : 0,
    activityDomains: Array.isArray(raw.activity)
      ? raw.activity.filter((domain) => typeof domain?.domain === 'string').map((domain) => domain.domain).slice(0, 32)
      : [],
    attestationCount: Array.isArray(raw.attestations) ? raw.attestations.length : 0,
    agentModelSelfReported: typeof raw.agentModel === 'string' ? raw.agentModel : null,
    agentCapabilitiesDeclared: Array.isArray(raw.agentCapabilities)
      ? raw.agentCapabilities.filter((c) => typeof c === 'string').slice(0, 64)
      : [],
    trustChainReported: chain,
    verification: 'UNVERIFIED MANIFEST: HTTPS fetch only; no Ed25519 signature, attestation, or provenance verification performed',
  };
}

async function readBoundedBody(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('MuseHub profile response is too large.');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error('MuseHub profile response is too large.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readPublicProfile(handle, { fetchFn = globalThis.fetch, timeoutMs = 8000 } = {}) {
  validateHandle(handle);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`${BASE_URL}/api/profiles/${encodeURIComponent(handle)}`, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 404) throw new Error(`MuseHub profile '${handle}' was not found.`);
    if (!response.ok) throw new Error(`MuseHub profile request failed (HTTP ${response.status}).`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new Error('MuseHub did not return a JSON profile manifest.');
    }
    const body = await readBoundedBody(response);
    let data;
    try { data = JSON.parse(body); }
    catch { throw new Error('MuseHub returned malformed JSON.'); }
    return summarizeManifest(data, handle);
  } finally {
    clearTimeout(timeout);
  }
}

function printHumanReadable(profile) {
  console.log(`MuseHub identity: ${profile.handle} (${profile.identityType})`);
  console.log(`Identity ID: ${profile.identityId}`);
  console.log(`Display name: ${profile.displayName || '(unset)'}`);
  console.log(`Public MuseHub repos: ${profile.repoCount}`);
  console.log(`Activity domains: ${profile.activityDomains.join(', ') || '(none)'}`);
  console.log(`Attestation badges: ${profile.attestationCount} (not independently verified)`);
  if (profile.identityType === 'agent') {
    console.log(`Agent model (self-reported): ${profile.agentModelSelfReported || '(unset)'}`);
    console.log(`Declared capabilities: ${profile.agentCapabilitiesDeclared.join(', ') || '(none)'}`);
    console.log(`Reported trust chain: ${profile.trustChainReported.map((x) => x.handle).join(' -> ') || '(none)'}`);
  }
  console.log(profile.verification);
}

async function main(args) {
  if (args.length < 2 || args.length > 3 || args[0] !== 'read' || (args.length === 3 && args[2] !== '--json')) {
    console.error('Usage: node src/muse-profile-cli.mjs read <public-musehub-handle> [--json]');
    process.exitCode = 2;
    return;
  }
  try {
    const profile = await readPublicProfile(args[1]);
    if (args[2] === '--json') console.log(JSON.stringify(profile, null, 2));
    else printHumanReadable(profile);
  } catch (error) {
    console.error(`MuseHub read-only profile check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
