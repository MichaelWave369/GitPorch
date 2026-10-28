# PhiOS R0.3: approved, bounded public mirror import

**Status:** operator-invoked pilot for importing small, explicitly selected batches of public GitHub repositories. Not background sync, private repository migration, a complete backup, or PhiOS offline-readiness certification.

## Safety contract

- Exact owner MichaelWave369 with visibility PUBLIC_ONLY and the existing GitPorch public catalog schema.
- One to five distinct, explicitly named Windows-safe repositories per batch. No globs, whole-account imports, implicit defaults or automatic discovery. Repeat later for more sources.
- Offline batch-plan: verifies each requested name against the public catalog and R0.2 local mirror audit, checks that each selected item is NOT_LOCAL, and verifies local namespace capacity. It makes no network requests or disk writes.
- The plan prints a SHA-256 plan fingerprint. Batch-import must provide the same names and fingerprint plus --i-approve-public-batch-import. It reruns preflight before any clone and rejects stale plans.
- The approved network import is sequential. Each GitHub HTTPS clone uses the existing staged, non-overwriting GitPorch importer with restricted Git environment, disabled credentials and no alternate protocols.
- First failure stops the remaining batch; no automatic retries, resets, overwrite, push-back or service exposure. Imported items are preserved.
- JSON result contains only selected public names and statuses, not local paths or raw Git stderr. An interrupted run may leave no final report; rerun the read-only audit before recovering.
- Local Git object verification does not authenticate remote parity, guarantee history beyond reachable refs, include Git LFS contents/submodule targets/releases/issues/PRs, or prove an external backup or offline boot.

## Operator instructions on Windows PowerShell

Prerequisites: Node.js 20+, Git and a trusted local checkout of GitPorch. Discover the public repository catalog explicitly *while online* (replace the example path with your real existing directory):

    New-Item -ItemType Directory -Force 'D:\PhiOSCatalog'
    npm run bridge -- discover MichaelWave369 'D:\PhiOSCatalog' --i-approve-public-discovery

Use the actual catalog filename returned by discovery. Example local data store selection:

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'

Step 1. Preview, offline with no writes (the catalog path shown is a placeholder):

    npm run bridge -- batch-plan 'D:\PhiOSCatalog\<actual-catalog>.json' 'PhiOS,GitPorch,PhiARK'

Check names, status NOT_LOCAL, expectedNetworkClones and disk capacity. Copy the 64-hex planSha256 from the returned JSON. The fingerprint detects plan drift, but is NOT catalog authenticity or network authorization.

Step 2. Explicitly approve that exact plan while online:

    npm run bridge -- batch-import 'D:\PhiOSCatalog\<actual-catalog>.json' 'PhiOS,GitPorch,PhiARK' '<64hex-planSha256>' --i-approve-public-batch-import

Exit 0 with LOCAL_GIT_IMPORTS_COMPLETED_ONLY means all selected Git objects were imported and checked locally. Exit 2 with PARTIAL_OR_FAILED_REVIEW_REQUIRED means stop and inspect. Exit 1 indicates preflight or approval denial.

Step 3. Check the whole catalog offline:

    npm run bridge -- audit 'D:\PhiOSCatalog\<actual-catalog>.json'

Then create separate independently held external backup snapshots and verify them. Example:

    New-Item -ItemType Directory -Force 'E:\PhiOSBackups'
    npm run homenode -- backup PhiOS 'E:\PhiOSBackups'
    npm run homenode -- verify '<actual-snapshot-directory-from-backup>'

Back up Git LFS, submodule target repositories, issues, PRs, wiki, releases, Actions artifacts and configuration separately, and actually restore onto a separate drive with WAN disconnected. Private repository backups are intentionally excluded from this public path.

## Failure recovery

If a batch partially imported repositories, never replay the old fingerprint or include already-imported names in a new batch. Run the R0.2 audit to reconcile what exists, inspect any orphan staging or lock directories after a machine crash, and prepare a newly selected batch for remaining NOT_LOCAL entries. Never delete a live import lock. Do not run simultaneous imports on the same store.

## Tests and claims

    npm test
    node --test test/homenode-batch.test.mjs

Fixtures exercise owner/visibility restrictions, five-repository limit, zero-write preview, stale plan hash, preexisting repositories, real local fixture Git clones, fail-stop reporting, environment credential isolation and CLI approval denial. Passing CI does not mean the user has downloaded any repositories or tested a physical disconnected machine.

**Next:** independent per-repository backup/restore evidence and private-only authenticated mirror isolation.

**Ledger Above Ego. DONE Means Verified.**
