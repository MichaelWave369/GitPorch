# GitPorch × MuseHub R0.1: public identity manifest reader

**Status:** optional, operator-invoked, read-only research pilot. This is not production Git ↔ Muse sync and does not extend Agentora's automation authority.

## Why this lives in GitPorch

The existing R0.7–R0.9 Muse bridge is manual and evidence-driven. This separate capability fetches ONE public MuseHub identity manifest. It does not register identities, derive keys, grant permissions, sign attestations, create Muse repositories, install or invoke the Muse CLI, push, or change GitPorch's dashboard. It does not affect [Agentora #124](https://github.com/MichaelWave369/Agentora/issues/124).

## Local use (Node 20+, no added dependencies)

~~~powershell
node src/muse-profile-cli.mjs read gabriel
node src/muse-profile-cli.mjs read gabriel --json
npm test
~~~

Only public GET https://musehub.ai/api/profiles/{handle} is contacted and only on an explicit command. HTTPS origin is fixed; handle syntax is restricted; there are no credentials, redirects, or remote mutations. The request has a timeout and bounded response size, and essential identity fields must match. The CLI outputs to the terminal without writing a local file or persisting source code, keys, or profile data.

## Security and evidence limits

- **NOT independent cryptographic verification.** No Ed25519 attestation signature, key rotation/revocation, agent-permission, model-identity, or trust-chain verification occurs.
- The profile identity, model, capabilities and genealogy are MuseHub-reported metadata. The model label itself is self-reported by the agent. Do not feed this summary into an automated permission or merge decision.
- This is the current documented flat camelCase profile contract: identityId, identityType, handle, repos, activity, attestations, agentModel, agentCapabilities, trustChain.
- The output intentionally omits MPay balances and personal profile data unrelated to this pilot. No payment functionality is enabled.
- The handle validator currently accepts 1–64 characters of letters, digits, underscore and hyphen, starting with a letter or digit.
- Tests run with synthetic fixtures and mocked HTTP responses only. A local passing test is **not** a successful live MuseHub API field test. Test a real human and agent profile separately before claiming field qualification.
- Reading a public profile does not mean this operator has a registered MuseHub account, and the GitHub user is never auto-mapped to a Muse handle.

## Future gates (separate approvals)

1. Record date and sanitized evidence of successful live public human and agent profile reads plus failure-path testing.
2. Independently verify signed attestations and current/revoked signing-key validity before any authorization decisions.
3. Add scoped, expiring worker identities without sharing the human mnemonic or broad GitHub credentials.
4. Integrate validated provenance as supplementary evidence in Agentora **without** replacing its R9 queue, Autonomous R1 approval gates, GitHub CI, or human review policy.

Official sources: https://musehub.ai/muse/profiles and https://musehub.ai/muse/identity
