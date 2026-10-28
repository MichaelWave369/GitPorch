# PhiOS R0.13: Offline recovery readiness evidence gates

## Purpose

A green GitHub Actions run proves the test suite passed in CI, not that the operator's real machine can independently restore the PhiOS ecosystem. R0.13 combines existing local evidence from R0.5 (Git bundle ref coverage), R0.9 (LFS bytes), R0.10 (submodule exact commits), and R0.12 (archived Release bytes) into one no-network scorecard.

**Bounded local evidence is NOT a physical offline recovery certification.** Even with all four eligible local gates satisfied, both physical restore and PhiOS offline-boot flags remain false.

## Requirements

Node 20+, Git, a GitPorch checkout, a PUBLIC_ONLY catalog for the exact owner MichaelWave369, a previously imported local bare mirror, and existing backup and asset-store directories. Optionally, provide an existing R0.11 saved public Release inventory and its R0.12 archive directory.

Run from the GitPorch checkout on the operator Windows machine, replacing all placeholder paths:

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    npm run homenode -- offline-readiness 'D:\PhiOSCatalog\<catalog>.json' PhiOS main 'E:\GitPorchSnapshots' 'E:\PhiOSAssets' 'D:\PhiOSCatalog\<release-inventory>.json' 'E:\PhiOSArchive'

When no saved public Release evidence is available, use **none none** as the final two arguments:

    npm run homenode -- offline-readiness 'D:\PhiOSCatalog\<catalog>.json' PhiOS main 'E:\GitPorchSnapshots' 'E:\PhiOSAssets' none none

The latter form marks Release evidence as NOT_SUPPLIED_UNVERIFIED, **blocking** a complete bounded-local result. It does not invent the claim that no Releases exist.

The command writes JSON to stdout, not to a saved file. Its reportSha256 is an unsigned repeatability fingerprint, not an attestation. Redirect stdout to a separately chosen new evidence file only when wanted.

## Four evidence gates

1. **Current Git bundle**: R0.5 must find a verified snapshot whose Git refs match the current fsck-verified local bare mirror. Missing, invalid or stale snapshots are blockers.
2. **Selected tip LFS bytes**: R0.9 must verify content SHA-256 and exact bytes for every detected canonical LFS pointer at the selected branch tip. Missing or corrupted bytes fail. Zero detected pointers is called out, never presented as full-history proof.
3. **Selected tip submodule commits**: R0.10 checks that the exact gitlink commits are reachable in individually verified public-cataloged local bare mirrors. Unapproved URLs and missing commits fail; nested dependencies and actual backup copies of target repos remain separate.
4. **Saved public Release attachment bytes**: verify up to 16 listed assets in the saved R0.11 inventory against their archived content using R0.12 offline SHA-256 checks. Missing digests, corrupt files, unsupported larger files and missing content fail. More than 16 items returns an explicit scope blocker instead of a partial pass; zero listed assets is still unverified absence.

R0.9 and R0.10 must agree on the pinned selected branch commit, and the branch is rechecked at the end. Any detected drift rejects the composition. The result records each local gate separately.

## Status interpretation

- BOUNDED_LOCAL_EVIDENCE_PRESENT_NOT_OFFLINE_QUALIFIED: all four local gates satisfied only within their bounded selected-tip and saved-inventory scope.
- LOCAL_RECOVERY_EVIDENCE_GAPS: at least one local gate failed or remains unknown.
- NOT_TESTED_REQUIRES_OPERATOR_AND_SEPARATE_MEDIA: no physical detached-media restore has been demonstrated.
- NOT_TESTED_REQUIRES_OPERATOR: no actual PhiOS offline launch has been demonstrated.

**The summary's offlineReady remains FALSE in every possible result.** Never promote a scoped CI or local integrity check into an independently tested offline OS claim.

## Safety guarantees and limitations

This command performs no remote GitHub requests, installs, downloads, pushes, checkout of submodules, execution of saved binaries, or persistent source/backup writes. R0.5 Git bundle verification uses a temporary local Git clone and cleans it afterward. No GitHub remote-parity assertion, publisher-signature validation, full Git/LFS history sweep or all-Release completeness is implied. Existing R0.5, R0.9, R0.10 and R0.12 per-tool caps apply.

## Actual Windows physical acceptance run (future field test)

1. Make independent copies of the selected Git bundle snapshots, relevant LFS content-addressed objects and Release archives onto **separate physical removable media**. Verify the copies cryptographically. Do not delete the originals.
2. Choose a *disposable isolated restore destination*, distinct from the backups and live GitPorch data. Run the existing explicit R0.4 Git bundle restore drill into it.
3. Deliberately disconnect all WAN routes, including Starlink/Wi-Fi if present. Validate that no network dependency silently succeeds.
4. Launch one explicitly selected, reviewed PhiOS component using only locally recovered assets, with no automatic download or unreviewed binary execution. Record the exact revision, logs and observed result.
5. Create a separate human-reviewed field evidence report with physical media identity, hashes, test revision, actual offline conditions and outcomes. Only a truly run and verified exercise may qualify this gate.

R0.13 does not carry out those steps, touch system networking or claim the result happened.

## Developer acceptance

    npm test
    node --test test/homenode-offline-readiness.test.mjs

Tests cover composite local-gate success without false full-readiness, broken or missing components, unknown Releases, real content SHA-256 readback of locally stored Release fixture bytes, corruption, >16-asset refusal, branch drift, public catalog constraints and safe CLI arg failure. The individual Git modules retain their own fixture tests.

**Ledger Above Ego. DONE Means Verified.**
