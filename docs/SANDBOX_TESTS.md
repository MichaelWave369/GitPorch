# Porch Crew R1-B: isolated Node test pilot

This feature is **experimental local-only CI**, not a hosted multi-tenant build service or verified security sandbox. R1-B is optional; R1-A Git integrity checking still works without Docker.

## Requirements

1. Node.js 20+, Git and a functioning Linux-container **Docker Engine** on your own machine.
2. At least one **trusted** local GitPorch bare repository with a pushed commit and built-in Node.js tests discoverable by `node --test`.
3. A preloaded Node.js 22 Alpine Docker image that you deliberately selected. Use its **immutable image ID** instead of a floating tag:

```powershell
docker pull node:22-alpine
docker image inspect --format '{{.Id}}' node:22-alpine
```

No `npm install` or Docker pull occurs during queue processing. Repos depending on `node_modules`, network access, compilers, or native tools will usually fail; R1-B is a minimal pilot for dependency-free tests. The image ID must be a valid `sha256:<64 hex>` string. A pinned `node:22-alpine@sha256:<64 hex>` manifest digest is also allowed if it is locally available.

## Running

```powershell
node src/sandbox-cli.mjs preflight sha256:<paste-id>
node src/sandbox-cli.mjs enqueue hello-world sha256:<paste-id>
node src/sandbox-cli.mjs list
node src/sandbox-cli.mjs work-once --i-approve-container-tests
node src/sandbox-cli.mjs list
npm start
# Dashboard: http://127.0.0.1:3690/#sandbox
```

The explicit flag is mandatory on every worker invocation. **Nothing auto-starts Docker jobs.** The localhost HTTP endpoint `GET /api/sandbox-tests` is read-only.

## R1-C evidence hardening

- `preflight <image>` performs only a local `docker image inspect`, without fetching images or starting a container.
- Each job compares Docker's actual inspected immutable image ID (or an explicitly matching `node:22-alpine@sha256` RepoDigest) to the queued image identity. If that check fails, the job reports `ERROR` and does not run project tests.
- A passing TAP summary must have a TAP version header, a plan, exactly one parsable set of footer totals, internally consistent counts, at least one passed test, zero test failures, zero cancelled tests and a successful container exit. All-skipped suites report `NO_TESTS`; inconsistent results report `ERROR`.
- Completed container executions record SHA-256 hashes of captured stdout and stderr, observed Docker image ID, and Docker CLI exit code. Logs themselves are **not written into the receipt**.
- This is locally generated, unsigned evidence. It does not authenticate the runner, attest the host, or prevent compromised tests from forging console output. The hashes enable comparisons only when the original output is independently retained by the operator.
- The hash of captured output cannot prove the entire stream was received after a crash. Interrupted work remains uncertain.

## Protections

The worker snapshots the currently observed HEAD commit using Git archive, refuses archives above 20 MiB, and checks that HEAD hasn't changed before and after execution. Docker runs with `--pull=never`, no network, readonly filesystem, capabilities dropped, no-new-privileges, PID/memory/CPU constraints, non-root user, private tmpfs, and no access to the host's Docker socket. The only host bind mount is the archived source tar, read-only. The fixed command inside Docker unpacks that archive and runs `node --test --test-reporter=tap`. A successful outcome requires exit code zero **and** a parseable TAP summary with at least one passed test.

This is defense-in-depth for **trusted local source**. Malicious code may still exploit Docker or kernel vulnerabilities. Do not treat it as appropriate isolation for arbitrary internet submissions, and never run the Docker daemon with unexpected privileged host mounts or under sensitive credentials.

## Status meanings

- `QUEUED`: saved locally, not started.
- `RUNNING_UNCERTAIN`: started or crashed, **not** safe to label green.
- `PASS`: in-container built-in Node test runner exited zero with at least one passed test and zero failures.
- `FAIL`: test runner reported actual failed tests.
- `NO_TESTS`: no tests were found or no tests passed; not success.
- `STALE`: repository HEAD changed between enqueue and worker completion.
- `ERROR`: Docker unavailable, run failed without valid TAP, archive problem, timeout or internal failure.

All receipts are local checksum-protected JSON, **not signed or remotely witnessed**. Work remains human-triggered. On crash, an `isolated-tests/worker.lock` file and/or `running/` receipt can remain. Investigate the process and container state first, back up the runtime folder, and manually resolve uncertain jobs. No automatic retries or forced job promotion. On timeout, the worker attempts `docker rm -f <container-name>`; operators should still verify that no containers remain.

## What comes later

Production untrusted-runner isolation, reproducible environments and dependency policies, artifact signing, **independent third-party attestations**, trusted runner identities, full test-log retention, queue recovery, and actual hosted team CI are **not implemented**. The GitHub Pages showcase has no connection to the local tests.
