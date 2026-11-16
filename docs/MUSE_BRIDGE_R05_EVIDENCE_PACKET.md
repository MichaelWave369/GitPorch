# GitPorch × Muse R0.5: Read-only evidence packet

**Status: review tooling only. NOT a verified Muse interoperability test.**

R0.5 composes three independent Git-side auditors and hashes operator-supplied Muse CLI transcripts. It **never installs or invokes Muse**, connects to networks, writes to either Git repository, authenticates logs, or reconstructs Muse history.

## Evidence it checks

- **R0.4 history baseline:** original Git commit parent graph, historical tree hashes/modes and digest of its complete commit list.
- **R0.2 committed snapshot comparison:** source vs. exported mirror file paths, blob contents and modes.
- **R0.3 status receipt:** reported import/export SHA vs. actual local Git branch tips, plus reported zero drift.
- **Safety:** source/mirror Git working trees have no configured remotes and no tracked or untracked changes. Logs are outside both trees, under 1 MiB each, nonempty and not symlinks.
- **Opaque evidence:** saved Muse version/import/export/status outputs are stored as only SHA-256 and byte counts in the report. Their contents and authenticity are **not verified**. A fabricated transcript may still satisfy this packet.

## Operator procedure

Follow `docs/MUSE_BRIDGE_PILOT.md` and R0.2/R0.3/R0.4 guides. Use **only disposable, isolated Git repositories** and a reviewed, independently installed Muse CLI. Verify the exact `muse --version` and relevant command help first. Do not import the export-only mirror branch back into Muse. Do not use original PhiOS, Agentora or GitPorch data.

Preserve the following raw output files **outside both Git repositories**, e.g. under `D:\MuseBridgePilot\`:

- `muse-version.txt`: the operator-recorded output of `muse --version`.
- `muse-import.log`: the original `muse bridge git-import --json` output (may not be clean NDJSON on older releases).
- `muse-export.log`: the original `muse bridge git-export --no-push --json` output.
- `muse-status.json`: the original `muse bridge git-status --git-dir <source> --json` output.

After the approved disposable trial, from GitPorch's root:

```powershell
npm test
npm run muse:evidence-packet -- 'D:\MuseBridgePilot\synthetic-git' 'D:\MuseBridgePilot\synthetic-mirror' 'D:\MuseBridgePilot\muse-status.json' 'D:\MuseBridgePilot\muse-version.txt' 'D:\MuseBridgePilot\muse-import.log' 'D:\MuseBridgePilot\muse-export.log'
```

**Exit codes:** 0 = `GIT_CHECKS_PASS_LOGS_PRESENT_HUMAN_REVIEW_REQUIRED`; 2 = `BLOCKED_OR_INCOMPLETE`; 1 = unsupported input or execution failure.

Even exit 0 must **never** authorize unattended syncing, publishing or production use. It means only that the local Git-side checks agree and opaque log files are present. The command writes no output file; redirect stdout explicitly to save a local report. Do not commit potentially sensitive actual Muse transcripts to a public repository.

## Outstanding proof

An actual Muse CLI round trip must still be executed and independently reviewed. The release binary identity, real import `metadata.git_sha` coverage, Muse parent graphs, historical trees, attribution, signatures, and side effects remain **UNVERIFIED**. This tool neither claims nor infers them.

References: [Muse Git interoperability](https://musehub.ai/muse/getting-started) and [Muse issue #140](https://staging.musehub.ai/gabriel/muse/issues/140).
