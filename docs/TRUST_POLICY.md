# GitPorch R1-D4A: Offline trust policy and revocation

This milestone adds a **local-only public-key trust allowlist** for the existing operator and witness signatures. The operator must explicitly enroll a key with its independently checked fingerprint and correct role. Verification refuses unknown or revoked keys.

**This registry is not signed, tamper-proof, independently witnessed or rollback-resistant. A valid signature does not prove that the original test ran honestly.**

## 1. Inspect fingerprints without trusting them

```powershell
node src/trust-cli.mjs fingerprint .\data\incoming\trusted-operator-public.pem
node src/trust-cli.mjs fingerprint .\data\incoming\trusted-witness-public.pem
```

Verify the displayed full SHA-256 fingerprints through a **separate trusted channel** with the key owner. Do not trust a fingerprint merely because it arrived in the same package as a report. The fingerprint command refuses private PEM input.

## 2. Enroll keys with explicit approval

```powershell
node src/trust-cli.mjs enroll operator .\data\incoming\trusted-operator-public.pem sha256:<64-confirmed-hex> --i-verified-fingerprint-out-of-band
node src/trust-cli.mjs enroll witness .\data\incoming\trusted-witness-public.pem sha256:<64-confirmed-hex> --i-verified-fingerprint-out-of-band
node src/trust-cli.mjs list
```

Enrollment copies only the public key into the ignored local data directory. A key cannot occupy both roles. This cannot establish that the signers are distinct human beings or organizations.

## 3. Verify both signed reports, entirely offline

```powershell
node src/trust-cli.mjs verify .\data\incoming\operator-report.json .\data\incoming\witness-report.json
```

The verifier obtains keys **only from the already enrolled local trust registry**, checks neither is revoked, and then verifies both Ed25519 signatures and the binding of the witness report to the original operator report. No Git, Docker, web, push or merge action occurs. It preserves the job's actual outcome, including FAIL or ABORTED_UNVERIFIED.

## 4. Revoke a retired or compromised key

```powershell
node src/trust-cli.mjs revoke witness sha256:<64-hex> "Witness retired" --i-confirm-revocation
node src/trust-cli.mjs list
```

Revocation creates a separate, checksum-validated tombstone with exclusive file creation; no undo command is exposed. The policy verifier rejects a revoked key **even for earlier signatures**. This is current-policy rejection, not historical proof of when the key became untrustworthy.

To rotate, create a fresh keypair, verify its public fingerprint independently, enroll it, then revoke the old public key. Keep old historical reports separately under an appropriate archival policy if required.

## Lock safety and limits

The registry lives under Git-ignored **data/trust/**. Exclusive **policy.lock** serializes enroll and revoke. If a lock remains after a crash, inspect active CLI processes and back up data before manually investigating it. The tool never auto-removes a possibly active lock.

The revocation checksum detects ordinary modifications, **not malicious rollback**. Someone controlling the local filesystem can remove or rewrite the registry and its checksums. There is no signed trust root, CA, external transparency log, key encryption, trusted timestamps, OS-backed hardware signing, identity verification or independent rerun in this milestone. Keep the runtime folder private and do not expose it via GitHub Pages.

## Encrypted operator keys

R1-D4B1 can create a new passphrase-encrypted signing identity. Enroll its public key by an independently verified fingerprint, and plan any rotation/revocation of the old key deliberately. See [Encrypted Keys](ENCRYPTED_KEYS.md). The trust policy remains unsigned and rollback-vulnerable.
