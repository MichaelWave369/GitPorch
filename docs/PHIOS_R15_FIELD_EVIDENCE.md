# PhiOS R0.15: operator field evidence with independently rechecked Git bytes

## Purpose

R0.14 verifies that a copied portable kit matches its saved reference file list and that the included Git bundle can be reconstructed. R0.15 goes one step further: compare **the operator's retained, separately restored bare repository** against the **copied kit's exact snapshot refs**, while keeping claims about physical hardware, network disconnection and successful application launch strictly separate from independently measured facts.

An operator's description of a successful field test can be useful evidence, but **a JSON declaration is not an instrument or a witness signature**. No value the operator supplies can make this tool claim a physically disconnected, independently verified PhiOS boot.

## Prerequisites

Node.js 20+ and Git from a trusted GitPorch checkout, a previously saved R0.14 reference manifest (outside copied kit), a complete R0.14 copied kit, and a retained bare repository created by an explicitly authorized R0.4 restore drill.

The copied kit can be on the operator's selected external drive. This tool checks bytes and paths, not physical drive hardware identity. It does not copy files, mount media, unplug Wi-Fi/Starlink, change Windows networking or execute any binary.

### 1. First perform R0.14 copied-kit verification

    npm run homenode -- portable-kit-verify 'D:\PhiOSEvidence\portable-kit-reference.json' 'F:\CopiedPhiOSKit'

The result should state PORTABLE_KIT_BYTES_AND_GIT_BUNDLE_VERIFIED_ONLY. Keep the reference manifest outside the kit.

### 2. Run R0.4 restore into a distinct disposable location

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    npm run homenode -- drill 'F:\CopiedPhiOSKit\snapshot' 'D:\PhiOSDisposableRestore' --i-confirm-local-restore

**This command actually creates a new bare Git repository.** It does not overwrite your source repository or the copied kit. Inspect the returned restoredBareRepository absolute directory. It will have a generated name beginning with gitporch-restored-. Do not guess the name and do not accidentally target production Git data.

### 3. Compose machine-verifiable evidence without human claims

Use the exact restoredBareRepository path returned above:

    npm run homenode -- field-evidence 'D:\PhiOSEvidence\portable-kit-reference.json' 'F:\CopiedPhiOSKit' 'D:\PhiOSDisposableRestore\gitporch-restored-PhiOS-<actual-UUID>.git' none

The report:
- Independently re-runs the R0.14 copied-kit SHA-256 file census and Git bundle clone/fsck check.
- Reads copied kit snapshot.json and cross-checks its repository identity and bundle digest.
- Rejects restored Git directories inside the copied kit or live GitPorch data, symlinks/redirects in key layout components, Git alternates, promisor packs and attached remote configuration.
- Runs restricted local git fsck --full --strict --no-reflogs, verifies it is a bare repository, and compares **every ref name and commit OID** against the copied snapshot's ref list. Missing or altered refs cause a refusal, not a partial success.
- Emits deterministic unsigned JSON with reportSha256 and no absolute path leakage. There are **no persistent file changes** from this command. The existing copied-kit verifier uses an automatically deleted temporary local Git clone.

The technical status is always COPIED_KIT_AND_RESTORED_GIT_TECHNICALLY_RECHECKED_ONLY. That does not imply the component runs, an OS boots, or all ecosystem assets were included.

### 4. Optional operator observations

For an actual manually witnessed field session, place the following JSON in a local evidence folder outside the copied kit, e.g. D:\PhiOSEvidence\operator-observations.json. Change the date and values to reflect what you personally observed; **do not set booleans true merely to produce a more favorable report**.

~~~json
{
  "schema": "gitporch.operator-field-observations.v0.1",
  "observedAt": "2026-10-28T15:30:00-07:00",
  "mediaLabel": "External SSD A (operator label)",
  "separatePhysicalDeviceObserved": false,
  "wanDisconnectedObserved": false,
  "componentName": "PhiOS selected local component",
  "componentLaunchOutcome": "NOT_RUN",
  "operatorNotes": "Record actual observations; keep passwords and personal details out."
}
~~~

Use it when ready:

    npm run homenode -- field-evidence 'D:\PhiOSEvidence\portable-kit-reference.json' 'F:\CopiedPhiOSKit' 'D:\PhiOSDisposableRestore\gitporch-restored-PhiOS-<actual-UUID>.git' 'D:\PhiOSEvidence\operator-observations.json'

Each human-reported successful claim is tagged OPERATOR_REPORTED_*_NOT_INDEPENDENTLY_VERIFIED. If the operator marks a component PASS while the files fail Git or SHA-256 validation, the entire command **fails**. An observation claiming WAN disconnection or independent media **never flips a technical acceptance flag**.

If a launch fails, set componentLaunchOutcome to FAIL and record the error. If not attempted, select NOT_RUN. Never claim network isolation based solely on a disabled browser or untested Wi-Fi icon.

The optional observation file is limited to 8 KiB with exact expected keys, size- and syntax-limited plain text, and no extra keys. It is unsigned and should be treated as potentially sensitive, especially if the operator records hardware identifiers.

## Technical versus human claims

| Subject | R0.15 status |
| --- | --- |
| Selected kit file bytes equal the reference | Recomputed SHA-256 plus exact path/size matching |
| Copied Git bundle reconstructable | Temporary local clone/fsck through R0.14 |
| Retained restored bare repo | fsck and exact copied-snapshot ref equality |
| All LFS and Release assets | **Not proved**; only the selected included files have matching bytes |
| Different physical disk | **Human statement only**, never measured by tool |
| WAN really disconnected | **Human statement only**, never measured by tool |
| PhiOS component launched successfully | **Human statement only**, not executed/observed by tool |
| Offline OS or whole-ecosystem recovery | **Always false and unproven** |

The reportSha256 is a repeatable change detector. It is not a digital signature, self-authenticating proof of launch or independent witness. If stronger evidence is needed, use an independent trusted signature and a personally reviewed field video/log outside this workflow.

## Developer acceptance

    npm test
    node --test test/homenode-field-evidence.test.mjs

CI builds actual local Git fixtures, generates bundle snapshots, copies the kit, performs an R0.4 restore, checks the restored repo's refs and fsck, and tests failures for modified/missing refs, added remote configurations, altered copied bytes, malformed/oversize human observations, unsafe overlapping paths and CLI argument rejection.

**CI tests are simulated local files and isolated directories, not actual Windows removable-media hardware, detached WAN, or an executed PhiOS component.**

**Ledger Above Ego. DONE Means Verified.**
