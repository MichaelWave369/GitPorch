# PhiOS R0.9: bounded multi-object LFS recovery manifest

## Purpose

R0.8 can download and SHA-256 verify **one** Git LFS object. R0.9 provides a repeatable, read-only report of the **canonical LFS pointers detected at one explicitly selected public Git branch tip**, so an operator can see whether that chosen source revision has all of its detected LFS payload bytes available locally.

This is deliberately not a whole-repository, all-history, all-branch or all-external-asset certification.

## Offline operator example

Prerequisites: Node.js 20+, Git, an exact-owner PUBLIC_ONLY catalog, the previously imported verified bare Git mirror, and a local content-addressed asset store. The asset store must be an existing real directory outside the GitPorch data directory.

Run from a GitPorch checkout on the operator machine. Substitute actual paths:

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    npm run homenode -- lfs-manifest 'D:\PhiOSCatalog\<actual-catalog>.json' PhiOS main 'E:\PhiOSAssets'

The command writes a JSON report **only to stdout**. To retain evidence, operators may redirect it to a separate existing evidence folder, ensuring that they do not overwrite prior receipts. The manifest's SHA-256 digest is an UNSIGNED change detector, not an authenticated attestation. Sharing source path listings can reveal project filenames; treat stored reports as operator records rather than publishing them automatically.

## What is inspected

1. Validate the catalog has exact public owner MichaelWave369 and the repo is an eligible named source.
2. Reuse R0.2's existing local bare-repository Git fsck/integrity checks.
3. Pin one selected branch ref to its resolved commit. Enumerate the tracked tree, identify Git LFS filter declarations in tracked .gitattributes, and look for canonical three-line LFS pointer files using local Git grep and blob inspection.
4. Deduplicate pointer objects by their SHA-256 content identifier. Repeated tracked paths pointing to identical content count as a single external payload.
5. For each detected pointer, inspect the expected content-addressed file beneath objects/sha256/<prefix>/<oid> in the selected asset store, checking exact byte count and streaming SHA-256. Never follow symlinked store components or count an invalid file as covered.
6. Re-resolve the branch ref at the end; if it moved, reject the incomplete report.
7. Print deterministic object statuses, totals and an unsigned manifest SHA-256 fingerprint. No existing file is created, modified, repaired, deleted, downloaded or executed.

## Statuses

- ALL_DETECTED_TIP_LFS_BYTES_VERIFIED_ONLY: every detected canonical LFS pointer's bytes match the locally stored payload. This says **nothing** about other branches, history, submodules, releases or independent disks.
- DETECTED_TIP_LFS_GAPS: one or more detected objects are absent, corrupt, unsafe or otherwise not verified.
- NO_CANONICAL_TIP_LFS_POINTERS_DETECTED_UNVERIFIED: none detected at the selected branch tip. This is **not** a claim that Git LFS was never used.

Each individual object has one status:
- LOCAL_LFS_BYTES_VERIFIED_ONLY: actual local bytes match SHA-256 and recorded length.
- NOT_STORED: the expected object does not exist.
- UNSAFE_OR_CORRUPT_LOCAL_OBJECT: an object, store path or its digest/size fails local validation.

Records also include the tracked branch-tip paths pointing to each object. Objects larger than the 64 MiB R0.8 download pilot receive r08PilotDownloadEligible=false, even if they are recorded as missing.

## Safety and scale caps

The scanner fails closed if one selected branch tip contains more than 30,000 tracked entries, 256 canonical-pointer candidates, 64 unique LFS payloads, 64 attribute files, or an aggregate declaration exceeding **256 MiB**. An oversized pointer blob or malformed header-bearing candidate also fails the entire manifest. No partial output may be misread as a complete result.

The command uses a file-only restricted Git environment; Git global/system configuration, Git LFS automatic smudge and remote transports are disabled. It does not send network requests, make unattended retry attempts, inspect unrelated local private repositories for output, or allow source code execution.

## Recovery workflow

For any NOT_STORED object eligible under the R0.8 64 MiB per-object pilot:
1. Review the trackedPath, commit and object SHA-256 in R0.9.
2. Use R0.8's offline lfs-fetch-plan for **one specific tracked file** and confirm the plan fingerprint.
3. Execute the approved lfs-fetch command separately if authorized. GitHub may return an unsupported storage host or authentication failure; do not weaken restrictions without code review.
4. Repeat R0.9. Watch the verified count increase. For corrupted store objects, review and resolve outside this audit; no automatic overwrite or repair occurs.

When an object is bigger than the pilot transfer cap, arrange a separately reviewed transfer path rather than attempting to bypass the limits. No automatic bulk download is implemented here.

## Claims explicitly NOT proved

This audit cannot establish:
- Source authenticity or current GitHub upstream ref parity.
- Historical Git LFS objects removed from the selected branch tip.
- Objects on other branches, even if GitPorch has them.
- Missing LFS references with malformed headers not detected by canonical pointer scanning.
- Preservation of submodule targets, GitHub release assets, dependencies or user data.
- Physically independent backup media, a powered-off network, offline application launch or PhiOS boot.
- Security of downloaded assets or permission to execute or redistribute them.

## Test coverage

    npm test
    node --test test/homenode-lfs-manifest.test.mjs

Synthetic local Git fixtures exercise deduplicated pointers, multiple object coverage, missing bytes, SHA-256 corruption, no-pointer branch, oversized pilot entry, malformed pointer failure, private/foreign catalog rejection, symlink safety, over-cap refusal and CLI repeatability.

GitHub Actions CI is NOT a live offline machine or external-disk acceptance run. A true fully disconnected recovery test remains separate.

**Ledger Above Ego. DONE Means Verified.**
