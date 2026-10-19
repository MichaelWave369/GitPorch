# R1-D2: Offline signed LOCAL evidence

This milestone adds **Ed25519 digital signatures** to explicitly chosen completed GitPorch worker records. Signatures allow a person on another machine to verify that a record was signed by the holder of a **trusted public key** and that the report has not been modified since signing.

**It does NOT prove the worker actually ran, that a test was honest, or that the operator is independent.** It does not replace code review, sandboxing, runner identities, external witnesses, transparency logs, or reproducible builds.

## First-time key setup

```powershell
# In your local GitPorch checkout, Node.js 20+ required:
node src/evidence-cli.mjs keygen --i-accept-unencrypted-private-key
```

This creates:
- `data/signer/operator-private.pem`: **UNENCRYPTED** Ed25519 private key, best-effort owner-only mode 0600 on Unix; Windows access protections depend on ACLs. **Never commit, send, screen-share or publish it.**
- `data/signer/operator-public.pem`: public verification key, safe to distribute.
- A SHA-256 fingerprint of the public key in the CLI result. Verify this fingerprint through an independent, trusted channel before accepting the key.

The command **refuses to overwrite** existing key files. `data/` is Git-ignored. Protect your disk and back up the private key securely. A compromised local user account can steal this unencrypted key and forge future signatures. Future work should support OS-backed/nonexportable or hardware-backed signing.

## Sign an existing completed record

```powershell
node src/porch-crew-cli.mjs list
node src/sandbox-cli.mjs list

# Substitute an actual completed job ID from the correct queue:
node src/evidence-cli.mjs sign git <job-id> .\data\signed-reports\git-report.json --i-attest-local-result
# Or:
node src/evidence-cli.mjs sign tests <job-id> .\data\signed-reports\tests-report.json --i-attest-local-result
```

The signing command validates the local queue's existing checksums, requires `DONE` and an actual recorded outcome, and writes a new signed report **without overwriting a previous report**. You may sign `FAIL`, `ERROR`, `STALE` or `ABORTED_UNVERIFIED` too. Signing **does not promote a result to PASS**, rerun a job, start Docker or merge a pull request.

The output parent directory is created automatically; the example stores reports under the Git-ignored `data/` tree. If you choose another location, you are responsible for keeping it private.

The exported JSON report includes the lane, job identifier, repository name, pinned commit, outcome, and, when present, the container image, counts and locally generated output hashes. **Treat reports as potentially sensitive project metadata.** Keep them private unless you explicitly intend to share them.

## Verify on another machine, offline

Transfer only the signed JSON report and independently authenticated public key:

```powershell
node src/evidence-cli.mjs verify .\git-report.json .\trusted-public.pem
```

No local Git repository or Docker is required to verify. It doesn't access any network. A valid response includes `signatureValid: true`, the trusted key fingerprint, and the **original stated outcome**. Reject mismatched fingerprints, untrusted keys and modified records.

**Verification checks authenticity of a key-holder's statement, not the truth of the statement itself.** A fake result can be signed by an attacker who controls the private key. The recipient needs a separately trusted fingerprint, policy, and potentially independent worker witnesses. This release deliberately provides **no automatic green verification badges**.

## Security and next work

The code is local-first and dependency-free (Node built-in crypto only). Do not store key material under `docs/`, `public/`, or anywhere that GitHub Pages might publish. No authenticated remote signing API is exposed.

Needed later: encrypted/private-key vaults, identity mapping and rotation/revocation, external independent witnesses, trusted CI isolation, reproducible build evaluation, full receipt lifecycle audits, and authenticated multi-user governance.

## Later R1-D3 witness layer

A separately controlled witness key can countersign an already signed operator report, after verifying the operator signature. See [R1-D3 Witness Guide](WITNESS.md). This adds a second verifiable signature, **not** independent verification that a job was run honestly.
