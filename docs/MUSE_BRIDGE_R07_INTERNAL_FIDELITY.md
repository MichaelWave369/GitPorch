# GitPorch × Muse R0.7: internal history fidelity audit

**This adds a new read-only audit to the manually dispatched disposable Muse trial. It has NOT yet been executed against the real Muse CLI.**

## Why this is useful to Gabriel

The first live R0.6 run, [GitHub Actions #43968439939](https://github.com/MichaelWave369/GitPorch/actions/runs/43968439939), installed **Muse 0.2.2rc9**, imported all six synthetic Git commits, passed snapshot/export and status audits, and passed 288 GitPorch regression tests. But it checked only the **final exported Git tree**, not the Muse engine's *stored parent DAG and historical snapshots*.

Upstream [gabriel/muse issue #140](https://staging.musehub.ai/gabriel/muse/issues/140) says the merge/side-branch history fixes shipped in Muse 0.2.2rc1. R0.7 independently verifies those fixes in an actual CLI trial. **Do not file a duplicate bug unless the evidence reproduces one.**

## What R0.7 adds

After the R0.6 synthetic Git import and Muse checkout, the existing manual-only script invokes:

```bash
node src/muse-history-verify.mjs capture \
  "$ROOT/git-history-baseline.json" \
  "$ROOT/muse-import.log" \
  "$ROOT/muse" > "$ROOT/muse-internal-history-audit.json"
```

For each Muse commit ID from the real import log it makes **read-only, local** CLI calls:

- `muse read-commit <id> --format json` for parent IDs, snapshot pointer, and `metadata.git_sha`;
- `muse read-snapshot <id> --format json` for the complete stored manifest mapping paths to blob hashes.

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
