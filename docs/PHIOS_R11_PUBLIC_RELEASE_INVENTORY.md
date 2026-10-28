# PhiOS R0.11: public GitHub Release asset metadata inventory

**Intent:** close the visibility gap left by Git bundles, Git LFS pointer verification and submodule gitlinks. GitHub Release attachments are separately hosted downloadable assets. An ordinary Git clone or bundle does NOT preserve those bytes. This first rung discovers which public releases exist and which attachments are advertised. No attachment is downloaded, authenticated as a signed publisher build or copied to storage.

## Operator command: explicitly online, metadata only

Run from a GitPorch checkout with Node.js 20+, a saved exact-owner PUBLIC_ONLY catalog, and normal outbound HTTPS access:

    npm run homenode -- release-inventory 'D:\PhiOSCatalog\<actual-catalog>.json' PhiOS --i-approve-public-release-lookup

The CLI needs the exact explicit approval flag. No repository is automatically selected, no URL is accepted as a CLI argument, and none of the release attachment URLs returned by GitHub are opened. The JSON report is written ONLY to stdout; the command does not mutate source repositories, copy binaries, write manifests or install programs.

For reproducibility, an operator may redirect output to a separate versioned evidence file. Do not overwrite a previous capture. The reportSha256 equivalent field is manifestSha256: this is an **unsigned JSON change-detection digest**, not a source signature or proof that the upstream assets were preserved.

## API boundaries

The tool constructs its own fixed HTTPS GitHub REST endpoints:

- GET https://api.github.com/repos/MichaelWave369/<approved-repository>/releases?per_page=20&page=1
- If the page fills, a second page is queried for overflow detection and the whole request fails if more than 20 published releases are returned.
- For each observed release, GET https://api.github.com/repos/MichaelWave369/<approved-repository>/releases/<numeric-id>/assets?per_page=100&page=1.
- If an attachment page fills, it checks the second page. More than 100 assets for one release fails closed.
- Global cap of 200 reported assets and 20 public published releases; one API response at most 1 MiB, including streamed body, and each request a 20 second timeout. No retry, no redirect, no server-selected URLs or links, no user-supplied credentials.
- The GitHub REST API may rate-limit unauthenticated requests. A 403/429 is a failed inventory, never a successful empty list.

For every release, the ledger retains public numeric ID, tag, prerelease status and published date. For every attachment, it retains numeric asset ID, safe display filename, GitHub-advertised byte size and SHA-256 if present. Duplicate IDs, ambiguous release tags, uploaded-state problems, impossible byte sizes and malformed names fail rather than silently reporting a misleading partial inventory.

GitHub's release metadata may include digest values such as sha256:<64 hex digits>. These are **published hash claims**, NOT independently computed checksums. If the digest is missing or uses an unsupported format, the report marks it NO_SUPPORTED_SHA256_PUBLISHED_UNVERIFIED, never "verified." All published SHA256 items are SHA256_PUBLISHED_NOT_YET_BYTE_VERIFIED, not recovered.

## Example status meanings

- RELEASE_ASSET_METADATA_INVENTORIED_NOT_BACKED_UP: one or more public published releases were enumerated within bounds. Nothing was downloaded or archived.
- NO_PUBLISHED_RELEASES_OBSERVED_UNVERIFIED: none were returned by this public API at inspection time. It says nothing about private/draft releases, deleted historical releases, workflows, packages or externally hosted downloads.

Summary reports count public releases, attachments, combined declared byte sizes, attachments with a GitHub-advertised SHA256 and assets without such a digest. Locally verified byte count remains zero. Every physical backup/restore and execution-safety acceptance flag remains false.

## Explicitly out of scope

- No byte preservation, SHA256 recomputation, extraction, executable inspection, signing/attestation, malware scanning or firmware/OS boot verification.
- Git tags without GitHub Releases, prerelease drafts, private repositories, GitHub Actions workflow artifacts, packages, containers, third-party binaries and dependency caches are not covered.
- The public release API does not prove that a release was built from trustworthy source or corresponds to the current local Git mirror. GitHub metadata is accessed using HTTPS but not cryptographically signed by the release publisher.
- The tool enumerates a bounded set only, and fails rather than calling that set exhaustive if a cap is exceeded.

## Developer tests

    npm test
    node --test test/homenode-release-inventory.test.mjs

Mocked HTTP tests include normal release/asset pages, stable fingerprint, published SHA-256 versus absent/unsupported digest, exact 20-release page overflow, 100-asset overflow, malformed and duplicate metadata, HTTP redirect/403/garbled JSON/oversized response, private/foreign catalog rejection, and CLI denial without the approval flag.

CI tests API-contract and security behavior with simulated responses. It does not prove a live GitHub response on the user's Windows workstation. Confirming that integration requires a subsequent real operator-approved release lookup.

## Subsequent rung

R0.12 should introduce **separate, per-asset operator-approved download plans** for exact numeric release asset IDs, strict GitHub API host/auth/redirect rules and hard file-size caps. Where the metadata has a SHA-256 digest, it must compare actual downloaded bytes to that published digest before writing a content-addressed archive. Assets without a published digest should remain UNVERIFIED until an independent trusted digest is supplied and checked. Next, perform a true off-host backup and restore drill with the WAN disconnected.

**Ledger Above Ego. DONE Means Verified.**
