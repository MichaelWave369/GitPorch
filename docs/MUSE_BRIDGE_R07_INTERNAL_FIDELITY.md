# GitPorch × Muse R0.7: internal history fidelity audit

**This adds a new read-only audit to the manually dispatched disposable Muse trial. It has NOT yet been executed against the real Muse CLI.**

## R0.7 live run #4: JSON readback output must be requested explicitly

[GitHub Actions run #43990973074](https://github.com/MichaelWave369/GitPorch/actions/runs/43990973074) was another **GitPorch harness failure**, not a demonstrated Muse history-fidelity problem. The real 0.2.2rc9 installer, all six Git imports, the exported Git snapshot, and existing snapshot/status/receipt audits passed. R0.7 instead stopped with:

```text
[Muse R0.7] Unexpected token 's', "sha256:e74"... is not valid JSON
```

The installed CLI's unflagged `muse read-commit sha256:<id>` response starts with a plain SHA-256 identifier rather than a JSON object. The previous regression fake incorrectly returned JSON by default and therefore masked this contract mismatch. Upstream Muse examples demonstrate the explicit `--json` switch; R0.7 now calls `muse read-commit sha256:<id> --json` and `muse read-snapshot sha256:<id> --json`, while keeping the valid canonical ID requirement learned from run #3. **A real R0.7 internal-history pass remains UNVERIFIED** until a new manual run.

To avoid another blind diagnosis, the disposable runner also records `muse read-commit --help`, `muse read-snapshot --help`, plus bounded **raw stdout, stderr, status and object ID** per readback in top-level synthetic text files. These files are collected in the existing seven-day GitHub Actions evidence artifact even if parsing fails. Never collect real/private repository data using this diagnostic mode.

## R0.7 live run #3: canonical Muse ID requirement (GitPorch harness bug)

[GitHub Actions run #43986428104](https://github.com/MichaelWave369/GitPorch/actions/runs/43986428104) also failed **only in our R0.7 checker**. Its uploaded `muse-internal-history-audit.err` shows:

```text
[Muse R0.7] Muse read-only read-commit failed:
{"error": "Invalid commit reference '768472d58d0b858ba816ef09b1572734549128a094409e9d2836b7741ba615a8': use the canonical 'sha256:<hex>' form. Bare hex IDs are not accepted."}
```

We mistakenly stripped `sha256:` from CLI arguments in the fix for run #2. The actual **Muse 0.2.2rc9** implementation demands a canonical `sha256:<64hex>` argument, even though some older reference examples show bare IDs. We now normalize IDs **only when comparing values**, and always supply prefixed IDs to `muse read-commit` and `muse read-snapshot`.

Run #3's real Muse installation and Git import/export completed; the R0.2 snapshot audit, R0.3 status audit, and R0.5 consolidated evidence packet all returned PASS. No evidence from this run supports an upstream Muse corruption bug. It **still has not verified internal ancestry or historical snapshots**.

A strict synthetic CLI test now rejects **both** formerly bad behaviors: `--format json` and unprefixed 64-hex arguments. The readback comparison still refuses malformed IDs, incorrect merge parents, and wrong file hashes. Re-run only after reviewed CI and operator authorization.

## R0.7 live run #2: test-harness failure, NOT a Muse fidelity defect

The first manual run after merging R0.7, [GitHub Actions #43976504464](https://github.com/MichaelWave369/GitPorch/actions/runs/43976504464), **failed only in the new internal-history auditor**. The preserved `muse-internal-history-audit.err` contains:

```text
[Muse R0.7] Muse read-only read-commit failed: usage: muse [-h] [--version] [-C DIR] COMMAND ...
muse: error: unrecognized arguments: --format json
```

The Git snapshot, sync-state and consolidated Git evidence packet all **passed** again; all six synthetic commits imported; Muse 0.2.2rc9 installed cleanly. The checker had passed an unsupported `--format json` flag to Muse's low-level read command. **This is our bug, not a Muse issue; do not report it to Gabriel as upstream failure.**

This PR fixes the command invocation to use `muse read-commit <64-hex-id>` and `muse read-snapshot <64-hex-id>`, whose default output is JSON. It accepts `sha256:<64hex>` from import receipts and either bare or prefixed IDs in readback records and manifests, but **still rejects malformed IDs and wrong parent/blob hashes**. A new fake Muse executable test ensures future changes never reintroduce the unsupported flag.

**No actual internal-history parity result exists yet.** It requires another explicitly approved disposable manual workflow dispatch after review and merge. Do not run against real repositories or bypass the reviewed-installer hash.

## Why this is useful to Gabriel

The first live R0.6 run, [GitHub Actions #43968439939](https://github.com/MichaelWave369/GitPorch/actions/runs/43968439939), installed **Muse 0.2.2rc9**, imported all six synthetic Git commits, passed snapshot/export and status audits, and passed 288 GitPorch regression tests. But it checked only the **final exported Git tree**, not the Muse engine's *stored parent DAG and historical snapshots*.

Upstream [gabriel/muse issue #140](https://staging.musehub.ai/gabriel/muse/issues/140) says the merge/side-branch history fixes shipped in Muse 0.2.2rc1. R0.7 independently verifies those fixes in an actual CLI trial. **Do not file a duplicate bug unless the evidence reproduces one.**

## What R0.7 adds

After the R0.6 synthetic Git import and Muse checkout, the existing manual-only script invokes:

```bash
node src/muse-history-verify.mjs capture \
  "$ROOT/git-history-baseline.json" \
  "$ROOT/muse-import.log" \
  "$ROOT/muse" "$ROOT" > "$ROOT/muse-internal-history-audit.json"
```

For each Muse commit ID from the real import log it makes **read-only, local** CLI calls:

- `muse read-commit sha256:<id> --json` for parent IDs, snapshot pointer, and `metadata.git_sha`;
- `muse read-snapshot sha256:<id> --json` for the complete stored manifest mapping paths to blob hashes.

It compares these independent readbacks to the R0.4 Git baseline, checking each commit including the merge: all Git SHAs have an imported Muse commit, both parent edges are preserved, and every historical tracked path and raw blob SHA-256 agrees. The report gives exact commit/path error codes if not.

Reports and the read-only readback payloads are preserved in the synthetic evidence artifact for human review. A failure is recorded but the script continues to the existing export audits, then fails the overall run, so a history defect won't hide a working export.

## Important boundaries

- **Executable mode is NOT verified by the Muse manifest.** R0.6 reported `exec_bit_not_kept` for `scripts/run.sh`; issue #140 already covers executable bits. R0.7 records this warning separately and explicitly marks the executable mode unverified.
- No claim about real repository safety, arbitrary histories, Git authorship metadata, signatures, push/pull, remote syncing, or Muse's non-imported branches.
- No new automatic trigger: R0.7 is part of the **existing** `workflow_dispatch` gate and still requires the manual approval phrase plus independently reviewed installer SHA-256. Normal PR CI only runs synthetic unit tests (no Muse installation).
- Installed CLI may have different read-command behavior: if so the audit fails closed and the artifact contains diagnostic stderr instead of claiming a pass. Never alter production or relax approvals to make it green.
- The stored records in R0.7 will be **actual Muse readbacks only after a new manual workflow dispatch**. The six pure-JS regression tests fabricate records deliberately and are not proof of Muse parity.

## Interpret the next result

- `PASS_DAG_AND_HISTORICAL_BLOBS_ONLY`: this fixture's imported parents and historical path/content bytes matched the Git baseline. Send Gabriel a confirmed independent green check plus the known mode warning.
- `FAIL_OR_INCOMPLETE_HISTORY`: inspect `problems[]` for `PARENT_DAG`, `WRONG_BLOB`, `MISSING_PATH`, `EXTRA_PATH`, `GIT_SHA_METADATA`, or missing readbacks. Send Gabriel **only** a minimized, reproducible failure with exact Muse version and captured records.
- CLI error and no report: inspect `muse-internal-history-audit.err` and the recorded runner stage; treat this as missing evidence, not proof of a Muse bug.

### Manual workflow
<https://github.com/MichaelWave369/GitPorch/actions/workflows/muse-live-smoke.yml>
