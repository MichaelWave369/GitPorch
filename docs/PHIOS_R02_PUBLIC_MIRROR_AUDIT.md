# PhiOS R0.2: GitPorch offline public-mirror audit

**Scope:** operator-run, read-only public-catalog comparison against existing local bare repositories.

This is not a batch importer, automated sync, GitHub authentication, off-host backup, live OS integration, or verification that the PhiOS ecosystem is offline-ready. The merged PhiOS R0.1 snapshot recorded 194 public repositories at that moment; this audit reads an operator-selected GitPorch public catalog, not a baked-in list, and does not fetch a fresh count.

## How to run

Prerequisites are Node.js 20+, installed Git, GitPorch locally cloned, an explicitly discovered public GitHub catalog, and a local GitPorch data directory.

PowerShell, while online, to create a catalog (the discovery operation is separate and opt-in):

    New-Item -ItemType Directory -Force 'D:\PhiOSCatalog'
    npm run bridge -- discover MichaelWave369 'D:\PhiOSCatalog' --i-approve-public-discovery

The command returns a newly created absolute catalog filename. Save that path. Later, even after disconnecting the WAN:

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    npm run bridge -- audit 'D:\PhiOSCatalog\gitporch-public-MichaelWave369-<generated-id>.json'

For a nonzero exit (code 2) unless every catalog entry has locally verified objects:

    npm run bridge -- audit 'D:\PhiOSCatalog\gitporch-public-MichaelWave369-<generated-id>.json' --require-all-local-objects-verified

A normal successful exit means only that a report was produced. A strict exit code zero means all entries passed this **local Git object check**, not full GitHub parity or offline readiness.

## Report status definitions

- NOT_LOCAL: no corresponding bare Git directory.
- UNSUPPORTED_NAME: public catalog name is incompatible with the GitPorch Windows-safe local namespace.
- LOCAL_UNSAFE_LAYOUT: symbolic link, unsafe file type, duplicate local case-insensitive name, or unexpected bare repository layout.
- LOCAL_UNSUPPORTED_OBJECT_STORAGE: alternate Git object stores or promisor/partial clone evidence.
- LOCAL_VERIFICATION_FAILED: refs invalid, Git failed, or a local command timed out.
- LOCAL_GIT_OBJECTS_VERIFIED_ONLY: local bare repository has Git refs; Git confirms bare status; a full, strict, read-only object integrity check passes. Sorted names and object IDs of all refs are summarized as a SHA-256 fingerprint for future comparisons.

The status never authenticates the upstream GitHub source, compares against current remote refs, verifies that the repo was imported from GitHub, or proves all history is recoverable elsewhere. It checks a local file tree using fixed Git operations with restricted environment variables. No clone, hook, file write, network connection, GitHub token, or app launch is performed by this audit.

The report includes only operator-selected catalog names, statuses, valid ref counts and digests. It does not enumerate other local repositories or print filesystem paths and Git stderr. An attacker-supplied catalog could falsely label repository names as public; catalog provenance must be verified separately. Never automatically upload locally generated audit reports to public Pages.

## Always unverified

The report's acceptance flags remain false for: independent remote source authentication, GitHub refs parity, Git LFS and submodule completeness, release/PR/issue/wiki/Actions backup, off-host restoration, physically disconnected WAN testing and overall PhiOS offline readiness.

Importing a specifically approved public repository remains a separate, online command:

    npm run bridge -- import '<previously-discovered-catalog-file>' PhiOS --i-approve-github-import

For durable preservation, take an external R1-H1 Git bundle backup and verify restoration; retain separate LFS, submodule, release and user-data backups. The repo object's hash integrity is not an off-host backup, nor a guarantee of a bootable OS.

## Verification

    npm test
    node --test test/homenode-mirror-audit.test.mjs

Tests use synthetic public catalogs, real temporary Git repositories, broken refs, alternate-object denial, symlink refusal, empty-store proof and CLI strict-exit behavior. CI tests alone do not qualify the operator's own Windows hardware or WAN-off installation.

**Next rung:** separately approved bounded multi-repository importing, reusing the established single-repository safety gate and recording failures without retries or overwrites. Private repositories require an independently authenticated private workflow that never enters public catalogs or Pages.

**Ledger Above Ego. DONE Means Verified.**
