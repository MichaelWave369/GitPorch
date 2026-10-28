# PhiOS R0.16: recovered source versus runnable offline component

## Reason for this rung

Recovering Git history and assets (R0.1–R0.14), then verifying a copied kit and a restored bare repository (R0.15), is important. None of those operations turns source code into a browser-ready or bootable PhiOS environment.

The real PhiOS repository as inspected in October 2026 has at least three independent runtime surfaces:

- **Web frontend**: \`site/package.json\` declares React, TypeScript and Vite; its \`site/index.html\` points to \`/src/main.tsx\`. It requires a trustworthy built frontend plus bundled assets or a reproducible *offline* Node toolchain and package dependencies. A raw copy of \`index.html\` is **not** a runnable offline website.
- **Python package and operator tools**: \`pyproject.toml\` and \`requirements.txt\` are project metadata. They are not a previously installed offline Python environment, a wheelhouse, or a tested virtual environment.
- **Experimental Linux OS release path**: \`build/build_iso.sh\` and packaging sources are not a qualified bootable ISO. VM release evidence is not a physical hardware test; external packages, image bytes and signature verification require separate evidence.

R0.16 reports which **source prerequisites are tracked in one pinned recovered Git commit**, then records what remains unproven.

## Operator preparation

Perform existing R0.14 and R0.15 operations first:

1. Prepare a portable kit with snapshot files, selected LFS files and Release objects as described by \`docs/PHIOS_R14_PORTABLE_KIT_FIELD_DRILL.md\`.
2. Verify the independently copied kit against its saved unsigned manifest.
3. Use \`npm run homenode -- drill ... --i-confirm-local-restore\` to create a new bare repository in a disposable local restore destination. Save the exact returned \`restoredBareRepository\` path.
4. Run \`npm run homenode -- field-evidence ... none\` to confirm the copied kit and restored Git commit references still match before runtime analysis.

Then:

    $env:GITPORCH_DATA_DIR = 'D:\GitPorchData'
    npm run homenode -- runtime-preflight 'D:\PhiOSEvidence\portable-kit-reference.json' 'F:\CopiedPhiOSKit' 'D:\PhiOSDisposableRestore\<actual-restored-repo>.git' main

All paths are placeholders. The command requires an existing trusted Git executable, Node.js 20+ and a *pinned locally restored* bare Git repository. It recomputes R0.15 technical checks on each invocation. The source kit manifest must be saved **outside** the copied kit.

## What it does, and does not do

- Repeats copied-kit byte and bundle SHA-256 verification, real Git fsck and exact restored Git ref parity checks from R0.15.
- Pins one named Git branch to its exact commit and inspects at most 30,000 tracked tree entries with restricted local Git commands. The tip is rechecked before producing a report.
- Reads a bounded tracked \`site/package.json\` (or root package.json) and detects Vite/build scripts, declared TypeScript/JavaScript package count and tracked lockfiles.
- Examines bounded HTML for common \`/src/*.ts\` and \`/src/*.tsx\` module-entry references that require a build; distinguishes tracked prebuilt \`site/dist/index.html\` from source-only \`site/index.html\`. A tracked \`dist/index.html\` is **only a candidate**, not a proof that related assets are bundled or that the browser actually loads it.
- Notes tracked Python manifests and a few OS build/release source paths. Presence is *source metadata*, not executable/runtime availability.
- Emits an unsigned deterministic JSON \`reportSha256\` with explicit flags for offline npm build, offline Python runtime, browser execution, Linux boot, WAN isolation and independent physical media, **all false**.

There is **no GitHub access, package manager invocation, \`npm install\`, \`pip install\`, script execution, source checkout, archive extraction, browser launch, web server, system-network change, boot attempt, or persistent file writing**. The R0.14 verification dependency uses an isolated, automatically deleted temporary Git clone for bundle integrity.

This is not a comprehensive dependency solver. Directly declared packages in package.json are not transitive dependencies, and a tracked lockfile does not prove offline availability or trust. Git submodules, symlinks, runtime API requests, hidden bundled assets, native extensions, wheelhouse, ISO media and untracked locally built artifacts remain outside R0.16's narrow inspection.

## Statuses to interpret

- \`VITE_OR_TYPED_SOURCE_REQUIRES_OFFLINE_BUILD\`: tracked HTML or package metadata indicates a Vite / typed source entry and no tracked \`dist/index.html\` candidate was found.
- \`BUILT_HTML_TRACKED_RUNTIME_NOT_VERIFIED\`: a prebuilt HTML candidate is tracked, but no browser, web-server or asset-closure test has been performed.
- \`WEB_SOURCE_ENTRY_PRESENT_EXECUTION_NOT_VERIFIED\`: a source HTML entry was found with no detected typed/Vite build requirement. Static runtime correctness is still unknown.
- \`NO_WEB_ENTRY_DETECTED_UNVERIFIED\`: no recognized tracked web entry was found. Other project entrypoints may still exist.
- \`LAUNCH_PREREQUISITES_IDENTIFIED_NOT_EXECUTED\`: overall report status. Never means a runnable offline OS or web application.

## Next actual field acceptance

For the PhiOS **frontend**, first preserve **the correct built deployment files**, local package dependencies or an independently verified offline build environment, and all required assets. Those bytes should be added to a specifically reviewed content-addressed recovery kit. Then, with WAN disconnected, serve the selected static build from an operator-approved local-only server with a documented port and inspect it in a browser on the target PC. Record the rendered entry page, local static asset requests, failed outbound requests and whether navigation works.

For the **Linux OS**, obtain a reviewed signed ISO image and approved packages from its separate release track, confirm byte and signature provenance and test a disposable VM or physical target under an independent safety plan. Do not infer OS boot readiness from this source-only report. Do not run unreviewed release attachments or write to production disks.

The final proof of an offline PhiOS component still depends on a real human-observed disconnected test and independent media, never CI alone.

## Tests

    npm test
    node --test test/homenode-runtime-preflight.test.mjs

Tests create real temporary Git repositories and HomeNode snapshots, copy and verify a portable kit, restore a bare repository, and classify a Vite + TSX frontend, tracked build candidate, static HTML and absent web entry. They also verify the branch and tamper refusal plus CLI syntax. This is **not** a live Windows browser, an installed npm build or a Linux OS boot.

**Ledger Above Ego. DONE Means Verified.**
