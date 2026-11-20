import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPublicProfile, summarizeManifest, validateHandle } from '../src/muse-profile-cli.mjs';

const identityId = 'sha256:' + 'a'.repeat(64);
const sample = {
  handle: 'example-agent', identityId, identityType: 'agent', displayName: null,
  repos: [{ name: 'example' }], activity: [{ domain: 'code' }],
  attestations: [{ claim: 'skill-verified' }], agentModel: 'self-reported-model',
  agentCapabilities: ['read:repos'],
  trustChain: [
    { handle: 'example-agent', identityType: 'agent', spawnedBy: 'example-human' },
    { handle: 'example-human', identityType: 'human', spawnedBy: null },
  ],
};

test('summarizes supported MuseHub camelCase manifest without claiming proof', () => {
  const out = summarizeManifest(sample, 'example-agent');
  assert.equal(out.identityType, 'agent');
  assert.equal(out.repoCount, 1);
  assert.equal(out.attestationCount, 1);
  assert.equal(out.trustChainReported[1].handle, 'example-human');
  assert.match(out.verification, /UNVERIFIED/);
  assert.equal(out.agentModelSelfReported, 'self-reported-model');
});

test('human manifests have no fabricated agent genealogy', () => {
  const out = summarizeManifest({ handle: 'human', identityId, identityType: 'human' }, 'human');
  assert.deepEqual(out.trustChainReported, []);
  assert.deepEqual(out.agentCapabilitiesDeclared, []);
});

test('rejects invalid handles and mismatched identity', () => {
  for (const handle of ['../private', 'foo/bar', 'https://evil.test', '', 'two names']) {
    assert.throws(() => validateHandle(handle), /Invalid MuseHub handle/);
  }
  assert.throws(() => summarizeManifest(sample, 'someone-else'), /identity fields/);
  assert.throws(() => summarizeManifest({ ...sample, identityId: 'oops' }, 'example-agent'), /identity fields/);
});

test('read only GET uses fixed origin, no credentials, rejects unexpected redirects', async () => {
  let called = 0;
  const out = await readPublicProfile('example-agent', {
    fetchFn: async (url, options) => {
      called++;
      assert.equal(url, 'https://musehub.ai/api/profiles/example-agent');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Accept, 'application/json');
      assert.equal('Authorization' in options.headers, false);
      return new Response(JSON.stringify(sample), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(called, 1);
  assert.equal(out.handle, 'example-agent');
});

test('404, non-JSON, malformed JSON, and oversized responses fail closed', async () => {
  const fail = async (response, regex) => {
    await assert.rejects(readPublicProfile('example-agent', { fetchFn: async () => response }), regex);
  };
  await fail(new Response('no', { status: 404 }), /not found/);
  await fail(new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }), /JSON/);
  await fail(new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }), /malformed JSON/);
  await fail(new Response('a'.repeat(256 * 1024 + 1), { status: 200, headers: { 'content-type': 'application/json' } }), /too large/);
});
