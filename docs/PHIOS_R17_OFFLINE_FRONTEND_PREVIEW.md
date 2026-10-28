# PhiOS R0.17: portable built frontend verification and approved localhost preview

## Purpose

A Vite/React/TypeScript **source checkout is not a deployable offline frontend**. R0.17 provides a bounded way to check an operator-provided, already-built static \`site/dist\` folder, preserve an unsigned SHA-256 file manifest outside the build, verify a manually copied build, and only on explicit approval expose that copy through a localhost-only HTTP preview.

The PhiOS site was inspected before implementation: it uses \`site/package.json\` with a Vite/TS/React build; \`site/vite.config.ts\` specifies \`base: "/PhiOS/"\`. R0.17 therefore serves only URLs beneath \`http://127.0.0.1:<port>/PhiOS/\`.

**No package installs, untrusted build scripts, arbitrary source checkouts, automatic downloads, automatic browser opening, OS boot or physical WAN-disconnected verification occur.**

## Prerequisites and preparation

Use Node.js 20+ and a reviewed GitPorch checkout on the operator machine. The built PhiOS site can come from a separately reviewed pinned source build or an authenticated deployment artifact; R0.17 does **not** verify its provenance.

To create PhiOS frontend artifacts separately from GitPorch, the normal site build is performed in an operator-controlled environment with a preinstalled, pinned Node toolchain and appropriate dependencies. If those dependencies were retrieved online, **do not call that earlier build offline**. A genuine offline-build qualification requires running and auditing a clean disconnected build with its own package and dependency checks.

Place the completed Vite **dist contents** at an operator-controlled existing location such as \`E:\PhiOSBuilt\dist\`. The folder must contain \`index.html\` at its root and all referenced direct HTML/CSS asset files (typically \`assets/index-*.js\` and \`assets/index-*.css\`). It should **not** be the raw \`site/index.html\` source tree.

The pilot checks up to 512 files, 128 directories, 32 MiB per file and 256 MiB total. Unsupported file extensions, hidden paths, symlinks/redirects, malformed paths, remote HTML/CSS static URLs and missing direct local HTML/CSS references are rejected. Vite source maps (\`.map\`) can be hashed in the manifest, but the local server refuses to serve them to reduce accidental source disclosure.

## 1. Scan a built static frontend and save its reference outside the directory

In Windows PowerShell:

    npm run homenode -- frontend-scan 'E:\PhiOSBuilt\dist' > 'D:\PhiOSEvidence\frontend-dist-reference.json'

Inspect the report. The status \`STATIC_FILES_VERIFIED_BROWSER_NOT_TESTED\` means only that files were enumerated and their bytes hashed, and that recognized **direct** HTML/CSS static resource references resolve inside the folder. The report has an unsigned \`manifestSha256\` to detect accidental changes. It does not authenticate source/publisher origin.

**Limits:** compiled JavaScript can make runtime fetch calls, dynamic imports and route-dependent asset requests, which are not fully proven by this static scan. No claim of full JavaScript transitive dependency closure or absence of runtime network requests is made.

## 2. Manually copy the built directory, then verify that copy

Copy \`E:\PhiOSBuilt\dist\` to a destination such as \`F:\CopiedPhiOSDist\`. The entire *contents* of \`dist\` must be copied, keeping \`index.html\` at the copied folder root. Keep the JSON reference outside both directories. The tool does not copy files, decide drive identity, touch live GitPorch data or overwrite backups.

    npm run homenode -- frontend-verify 'D:\PhiOSEvidence\frontend-dist-reference.json' 'F:\CopiedPhiOSDist'

Status \`FRONTEND_BYTES_AND_DIRECT_STATIC_REFERENCES_REVERIFIED_ONLY\` means the copied file listing, lengths and SHA-256 hashes match the reference, and direct HTML/CSS asset references are still present. External media independence and browser rendering remain unknown.

## 3. Explicitly start the **localhost-only** HTTP preview

Only if you choose to inspect a reviewed built frontend in your browser:

    npm run homenode -- frontend-serve 'D:\PhiOSEvidence\frontend-dist-reference.json' 'F:\CopiedPhiOSDist' 8765 --i-approve-loopback-preview

The process stays open until the operator stops it with Ctrl+C. It listens only on **127.0.0.1**, never \`0.0.0.0\` or the LAN IP, and only recognizes \`/PhiOS/\` prefix paths. Manual URL:

    http://127.0.0.1:8765/PhiOS/

Supported methods: GET and HEAD. The server rejects unexpected Host headers, traversal/encoded paths, other methods, unlisted files and source maps. It rechecks the SHA-256 and length of **each requested file** before serving it. Responses use no-store, nosniff, same-origin resource policy, no-referrer and a restrictive Content Security Policy that limits script/style/resource/fetch origins to self (with narrow data/blob allowances). No external CDN fallback is configured.

This preview **executes JavaScript in your chosen browser when you deliberately open the page**. R0.17 does not authenticate the original frontend author, and browsers and extensions may have their own capabilities. Use only built artifacts you personally trust, and do not expose sensitive local services to unknown webpages. CSP is defense in depth, not proof of code safety or absence of all network effects.

**Do not open port 8765 in your router or firewall.** Loopback is intended for the local machine only.

## 4. Actual browser/physical acceptance remains a separate operator task

With WAN intentionally disconnected (including Starlink and Wi-Fi), open the local URL manually, inspect the browser console/network logs, navigate the page and verify all necessary routes, fonts, images and dependencies load from localhost. Record screenshots and observed failures, the exact build/source revision, and machine/storage identifiers privately. The CLI startup message, successful HTTP fetch, and green GitHub CI **do not prove that the browser rendered the app or that WAN was disconnected**.

The site may legitimately depend on remote services in optional features. This protocol is a **static frontage proof**, not full PhiOS OS or all-app offline qualification.

## Developer checks

    npm test
    node --test test/homenode-frontend-offline.test.mjs

CI exercises real temporary-built file trees, checks SHA-256 and static asset references, copies and corrupts files, refuses missing/external files and symlinks, starts a **127.0.0.1 loopback server with an ephemeral test port**, checks GET/HEAD, scope/host/path/method rejections and Content Security Policy, and detects file changes after the server starts. CI never opens a browser or qualifies physical WAN isolation.

**Ledger Above Ego. DONE Means Verified.**
