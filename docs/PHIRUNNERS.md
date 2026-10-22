# ΦRunners R1-E: First Ignition

ΦRunners is the **local operator-facing layer** over GitPorch's existing Porch Crew Git-integrity and Docker-test workers. It does **not** replace the underlying queue, execution code, signed-report tools or manual recovery procedures.

## Start here

With Node.js 20+, Git and a cloned GitPorch repository:

```powershell
npm test
npm start
# open http://127.0.0.1:3690/#phirunners
```

Check both lanes from the terminal without running any jobs:

```powershell
npm run phirunners -- status
```

You must first initialize a local bare repo and push a real commit into it (see the main README). Queue and execute one Git-integrity job:

```powershell
npm run phirunners -- enqueue-git hello-world
npm run phirunners -- work-git-once
```

To run **built-in Node tests** for a trusted local repo, install Docker yourself, deliberately load the Node 22 Alpine image, inspect its immutable local ID, then:

```powershell
npm run phirunners -- preflight-image sha256:<64-hex-image-id>
npm run phirunners -- enqueue-tests hello-world sha256:<64-hex-image-id>
npm run phirunners -- work-tests-once --i-approve-container-tests
```

These test commands delegate to the pre-existing R1-B/C restricted Docker worker. That worker runs one fixed `node --test --test-reporter=tap` command, cannot install dependencies at execution time, and is NOT a sufficiently hardened environment for untrusted public PR code.

## What the PhiRunners status actually means

- `GET /api/phirunners` and `#phirunners` display **local** queue counts, recent job outcomes and worker-lock indicators. The API is read-only. Neither the dashboard nor status reads start a worker or probe Docker availability.
- `LOCAL_RECEIPTS_CHECKED_NOT_ATTESTED` means the existing queue checksum and structure checks passed during this read. It does **not** prove the job executed honestly or independently.
- `PARTIAL_OR_UNVERIFIED` means at least one lane had malformed/unavailable or changing receipts. Its affected lane withholds jobs and counts. Combined totals are null, never invented zeros or green checks. The CLI exits with code 2.
- `RUNNING_UNCERTAIN` is not proof that a job is still running and is **never** success. `LOCK_PRESENT_ACTIVITY_UNKNOWN` only indicates an on-disk lock. Use `node src/recovery-cli.mjs doctor` and the documented manual recovery steps after independently inspecting the actual process/container.
- `PASS` on the Git lane means Git object integrity only. `PASS` on the test lane means a locally reported bounded Docker test run passed, NOT a signed or independently observed attestation. `FAIL`, `ERROR`, `STALE`, `NO_TESTS`, and `ABORTED_UNVERIFIED` are never green.
- Reads from the two lanes are sequential, not transactional; if a queue changes during inspection, the affected lane is withheld and a new read can be attempted.

## Security boundaries

GitPorch remains **127.0.0.1 only**, single-operator, without accounts, SSH push, webhook ingestion, GitHub Actions registration or automated deployments. This revision introduces **no HTTP write endpoints and no public-network listeners**. The GitHub Pages showcase remains separate fictional demo content; the `/api/phirunners` endpoint is never available on Pages. All command execution requires explicit local CLI invocation.

Do not expose your Docker socket, publish the private `data/` directory, mount personal credentials into build containers, or enable untrusted external submissions. The independently controlled local queue continues to work without GitHub availability; syncing PRs, merging on GitHub, and publishing GitHub Pages do not.

## Future milestones (not claimed here)

R1-F: operator-approved build recipes and safely bounded artifacts with provenance. R1-G: a local worker capability registry and a separate-machine transport threat model. Later: optional GitHub self-hosted runner adapter, with credentials strictly separated from sovereign jobs and untrusted PRs. R2/R3 GitPorch auth and review features remain distinct.
