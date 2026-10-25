# GitPorch HomeNode R1-H1: offline Git snapshots

**Scope:** local-only inventory and single-repository, checked, immutable-named Git bundle snapshots. This is an initial building block for a PhiOS HomeNode, **not** LAN hosting, a GitHub backup of all account metadata, or automatic mirroring.

Requires Node.js 20+ and Git installed. No npm dependency installation, cloud credentials or internet connection required for these commands once GitPorch itself is available locally.

## Local-first operator steps

On the computer where the GitPorch repository exists:

~~~powershell
npm test
npm run homenode -- inventory
# Create a separate existing destination directory on your backup disk once:
New-Item -ItemType Directory -Force 'E:\PhiOSBackups'
npm run homenode -- backup PhiOS 'E:\PhiOSBackups'
# Copy the absolute path returned in the successful command output:
npm run homenode -- verify 'E:\PhiOSBackups\gitporch-PhiOS-<generated-id>'
~~~

The repo name is an **already present local GitPorch repo**, not a GitHub URL. `backup` will refuse an empty Git repository with no refs. For multiple repositories, issue a command per repo: there is no automated GitHub account sweep in this release. `inventory` inherits the GitPorch 2,048-local-repo capacity; it does not certify that all repos on GitHub are present.

For each successful backup, HomeNode creates a newly named directory containing:

- `repository.bundle`: a complete bundle of reachable Git history and refs available to `git bundle create --all`.
- `snapshot.json`: source repo name, snapshot time, ref object IDs, byte length and SHA-256 checksum.

Before reporting success, the tool clones the bundle as a separate bare mirror, runs `git fsck`, and compares the recovered refs with the source's recorded refs. It also aborts if source refs changed during creation, refuses destinations within the GitPorch data directory, and does not overwrite any existing snapshot. The command never alters the original repository or starts a server.

## Recovery drill (manual, into a NEW location)

After a successful `verify`, restore **to a different nonexisting directory**. Run this on a machine that already has Git installed:

~~~powershell
# Use the real snapshot directory generated above.
git clone --mirror 'E:\PhiOSBackups\gitporch-PhiOS-<generated-id>\repository.bundle' 'D:\Recovered\PhiOS.git'
git --git-dir='D:\Recovered\PhiOS.git' fsck --full --no-reflogs
~~~

Do not restore over the only live copy. Compare branches and tags before manually reconnecting a recovered repo to GitPorch. Private keys, credentials and runtime state require separately protected backups.

## What this DOES NOT protect

- Git LFS blobs (pointers are in Git, content is managed separately), GitHub issues/PRs/comments, release files, Actions artifacts, GitHub Pages configuration, submodule target repositories or wiki repos.
- GitPorch runtime queues, encrypted key vault, repo hooks/config or other `data/` directories.
- Refs that were absent at snapshot time; Git objects no longer reachable from any ref.
- Physical disk failure when the backup remains on the same disk; tampering with both the snapshot and unsigned manifest.

Maintain separate offline backups, confirm their restore paths, and keep a copy **off the server**. The SHA-256 receipt detects incidental corruption relative to its manifest, but is not a signature or adversarial tamper-proof attestation.

## EnterTheField.org and PhiOS server switching

This phase does not modify EnterTheField.org or expose a network service. Its public website can retain a **Public/Local** selector in a future integration, but private `127.0.0.1` is reachable only from the browser's own computer, not your HomeNode on another machine. LAN service requires separate authenticated HTTPS/SSH transport, device discovery or split-horizon DNS, and browser security/CORS review. A public DNS record cannot turn a LAN-only address into a globally reachable service. Do not proxy or port-forward the existing GitPorch 3690/9418 endpoints: they are intentionally unauthenticated and localhost-only.

**Acceptance criteria for R1-H1:** full-history bundle for a populated repo; verified restore of branches/tags; corruption fails closed; source/old backup untouched; offline operation. **R1-H2+:** complete account inventory, LFS/metadata backup, cross-device transport, trusted restore workflows and governed bidirectional sync, each reviewed separately.
