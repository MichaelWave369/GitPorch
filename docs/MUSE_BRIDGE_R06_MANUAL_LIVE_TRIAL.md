# GitPorch × Muse R0.6: manually dispatched disposable live CLI trial

**State: implemented, NOT YET EXECUTED against a real Muse CLI.** The new workflow is intentionally manual-only, so a passing GitPorch CI check does not prove Muse interoperability.

## Purpose

GitPorch R0.1–R0.5 prepare synthetic fixtures and independent Git-side verification. R0.6 provides the first opt-in, *actual Muse CLI* trial using a fresh ephemeral GitHub Actions runner, never your existing PhiOS, Agentora, GitPorch or user repositories.

Upstream references: https://musehub.ai/muse/getting-started and https://staging.musehub.ai/gabriel/muse/issues/140.

## Safety contract

- Trigger: workflow_dispatch ONLY. Requires exactly RUN_DISPOSABLE_MUSE_TEST and a SHA-256 of the installer reviewed by the operator.
- Job permissions: contents: read. Git checkout does not retain credentials. No repository secrets are passed. The ephemeral Actions job still has its ordinary limited token.
- Installer is downloaded via HTTPS to runner temporary storage, checked for shell syntax and matched byte-for-byte to the operator-supplied SHA-256 before execution. It is NOT piped blindly into a shell.
- Python 3.14 and Node 22 are set up on an Ubuntu runner. Muse uses runner-temp-only venv and install locations.
- Source and mirror Git repositories are synthetic, in a new runner-temp directory, and have no Git remotes. Git export always includes --no-push.
- The script never invokes Muse push or hub push, and refuses an existing test directory. A failed test cannot authorize production changes.
- An installer SHA-256 pin alone does NOT pin the Muse source distribution or transitive wheels. Treat the remote installer and its package dependencies as third-party code, not as formally attested or sandbox-secure.
- Synthetic top-level reports and logs, not private Muse state or Git directories, are uploaded as Actions artifacts for 7 days.

## Before manually dispatching

This workflow must first be reviewed and merged to GitPorch's default branch. It will not run on push or PR.

From Windows PowerShell, independently download, inspect, and hash the upstream installation script. Do not execute the script just to obtain its hash:

    $reviewFile = Join-Path $env:TEMP 'muse-install-reviewed.sh'
    Invoke-WebRequest -Uri 'https://musehub.ai/install.sh' -OutFile $reviewFile
    Get-Content -Path $reviewFile
    (Get-FileHash -Path $reviewFile -Algorithm SHA256).Hash.ToLowerInvariant()

Check the publisher, the reviewed installer contents, and the release notes. On GitHub open **GitPorch > Actions > Muse Disposable Live Bridge Trial (manual only) > Run workflow** on branch main, with:

- disposable_approval = RUN_DISPOSABLE_MUSE_TEST
- installer_sha256 = the 64-character hash of the reviewed script

A mismatched installer aborts before Muse is installed.

## What the isolated run does

1. Runs the regular GitPorch Node test suite.
2. Downloads and checks the installer, installs Muse into temp storage, and records the actual Muse version and CLI help.
3. Generates a synthetic Git history with a side branch, two-parent merge, tracked deletion and executable bit; records R0.4 historical Git evidence.
4. Uses a fresh Muse directory for Muse init, Git import, and forced checkout. Forced checkout is allowed ONLY in this throwaway Muse directory.
5. Creates a separate empty Git mirror and exports the Muse snapshot to it using --no-push. Records Muse git-status.
6. Runs R0.2 snapshot comparison, R0.3 receipt audit and R0.5 evidence packet, recording mismatches separately.

Logs are uploaded even when a stage fails. The run can legitimately be red due to upstream behavior, data loss protections, unsupported flags, mode preservation gaps, or malformed CLI JSON.

## Reviewing the result

Download the synthetic evidence artifact from the specific Actions run. Examine the Muse version, Git baseline, raw import/export outputs, git-status JSON, snapshot audit and evidence packet. Do NOT publish private logs or assume that every upstream command actually executed merely because an artifact exists.

A green R0.6 result would establish a narrowly scoped, disposable smoke-test outcome for the tested version. It would NOT prove full Muse parent DAG or historical-tree parity, signature verification, attribution, general repository compatibility or production sync. Import retains source Git history in Muse, but the documented Git export writes one current Muse snapshot as one mirror commit, not the original Git DAG.

A red result should be triaged to identify installer/version failure, CLI usage mismatch, missing sync data, mode/content differences or a genuine compatibility issue. One red run does not prove the existence of a general upstream defect.

Normal PR CI runs static/safety tests only, including Bash syntax and refusal without manual approval. No live Muse CLI invocation occurs in ordinary CI.
