# PhiOS R0.10: offline submodule commit recovery ledger

**Purpose:** determine whether each Git submodule commit referenced at one selected, locally verified public Git branch tip can be found in a separate, locally verified public bare repository. Git bundles alone do not copy the repositories behind submodule gitlinks.

## Operator command

Run from a trusted GitPorch checkout with Node.js 20+, Git, an existing exact-owner PUBLIC_ONLY catalog and local bare mirrors. Substitute actual paths.

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    npm run homenode -- submodule-ledger 'D:\PhiOSCatalog\<actual-public-catalog>.json' PhiOS main

The command has **zero network and zero filesystem writes**. It does not execute hooks, call a submodule initializer, fetch, clone, update, follow .gitmodules URLs, install software or start a listener.

The JSON ledger is emitted to stdout and contains the pinned parent Git commit, one row for each gitlink, a local recovery status, summary counts and an **unsigned** SHA-256 fingerprint. Untrusted .gitmodules URL strings are never returned. Reports may contain public tracked directory paths; do not auto-publish them.

## Recovery checks

1. Require the selected parent repository in the public catalog for the exact owner MichaelWave369. Its existing bare mirror must pass the established GitPorch R0.2 Git fsck and ref checks.
2. Pin one named parent branch ref to its Git commit and inspect up to 30,000 tracked tree entries for gitlinks (Git mode 160000), with a hard cap of 24 links.
3. Read the root tracked .gitmodules blob (up to 64 KiB) **as untrusted text**, using a restricted parser. Unsupported config sections/continuations, duplicate declarations and ambiguous paths cause the whole operation to fail rather than silently skip dependencies. The file must not be executed or resolved as a URL.
4. For each gitlink, match the tracked directory path against the .gitmodules declaration. An approved target must use HTTPS github.com/MichaelWave369/<public-cataloged-repo> with no URL credentials, nondefault port, query or fragment. Relative, SSH, third-party or absent targets are marked unapproved, without exposing their URLs.
5. Independently fsck-audit the exact local bare target mirror. Check that the gitlink's *specific commit* is present as a commit and reachable from a local ref in the target repository. A valid mirror without the linked commit is not counted as covered.
6. Recheck the parent branch commit after the audit to refuse results if its tip changed during inspection.

## Statuses

- ALL_DETECTED_TIP_GITLINK_COMMITS_LOCALLY_PRESENT_ONLY: every detected gitlink's exact commit is reachable in its independently fsck-verified public mirror, and no .gitmodules-only paths remain. This is a local-source availability observation, **not a proven independent backup**.
- SUBMODULE_RECOVERY_GAPS: at least one target, URL, commit, declaration or mirror remains unverified.
- NO_GITLINKS_AT_SELECTED_TIP_UNVERIFIED: no gitlinks were found at this tip. Nothing is claimed about other branches or historical references.

Per dependency, statuses include:

- TARGET_COMMIT_IN_VERIFIED_LOCAL_MIRROR_ONLY
- TARGET_MIRROR_UNAVAILABLE_UNVERIFIED
- TARGET_COMMIT_NOT_PRESENT
- TARGET_COMMIT_NOT_REACHABLE_FROM_REFS
- TARGET_COMMIT_CHECK_FAILED_UNVERIFIED
- TARGET_SOURCE_NOT_APPROVED_UNVERIFIED
- GITLINK_WITHOUT_MATCHING_CONFIG_UNVERIFIED

The status of the locally validated mirror is also shown for missing/unsafe target repositories. .gitmodules entries without matching gitlinks are counted as an unresolved configuration mismatch.

## Known limits and next work

This pilot intentionally supports only one parent branch tip; its root tracked .gitmodules file; basic unambiguous Git .gitmodules config syntax; and exact public-cataloged repositories under MichaelWave369. A valid external open-source URL from another owner is not auto-trusted or fetched. Complex nested submodule settings are not evaluated and unsupported syntax must fail closed. Nested submodules need their own separate explicit scans.

**Even a positive status does not establish:**

- A signed or authentic GitHub provenance of either repository.
- A separate, successfully restored Git bundle for the target bare repository.
- The target's own nested submodules, Git LFS object payloads, release assets, dependencies or runtime files.
- Physical off-site media independence, disconnected-WAN recovery, or a bootable PhiOS installation.

For locally verified target repositories, use the existing HomeNode backup/restore drill workflow individually, then re-run local coverage for independent evidence. No automated source or file copy is authorized here.

## Developer checks

    npm test
    node --test test/homenode-submodule-ledger.test.mjs

The GitHub Actions suite uses real temporary Git repositories and gitlink records to exercise target-commit reachability, missing target mirrors, incorrect commit OIDs, unapproved SSH/file/third-party URLs, absent/misaligned .gitmodules, unsupported configuration, catalog safety, capacity limits, deterministic digests and CLI read-only behavior.

CI does not prove that a real user's Windows machine has mirrored every project or backed up its dependencies. A physically independent recovery run must still be performed separately.

**Ledger Above Ego. DONE Means Verified.**
