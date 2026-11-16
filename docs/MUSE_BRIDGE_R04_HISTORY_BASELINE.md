# GitPorch × Muse R0.4: history and tree baseline for import-fidelity testing

**Status:** Git-only, read-only verifier. This does **not** install, invoke, connect to or authenticate Muse; its output is not a Muse compatibility certificate. Do not feed production repos to this small synthetic-fixture pilot.

## Why this exists

R0.2 compares the source Git branch's **final tree** to a separately exported Git mirror. R0.3 checks a saved Muse `git-status --json` receipt against two Git branch HEADs and the receipt's reported drift. Neither detects a Muse import that silently flattened a merge or assigned the wrong historical files to side-branch commits.

R0.4 records the original Git **parent graph** and the **full tracked tree at every reachable commit**. It is independent evidence against which a *future*, separately reviewed Muse import transcript can be compared. See [Muse import fidelity issue #140](https://staging.musehub.ai/gabriel/muse/issues/140). The existence of this Git-side baseline does not establish that Muse matches it.

## Run on Windows PowerShell

Requirements: Node.js 20+, Git on PATH, a cloned GitPorch checkout, and a **new disposable absolute-path workspace**. The fixture-creation step is operator-approved and must not point at a production directory.

```powershell
New-Item -ItemType Directory -Force 'D:\MuseBridgePilot'
# Run from the GitPorch repository root:
npm test
npm run muse:pilot -- fixture 'D:\MuseBridgePilot\synthetic-git' --i-approve-disposable-fixture
npm run muse:history-baseline -- 'D:\MuseBridgePilot\synthetic-git' main > 'D:\MuseBridgePilot\git-history-baseline.json'
```

The JSON contains, for every reachable commit in parent-before-child order, its Git SHA, direct Git parent SHAs, whether it is a merge, and a full list of tracked paths, Git modes (`100644`, `100755`, `120000`) and SHA-256 digests of the *raw Git blob bytes*. Every commit also has a deterministic `snapshotSha256` derived from an ordered JSON array of `[path, gitMode, blobSha256]` records. Git's own object ID remains authoritative for Git identity; this separate SHA-256 digest supports cross-system byte comparisons.

**Limits:** at most 96 reachable commits, 512 tracked files per commit, 2,048 unique blobs, 8 MiB per blob, and 64 MiB of total distinct blob contents. Gitlinks/submodules, unusual modes and non-UTF-8 paths fail closed. The pilot is intentionally bounded rather than silently truncating large repositories.

## Compare with an actual Muse import in a future controlled test

1. Verify the installed `muse --version` and `muse bridge git-import --help`; review the release notes and known bridge limitations. Do not assume the documentation's example CLI version is installed.
2. Use only disposable local directories with no production remotes. Follow `docs/MUSE_BRIDGE_PILOT.md` for a human-approved Muse import. Preserve the **raw** JSON/NDJSON output, exact CLI version, and all commands run. Import must not modify the original Git source.
3. Map every Git SHA in `commits[]` to the Muse import's `metadata.git_sha`. Independently extract Muse parents and historical trees using the **verified** version's documented commands, then compare parent identities and file bytes/modes at each commit. Where the Muse CLI does not expose enough information, mark that check `UNVERIFIED`, never `PASS`.
4. After export into a separate disposable Git checkout with `--no-push`, run R0.2's snapshot auditor, and then R0.3's status receipt auditor against the saved `git-status --json` result. Validate safety and zero drift separately.
5. Record missing Git commits, flattened merges, incorrect historical trees, missing executable modes, and import exclusions as *observations*, not proof that a specific Muse version has a general defect. Keep reproducible fixture/version details with each finding.

## Verification boundaries

A `GIT_ONLY_BASELINE` verifies **only the Git source itself**. This command does not attest that Muse was installed, its release verified, the import succeeded, Git ancestry survived, tags were preserved, authors were mapped, signed commits were validated, or the exported mirror had no side effects. It creates no files itself and does not fetch, clone, commit, push or contact the network. Redirecting stdout into a JSON file is the operator's choice.

Tests:

```bash
node --test test/muse-bridge-history-baseline.test.mjs
npm test
```

The tests generate temporary synthetic Git histories, including a two-parent merge and a deliberately unsupported gitlink, and clean up after themselves. They do **not** execute Muse.
