# The Porch Crew · R1-A local integrity queue

**Status:** first local implementation, not a secure network CI platform.

The job type `GIT_OBJECT_INTEGRITY` runs an explicit `git fsck --full --no-reflogs` against an existing local bare Git repository. There is **no arbitrary command execution** and no pipeline YAML parser. Jobs are queued and run entirely on the operator's computer without contacting GitHub Actions.

## Try the worker

Run in the cloned GitPorch folder, with Node.js 20+ and Git on PATH:

```bash
node src/cli.mjs init hello-world
# Push a real commit into hello-world using a local filesystem Git remote.
node src/porch-crew-cli.mjs enqueue hello-world
node src/porch-crew-cli.mjs work-once
node src/porch-crew-cli.mjs list
npm start
# http://127.0.0.1:3690/#workshop
```

Jobs are one-shot; `work-once` processes at most one queued job. Nothing executes in the background, and the HTTP API is GET-only. Jobs are pinned to the HEAD commit observed at enqueue time. HEAD changing before or during the check gives `STALE`, not a pass. Missing Git or unexpected failures produce `ERROR` or `FAIL`. An empty repo cannot be queued.

## State machine

```text
operator enqueue -> pending
operator work-once -> running (exclusive rename)
    -> result receipt (PASS / FAIL / STALE / ERROR) -> done
crash -> running + uncertain / requires local inspection
```

The worker uses a local exclusive lock file. If `data/porch-crew/worker.lock` survives an interruption, it reports `BUSY`. **Do not delete the lock while a worker may still be active.** Inspect all job and result files, back up the directory, and determine whether any worker is alive before restoring service. No automatic replay of uncertain jobs exists.

## Ledger boundary

Receipts are checksummed JSON files in ignored `data/porch-crew/`. Checksums detect accidental modification, not malicious rewriting: there are no authenticated identities, signed timestamps, external witnesses, or guaranteed append-only history. Do not publish the runtime directory or run the worker under administrative credentials.

**PASS means Git object integrity, not CI.** Never translate it to a green test badge. Isolated code builds, test execution, resource-limited workers, and signed attestations are future R1-B work.

The public GitHub Pages website remains a static, fictional showcase and does not access this queue.
