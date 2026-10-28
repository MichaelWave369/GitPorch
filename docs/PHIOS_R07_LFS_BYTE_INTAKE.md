# PhiOS R0.7: operator-approved local Git LFS byte intake

**Purpose:** preserve verified contents of ONE Git LFS object that is already present as a local file. The object is addressed by SHA-256 in a separate storage directory. This release does not fetch files from GitHub, authenticate LFS endpoints, run binaries, scan all history or prove off-device backup.

## Why R0.7 is narrower than "download every LFS file"

An R0.6 pointer tells us the advertised SHA-256 digest and exact byte count. It does not establish that any copy of those bytes exists. Batch download requires a separate, authenticated LFS API flow with bounded requests, domain pinning, size controls and security review. R0.7 instead lets an operator supply a known local payload, and then verifies the bytes against the actual pointer stored in the already verified GitPorch bare mirror. It never trusts a supplied filename, extension or sidecar manifest as proof.

## Preconditions

- A public-only GitPorch catalog for the **exact** account MichaelWave369.
- An already-imported, integrity-verified local bare Git mirror of the selected repository.
- An existing local file that you believe corresponds to the tracked LFS pointer.
- An existing absolute asset-root directory outside the live GitPorch data tree. Choose independent physical media for a meaningful backup, but the program cannot confirm drive independence.
- The exact branch and tracked relative file path containing the LFS pointer. This pilot scans one selected branch-tip tracked file, not the entire Git object history.
- Node.js 20+ and Git. No Git LFS client required; no network connections are created.

Limit: **64 MiB per object per invocation**. This first rung is intentionally bounded and will reject larger files; do not split or rename objects to bypass their expected SHA-256.

## Phase 1: offline preview, no writes

Change these Windows PowerShell examples to the actual local paths, branch, repo name and tracked Git path:

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    New-Item -ItemType Directory -Force 'E:\PhiOSAssets'
    npm run homenode -- lfs-plan 'D:\PhiOSCatalog\<actual-catalog>.json' 'PhiOS' 'main' 'models/model.bin' 'D:\AssetImports\model.bin' 'E:\PhiOSAssets'

This command verifies: exact public repository identity; current local Git objects via R0.2; selected branch commit; tracked regular file (not a symlink or submodule); canonical LFS pointer; the local payload's real byte length and SHA-256; existence/integrity of an already stored object; and the current asset-root safety boundaries. It prints a planSha256 and EXPLICIT_APPROVAL_REQUIRED, or ALREADY_VERIFIED_NO_WRITE_NEEDED if that exact byte object has already been saved.

No source, snapshot or stored object is modified during planning. SHA-256 plan fingerprints are drift guards, NOT authenticated GitHub identities, operator signatures or physical media proofs.

## Phase 2: explicit content-addressed intake

After reviewing the preview, pass back the returned planSha256 and literal operator approval:

    npm run homenode -- lfs-intake 'D:\PhiOSCatalog\<actual-catalog>.json' 'PhiOS' 'main' 'models/model.bin' 'D:\AssetImports\model.bin' 'E:\PhiOSAssets' '<planSha256>' --i-approve-lfs-byte-intake

The CLI rechecks the Git pointer and local file before copying. It creates only the necessary content-addressed object directory under the chosen asset root. The byte file is staged with a random temporary name, rehashed after copying, and published via an atomic no-overwrite hard link. The staging file is removed. If the selected filesystem does not support hard links, this version fails rather than risk replacing another object. No file is ever executed, interpreted or loaded as a plugin.

A successful receipt reports LOCAL_LFS_BYTES_VERIFIED_ONLY. It is printed to stdout and contains digest and byte length, not original file contents or any access token.

## Phase 3: independent local readback

Remove or disconnect the *original input file* if appropriate, then verify the saved content from the store:

    npm run homenode -- lfs-verify 'D:\PhiOSCatalog\<actual-catalog>.json' 'PhiOS' 'main' 'models/model.bin' 'E:\PhiOSAssets'

This does not need the original input file. It independently hashes the stored bytes and compares byte length + SHA-256 against the selected tracked Git pointer.

Expected statuses: NOT_STORED; STORED_OBJECT_UNSAFE_OR_INVALID; or LOCAL_LFS_BYTES_VERIFIED_ONLY. It never silently repairs or overwrites corrupt stored objects.

## Security and completeness boundaries

- The Git subprocess has file-only protocol, disabled global/system configuration, no interactive credentials and no Git LFS smudge or download.
- Rejects unsafe directory traversal, symlink/redirected root and payload paths, malformed pointers, data-store overlap, missing refs, remote/private catalogs, stale plan fingerprints, mismatched bytes and preexisting invalid objects.
- No GitHub API, LFS Batch API, release downloads, submodule checkout, binary execution or network listener.
- One object at one branch tip is **not** full LFS preservation, nor source GitHub parity, backup of external releases, verified licensed redistributability or an installable operating system.
- SHA-256 is an object-integrity check. It does not authenticate where the upstream bytes came from, verify external device independence or establish cryptographic authorship. Keep a second independently verified physical copy.

## Developer checks

    npm test
    node --test test/homenode-lfs-intake.test.mjs

Fixture tests include a genuine Git commit with a literal canonical LFS pointer, valid byte intake, readback after removing the source payload, stale fingerprint, altered and short files, existing same-hash and corrupted objects, symlink/directory boundaries, foreign/private catalog denial, 64 MiB guard, CLI explicit approval, and hostile Git config injection. CI runs against synthetic local Git fixtures, not against a real user's Windows machine or a physical off-host disk.

**Future rungs:** authenticated operator-approved GitHub LFS byte acquisition; bounded manifests for full LFS history; separate submodule repository provenance; immutable release-asset backups; and full physical WAN-disconnected PhiOS boot/restore qualification.

**Ledger Above Ego. DONE Means Verified.**
