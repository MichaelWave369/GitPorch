# PhiOS R0.8: operator-reviewed GitHub LFS acquisition

**Status:** one public Git LFS object at a time, from GitHub LFS batch API with a strict download host allowlist. Requires an already verified local GitPorch repository and a tracked canonical Git LFS pointer. This is **not** an automated LFS sync, a full backup, or a GitHub source authenticity certification.

R0.6 audits LFS pointers and submodule references. R0.7 preserves an already available local payload. R0.8 can request the real bytes from GitHub with explicit operator approval and independently validate them against the local Git pointer.

## Prerequisites and exact scope

- Local GitPorch checkout with Node.js 20+ and Git; a PUBLIC_ONLY catalog for the exact owner MichaelWave369.
- Already imported GitPorch bare mirror, validated with R0.2.
- A real named Git branch and tracked file containing a canonical three-line Git LFS pointer.
- An existing, non-symlink asset root outside GitPorch data, with enough free space. **One object at most 64 MiB** in this pilot.
- Permission to download and preserve the asset; honor licensing and GitHub's bandwidth/usage rules.

Run from the GitPorch checkout on the operator's own machine. Replace all sample paths and names:

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    New-Item -ItemType Directory -Force 'E:\PhiOSAssets'
    npm run homenode -- lfs-fetch-plan 'D:\PhiOSCatalog\<public-catalog>.json' PhiOS main models/model.bin 'E:\PhiOSAssets'

The plan is **offline** and has no file writes. Review the repo, branch, tracked path, Git commit, LFS SHA-256, declared bytes, destination and exact planSha256. If already verified in the local asset store, no fetch will be permitted.

## Explicit network operation

    npm run homenode -- lfs-fetch 'D:\PhiOSCatalog\<public-catalog>.json' PhiOS main models/model.bin 'E:\PhiOSAssets' '<returned-planSha256>' --i-approve-github-lfs-download

Only after approval does the tool issue:
1. HTTPS POST to the fixed address github.com/MichaelWave369/<public-repo>.git/info/lfs/objects/batch, with the Git LFS download transfer request for one exact object SHA-256 and byte count.
2. If GitHub returns a valid matching object and basic-transfer action, one HTTPS GET to the exact action location. The hostname must be one of media.github.com, objects.githubusercontent.com, media.githubusercontent.com, or github-cloud.s3.amazonaws.com.

It refuses all other hosts, HTTP, embedded URL credentials, non-443 ports, redirects, unreviewed action headers, unexpected object IDs and sizes, mismatched content-length, oversized streaming responses and bad SHA-256. Object bytes are staged in a new temporary file, digest/size-checked and installed by a no-overwrite hard link under the local asset store's content-addressed objects/sha256/<prefix>/<oid> directory. There is no automatic retry or fetch beyond this exact object. A failure removes the staged object without overwriting a prior one.

The Git branch and selected pointer are independently reverified after the network phase to catch drift. The final store object is rehashed after publication. Use the earlier R0.7 lfs-verify command to check it again offline.

## Optional credential

For GitHub LFS repositories that require an authenticated batch request, set GITPORCH_LFS_TOKEN in the **local process environment only**. The command reads it at execution and supplies HTTP Basic credentials only to the fixed github.com LFS batch URL. GITPORCH_LFS_USERNAME defaults to x-access-token; change it only if your account credentials require a username.

Do not put secrets in CLI arguments, Git commits, manifests, GitHub Actions variables or documentation examples. The program never prints the token, any signed action URL, raw response body, or Git network stderr. The GitHub-provided one-time action Authorization header is accepted only for media.github.com, and no operator token is automatically passed to the CDN. An unsupported GitHub storage action will fail closed; the allowlist may need a separate review if GitHub changes its media hosting.

Public LFS assets might not require a token. GitHub may reject Basic tokens depending on account/credential policy. That is an expected failure, not a reason to disable the host restrictions.

## Limits and remaining work

- This pilot has a 64 MiB hard per-object limit. Larger files are rejected rather than silently truncated. No batch pulls, auto-fetching, partial/resume transfers or scheduling.
- The selected Git mirror itself was previously imported. GitHub upstream parity and provenance of local refs are not proven merely by checking this local Git LFS pointer.
- GitHub LFS bandwidth cost, availability, upstream licensing, full Git LFS history coverage, GitHub release assets, submodule target repositories and dependencies are not addressed.
- A matching SHA-256 payload does not mean the file is safe to execute or load as a plugin. The tool never does so.
- An asset root that is a different **path** might not be a physically independent disk; actual off-host media and disconnected WAN recovery remain separate field tests.
- CI exercises intercepted HTTP in unit tests and does not perform a real GitHub LFS download or validate an operator's Windows storage.

## Developer acceptance

    npm test
    node --test test/homenode-lfs-download.test.mjs

Tests use local Git pointers and an injected mock HTTP client to prove the exact POST/GET flow, SHA-256 preservation and separate readback, stale plan denial, redirects rejected, action host allowlist, response OID/size mismatch, corrupted or oversized byte counts, secret-bearing token not sent to CDN/output, local Git branch drift during acquisition, and CLI approval failure without network access.

The API behavior follows the documented Git LFS Basic Batch/Transfer protocol. It is intentionally narrower than arbitrary third-party LFS servers.

**Next:** the operator-machine network acceptance test, then a bounded multi-object manifest with digest receipts, and separate submodule/release preservation policies.

**Ledger Above Ego. DONE Means Verified.**
