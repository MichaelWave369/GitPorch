# PhiOS R0.14: portable recovery kit byte verification and physical field drill

## R0.14 scope

This rung provides two offline commands that can prove a **specifically assembled portable kit** has unchanged Git bundle, Git LFS payload files and GitHub Release archive files, as identified by a saved unsigned reference manifest. The Git bundle is also independently cloned/fsck-verified in a temporary local Git repository, which is removed after verification.

The commands do **not** copy assets, change Wi-Fi/Starlink, boot PhiOS, execute release files, initialize submodules, access remote GitHub, establish separate physical storage devices or authenticate a publisher signing key.

A correct copy and verified Git bundle are valuable, but **not** proof that the whole PhiOS ecosystem can boot offline.

## Prepare the source kit (operator controlled)

Do not use the live GitPorch data directory as a kit. Set up a dedicated existing folder, for example E:\PreparedPhiOSKit, and copy **one previously R0.4/R0.5 verified snapshot** and any selected already SHA-256-verifiable content-addressed assets into the exact layout below. Preserve originals.

    E:\PreparedPhiOSKit\
      snapshot\
        repository.bundle
        snapshot.json
      lfs\
        objects\
          sha256\
            ab\
              abcd...<full 64-char SHA-256>
      releases\
        releases\
          sha256\
            cd\
              cdef...<full 64-char SHA-256>

The two snapshot files are mandatory. The lfs/ and releases/ trees are optional **only when the operator explicitly has no selected assets to include**. Paths and object names under those trees must be exact hexadecimal content-addressed files. The source kit rejects hidden extras, arbitrary directories, symlinks, reparse-point redirects and special files rather than silently ignoring them.

The pilot caps: 2 mandatory snapshot files, at most **128 asset payloads**, up to 130 files overall, 160 directories, 2 GiB per file and 4 GiB aggregate package bytes. Files beyond the caps require a separately reviewed extension, not a bypass.

## Offline preview and saved reference manifest

Use a GitPorch checkout with Node.js 20+, Git and a saved exact-owner PUBLIC_ONLY catalog. Substitute your real paths:

    npm run homenode -- portable-kit-plan "D:\PhiOSCatalog\<catalog>.json" PhiOS "E:\PreparedPhiOSKit"

Inspect the JSON. The command reads all included file hashes and verifies the Git bundle through an isolated temporary Git clone and fsck. It does not persist changes to any kit or backup file. Keep the printed JSON as an **operator-saved reference file outside both kit roots**. For example, an operator may use a unique filename:

    npm run homenode -- portable-kit-plan "D:\PhiOSCatalog\<catalog>.json" PhiOS "E:\PreparedPhiOSKit" > "D:\PhiOSEvidence\portable-kit-reference.json"

Do not put the reference manifest into the kit: that would alter its selected contents. The reference is **unsigned and editable**; the fingerprint detects accidental changes but does not attest provenance or independent custody. For strong authenticity, separately sign, timestamp or independently witness this fingerprint using trusted offline keys, keeping secrets out of artifacts and terminal history.

## Copy to other media (operator action, never automatic)

Manually copy the whole E:\PreparedPhiOSKit directory tree to an **independently attached** removable USB/SSD or another physically distinct medium. Verify drive identity with Windows Disk Management or an equivalent trusted local mechanism; different drive letters **alone** do not prove separate physical devices.

For the example below, F:\CopiedPhiOSKit is the directory on the intended copy destination. Avoid mirroring or synchronizing over your sole original. R0.14 does not perform destructive cleanup or any automatic copying.

## Read back the copied kit

Disconnect network deliberately if you want to test disconnected recovery. The tool does not manipulate the network.

    npm run homenode -- portable-kit-verify "D:\PhiOSEvidence\portable-kit-reference.json" "F:\CopiedPhiOSKit"

This command recomputes **every** file's SHA-256, exact byte length, filename, path and presence, rejects unexpected extras, and independently verifies the **copied** Git bundle with a temporary local clone and fsck. It requires only the saved reference manifest and copied kit. The original prepared kit can be unavailable.

Result status:

- PORTABLE_KIT_BYTES_AND_GIT_BUNDLE_VERIFIED_ONLY: the bytes match the saved unsigned reference and the copied Git bundle independently verifies.
- Any missing, extra, malformed, mismatched, corrupted, symlinked or oversize file **fails** rather than returning a partial success receipt.

Even a positive result always records physicallyIndependentDeviceVerified=false, detachedWanVerified=false, actualPhiOSComponentLaunched=false and completeEcosystemRecovered=false. The tool has no trusted hardware identity sensor or ability to observe your real network/boot conditions.

## Actual offline field test: distinct human-reviewed evidence

Once the copy passes, the remaining physical recovery acceptance requires operator-visible and separately recorded steps:

1. Confirm the target storage hardware is an **independent physical device**, not another partition on the source drive. Record its make/model/serial privately with your test notes.
2. With the kit connected and the originals safely preserved, unplug or disable **all** WAN routes, including Starlink and Wi-Fi. Record observation from the machine; do not rely only on a test suite's claim.
3. Restore the copied snapshot bundle into an existing **disposable** destination with the existing approved R0.4 drill (never on live data, snapshots or the copied kit), for example:

       npm run homenode -- drill "F:\CopiedPhiOSKit\snapshot" "D:\PhiOSDisposableRestore" --i-confirm-local-restore

4. Inspect that restored bare Git repository and verify required selected LFS, Release and submodule files from the kit. Do not execute unknown release archives. Choose one reviewed PhiOS component whose run prerequisites are already available.
5. Launch the **selected component offline** using its documented local entry point. Record exact Git commit, asset checksum evidence, component start/output and failed network attempts if any.
6. Record real operator observations, date, physical media identity, detached WAN state, and which component passed or failed. A witness or separate independently signed field record can be added later. No tool should self-award an offline-qualified badge based on a claim.

R0.14 helps with the copied **byte integrity and Git restore feasibility** portion, but it does **not** enact or establish steps 1, 2, 4, 5 or 6. It cannot certify whole-ecosystem offline readiness.

## Developer acceptance

    npm test
    node --test test/homenode-portable-kit.test.mjs

Real temporary Git fixtures exercise snapshot bundle creation, independent Git clone + fsck on the copy, source removal, actual LFS and Release file SHA-256 verification, changed/missing/extra files, corrupted bundles, tampered references, symlinks, invalid paths, owner/public catalog boundaries and CLI syntax.

The CI runner uses simulated separate directories, **not** independent physical media or disconnected WAN.

**Ledger Above Ego. DONE Means Verified.**
