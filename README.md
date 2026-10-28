# The GitPorch

## Code Brown · Human usability gauntlet (CB-001)

**If Brown can’t figure it out, we haven’t finished building it.** Code Brown is a six-question, *human-observed* first-use review for the Φ ecosystem: understand the app in 5 seconds, find the main action, achieve a useful result in 30 seconds, navigate on the actual device, recover from an error, and say whether they would return. It tests the interface, **not the visitor’s intelligence**.

Use the local-only [browser checklist](docs/code-brown.html) (also available from the public GitPorch showcase after Pages deploys); export a JSON report, then validate it with `node src/code-brown-cli.mjs path/to/report.json --require-pass`. [Protocol, claims and limitations](docs/CODE_BROWN.md). This does not confer an automatic usability certification or run a real human test for you.


> **Pull up a chair. Push some code.**
>
> Your code. Your porch. Your rules.

**R0.1.0: local-first Git homestead.** An original, dependency-free Node.js + Git repository host with a browser dashboard and a separate read-only local Git clone endpoint. This is **not** yet a GitHub replacement, multiuser forge, or independent CI runner. We mark unfinished capabilities honestly.

## Public GitHub Pages showcase

The Pages-ready **interactive public demo** lives under [`docs/`](docs/). It uses only fictional repositories and commit examples, never the local GitPorch API or private data.

After this feature is merged, enable GitHub Pages under **Settings → Pages → Deploy from a branch → `main` / `docs`**. Expected address: https://michaelwave369.github.io/GitPorch/ (live only after GitHub Pages publishes it). See [the Pages guide](docs/PAGES.md).

## Quick start on Windows PowerShell (or any terminal)

Requirements: **Node.js 20+** and **Git** on PATH.

```bash
npm start
```

Open **http://127.0.0.1:3690**. No `npm install` required.

In another terminal, create your first repository:

```bash
node src/cli.mjs init hello-world
```

To push an **existing local** repository into GitPorch, use the actual path printed by the command (the example is a placeholder):

```bash
git remote add porch "C:/path/to/GitPorch/data/repos/hello-world.git"
git push porch HEAD:main
```

To clone from the **read-only** Git daemon while `npm start` is running:

```bash
git clone git://127.0.0.1:9418/hello-world.git
```

To inspect repository object integrity and run the built-in tests:

```bash
node src/cli.mjs verify hello-world
npm test
```

`verify` runs `git fsck`. It is **not** a build test, malware scan, or security certification.

### Configuration

- `GITPORCH_DATA_DIR`: location of the private runtime data directory, default `./data`.
- `GITPORCH_HTTP_PORT`: dashboard/API port, default `3690`.
- `GITPORCH_GIT_PORT`: read-only clone port, default `9418`.
- Both listeners bind to `127.0.0.1`, not LAN or public interfaces.

```powershell
$env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
node src/cli.mjs init MyProject
npm start
```

## Actually implemented in R0

- Bare Git repository creation, listing and object-integrity checks through a local CLI.
- Real Git branch and commit evidence in the browser dashboard.
- Local filesystem Git pushes, loopback-only read-only `git://` cloning.
- Read-only HTTP API with no browser mutations, no authentication claims and no public-network exposure.
- Native `node --test` suite; does not require GitHub Actions or any npm dependency downloads.
- **Showcase mode** if the local API is not available: fictional sample repositories are explicitly labeled.

## PhiOS HomeNode R1-H1: offline snapshot pilot

The optional single-operator HomeNode CLI inventories **local** GitPorch repositories and makes per-repository full-history Git bundles with SHA-256 manifests and a verified temporary mirror restoration. These commands do not install or access a remote server, sync GitHub, back up GitHub PRs/LFS, or open network listeners.

```powershell
npm run homenode -- inventory
# Use an existing backup directory outside GitPorch's data directory:
npm run homenode -- backup hello-world 'E:\PhiOSBackups'
# Then use the generated snapshot directory returned by the command:
npm run homenode -- verify 'E:\PhiOSBackups\gitporch-hello-world-<generated-id>'
```

Read [the HomeNode operator and restore guide](docs/HOMENODE.md) before relying on snapshots. The existing dashboard is still localhost-only and unauthenticated. **Do not expose its ports to a LAN or the public internet.**

## PhiOS R0.17: operator-approved offline PhiOS frontend byte check and localhost preview

R0.17 explicitly separates **source recovery** from **a built static frontend**. After you produce a reviewed PhiOS Vite `site/dist` build and copy it to a standalone folder (not automatically from GitPorch), the new `frontend-scan` command inventories up to 512 files with SHA-256, detects missing *direct* HTML/CSS static asset references, and fails on remote HTML/CSS resource URLs. Save its **unsigned** JSON output outside the build. `frontend-verify` then checks an operator-copied `dist` directory's exact filenames, sizes and hashes without any network traffic.

```powershell
npm run homenode -- frontend-scan "E:\PhiOSBuilt\dist" > "D:\PhiOSEvidence\frontend-dist-reference.json"
npm run homenode -- frontend-verify "D:\PhiOSEvidence\frontend-dist-reference.json" "F:\CopiedPhiOSDist"
npm run homenode -- frontend-serve "D:\PhiOSEvidence\frontend-dist-reference.json" "F:\CopiedPhiOSDist" 8765 --i-approve-loopback-preview
```

The opt-in preview binds **127.0.0.1:8765** only and serves under `/PhiOS/` with a local-only Content Security Policy blocking external resource and fetch origins. It rechecks every requested file's hash, never opens the browser automatically, and stops with Ctrl-C. In the operator's browser, manually visit `http://127.0.0.1:8765/PhiOS/`. Even an HTTP 200 is **not** a measured rendered page, app navigation, offline external-network disconnection, or a booted Linux PhiOS image.

This tool neither invokes `npm` to build nor imports arbitrary binaries. Static HTML/CSS references are inspected, but dynamic JavaScript imports and runtime fetches remain **unverified**. [R0.17 guide](docs/PHIOS_R17_OFFLINE_FRONTEND_PREVIEW.md).

## PhiOS R0.16: recovered-source offline launch prerequisite preflight

**A recovered Git repository is not automatically a running application.** R0.16 inspects one validated, copied and independently restored public repository's selected branch without running its code. It composes the R0.15 copied-kit and recovered-Git verification first, then checks tracked HTML/JS package entrypoints, build scripts, dependency lockfile presence, Python dependency manifests and Linux ISO build/release sources.

This distinction is especially important for PhiOS: the website is a **Vite + TypeScript + React source project**, whose `site/index.html` references `/src/main.tsx`. A raw HTML file from that source tree **is not a self-contained offline build**; the standalone offline frontend needs a prebuilt deployable output and its required assets, or a separately verified local build toolchain and dependency cache. Likewise, Linux archiso sources are not a bootable ISO.

```powershell
npm run homenode -- runtime-preflight "D:\PhiOSEvidence\portable-kit-reference.json" "F:\CopiedPhiOSKit" "D:\PhiOSDisposableRestore\<actual-restored-repository>.git" "main"
```

The command reports what is tracked and what is **still unverified**. It never installs packages, calls GitHub, extracts files, executes scripts, spins up servers, or changes the network. All launcher/boot/physical WAN readiness flags remain false. See [R0.16 source and runtime guide](docs/PHIOS_R16_OFFLINE_RUNTIME_PREFLIGHT.md).

## PhiOS R0.15: offline field evidence with honest human/test boundaries

After R0.14 verifies a copied kit, R0.15 rechecks the kit and an **actual separately restored bare Git repository**. It performs restricted local Git fsck, matches **every restored ref and commit OID** to the copied snapshot, and rejects external alternates, remote configurations and unsafe paths. An optional small operator observation JSON records what a human saw during the field test, but its WAN, media independence and component launch claims are **explicitly unsigned and unverified**. The report never claims full PhiOS offline readiness.

```powershell
npm run homenode -- field-evidence "D:\PhiOSEvidence\portable-kit-reference.json" "F:\CopiedPhiOSKit" "D:\PhiOSDisposableRestore\gitporch-restored-PhiOS-<generated-id>.git" none
```

Use the exact restored bare repository directory returned by the existing R0.4 `drill` receipt. To add an optional operator observation file, replace literal `none` with the absolute JSON path described in [R0.15 operator guide](docs/PHIOS_R15_FIELD_EVIDENCE.md). The command has no outbound network, no automatic copy/restore, no software launch, and no permanent file writes. Git verification uses temporary local clones that are deleted by the existing verifier.

Even if a human reports success offline, **independent-device identity, actual WAN disconnection and component execution remain unmeasured by this software**. Keep those as separate, externally witnessed field evidence.

## PhiOS R0.14: portable offline recovery kit readback

Git bundle backups, Git LFS bytes, and Release assets become much more useful when **a copied kit can be verified without the original machine or the internet**. R0.14 provides two read-only commands: `portable-kit-plan` inventories an explicitly assembled source kit, independently clones/fsck-verifies its included Git bundle, checks every included content-addressed LFS/Release file's name against its SHA-256 bytes, and prints a repeatable unsigned manifest to stdout. `portable-kit-verify` checks that an operator-copied kit has **the exact same files, sizes and hashes** and re-verifies its Git bundle.

Use a kit folder containing `snapshot/repository.bundle`, `snapshot/snapshot.json`, and optional `lfs/objects/sha256/<2-digit-prefix>/<64-digit-hash>` and `releases/releases/sha256/<2-digit-prefix>/<64-digit-hash>` files. No arbitrary extra files, links, symlinks or partial inventories are allowed. Max 128 asset files and 4 GiB of selected contents.

```powershell
npm run homenode -- portable-kit-plan "D:\PhiOSCatalog\<catalog>.json" "PhiOS" "E:\PreparedPhiOSKit"
npm run homenode -- portable-kit-verify "D:\PhiOSCatalog\<saved-portable-manifest>.json" "F:\CopiedPhiOSKit"
```

The tool **never copies files or disconnects your WAN**. You manually copy the kit, keep the reference manifest separate, and can run `portable-kit-verify` on the copied device with the original source unavailable. This proves byte equality against the **unsigned** reference file, not independent physical media, a live offline boot, publisher authenticity, or completeness of all ecosystem assets. [R0.14 field guide](docs/PHIOS_R14_PORTABLE_KIT_FIELD_DRILL.md).

## PhiOS R0.13: unified offline recovery evidence gates

R0.13 combines our existing **R0.5 current-ref Git bundle coverage**, **R0.9 LFS tip byte verification**, **R0.10 exact submodule commit availability**, and **R0.12 archived GitHub Release attachment verification** into a single no-network evidence report for one explicitly selected public repository. It refuses mismatched pinned branch tips and reports missing, corrupt, unsupported, or unprovided evidence without awarding a fake 'offline-ready' badge.

```powershell
npm run homenode -- offline-readiness "D:\PhiOSCatalog\<catalog>.json" "PhiOS" "main" "E:\GitPorchSnapshots" "E:\PhiOSAssets" "D:\PhiOSCatalog\<saved-release-inventory>.json" "E:\PhiOSArchive"
```

If no saved public-release inventory/asset store exists yet, use literal `none none` for the last two arguments; that **blocks** the Release evidence gate. The command emits an unsigned repeatable JSON status report to stdout and does not connect to GitHub, fetch external assets, or change source/backup files. Existing bundle verification may create and delete temporary isolated Git clones as part of R0.5.

Passing all four *bounded local-evidence gates* still **never means** independent physical media, historical Git/LFS coverage, current GitHub parity, WAN-disconnected restoration, or a working PhiOS boot. Those need a separate operator-run physical acceptance drill. See [R0.13 guide](docs/PHIOS_R13_OFFLINE_RECOVERY_EVIDENCE.md).

## PhiOS R0.12: approved single-asset GitHub Release preservation

R0.12 extends the R0.11 published-asset census to **actual SHA-256 verified byte archival** for one selected public GitHub Release asset. First save the output of the explicitly approved R0.11 `release-inventory` command as a local JSON file. Then run an **offline, read-only preview**, review the exact asset ID, release ID, published SHA-256, size, archive root and plan fingerprint, and separately approve a **single** capped network download:

```powershell
npm run homenode -- release-archive-plan "D:\PhiOSCatalog\<catalog>.json" "D:\PhiOSCatalog\<saved-release-inventory>.json" "PhiOS" "1234567" "E:\PhiOSArchive"
npm run homenode -- release-archive "D:\PhiOSCatalog\<catalog>.json" "D:\PhiOSCatalog\<saved-release-inventory>.json" "PhiOS" "1234567" "E:\PhiOSArchive" "<planSha256>" --i-approve-release-download
npm run homenode -- release-archive-verify "D:\PhiOSCatalog\<catalog>.json" "D:\PhiOSCatalog\<saved-release-inventory>.json" "PhiOS" "1234567" "E:\PhiOSArchive"
```

The download step **rechecks current GitHub release metadata** before requesting any attachment bytes, refuses releases without a published SHA-256, caps each file at 64 MiB, rejects unapproved redirects, checks true streamed bytes and SHA-256, and atomically preserves the verified object under a content-addressed `releases/sha256/` store. Nothing is unpacked or executed. A physically separate restore, publisher signature verification, completeness of all Releases and actual offline PhiOS launch are **not** implied. [Full R0.12 guide](docs/PHIOS_R12_RELEASE_ASSET_ARCHIVE.md).

## PhiOS R0.11: bounded public GitHub Release asset inventory

Unlike Git commits or Git LFS pointers, **GitHub Release attachment files are not preserved by Git bundles**. The R0.11 `release-inventory` command performs an explicit **online, metadata-only** inspection of one public-cataloged repository. It lists published public Releases and their downloadable asset IDs, names, byte sizes, and SHA-256 digest claims where GitHub provides one.

```powershell
npm run homenode -- release-inventory "D:\PhiOSCatalog\<actual-catalog>.json" "PhiOS" --i-approve-public-release-lookup
```

The command constructs only fixed GitHub REST API URLs, rejects redirects and incomplete oversized pages, and never follows asset download links. At most **20 published releases** and **100 attachments per release** (200 overall) are accepted. Output is a deterministic unsigned JSON evidence manifest; **none of the release bytes are downloaded or verified**. A missing SHA-256 digest is explicitly unverified, and no-result status is not interpreted as permanent absence of releases. Next stage requires a separate approved byte archival flow. [R0.11 operator guide](docs/PHIOS_R11_PUBLIC_RELEASE_INVENTORY.md).

## PhiOS R0.10: offline submodule commit recovery ledger

Normal Git bundles preserve submodule **gitlink commit identifiers**, not the external repositories they reference. The new `submodule-ledger` reads the pinned parent branch-tip tree and a bounded local `.gitmodules` file without contacting its URLs. It checks only exact, public-cataloged `github.com/MichaelWave369/<repo>` submodule targets and asks whether their **referenced commit** is present and reachable from refs in a separately fsck-verified local GitPorch mirror.

```powershell
npm run homenode -- submodule-ledger "D:\PhiOSCatalog\<actual-catalog>.json" "PhiOS" "main"
```

Every target is marked locally available or missing/unverified, including unapproved URLs and mismatched .gitmodules paths. It emits no untrusted URL strings, private catalog entries or local file paths. There is no GitHub fetch, submodule checkout, cloning, downloading, file write or code execution. A verified target commit still **does not mean its bare repository has been independently bundled and restored**, or that nested submodules, LFS payloads, releases, GitHub upstream authenticity or PhiOS boot are covered. [R0.10 operator guide](docs/PHIOS_R10_SUBMODULE_RECOVERY_LEDGER.md).

## PhiOS R0.9: local LFS multi-object recovery manifest

One missing LFS object is manageable; dozens of them need a ledger. The R0.9 `lfs-manifest` command inventories canonical Git LFS pointer files from **one explicitly selected, pinned, locally verified public Git branch tip** and checks which underlying payload bytes are independently readable and SHA-256 valid in the content-addressed local asset store:

```powershell
npm run homenode -- lfs-manifest "D:\PhiOSCatalog\<actual-catalog>.json" "PhiOS" "main" "E:\PhiOSAssets"
```

The report includes each unique pointer SHA-256, declared size, tracked source paths, local verification status and per-object R0.8 download-pilot eligibility. It counts missing, verified and corrupted objects and prints a stable SHA-256 fingerprint for the **unsigned** report. It does not write files or access the network.

Safety caps: 30,000 tracked tip entries, 256 canonical pointer candidates, 64 distinct LFS objects, and 256 MiB aggregate inspected payload bytes. Exceeding limits **refuses incomplete reporting**. A verified report means *only the detected LFS pointers at this selected Git branch tip*, not historical LFS objects, other branches, releases, submodules, independent off-host media or bootable PhiOS. [R0.9 operator guide](docs/PHIOS_R09_LFS_RECOVERY_MANIFEST.md).

## PhiOS R0.8: explicit, bounded GitHub LFS acquisition

R0.8 extends the verified local LFS pointer chain to a single **operator-approved GitHub LFS download**. Review an offline `lfs-fetch-plan`, then run `lfs-fetch` with that exact plan fingerprint and an explicit approval flag. Only `github.com/MichaelWave369/<public-repo>.git/info/lfs/objects/batch` can be contacted for the GitHub LFS transfer agreement; its subsequent download action must use a tightly allowlisted GitHub media or object-storage hostname with **HTTPS**, no redirects, and a **64 MiB stream limit**. The downloaded bytes must match the exact SHA-256 and size from the locally verified Git pointer or they are discarded.

```powershell
npm run homenode -- lfs-fetch-plan "D:\PhiOSCatalog\<actual-catalog>.json" "PhiOS" "main" "models/model.bin" "E:\PhiOSAssets"
npm run homenode -- lfs-fetch "D:\PhiOSCatalog\<actual-catalog>.json" "PhiOS" "main" "models/model.bin" "E:\PhiOSAssets" "<planSha256>" --i-approve-github-lfs-download
```

Public LFS may work without a token. For access that requires authentication, set a **separately scoped** `GITPORCH_LFS_TOKEN` in the operator process environment; it is sent only to GitHub's LFS batch endpoint, not automatically forwarded to a CDN, recorded, or printed. Unsupported action hosts/headers are **rejected rather than silently trusted**; real GitHub success still needs operator-machine testing. No automatic import of arbitrary URLs, private projects, recurring sync or claim of complete LFS coverage. [Read R0.8 boundaries](docs/PHIOS_R08_GITHUB_LFS_DOWNLOAD.md).

## PhiOS R0.7: approved one-object Git LFS byte intake

This first LFS byte rung uses **one operator-selected local file**, not a GitHub download. A read-only `lfs-plan` verifies the current Git branch-tip LFS pointer against the file's true SHA-256 and declared byte length, up to **64 MiB per invocation**. After reviewing the SHA-256 plan fingerprint, `lfs-intake` preserves the matching bytes under a content-addressed asset store **outside** GitPorch data, without overwriting. `lfs-verify` checks the preserved object again **without** requiring the original payload file.

```powershell
# Replace example absolute paths and names with actual existing paths.
npm run homenode -- lfs-plan "D:\PhiOSCatalog\<catalog>.json" "PhiOS" "main" "models/model.bin" "D:\AssetImports\model.bin" "E:\PhiOSAssets"
npm run homenode -- lfs-intake "D:\PhiOSCatalog\<catalog>.json" "PhiOS" "main" "models/model.bin" "D:\AssetImports\model.bin" "E:\PhiOSAssets" "<returned-planSha256>" --i-approve-lfs-byte-intake
npm run homenode -- lfs-verify "D:\PhiOSCatalog\<catalog>.json" "PhiOS" "main" "models/model.bin" "E:\PhiOSAssets"
```

No arbitrary URLs, GitHub tokens, auto-smudge, hooks, network activity, code execution or files bigger than 64 MiB. This does **not** collect every historical LFS object or release, verify separate physical media, establish remote GitHub parity, or qualify an offline PhiOS build. See [R0.7 LFS byte intake](docs/PHIOS_R07_LFS_BYTE_INTAKE.md).

## PhiOS R0.6: offline external asset dependency gap audit

A Git bundle preserves reachable Git objects, **not** the contents referenced by Git LFS pointers, submodule gitlinks, or GitHub release downloads. The first R0.6 tool inspects up to five explicitly named public local bare mirrors and checks a bounded set of branch-tip trees for Git LFS pointers, tracked `.gitattributes` LFS declarations, and submodule gitlink references. It never downloads or executes them.

```powershell
# Use your exact saved public catalog file; local mirrors must already be imported.
npm run homenode -- asset-gaps "D:\PhiOSCatalog\<actual-catalog>.json" "PhiOS,GitPorch,PhiARK"
```

Each finding is deliberately **unverified as a complete external backup**. GitHub release contents remain UNKNOWN because they are not part of a normal Git repo. The tool uses no network and writes nothing to mirrors or bundles. It does not claim full-history scanning, saved LFS data, submodule target backups or offline PhiOS readiness. [R0.6 operator guide](docs/PHIOS_R06_EXTERNAL_ASSET_GAPS.md).

## PhiOS R0.5: public source backup coverage ledger

Use an existing public GitPorch catalog and existing HomeNode backup directory to report which local source mirrors are covered by verified, restorable Git bundles:

```powershell
npm run homenode -- coverage "D:\PhiOSCatalog\<actual-catalog>.json" "E:\PhiOSBackups"
```

This checks matching public snapshot folders using temporary local Git restores, then compares the bundle's branch/tag refs to the current local GitPorch mirror fingerprints. It labels **missing, invalid, matching, stale/different, or locally unavailable** instead of declaring a complete backup. It does not create/update/remove any Git mirror or backup bundle, fetch GitHub, or publish private data. It also cannot establish physical media independence, LFS preservation, GitHub parity or full PhiOS offline readiness. See [the R0.5 guide](docs/PHIOS_R05_BACKUP_COVERAGE.md).

## PhiOS R0.4: a real offline restore drill

Imported Git source is not recoverable merely because it passes a local fsck. After saving a verified HomeNode bundle on a separate backup disk, the **explicit** restore-drill command reopens that bundle into a NEW, standalone bare Git repository, checks every ref and Git object, and leaves the recovered repository available for inspection. There is no network, no overwriting the live copy and no new listener.

```powershell
# Both directories must exist. Run with WAN disconnected for your own acceptance drill.
npm run homenode -- drill "E:\PhiOSBackups\gitporch-PhiOS-<generated-id>" "D:\PhiOSRecovered" --i-confirm-local-restore
```

The command returns a local, unsigned JSON result with the actual recovered path and deliberately **false** claims for independent storage media, physical WAN disconnection, LFS, complete GitHub metadata and PhiOS boot readiness. CI only proves synthetic fixture restoration. Read [the R0.4 operator guide](docs/PHIOS_R04_OFFLINE_RESTORE_DRILL.md).

## ΦOS HomeNode R1-H2: public GitHub bridge

An **opt-in public-only** GitHub catalog and verified one-repository mirror importer builds on R1-H1 snapshots:

~~~powershell
npm run bridge -- discover MichaelWave369 'D:\PhiOSCatalog' --i-approve-public-discovery
npm run bridge -- plan 'D:\PhiOSCatalog\gitporch-public-MichaelWave369-<generated-id>.json'
npm run bridge -- import 'D:\PhiOSCatalog\gitporch-public-MichaelWave369-<generated-id>.json' PhiOS --i-approve-github-import
~~~

The catalog directory must already exist. Import never replaces an existing local repository and disconnects the original GitHub remote after verifying the mirror. This does **not** download private repositories, Git LFS contents, issues, PRs, wikis, release assets, or account settings. It does not enable automatic sync, LAN exposure, or unattended downloads.

Read [the bridge operator guide](docs/HOMENODE_BRIDGE.md) and verify an external snapshot before relying on offline recovery.

## PhiOS R0.2: offline public-mirror census (read-only)

The operator can run a **network-silent** multi-repository audit of an already-downloaded public GitHub catalog against the local GitPorch store:

```powershell
npm run bridge -- audit 'D:\\PhiOSCatalog\\gitporch-public-MichaelWave369-<generated-id>.json'
# Optional: exit code 2 unless every catalog entry has locally verified Git objects:
npm run bridge -- audit 'D:\\PhiOSCatalog\\gitporch-public-MichaelWave369-<generated-id>.json' --require-all-local-objects-verified
```

It checks local bare Git object structure and records a digest of refs for each present, supported source; missing repos stay NOT_LOCAL. This **does not** clone, back up, restore, fetch, sync, inspect private GitHub repositories, or prove the local refs match GitHub. It grants no offline readiness, mirroring completion or publication authority. [R0.2 operator guide](docs/PHIOS_R02_PUBLIC_MIRROR_AUDIT.md).

## PhiOS R0.3: five-at-a-time approved public mirror batches

This pilot imports **only 1–5 explicitly named public repositories per batch**. The preview is offline and doesn't write; the subsequent import requires a matching plan hash and operator approval. The importer reuses R1-H2's staged, non-overwriting verified Git clone, one repository at a time, and stops on the first failure.

```powershell
# Replace with the real absolute public catalog filename returned by "bridge discover":
npm run bridge -- batch-plan "D:\\PhiOSCatalog\\public-catalog.json" "PhiOS,GitPorch,PhiARK"
# Inspect the returned planSha256, then explicitly approve that exact plan:
npm run bridge -- batch-import "D:\\PhiOSCatalog\\public-catalog.json" "PhiOS,GitPorch,PhiARK" "<the-64-hex-planSha256>" --i-approve-public-batch-import
```

The batch is **not** a backup, an automatic importer of the whole account, a private-repository migration or a background sync. Always use the R0.2 read-only audit before and after and take independently verified external backups. See [R0.3 operator guide](docs/PHIOS_R03_PUBLIC_BATCH_IMPORT.md).

## HomeNode R1-H3: scaling the local Git repository namespace

The HomeNode capacity policy now supports **up to 2,048 supported local repositories** and GitPorch names **up to 100 characters** (excluding Windows reserved device basenames and unsafe filename patterns). Inventory no longer silently truncates at 200. Repository scans use a maximum of eight simultaneous Git workers rather than spawning subprocesses for every repository at once.

Existing repository content is not renamed or migrated. All CLI operations remain single-operator and localhost-only; this is a storage-capacity and catalog correctness update, **not** an authenticated LAN server or automatic cloud synchronization.

See [R1-H3 operating notes](docs/HOMENODE_CAPACITY.md) for limitations and validation.

## HomeNode R1-H4: experimental authenticated LAN capability gateway

An **independent, opt-in HTTPS service** can answer versioned HomeNode health/capability requests for trusted native PhiOS companions on a private LAN. It **does not** expose any repositories, Git operations, builds, API writes or the original GitPorch dashboard.

```powershell
# First configure one explicit private LAN IPv4 and private TLS cert/key/token file paths.
npm run gateway -- preflight
npm run gateway -- serve --i-accept-lan-read-only
```

This gateway never starts with `npm start`. Its endpoints require a bearer token, valid TLS and matching IP Host header. Browsers, CORS and cookies are deliberately unsupported. **Do not forward/bridge ports 3690, 9418 or 3743 to the WAN.** No EnterTheField.org/ PhiOS app is modified by this change. Read the [HomeNode network/operator guide](docs/HOMENODE_NETWORK.md) and complete an independent security review before LAN deployment.

## HomeNode R1-H5: PhiOS native companion trust client

The **one-shot local CLI** selects Public, Local or Offline mode without claiming untested service readiness. In Local mode it makes a single TLS-validated, SHA-256 certificate-pinned, authenticated request to the R1-H4 **metadata-only** gateway.

```powershell
npm run companion -- status --mode offline
npm run companion -- status --mode public
# First set private IP, operator-verified cert fingerprint, private certificate and token-file paths:
npm run companion -- preflight
npm run companion -- status --mode local
```

Missing LAN service, invalid certificate or token, or unexpected capability schema fails closed to OFFLINE **selection**, with `offlineServicesVerified: false`. No automatic public fallback, Git pushes, secrets in browser, installed daemon or EnterTheField site changes. See [companion operating and trust guide](docs/HOMENODE_COMPANION.md).

## PhiBots Clubhouse (local R0.3)

The Clubhouse records **local contributor labels, proposals referencing actual Git commits, and operator review notes**. It does not authenticate human or bot identity, certify any test, run build scripts, or merge branches.

```bash
node src/clubhouse-cli.mjs register helper-bot builder "Example Helper"
node src/clubhouse-cli.mjs list
# After you create/push a real repo commit to the local GitPorch:
node src/clubhouse-cli.mjs propose helper-bot hello-world <full-commit-sha> "Improve the README"
# Review decisions only after manual operator inspection:
node src/clubhouse-cli.mjs decide <proposal-uuid> ACCEPTED "Reviewed locally" --confirm-local-review
```

These receipt files stay under ignored `data/crew/`. They are checksum-protected against accidental changes, **not signed, tamper-proof, append-only, or backed by authenticated identities**. See [Clubhouse rules](docs/CLUBHOUSE.md). The local dashboard has a read-only clubhouse view at `#clubhouse`. The public GitPage uses separate fictional examples.

## The Porch Crew R1-A: independent Git integrity worker

The Porch Crew first slice runs **real local Git object integrity checks** using `git fsck`. This is not automated testing, authenticated CI, a sandbox, or permission to merge. Neither GitHub nor GitHub Actions is needed to queue or execute a check.

```bash
node src/porch-crew-cli.mjs enqueue hello-world
node src/porch-crew-cli.mjs work-once
node src/porch-crew-cli.mjs list
```

First create `hello-world` and push a real commit. Empty repositories cannot pass integrity checks. The running local dashboard shows the read-only Workshop at `http://127.0.0.1:3690/#workshop`, and read-only JSON at `GET /api/porch-crew`.

`PASS` means **Git integrity check passed for the recorded HEAD**, *not* a project build, test, or security audit. Changed repository HEAD => `STALE`. A killed worker remains `RUNNING_UNCERTAIN`, never green. An exclusive `data/porch-crew/worker.lock` prevents two workers from running together; after a crash, inspect and back up the queue before manually addressing the lock. Read [Porch Crew safety and recovery](docs/PORCH_CREW.md).

## The Porch Crew R1-B: opt-in container tests

This adds an **optional local test runner** for Node.js repositories. Unlike R1-A's Git integrity-only check, the R1-B worker actually executes `node --test --test-reporter=tap` **inside** a restricted Docker container. It requires Docker Engine installed and an **already-loaded, immutable Node 22 Alpine image**. It **never installs packages**, downloads images, pulls dependencies, or runs repository scripts on your Windows host.

```powershell
# Only on your local PC, when Docker is installed and trusted:
docker pull node:22-alpine
docker image inspect --format '{{.Id}}' node:22-alpine
# Copy the returned sha256:<64-hex> image ID below.
node src/sandbox-cli.mjs preflight sha256:<64-hex-image-id>
node src/sandbox-cli.mjs enqueue hello-world sha256:<64-hex-image-id>
node src/sandbox-cli.mjs work-once --i-approve-container-tests
node src/sandbox-cli.mjs list
```

The worker stages the pinned repository commit as a tar archive, then uses `docker run` with `--pull=never`, `--network none`, `--read-only`, dropped capabilities, non-root user, a bounded tmpfs, CPU/memory/PID limits and a 90-second deadline. Its command is fixed to built-in Node tests; no repo-provided GitHub Actions YAML is read. Docker isolation still has residual risks, and **this is intended only for trusted local repositories**.

**R1-C evidence hardening:** The worker compares the inspected local Docker image ID (or explicitly matching RepoDigest) to the immutable image recorded in the queued job. It rejects mismatches before running tests, requires a consistent TAP summary, and stores SHA-256 hashes of container stdout/stderr alongside the observed image ID and Docker CLI exit status. This is local metadata, **not a signed attestation or proof of independence**. `preflight` inspects the image without launching it. Real Docker and full Windows verification are still required.

See [R1-B/C operator guide](docs/SANDBOX_TESTS.md) for limitations, status semantics and recovery. The local read-only dashboard shows these receipts at `http://127.0.0.1:3690/#sandbox`. Public GitHub Pages receives no job data.

## R1-D1: The Recovery Doctor

A local operator can inspect interrupted worker queues without executing jobs or silently changing results:

```powershell
node src/recovery-cli.mjs doctor
# Only AFTER verifying the original worker has stopped and the lock is absent:
node src/recovery-cli.mjs abandon git <job-id> "Operator confirmed worker stopped" --i-confirm-no-worker-running
# Or for container tests:
node src/recovery-cli.mjs abandon tests <job-id> "Container inspected and stopped" --i-confirm-no-worker-running
```

The only permitted manual outcome is **`ABORTED_UNVERIFIED`**, never a pass or successful test. Existing worker locks cause recovery to refuse, and it does not kill processes, remove locks or re-run tests. A partial manual recovery can be completed only when its existing checksum-validated abandonment receipt has the same operator reason. **Never delete a lock until independently verifying no worker/container is running and backing up your local data.** See [Safe Recovery Guide](docs/RECOVERY.md). No signed attestations or automated restart safety claims are made.

## R1-D2: Offline signed local reports

A completed Git integrity check or opt-in Docker test run can be **manually signed** with an Ed25519 key stored only on the local machine. Another person can verify the signature **offline** using a separately trusted public key. **A valid signature proves who held the signing key and that signed bytes have not changed, not that the run was truthful, independently witnessed or passed.** The private key generated in this first pilot is **unencrypted**; protect it with OS ACLs and never publish it.

```powershell
node src/evidence-cli.mjs keygen --i-accept-unencrypted-private-key
node src/evidence-cli.mjs sign git <completed-job-id> .\data\signed-reports\git-report.json --i-attest-local-result
node src/evidence-cli.mjs verify .\git-report.json .\data\signer\operator-public.pem
```

Signing does not run any tests, overwrite completed results, or change the underlying outcome. Signed JSON can reveal repository names and commit identities, so share only deliberately. [Read the signing and verification guide](docs/SIGNED_EVIDENCE.md).

## R1-D3: Second-key offline witness

The operator may send an **already signed local job report** to another trusted person, who checks its operator signature and signs the exact report hash with a **different Ed25519 key**. A third party can verify **both** signatures offline, with independently trusted public keys. It preserves recorded `PASS`, `FAIL` or `ABORTED_UNVERIFIED` outcomes.

```powershell
# Ideally on the witness's separate computer. The private key is unencrypted:
node src/witness-cli.mjs keygen "$env:USERPROFILE\GitPorchWitnessKeys" --i-accept-unencrypted-witness-key
node src/witness-cli.mjs sign .\data\incoming\operator-report.json .\data\incoming\trusted-operator-public.pem "$env:USERPROFILE\GitPorchWitnessKeys\witness-private.pem" .\data\signed-reports\witness-report.json --i-confirm-signature-only
# Verifier with separately trusted keys:
node src/witness-cli.mjs verify .\data\incoming\operator-report.json .\data\signed-reports\witness-report.json .\data\incoming\trusted-operator-public.pem .\data\incoming\trusted-witness-public.pem
```

**Two signatures do not prove two independent machines or that the test actually ran.** They establish only that distinct key holders signed and countersigned the particular record. No remote services or automatic merge actions are added. See [R1-D3 operator guide](docs/WITNESS.md).

## R1-D4A: Offline public-key trust and revocation

A valid Ed25519 signature is only useful if the verifier separately approves the signing keys. This opt-in local registry enrolls operator and witness public keys by confirmed fingerprint and refuses unknown or revoked keys.

```powershell
node src/trust-cli.mjs fingerprint .\data\incoming\trusted-operator-public.pem
node src/trust-cli.mjs enroll operator .\data\incoming\trusted-operator-public.pem sha256:<64-hex> --i-verified-fingerprint-out-of-band
node src/trust-cli.mjs enroll witness .\data\incoming\trusted-witness-public.pem sha256:<64-hex> --i-verified-fingerprint-out-of-band
node src/trust-cli.mjs verify .\data\incoming\operator-report.json .\data\incoming\witness-report.json
node src/trust-cli.mjs revoke witness sha256:<64-hex> "Key retired" --i-confirm-revocation
```

The registry is stored in ignored `data/trust/`. Its revocation checksums **do not make it signed, immutable or rollback-proof**. Revoked keys are rejected even for old reports under the current local policy. This does not prove test execution. See [Trust Policy Guide](docs/TRUST_POLICY.md).

## R1-D4B1: Optional password-encrypted local operator key

Generate a **new** Ed25519 operator key whose private material is stored in an encrypted vault (scrypt + AES-256-GCM) under ignored `data/signer/`. A hidden interactive passphrase prompt is required; no passphrase is accepted on the command line. **Existing unencrypted keys are not converted or deleted.**

```powershell
node src/vault-cli.mjs keygen --i-accept-password-vault
node src/vault-cli.mjs public
node src/vault-cli.mjs sign git <completed-job-id> --i-confirm-local-signing
```

Signed reports remain compatible with existing offline verification; they retain their actual PASS/FAIL/ABORTED_UNVERIFIED status. Decrypted key material exists briefly in process memory, so encryption does **not** protect against a compromised host. Protect and back up your strong vault passphrase: there is no recovery. See [Encrypted Operator Key Guide](docs/ENCRYPTED_KEYS.md).

## R1-D4B2A: Stage an encrypted-vault passphrase change

This provides an **opt-in, nondestructive rewrap** of the current encrypted operator key, generating a new encrypted copy with the **same Ed25519 fingerprint** and a **different passphrase**, salt and nonce. It keeps the original encrypted vault untouched; nothing switches or revokes automatically.

```powershell
node src/vault-cli.mjs rewrap --i-confirm-new-encrypted-copy
node src/vault-cli.mjs verify-next
# Optional: use staged key for a new completed job, without changing default vault:
node src/vault-cli.mjs sign-next git <completed-job-id> --i-confirm-local-signing
```

This is **passphrase rotation, not signing-key identity rotation**. It cannot make a compromised private key safe, and revoking its unchanged public fingerprint would affect both encrypted copies. [Read the safe rewrap guide](docs/VAULT_REWRAP.md).

## PhiRunners R1-E: the local operator command hub

PhiRunners unifies the already implemented Porch Crew Git-integrity and restricted Docker-test queues. It introduces a **read-only local status view**, not a new runner engine or GitHub replacement.

```powershell
npm run phirunners -- status
npm start
# http://127.0.0.1:3690/#phirunners
```

The CLI also exposes operator-initiated `enqueue-git`, `work-git-once`, `preflight-image`, `enqueue-tests`, and `work-tests-once --i-approve-container-tests` operations by **delegating to existing workers**. Nothing triggers automatically from the browser or a remote PR. Invalid or changing receipts suppress affected lane data; combined totals are withheld if any lane cannot be verified locally. Locks mean activity **unknown**, not confirmed running. This module does not register a GitHub self-hosted runner or offer deployment, remote sync, untrusted-code isolation, or independently attested builds.

See [PhiRunners operator guide](docs/PHIRUNNERS.md) for the commands, boundaries, and roadmap.

## Artifact Forge R1-F1: private source bundles with local SHA-256

Artifact Forge produces a bounded `git archive` of an exact commit only when a matching, locally reported **successful isolated Node test** has completed with output evidence. The operator must explicitly approve each bundle; no build scripts, arbitrary commands, installs, deployments, pushes, or network publishing run during packaging.

```powershell
npm run artifacts -- list
# After a matching completed local Docker test job:
npm run artifacts -- bundle hello-world <completed-test-job-id> --i-approve-source-archive
npm start
# http://127.0.0.1:3690/#artifacts
```

Every source tar and its receipt live under ignored private `data/artifacts/`. The read-only local inventory rechecks SHA-256 and metadata and **fails closed** on missing, partial or altered files. Packaging success means the *source bytes* were archived, **not** a compiled build, signed supply-chain attestation, or permission to merge or ship. See [Artifact Forge operator guide](docs/ARTIFACT_FORGE.md).

## Isolated Builds R1-F2: fixed-recipe local HTML output

R1-F2 introduces the first narrowly allowlisted **actual build transformation**. Using a previously verified Artifact Forge source archive, a pinned local Docker image and an explicit operator approval flag, PhiRunners can combine the canonical `docs/index.html`, `docs/styles.css` and `docs/app.js` into a single HTML file inside an offline, resource-limited container.

```powershell
npm run builds -- list
# After creating a source artifact with R1-F1:
npm run builds -- static-web <source-artifact-id> --i-approve-isolated-build
npm start
# http://127.0.0.1:3690/#builds
```

The private `data/builds/` output and receipt are checksum-validated on each inventory read. Only metadata is exposed via read-only `GET /api/builds`; HTML is **never** served by the dashboard. R1-F2 does not install dependencies, run repository scripts on the host, provide a general-purpose bundler, certify independent execution, or automatically ship a build. The inlined output can still refer to other assets. Read [R1-F2 operating guide](docs/ISOLATED_BUILDS.md).

## NOT yet implemented

Remote pushes, SSH access, accounts/permissions, PRs/issues, encrypted transport, production CI isolation, independently re-executed builds or attested runners, automated mirroring, TMC integration, or production network deployment.

```text
Browser (http://127.0.0.1:3690)      Git client
          |                                |
      GET-only API                 read-only git://
          |                                |
       Node HTTP                    git daemon
          +---------------+----------------+
                          |
                 local bare Git repos
                   data/repos/*.git
                          ^
                local filesystem git push
```

**Security boundary:** This is a single-user **localhost prototype**, not a remotely deployable platform. `git://` is unencrypted and unauthenticated. Do not expose ports 3690 or 9418 through LAN forwarding, tunnels, or reverse proxies. See [SECURITY.md](SECURITY.md).

See [the development roadmap](docs/ROADMAP.md) for The Porch Crew independent CI plans.

**Ledger Above Ego. Build outward. Circle back.**

Created by PHI369 Labs / Parallax. MIT licensed.
