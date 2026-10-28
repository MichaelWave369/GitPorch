# PhiOS R0.5: public Git backup coverage ledger

**Scope:** operator-run, read-only backup coverage against an existing public catalog, existing local Git mirrors and HomeNode bundle snapshots. No new backups, repository imports or cloud sync.

R0.1 inventories public source repositories. R0.2 checks current local Git object integrity. R0.3 imports operator-approved small batches. R0.4 restores a bundle to a separate bare Git repository. R0.5 tracks which catalog entries have verified independent bundle copies with Git refs matching the current local source.

## Prerequisites

Node.js 20+, Git, a checkout of GitPorch, the exact existing public-only GitPorch discovery catalog and an existing HomeNode backup root outside the live GitPorch data tree.

PowerShell example (replace all placeholder paths with your actual locations):

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    npm run homenode -- coverage 'D:\PhiOSCatalog\<actual-public-catalog-file>.json' 'E:\PhiOSBackups'

If you don't have a saved public discovery catalog, the existing online discovery is a separate explicitly approved action. Create an existing catalog directory first:

    npm run bridge -- discover MichaelWave369 'D:\PhiOSCatalog' --i-approve-public-discovery

The coverage audit does NOT contact GitHub or otherwise use the network. It runs local Git object checks and temporary bundle clones inside an OS temp directory, with file-only transport and global Git config/credentials disabled. Temporary verification clones are removed. No existing Git mirror or backup bundle is modified.

Only canonical HomeNode snapshot directories whose names match an exact cataloged public repo are examined. Private and unrelated snapshot directories are ignored, not listed or printed. The process refuses more than 2,048 public snapshot candidates rather than returning a silently truncated report.

## Status definitions

Every public catalog entry reports both the R0.2 mirrorStatus and a backupStatus:

- NO_SNAPSHOT_FOUND: no matching canonical HomeNode snapshot was found.
- SNAPSHOT_CANDIDATES_INVALID: matching backup folders exist, but none passes restoration verification.
- VERIFIED_SNAPSHOT_MATCHES_LOCAL_REFS: one or more cloned-and-verified bundles match current local branch/tag ref names and object hashes. This means matching *local Git history only*.
- VERIFIED_SNAPSHOT_REFS_DIFFER_FROM_LOCAL: a bundle verifies but current local source refs are different. The backup may be older, and current state is not fully covered by this snapshot.
- VERIFIED_SNAPSHOT_LOCAL_COMPARISON_UNAVAILABLE: at least one bundle verifies, but no valid local Git mirror is available for current-source comparison. This case matters when the original mirror has been lost.

The JSON output includes only public source names, statuses, snapshot counts and SHA-256 digests. There are no private local repository names, local paths, secrets, raw Git objects, or Git stderr. The output is UNSIGNED and is not automatically written to the disk or uploaded to a website.

## Limitations

This audit cannot prove that source and backup are on separate physical disks, that WAN was physically disconnected, that the snapshot was ever independently restored on a second machine, that GitHub remote refs match, that Git LFS and submodule targets and release assets are preserved, or that PhiOS boots offline. All these acceptance claims stay FALSE.

A valid older Git bundle may still be useful for recovery, but it must never be reported as current full-source coverage. The bundle and unsigned checksum are not code-signing or adversarial tamper resistance.

For missing local source with a verified backup, run R0.4's explicitly approved restore drill into a NEW directory, inspect the recovered refs, and leave the live store untouched. For outdated backups, make and verify new HomeNode bundles after independent review.

## Acceptance

    npm test
    node --test test/homenode-backup-coverage.test.mjs

CI tests with temporary Git fixtures cover current and stale refs, deleted local source, corrupt backups, public/private separation, unsafe paths, CLI use and hostile global Git configuration overrides. CI does not qualify your physical disks or a real unplugged network.

**Next:** address Git LFS, submodules and release artifacts, followed by a real WAN-disconnected PhiOS boot and app availability acceptance run.

**Ledger Above Ego. DONE Means Verified.**
