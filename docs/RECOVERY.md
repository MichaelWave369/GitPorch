# R1-D1: Safe recovery for interrupted Porch Crew jobs

**Single-user localhost only.** This tool cannot prove a stopped worker, authenticate the operator, sign its records, recover lost logs or re-run a failed build. It exists specifically to close uncertain work **without inventing a PASS**.

## Read-only diagnosis

```powershell
node src/recovery-cli.mjs doctor
```

It checks both `porch-crew/` (Git integrity) and `isolated-tests/` (Docker Node tests). It reports queue counts, uncertain job IDs, whether a worker lock is present, and whether checksum/structure validation succeeded. A lock being present does **not** prove the worker is still running; a lock being absent does not prove Docker is stopped. Diagnostics alone do not change data.

## Explicit operator disposition

Only after checking running processes and containers, confirming no worker is active, backing up `data/`, and ensuring the corresponding `worker.lock` is absent:

```powershell
node src/recovery-cli.mjs abandon git <job-id> "Manually confirmed worker stopped" --i-confirm-no-worker-running
node src/recovery-cli.mjs abandon tests <job-id> "Manually inspected Docker and stopped" --i-confirm-no-worker-running
```

The command acquires the **same exclusive lock** used by that lane's worker; if the lock exists it **refuses**, even if it might be stale. There is deliberately no `--force`, `--unlock`, `--retry`, `PASS` or `FAIL` option. Process inspection and any manual cleanup stay the owner's responsibility.

It writes a checksum-protected `ABORTED_UNVERIFIED` result and moves `running/ID.json` to `done/ID.json`. This means *no trustworthy test conclusion was obtained*. It is not equivalent to a test failure, verified passing build, or independent attestation.

If the process crashes between writing the aborted result and moving the job, a later run with the **identical note** can complete the move after the operator repeats the safety inspection. It never overwrites a genuine existing worker result or changes an earlier PASS.

## No automatic lock cleanup

After a crash, `worker.lock` can remain. Do **not** blindly delete it. First inspect local `node`, `git` and `docker` processes, any `gitporch-ci-*` container names and the runtime receipts. Back up the runtime folder before making operator-only manual changes. The tool will not tell you that a crashed process is definitely gone.

## Further work

Trusted actor identity, signed third-party attestations, independent hardware-backed witnesses, fully reliable resumable execution, hardened multi-tenant isolation and automated recovery remain future milestones. This stage is only a **manual fail-closed disposition** for interrupted work.

All recovery receipts are **not signed** and are not independently witnessed. A valid checksum is only a local corruption check.
