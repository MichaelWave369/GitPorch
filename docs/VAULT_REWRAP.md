# GitPorch R1-D4B2A: Nondestructive passphrase rewrap

This milestone allows the owner to **change the passphrase protecting an existing Ed25519 encrypted operator vault without changing the cryptographic signing identity**. It creates a second encrypted copy with a fresh scrypt salt and AES-GCM nonce. It does not overwrite, delete, rename, migrate, revoke, enroll or activate any key automatically.

**This is passphrase rotation, not private-key rotation.** Both old and staged encrypted files decrypt to the same Ed25519 private key and have the same public fingerprint. If the old private key was compromised, this step does NOT restore trust. Generate a separate signing identity and handle public-key enrollment/revocation independently.

## Stage a new passphrase, without touching the old vault

Requirements: Existing `data/signer/operator-encrypted.json` created with the previous encrypted vault feature, Node.js 20+, an interactive PowerShell terminal.

```powershell
node src/vault-cli.mjs rewrap --i-confirm-new-encrypted-copy
```

The CLI prompts (without echo) for the current passphrase, new passphrase, and its confirmation. It requires a changed passphrase and uses scrypt and authenticated AES-256-GCM with new randomness. It verifies the encrypted candidate in memory before exclusive-writing `data/signer/operator-encrypted-next.json`. If that file already exists, the command **refuses** to overwrite it. Incorrect old passphrases or tampering result in no new vault.

**Never publish either vault or its passphrase.** Both files stay in Git-ignored `data/signer/`. Protect OS file permissions and store a secure, independent backup before using this feature.

## Verify and optionally sign with the staged vault

```powershell
node src/vault-cli.mjs verify-next
node src/porch-crew-cli.mjs list
node src/vault-cli.mjs sign-next git <completed-job-id> --i-confirm-local-signing
```

`verify-next` interactively unlocks the staged vault and confirms it still has the original public fingerprint. The test checks its signing ability in memory and outputs only the fingerprint and status. `sign-next` first verifies the staged vault still matches the original signing fingerprint, then unlocks **the staged vault specifically** and signs an already completed job with the existing local report format. It neither changes the default `sign` command nor promotes failing/uncertain work to PASS. The default command `vault-cli.mjs sign` continues using the original vault.

Do not expect two reports for the same job: signed report paths are exclusive and based on job ID, not vault copy. If one already exists, the signer refuses to overwrite it. Test with a newly completed job you are willing to sign.

## No automatic activation, replacement, deletion or revocation

The staged vault remains a separate copy and the original vault is preserved byte-for-byte. There is **no activate, force, remove-old, or unlock-lost-passphrase command**. When you decide to retire the original encrypted copy, back up everything and handle storage cleanup manually, after verifying the next copy and your disaster-recovery plan. This software does not establish whether any particular filesystem backup should be deleted.

Because the **public key identity is unchanged**, the trusted public-key allowlist and existing signatures are unaffected. Revoking that public fingerprint would revoke **both** copies under current policy. A genuine signer-identity rotation requires an entirely new keypair, a new independently confirmed fingerprint, explicit enrollment, and a deliberate plan for historical reports.

## Security limits

- The vault is passphrase-encrypted at rest, not TPM/HSM protected. A compromised computer or process memory can reveal both passphrases and decrypted key.
- Changing the passphrase **does not undo** prior key exposure, and both vaults can still sign while they exist.
- New vault creation uses `wx` to reject overwrites and compares public key fingerprints; it cannot protect against an attacker controlling the machine or its filesystem.
- No trustworthy timestamp, encrypted trust-policy rollback protection, independently executed CI or automatic merge authority is created.
- The new passphrase must be strong, unique, backed up securely, and never entered on a command line or into an environment variable.
