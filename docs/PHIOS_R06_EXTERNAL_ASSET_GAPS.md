# PhiOS R0.6: offline external asset dependency gap census

**Scope:** network-silent, read-only, small-set inspection of Git LFS pointers, declared LFS attributes, Git submodule gitlinks and the limits of release-asset coverage. This is NOT a tool for downloading LFS objects, executing code, importing submodules, downloading release assets, or verifying an offline-complete installation.

## Motivation

After the earlier PhiOS public inventory, GitPorch local mirrors, guarded imports, bundle restore drills and backup coverage ledger, a key limitation remains: ordinary Git history and bundle snapshots preserve Git objects, **not the external payloads referenced by those objects**.

Examples:
- Git LFS pointer files record SHA-256 object identities and sizes. They do not contain the actual images, models, media or game assets.
- A submodule gitlink stores a referenced commit hash. It is not a backup of the target submodule repository.
- GitHub release assets are web-hosted artifacts. A successful git clone or git bundle does not automatically preserve these downloads.
- Dependency package caches, compiled binaries, fonts, third-party licensing and application runtime assets need independent coverage outside this first rung.

## Offline local audit (operator step)

Requires Node.js 20+, Git, a trusted local GitPorch checkout, a saved exact-owner PUBLIC_ONLY GitPorch public catalog from opt-in discovery, and a local GitPorch data directory.

PowerShell with *example paths*:

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    npm run homenode -- asset-gaps 'D:\PhiOSCatalog\<actual-catalog>.json' 'PhiOS,GitPorch,PhiARK'

Only 1 to 5 exactly named public repositories can be selected per call. Local source mirrors must already have been imported; absent or failed Git mirrors produce MIRROR_UNAVAILABLE_UNVERIFIED, never made-up asset evidence. This command makes no GitHub HTTP requests, runs no hooks or repository code, opens no listener, and writes nothing.

The census restricts Git to file-only protocol with global/system Git config and inherited askpass/credential overrides disabled. It first reuses R0.2's local Git fsck validation, then inspects at most eight distinct branch-tip Git trees per repo, with fixed limits on tracked tree entries, attributes files and pointer candidates. If limits are exceeded, the result stays explicitly unverified.

## Meaning of the report

- TIP_SCAN_EVIDENCE_ONLY: bounded branch-tip inspection succeeded. This is not full Git history and not a claim that every LFS file or submodule in every historic revision was found.
- TIP_SCAN_LIMITED_UNVERIFIED: more than eight distinct branch tips exist. Counts cover inspected tips only.
- TIP_SCAN_ERROR_UNVERIFIED: malformed metadata or Git size/time limits prevented an adequate tip inspection.
- NO_BRANCH_HEADS_UNVERIFIED: no branch heads were available to inspect.
- MIRROR_UNAVAILABLE_UNVERIFIED: local mirror absent, unsafe or not Git-integrity verified.

The scanner counts canonical three-line Git LFS pointer objects and totals declared byte sizes, notes tracked LFS filter declarations, and counts Gitlink paths and presence of a .gitmodules file. It deliberately does not print repository-internal paths, submodule URLs or blob contents. Release assets always report UNKNOWN_NOT_PART_OF_GIT because verifying they exist requires a different, explicitly authorized online inventory and separate immutable archive.

All of these acceptance fields remain false: fullHistoryScanned, lfsPayloadVerified, submoduleTargetReposVerified, githubReleasesInventoried, releaseBytesArchived, completeExternalAssetsBackup, physicallyIndependentBackupVerified and offlinePhiOSBootVerified.

**Important:** Seeing zero LFS pointer files at scanned branch tips does NOT prove a repository never used LFS. Seeing one or more pointers does NOT prove the pointed-to binary content has been retained. Git objects may describe licensed or private upstream URLs, so never auto-fetch or publish external content without separate review.

## Tests

    npm test
    node --test test/homenode-asset-gaps.test.mjs

Fixture tests create real local Git repositories with canonical LFS pointer files, LFS .gitattributes, a Gitlink to a deliberately unavailable submodule target, missing sources, malformed pointers, nine extra branch tips, CLI usage and inherited Git config injection. They do not connect to a remote service or download any external assets.

CI proves only these synthetic fixtures on the runner. Real Windows filesystem performance, external asset licensing, actual downloaded LFS objects and a disconnected PhiOS boot all remain separate acceptance gates.

## Next engineering rungs

1. An opt-in, authenticated LFS object acquisition and local content-addressed verifier with operator-selected public source and strict size limits.
2. An independently reviewed submodule dependency map with target repo provenance, licensing and recursive-depth cap.
3. A separate online GitHub release metadata discovery, immutable digest manifest and operator-approved download archive, never interpreted as executable permission.
4. Physical external-disk restore and WAN-off PhiOS app/ISO qualification.

**Ledger Above Ego. DONE Means Verified.**
