# GitPorch x Muse: R0.1 compatibility readiness pilot

**Status:** Offline preparation only. Await Gabriel's explicit notice that the next Muse
release candidate has been promoted from staging to production. This pilot does
**not** install, start, contact, authenticate to, or execute Muse. It does not
synchronize real GitPorch mirrors or modify GitHub.

Source reference: https://musehub.ai/muse/getting-started#migrate
Review the live documentation again when the release candidate becomes available.
The documented 0.2.1rc20 limitations may change with the next release.

## Why this exists

GitPorch already supports local bare Git repositories, public GitHub imports,
Git integrity checks, and recoverable bundles. Muse offers a separately
implemented Git-to-Muse import, Muse-to-Git snapshot export, and code intelligence.

This pilot captures evidence from an **isolated synthetic Git repository** so
we can assess interoperability without risking existing PhiOS projects.

## Prerequisites

- Node.js 20+, Git on PATH, no npm dependencies.
- A new workspace directory outside any production GitPorch data folder.
- Do not upgrade Muse yet. Await the release confirmation and check
  the Muse CLI version against the release notes.
- Python 3.14+ is currently documented for Muse, but is not needed to
  run this offline preparation pilot.

## Prepare the fixture (PowerShell)

Run these commands from the GitPorch source checkout. Create an empty
workspace **outside** production repos, for example:

    New-Item -ItemType Directory -Path 'D:\MuseBridgePilot'
    node src/muse-bridge-pilot.mjs fixture 'D:\MuseBridgePilot\synthetic-git' --i-approve-disposable-fixture
    node src/muse-bridge-pilot.mjs inspect 'D:\MuseBridgePilot\synthetic-git'
    node src/muse-bridge-pilot.mjs plan 'D:\MuseBridgePilot\synthetic-git' 'D:\MuseBridgePilot\synthetic-muse' 'D:\MuseBridgePilot\synthetic-mirror'

The fixture command refuses existing targets, initializes an offline Git repo with
no remotes, and creates a branch, diverging commits, a merge commit, deletion,
and executable file-mode change. It runs Git locally and executes NO Muse code.

The inspect command is read-only. The plan command prints JSON without creating
either destination. It refuses unclean source trees, existing destinations, or
overlapping source/destination paths. Review the JSON manually; it is **not**
permission to execute anything.

Run tests:

    npm test

## After Gabriel confirms the new release candidate

**Human-approved integration test, not automated by R0.1:**

1. Verify the exact Muse version with **muse --version** and re-read the bridge docs.
   Review upstream release notes for merge, file-mode, signing, ignored-file,
   snapshot and export semantics. Do not assume older issues are fixed.
2. Copy the synthetic Git fixture to a disposable location if needed. Do not
   use an original PhiOS, Agentora, GitPorch, or user repository.
3. Manually create the *empty* Muse test directory, initialize Muse there,
   and run the planned **git-import --json**. Inspect per-commit events.
4. Run **muse bridge git-status --git-dir <synthetic-git> --json** to inspect
   import position and drift. If comparing the Muse working tree, note the
   documented need for a controlled checkout after import.
5. Independently initialize a *new* Git mirror checkout, outside the source
   and outside the Muse working tree. Configure a throwaway local Git identity
   if necessary, and review its contents before any export.
6. Export with **--no-push --json** to that isolated checkout only. Do not
   export into an original source repo or an existing developer checkout.
7. Compare branch tips, parent graphs, original Git SHAs carried in Muse
   metadata, tracked file paths and SHA-256 content, deletions, executable mode,
   untracked-file behavior, and post-export drift. A matching final snapshot
   does **not** imply full history reconstruction.
8. Preserve a redacted JSON evidence report and exact CLI versions. Only
   then consider a one-repo PhiOS/Agentora integration behind operator approval.

**Explicitly prohibited in this pilot:** Git push, Muse push, automatic
git-import of an exported mirror branch, CI secret exposure, calling Muse on
the GitPorch data directory, replacing a tracked user repo, and unattended
sync. The plan's git-export always specifies **--no-push**.

## Acceptance rubric

| Check | Evidence | Required to pass |
| --- | --- | --- |
| Git baseline | Git HEAD, commit count, merge count, file modes | Git fixture passes fsck |
| Import coverage | Per-commit Muse JSON and metadata.git_sha | All expected commits accounted for |
| Merge topology | Git parent graph vs. Muse parent graph | Deviations explicitly measured |
| Final snapshot | File paths, SHA-256 bytes, tracked deletions | No silent missing or added files |
| Modes | Git executable bit vs. Muse/exported tree | Differences identified, not ignored |
| Export safety | Fresh mirror, --no-push, checked untracked files | No original or remote modified |
| Drift | git-status --json before/after | Results recorded and understood |
| Identity/provenance | Import attribution, signature verification | Claims match actual verification |
| CI compatibility | Separate GitHub Actions test on reviewed mirror | Deferred; no production CI changes |

A result is **blocked/unverified** until a real release-candidate integration
test produces evidence. A successful Node unit test proves our *preparation
code*, not the behavior of Muse.

## Development scope

- Implementation: src/muse-bridge-pilot.mjs
- Unit tests: test/muse-bridge-pilot.test.mjs
- No new runtime dependencies.
- No GitPorch server, API, network listeners or existing bridge code changed.
- Future phase: a **separate optional Muse adapter** that parses live JSON,
  applies explicit approvals, and reports evidence to Agentora/PhiRepoNerve.
  It should only be designed after the new release's behavior is verified.
