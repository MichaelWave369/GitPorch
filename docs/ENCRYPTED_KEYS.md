# GitPorch R1-D4B1: Passphrase-encrypted operator key

This **opt-in local pilot** generates a fresh Ed25519 operator key and immediately stores its private component as **AES-256-GCM ciphertext**, with a key derived using **scrypt** (`N=32768`, `r=8`, `p=1`) and a fresh 16-byte salt. The vault's metadata is authenticated as additional data; encryption uses a fresh 12-byte nonce and a 16-byte authentication tag. There are no new dependencies.

**Existing unencrypted operator keys are not migrated, deleted, unlocked or overwritten.** This feature creates a *different* signing identity and preserves the original signed-report format and verification flow. It is not a hardware-backed key, encrypted trust policy, proof of CI execution, or protection from a compromised local account.

## Create a new encrypted identity

Run in a real interactive PowerShell terminal, inside a local GitPorch checkout:

```powershell
node src/vault-cli.mjs keygen --i-accept-password-vault
node src/vault-cli.mjs public
```

The first command asks twice for a new **long, unique passphrase**, without echoing it, and writes a single encrypted vault to Git-ignored `data/signer/operator-encrypted.json`. The `public` command writes the corresponding public PEM to `data/signer/operator-encrypted-public.pem` without requiring the passphrase. Existing files are never overwritten.

Your passphrase is NOT accepted as a command-line argument or environment variable. The CLI requires an interactive terminal for secret entry. No plaintext PEM file is written during key creation or signing. However, the decrypted key and passphrase exist temporarily as strings in process memory; they are **not protected against malware, debugging, memory dumps or a compromised host**.

**Never lose your passphrase or encrypted vault**. There is no recovery or reset feature. Back up the vault securely and test your backup while you still know the passphrase. A weak or reused passphrase may be brute-forced offline by an attacker who steals the ciphertext. The minimum length check is not an entropy guarantee.

## Trust the new public key deliberately

```powershell
node src/trust-cli.mjs fingerprint .\data\signer\operator-encrypted-public.pem
```

Confirm its exact full SHA-256 fingerprint through an independent channel before enrolling it in your local operator-role trust allowlist. When you eventually rotate, **do not revoke your old operator key until you have decided what to do with its historical reports and trust policy**. The new encrypted key does not automatically replace the old one.

## Sign an existing completed job

```powershell
node src/porch-crew-cli.mjs list
node src/vault-cli.mjs sign git <completed-job-id> --i-confirm-local-signing
# Or use 'tests' for completed Docker test receipts:
node src/vault-cli.mjs sign tests <completed-job-id> --i-confirm-local-signing
```

Signing requires the vault passphrase interactively each time. It checks the existing completed receipt and signs its **original recorded outcome**, including `FAIL`, `ERROR`, `STALE` or `ABORTED_UNVERIFIED`. It never reruns work, alters a result, grants a merge or turns an uncertain job green.

Signed reports are created exclusively under Git-ignored `data/signed-reports/` with a fixed file name containing the lane and job ID. They are compatible with the existing offline `evidence-cli.mjs verify` command and optional witness/trust policy tooling. The report may contain private repository names and commit metadata. Share it only intentionally.

## Limitations and threats

- **No secure enclave, OS keychain, TPM/HSM, key rotation protocol or remote signing endpoint.**
- Existing **legacy unencrypted keys remain untouched**. You must manage their storage and lifecycle separately.
- The passphrase, decrypted PEM and derived material appear in process memory. The derived key is zeroed when finished, but JavaScript strings and memory copies cannot be reliably scrubbed.
- `scrypt` raises the cost of offline guessing; it is not a substitute for a strong unique passphrase.
- Vault files and trust policy are local filesystem data, without independently verified anti-rollback or external attestations.
- A correct signature proves key possession and report integrity, **not the honesty or independence of test execution**.

Future R1-D4B work can explore OS/hardware-backed nonexportable keys, careful migration/rotation, independently witnessed revocation, and separate-machine test reruns.
