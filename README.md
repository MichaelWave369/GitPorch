# The GitPorch

> **Pull up a chair. Push some code.**
>
> Your code. Your porch. Your rules.

**R0.1.0: local-first Git homestead.** An original, dependency-free Node.js + Git repository host with a browser dashboard and a separate read-only local Git clone endpoint. This is **not** yet a GitHub replacement, multiuser forge, or independent CI runner. We mark unfinished capabilities honestly.

## Public GitHub Pages showcase

The Pages-ready **interactive public demo** lives under [`docs/`](docs/). It uses only fictional repositories and commit examples, never the local GitPorch API or private data.

After this feature is merged, enable GitHub Pages under **Settings → Pages → Deploy from a branch → `main` / `docs`**. Expected address: https://michaelwave369.github.io/GitPorch/ (live only after GitHub Pages publishes it). See [the Pages guide](docs/PAGES.md).

## Quick start on Windows PowerShell (or any terminal)

Requirements: **Node.js 20+** and **Git** on PATH.

```bash
npm start
```

Open **http://127.0.0.1:3690**. No `npm install` required.

In another terminal, create your first repository:

```bash
node src/cli.mjs init hello-world
```

To push an **existing local** repository into GitPorch, use the actual path printed by the command (the example is a placeholder):

```bash
git remote add porch "C:/path/to/GitPorch/data/repos/hello-world.git"
git push porch HEAD:main
```

To clone from the **read-only** Git daemon while `npm start` is running:

```bash
git clone git://127.0.0.1:9418/hello-world.git
```

To inspect repository object integrity and run the built-in tests:

```bash
node src/cli.mjs verify hello-world
npm test
```

`verify` runs `git fsck`. It is **not** a build test, malware scan, or security certification.

### Configuration

- `GITPORCH_DATA_DIR`: location of the private runtime data directory, default `./data`.
- `GITPORCH_HTTP_PORT`: dashboard/API port, default `3690`.
- `GITPORCH_GIT_PORT`: read-only clone port, default `9418`.
- Both listeners bind to `127.0.0.1`, not LAN or public interfaces.

```powershell
$env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
node src/cli.mjs init MyProject
npm start
```

## Actually implemented in R0

- Bare Git repository creation, listing and object-integrity checks through a local CLI.
- Real Git branch and commit evidence in the browser dashboard.
- Local filesystem Git pushes, loopback-only read-only `git://` cloning.
- Read-only HTTP API with no browser mutations, no authentication claims and no public-network exposure.
- Native `node --test` suite; does not require GitHub Actions or any npm dependency downloads.
- **Showcase mode** if the local API is not available: fictional sample repositories are explicitly labeled.

## PhiBots Clubhouse (local R0.3)

The Clubhouse records **local contributor labels, proposals referencing actual Git commits, and operator review notes**. It does not authenticate human or bot identity, certify any test, run build scripts, or merge branches.

```bash
node src/clubhouse-cli.mjs register helper-bot builder "Example Helper"
node src/clubhouse-cli.mjs list
# After you create/push a real repo commit to the local GitPorch:
node src/clubhouse-cli.mjs propose helper-bot hello-world <full-commit-sha> "Improve the README"
# Review decisions only after manual operator inspection:
node src/clubhouse-cli.mjs decide <proposal-uuid> ACCEPTED "Reviewed locally" --confirm-local-review
```

These receipt files stay under ignored `data/crew/`. They are checksum-protected against accidental changes, **not signed, tamper-proof, append-only, or backed by authenticated identities**. See [Clubhouse rules](docs/CLUBHOUSE.md). The local dashboard has a read-only clubhouse view at `#clubhouse`. The public GitPage uses separate fictional examples.

## The Porch Crew R1-A: independent Git integrity worker

The Porch Crew first slice runs **real local Git object integrity checks** using `git fsck`. This is not automated testing, authenticated CI, a sandbox, or permission to merge. Neither GitHub nor GitHub Actions is needed to queue or execute a check.

```bash
node src/porch-crew-cli.mjs enqueue hello-world
node src/porch-crew-cli.mjs work-once
node src/porch-crew-cli.mjs list
```

First create `hello-world` and push a real commit. Empty repositories cannot pass integrity checks. The running local dashboard shows the read-only Workshop at `http://127.0.0.1:3690/#workshop`, and read-only JSON at `GET /api/porch-crew`.

`PASS` means **Git integrity check passed for the recorded HEAD**, *not* a project build, test, or security audit. Changed repository HEAD => `STALE`. A killed worker remains `RUNNING_UNCERTAIN`, never green. An exclusive `data/porch-crew/worker.lock` prevents two workers from running together; after a crash, inspect and back up the queue before manually addressing the lock. Read [Porch Crew safety and recovery](docs/PORCH_CREW.md).

## The Porch Crew R1-B: opt-in container tests

This adds an **optional local test runner** for Node.js repositories. Unlike R1-A's Git integrity-only check, the R1-B worker actually executes `node --test --test-reporter=tap` **inside** a restricted Docker container. It requires Docker Engine installed and an **already-loaded, immutable Node 22 Alpine image**. It **never installs packages**, downloads images, pulls dependencies, or runs repository scripts on your Windows host.

```powershell
# Only on your local PC, when Docker is installed and trusted:
docker pull node:22-alpine
docker image inspect --format '{{.Id}}' node:22-alpine
# Copy the returned sha256:<64-hex> image ID below.
node src/sandbox-cli.mjs preflight sha256:<64-hex-image-id>
node src/sandbox-cli.mjs enqueue hello-world sha256:<64-hex-image-id>
node src/sandbox-cli.mjs work-once --i-approve-container-tests
node src/sandbox-cli.mjs list
```

The worker stages the pinned repository commit as a tar archive, then uses `docker run` with `--pull=never`, `--network none`, `--read-only`, dropped capabilities, non-root user, a bounded tmpfs, CPU/memory/PID limits and a 90-second deadline. Its command is fixed to built-in Node tests; no repo-provided GitHub Actions YAML is read. Docker isolation still has residual risks, and **this is intended only for trusted local repositories**.

**R1-C evidence hardening:** The worker compares the inspected local Docker image ID (or explicitly matching RepoDigest) to the immutable image recorded in the queued job. It rejects mismatches before running tests, requires a consistent TAP summary, and stores SHA-256 hashes of container stdout/stderr alongside the observed image ID and Docker CLI exit status. This is local metadata, **not a signed attestation or proof of independence**. `preflight` inspects the image without launching it. Real Docker and full Windows verification are still required.

See [R1-B/C operator guide](docs/SANDBOX_TESTS.md) for limitations, status semantics and recovery. The local read-only dashboard shows these receipts at `http://127.0.0.1:3690/#sandbox`. Public GitHub Pages receives no job data.

## R1-D1: The Recovery Doctor

A local operator can inspect interrupted worker queues without executing jobs or silently changing results:

```powershell
node src/recovery-cli.mjs doctor
# Only AFTER verifying the original worker has stopped and the lock is absent:
node src/recovery-cli.mjs abandon git <job-id> "Operator confirmed worker stopped" --i-confirm-no-worker-running
# Or for container tests:
node src/recovery-cli.mjs abandon tests <job-id> "Container inspected and stopped" --i-confirm-no-worker-running
```

The only permitted manual outcome is **`ABORTED_UNVERIFIED`**, never a pass or successful test. Existing worker locks cause recovery to refuse, and it does not kill processes, remove locks or re-run tests. A partial manual recovery can be completed only when its existing checksum-validated abandonment receipt has the same operator reason. **Never delete a lock until independently verifying no worker/container is running and backing up your local data.** See [Safe Recovery Guide](docs/RECOVERY.md). No signed attestations or automated restart safety claims are made.

## R1-D2: Offline signed local reports

A completed Git integrity check or opt-in Docker test run can be **manually signed** with an Ed25519 key stored only on the local machine. Another person can verify the signature **offline** using a separately trusted public key. **A valid signature proves who held the signing key and that signed bytes have not changed, not that the run was truthful, independently witnessed or passed.** The private key generated in this first pilot is **unencrypted**; protect it with OS ACLs and never publish it.

```powershell
node src/evidence-cli.mjs keygen --i-accept-unencrypted-private-key
node src/evidence-cli.mjs sign git <completed-job-id> .\data\signed-reports\git-report.json --i-attest-local-result
node src/evidence-cli.mjs verify .\git-report.json .\data\signer\operator-public.pem
```

Signing does not run any tests, overwrite completed results, or change the underlying outcome. Signed JSON can reveal repository names and commit identities, so share only deliberately. [Read the signing and verification guide](docs/SIGNED_EVIDENCE.md).

## R1-D3: Second-key offline witness

The operator may send an **already signed local job report** to another trusted person, who checks its operator signature and signs the exact report hash with a **different Ed25519 key**. A third party can verify **both** signatures offline, with independently trusted public keys. It preserves recorded `PASS`, `FAIL` or `ABORTED_UNVERIFIED` outcomes.

```powershell
# Ideally on the witness's separate computer. The private key is unencrypted:
node src/witness-cli.mjs keygen "$env:USERPROFILE\GitPorchWitnessKeys" --i-accept-unencrypted-witness-key
node src/witness-cli.mjs sign .\data\incoming\operator-report.json .\data\incoming\trusted-operator-public.pem "$env:USERPROFILE\GitPorchWitnessKeys\witness-private.pem" .\data\signed-reports\witness-report.json --i-confirm-signature-only
# Verifier with separately trusted keys:
node src/witness-cli.mjs verify .\data\incoming\operator-report.json .\data\signed-reports\witness-report.json .\data\incoming\trusted-operator-public.pem .\data\incoming\trusted-witness-public.pem
```

**Two signatures do not prove two independent machines or that the test actually ran.** They establish only that distinct key holders signed and countersigned the particular record. No remote services or automatic merge actions are added. See [R1-D3 operator guide](docs/WITNESS.md).

## R1-D4A: Offline public-key trust and revocation

A valid Ed25519 signature is only useful if the verifier separately approves the signing keys. This opt-in local registry enrolls operator and witness public keys by confirmed fingerprint and refuses unknown or revoked keys.

```powershell
node src/trust-cli.mjs fingerprint .\data\incoming\trusted-operator-public.pem
node src/trust-cli.mjs enroll operator .\data\incoming\trusted-operator-public.pem sha256:<64-hex> --i-verified-fingerprint-out-of-band
node src/trust-cli.mjs enroll witness .\data\incoming\trusted-witness-public.pem sha256:<64-hex> --i-verified-fingerprint-out-of-band
node src/trust-cli.mjs verify .\data\incoming\operator-report.json .\data\incoming\witness-report.json
node src/trust-cli.mjs revoke witness sha256:<64-hex> "Key retired" --i-confirm-revocation
```

The registry is stored in ignored `data/trust/`. Its revocation checksums **do not make it signed, immutable or rollback-proof**. Revoked keys are rejected even for old reports under the current local policy. This does not prove test execution. See [Trust Policy Guide](docs/TRUST_POLICY.md).

## R1-D4B1: Optional password-encrypted local operator key

Generate a **new** Ed25519 operator key whose private material is stored in an encrypted vault (scrypt + AES-256-GCM) under ignored `data/signer/`. A hidden interactive passphrase prompt is required; no passphrase is accepted on the command line. **Existing unencrypted keys are not converted or deleted.**

```powershell
node src/vault-cli.mjs keygen --i-accept-password-vault
node src/vault-cli.mjs public
node src/vault-cli.mjs sign git <completed-job-id> --i-confirm-local-signing
```

Signed reports remain compatible with existing offline verification; they retain their actual PASS/FAIL/ABORTED_UNVERIFIED status. Decrypted key material exists briefly in process memory, so encryption does **not** protect against a compromised host. Protect and back up your strong vault passphrase: there is no recovery. See [Encrypted Operator Key Guide](docs/ENCRYPTED_KEYS.md).

## R1-D4B2A: Stage an encrypted-vault passphrase change

This provides an **opt-in, nondestructive rewrap** of the current encrypted operator key, generating a new encrypted copy with the **same Ed25519 fingerprint** and a **different passphrase**, salt and nonce. It keeps the original encrypted vault untouched; nothing switches or revokes automatically.

```powershell
node src/vault-cli.mjs rewrap --i-confirm-new-encrypted-copy
node src/vault-cli.mjs verify-next
# Optional: use staged key for a new completed job, without changing default vault:
node src/vault-cli.mjs sign-next git <completed-job-id> --i-confirm-local-signing
```

This is **passphrase rotation, not signing-key identity rotation**. It cannot make a compromised private key safe, and revoking its unchanged public fingerprint would affect both encrypted copies. [Read the safe rewrap guide](docs/VAULT_REWRAP.md).

## NOT yet implemented

Remote pushes, SSH access, accounts/permissions, PRs/issues, encrypted transport, production CI isolation, independently re-executed builds or attested runners, automated mirroring, TMC integration, or production network deployment.

```text
Browser (http://127.0.0.1:3690)      Git client
          |                                |
      GET-only API                 read-only git://
          |                                |
       Node HTTP                    git daemon
          +---------------+----------------+
                          |
                 local bare Git repos
                   data/repos/*.git
                          ^
                local filesystem git push
```

**Security boundary:** This is a single-user **localhost prototype**, not a remotely deployable platform. `git://` is unencrypted and unauthenticated. Do not expose ports 3690 or 9418 through LAN forwarding, tunnels, or reverse proxies. See [SECURITY.md](SECURITY.md).

See [the development roadmap](docs/ROADMAP.md) for The Porch Crew independent CI plans.

**Ledger Above Ego. Build outward. Circle back.**

Created by PHI369 Labs / Parallax. MIT licensed.
