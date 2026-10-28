# PhiOS R0.4: isolated offline Git restore drill

**Status:** operator-approved recovery of a previously verified HomeNode snapshot to a new, separate bare Git repository. This is recovery proof for Git refs and reachable objects, NOT proof that the complete PhiOS desktop, local models or hardware can function without the internet.

## Why this rung

- R0.1 PhiOS: public source inventory (194 at the October 28 census).
- R0.2 GitPorch: network-silent audit of existing local Git mirror objects.
- R0.3 GitPorch: approved one-to-five-project public mirror batches.
- R0.4 GitPorch: recover source history from a backup bundle into an independent retained repository, without contacting GitHub or overwriting source.

The existing HomeNode backup command makes a uniquely named directory containing repository.bundle and snapshot.json and tests an ephemeral restore. This R0.4 adds a retained recovered repository in an operator-chosen existing directory.

## Step 1: Create a snapshot backup

On your own GitPorch computer with Node.js 20+ and Git installed, in PowerShell. Change all example paths to match the actual machine.

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    New-Item -ItemType Directory -Force 'E:\PhiOSBackups'
    npm run homenode -- backup PhiOS 'E:\PhiOSBackups'

The backup destination should use physically separate storage. GitPorch cannot independently detect whether two paths reside on separate disks. Record the exact snapshot directory returned by the backup command.

## Step 2: Recover into a separate directory

Ideally disconnect WAN manually, and use a different computer or disk. Create a separate existing restore parent, never the live GitPorch data directory.

    New-Item -ItemType Directory -Force 'D:\PhiOSRecovered'
    npm run homenode -- drill 'E:\PhiOSBackups\<actual-snapshot-directory>' 'D:\PhiOSRecovered' --i-confirm-local-restore

The command retains a new gitporch-restored-PhiOS-<random-id>.git bare repository under the restore parent. It does NOT overwrite, delete, synchronize, push or change the original snapshot or live GitPorch repositories. It refuses overlapping snapshot and destination trees, unsafe symlinks, missing directories and targets inside the live GitPorch data directory.

The tool validates the HomeNode manifest, exact ref records, bundle bytes and SHA-256, uses a restricted file-only Git environment and creates a real mirror clone. It checks bare status, strict git fsck, all recovered ref names and object IDs, detached origin, and rehashes the input bundle before atomic promotion from staging. A failure cleans up this invocation's temporary clone.

Result status is LOCAL_RESTORE_DRILL_VERIFIED_ONLY. The JSON includes the actual local restored path, bundle digest, ref count, refs digest and a series of explicit success and non-claims. It is printed to stdout only and is NOT a signed or durable public ledger receipt.

## Claims that always remain false

- offHostDeviceVerified: there was an independent physical backup drive or another computer.
- physicalWanDisconnectVerified: a human actually disconnected WAN.
- sourceAuthenticityVerified: GitHub source identity or remote ref parity was independently checked.
- lfsAndGitHubMetadataBackedUp: LFS, submodule target repos, issues, PRs, wiki, releases, Actions output and user data are backed up.
- phiosBootVerified: an installable PhiOS image or app has booted or been qualified offline.

The SHA-256 manifest is unsigned: an actor who can change both manifest and bundle may forge the pair. Git object integrity does not imply code safety, application readiness or approval to run software.

## Field acceptance protocol

To actually qualify physical recovery, store backup media off the source drive, disconnect WAN, run the drill on a different drive or computer, and verify retained heads/tags and readable Git objects. Record a human-observed WAN-disconnect note separately from the tool's receipt. Reconnect only after checking the recovery. Keep independent copies; never restore over the original.

## Developer acceptance

    npm test
    node --test test/homenode-restore-drill.test.mjs

Tests use real temporary Git commits and tags, delete the original source mirror to prove the bundle stands alone, corrupt bundle files and ref records, inject hostile Git config, reject symlink and overlapping recovery destinations, verify no residue after failures and demand explicit CLI approval.

CI does not certify a real external disk, a disconnected network or bootable PhiOS.

**Next:** batch snapshot coverage report, separately preserved LFS/release assets, and a WAN-disconnected PhiOS boot and app availability test.

**Ledger Above Ego. DONE Means Verified.**
