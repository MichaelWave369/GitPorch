# PhiOS R0.12: operator-approved, SHA-256 verified GitHub Release asset archive

**Goal:** preserve the *actual bytes* of one public GitHub Release attachment, not merely a Git tag or attachment metadata row. A successful R0.12 receipt proves local contents match the SHA-256 GitHub published at the time of approval. It does **not** authenticate the publisher's signing key or establish that all external dependencies are backed up.

## Step 1: capture R0.11 public inventory

From your GitPorch checkout with Node.js 20+, run the explicit R0.11 public inventory command and redirect its stdout into a **new** JSON file outside your archive root. For example, in Windows PowerShell:

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    npm run homenode -- release-inventory 'D:\PhiOSCatalog\<actual-catalog>.json' PhiOS --i-approve-public-release-lookup | Set-Content -Encoding utf8 'D:\PhiOSCatalog\phios-public-releases-snapshot.json'

Check that the output contains a published release asset with an **actual SHA-256 digest**. GitHub Releases and GitHub Actions artifacts are different services. A release with no SHA-256, a failed inventory, or an attachment larger than this pilot's limit is not supported by this rung.

## Step 2: offline, read-only plan

Pick the exact public numeric asset ID from the saved R0.11 JSON:

    npm run homenode -- release-archive-plan 'D:\PhiOSCatalog\<actual-catalog>.json' 'D:\PhiOSCatalog\phios-public-releases-snapshot.json' PhiOS 1234567 'E:\PhiOSArchive'

The path E:\PhiOSArchive must already exist and must not be a symlink or part of live GitPorch data. The plan inspects the saved JSON (maximum 2 MiB), validates its **unsigned** manifest fingerprint, pins the exact public repo/release tag/release ID/asset ID/name/size/SHA-256 and checks whether a correct archive copy already exists. Output status EXPLICIT_APPROVAL_REQUIRED means no bytes have been downloaded or written. The planSha256 is a *plan-drift guard*, not a signature or authority to operate silently.

The pilot refuses assets above **64 MiB**, assets without an authoritative published SHA-256 value in GitHub's R0.11 REST response, missing source rows, damaged previously archived files, unsafe archive directories and a source manifest inside the archive root.

## Step 3: explicitly approved one-file download

After reviewing the plan and SHA-256 fingerprint, run:

    npm run homenode -- release-archive 'D:\PhiOSCatalog\<actual-catalog>.json' 'D:\PhiOSCatalog\phios-public-releases-snapshot.json' PhiOS 1234567 'E:\PhiOSArchive' '<planSha256>' --i-approve-release-download

Only then:
1. GitPorch **re-queries current public R0.11 release metadata**, within its 20-release, 100-asset-per-release and 200-total bounds, and checks that the selected release ID/tag and asset ID/name/size/published SHA-256 have **not changed**. This may issue multiple metadata GETs but does not download their asset bytes.
2. GitPorch makes one GitHub REST **GET https://api.github.com/repos/MichaelWave369/<exact-repo>/releases/assets/<numeric-id>** with Accept: application/octet-stream. It does not request an arbitrary URL from user input or from remote JSON.
3. The REST API may return the binary directly (200) or a manual 302/307 redirect. Only one HTTPS redirection to **release-assets.githubusercontent.com** or **objects.githubusercontent.com** is permitted. Signed URL query parameters are allowed only on those exact hosts. Redirect credentials, non-default ports, fragments, HTTP, local IPs, any second redirect or alternate hosts fail closed. The user token is never forwarded to the CDN.
4. The response is streamed to a private new temporary file in the destination archive. Its actual length must match the published size, and both streaming and independent reread SHA-256 must match the published digest. Overlong, truncated, tampered or JSON responses fail; the staged file is removed.
5. The verified object is atomically published via a **no-overwrite hard link**, under E:\PhiOSArchive\releases\sha256\<first-two-hex>\<full-sha256>. No extraction, installation, execution, file type dispatch, hook, retry, scheduled sync or overwrite occurs.
6. Offline readback validates the published object again before a success receipt is printed.

Optional environment token: GITPORCH_RELEASE_TOKEN. Supply a **read-only scoped** token only if needed by GitHub. It is read during the *approved download*, sent solely to api.github.com as HTTP Bearer for that exact asset request, never stored in the result or passed to a CDN. Public APIs may work without it. Errors suppress raw remote responses, signed URLs and credentials.

**Host policy tradeoff:** GitHub may change its release-asset delivery infrastructure. If a real download is rejected because its final host is not explicitly allowed, the command must stop; a security review and tests are required before expanding the policy. Never disable manual redirects to force success.

## Step 4: later offline readback, including without the network

    npm run homenode -- release-archive-verify 'D:\PhiOSCatalog\<actual-catalog>.json' 'D:\PhiOSCatalog\phios-public-releases-snapshot.json' PhiOS 1234567 'E:\PhiOSArchive'

This uses **no network** and does not require the original download URL, GitHub access or source payload file. The local SHA-256 and expected byte count are verified against the saved inventory. Statuses are NOT_STORED or LOCAL_RELEASE_BYTES_SHA256_VERIFIED_ONLY; damaged or unsafe files cause refusal, never repair.

## Security and completeness boundaries

- **One approved attachment, max 64 MiB**. No bulk download, no multi-file release completeness claim, no automatic physical drive copy and no recovery of draft/private releases, Actions artifacts, third-party install packages, Git submodule targets or Git LFS history.
- GitHub-published digest is a byte-integrity expectation, **not** a verified publisher signature, provenance or security audit. Matching bytes might still be malicious. Never run or automatically unpack preserved binaries.
- A path on a separate logical volume is not proof of independent media. For true sovereignty, test copying to separate removable media, unplugging the network, and restoring/running relevant PhiOS components without services or credentials.
- Captured metadata is an unsigned local JSON snapshot; it can be altered and rehashed. Execution always checks current GitHub data before downloading to detect changes, but R0.12 does not establish the original author's cryptographic signing identity.
- Atomic no-overwrite uses hard links; filesystems that lack hard-link support fail closed. Symlink/redirected path guards are best-effort operator-environment checks; concurrent adversarial filesystem modification still requires operating-system permission controls.

## Developer acceptance

    npm test
    node --test test/homenode-release-archive.test.mjs

Test fixtures use intercepted REST metadata and redirect responses, synthetic real binary bytes, real temporary files and actual SHA-256 checks. Cases include 200 direct stream, 302 CDN stream, remote metadata drift, exact-byte mismatch, truncated/oversize transfers, missing published hash, tampered inventory, stale plan, forbidden redirect hosts/credentials/ports/chains, token isolation, corrupted existing object, symlink exclusion, catalog/privacy boundaries, offline plan/readback and CLI explicit-approval failure.

**CI is NOT a live GitHub production download, signed-release audit, unplugged-WAN restore or Windows external-drive test.** These need explicit operator-run acceptance before the ecosystem can claim full offline recoverability.

**Ledger Above Ego. DONE Means Verified.**
