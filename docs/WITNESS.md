# GitPorch R1-D3: Offline second-key witness

This milestone adds an explicit **second Ed25519 signature** over an already signed operator report. The witness tool first verifies the operator's report against a separately trusted operator public key. It then signs a checksum of the **entire signed report**, including the operator's signature and recorded outcome.

**It does not rerun the job, independently inspect a Git object, inspect Docker or prove the result is true.** It records that the witness key holder checked an operator signature and countersigned that particular report. Genuine independence requires the two keys to be controlled by separate trusted parties/machines. The software only enforces **different key identities**.

## Prepare the operator-signed report on the first computer

Follow [the original signing guide](SIGNED_EVIDENCE.md) to generate and use the operator signing key. Export only a completed report and the **public** operator key to the witness. A signed `FAIL`, `ERROR`, `STALE` or `ABORTED_UNVERIFIED` remains the same outcome when witnessed.

## Witness from a separate trusted computer

Install Node.js 20+ and obtain a verified copy of the GitPorch source. In PowerShell, ideally on a separate computer with a separate operator:

```powershell
# Use an absolute directory outside the GitPorch repo.
node src/witness-cli.mjs keygen "$env:USERPROFILE\GitPorchWitnessKeys" --i-accept-unencrypted-witness-key
```

This creates `witness-private.pem` and `witness-public.pem`. The **private key is unencrypted** in this prototype. Treat it as sensitive, restrict access through OS filesystem permissions, and do not send it to the original operator, GitHub or a public website.

Verify the operator public key fingerprint over an independent trusted channel. Do not simply trust a public key delivered together with the untrusted report.

```powershell
# Assume the operator sent operator-report.json and verified operator-public.pem.
node src/witness-cli.mjs sign .\data\incoming\operator-report.json .\data\incoming\operator-public.pem "$env:USERPROFILE\GitPorchWitnessKeys\witness-private.pem" .\data\signed-reports\witness-report.json --i-confirm-signature-only
```

Keep incoming operator reports and the generated witness report under Git-ignored `data/` or outside the repository; report output inside tracked source is rejected to avoid accidental publishing. Treat the incoming public keys as trusted only after independent fingerprint verification.

The command refuses to countersign if the operator signature is invalid, the operator and witness keys are identical, or the output report already exists. It creates no network connections, Docker containers or Git commits.

Share the `witness-report.json` and the witness **public** key with the verifier. Never share the private key.

## Third-party verification offline

The verifier needs the operator-signed JSON report, the witness JSON report and **both independently trusted public keys**:

```powershell
node src/witness-cli.mjs verify .\data\incoming\operator-report.json .\data\signed-reports\witness-report.json .\data\incoming\trusted-operator-public.pem .\data\incoming\trusted-witness-public.pem
```

The verifier checks the original operator signature, the witness signature, both fingerprints, that the keys differ, that the witness's bound report hash matches the exact signed operator report, and that the job ID and outcome match.

A positive response is labelled `TWO_DISTINCT_KEY_SIGNATURES_NOT_INDEPENDENT_EXECUTION_PROOF`. It is **not a green CI badge** or audit of the underlying execution. Distinct keys could still be controlled by the same person, device or attacker. Digital signatures alone cannot enforce organizational independence.

## Remaining limitations

- No encrypted private keys, hardware key support, key rotation/revocation or verified identities yet
- No independent rebuild, machine attestation, automatic pipeline, remote witness service, externally trusted timestamps or append-only transparency log
- JSON reports can contain private project names, Git commits and test metadata; distribute only intentionally
- Witness reports are never written by GitHub Pages; the website remains a static fictional showcase
- Generate witness keys in private storage **outside the repo**, because arbitrary output directories are allowed and the tool cannot guard every user-selected location
