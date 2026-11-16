# GitPorch x Muse R0.3: saved status-receipt audit

**Status: Git-only, read-only preparation.** This utility does not install or run Muse, connect to MuseHub, sign, export, push, or modify repository data. Its tests use fabricated JSON receipts and temporary synthetic Git repositories. No real Muse bridge result is claimed.

## Why

The official [Muse Git interoperability guide](https://musehub.ai/muse/getting-started) documents `muse bridge git-status --git-dir <source> --json` with `last_import.git_sha`, `last_import.git_ref`, `last_export.git_sha`, `last_export.git_ref` and a `drift` object containing `git_commits_since_import` and `muse_commits_since_export`. An absent drift object is **unverified**, not zero drift.

Our R0.2 auditor checks *committed snapshot bytes and file modes*. This R0.3 check instead reconciles a saved Muse status receipt with real local Git branch tips and explicit reported drift. They are independent checks, and **both are insufficient for full bridge verification**.

## Safe procedure after a separately approved Muse trial

1. Read the upstream CLI/release notes; record the installed `muse --version`. Do not assume the documentation's example version is installed. Keep the procedure limited to two fresh **disposable** Git repositories, with no production remotes.
2. Run the documented R0.1 synthetic fixture, Muse import and export trials using the approved version. Do not import the exported mirror branch back into Muse. Use `--no-push` for export and verify help output before use.
3. While inside the *isolated Muse workspace*, save the exact Muse status JSON **with the source repository explicitly supplied as `--git-dir`**. Preserve the raw receipt outside the Git checkout, for example:

   ```powershell
   muse bridge git-status --git-dir 'D:\MuseBridgePilot\synthetic-git' --json > 'D:\MuseBridgePilot\muse-status.json'
   ```

4. Run both Git-only audits from GitPorch's repository root:

   ```powershell
   npm run muse:audit -- 'D:\MuseBridgePilot\synthetic-git' 'D:\MuseBridgePilot\synthetic-mirror'
   npm run muse:status-audit -- 'D:\MuseBridgePilot\synthetic-git' 'D:\MuseBridgePilot\synthetic-mirror' 'D:\MuseBridgePilot\muse-status.json'
   ```

## Receipt checks

- Import record exists, its `git_ref` is a safe Git branch name, and `git_sha` exactly equals that branch's local commit.
- Export record exists, its `git_ref` is a safe Git branch name, and `git_sha` exactly equals the mirror's corresponding local commit.
- Both drift counters are present, nonnegative integers, and zero.
- The two input checkouts are distinct non-bare Git roots. The saved receipt must be an absolute-path, nonempty regular JSON file no larger than 256 KiB. No symlinked receipt.
- Unknown/missing status is treated as **failed or unverified**, never a pass. A mismatched SHA may signal subsequent branch movement or a stale receipt, not necessarily a Muse bug.

Exit codes: 0 = `PASS_STATUS_RECEIPT_ONLY`, 2 = `FAIL_OR_UNVERIFIED_STATUS`, 1 = input or execution error. The stdout JSON lists findings and remaining unknowns. Do not use this success alone as a CI gate for publishing or trusting production mirrors.

**Evidence boundary:** This program cannot authenticate the JSON receipt or the installed Muse executable, prove historical tree fidelity, compare imported commit ancestry or attribution, verify cryptographic signatures, or establish absence of past writes or pushes. Pair this report with independently preserved import/export transcripts, exact CLI version, the R0.2 snapshot audit, and reviewed evidence before advancing to a real adapter.

## Tests

```bash
node --test test/muse-bridge-status-audit.test.mjs
npm test
```

All test fixtures are created under the OS temp directory and cleaned up. These tests never execute Muse, use network services, or contact production repositories.
