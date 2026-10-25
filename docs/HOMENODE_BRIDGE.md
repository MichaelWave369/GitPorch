# GitPorch HomeNode R1-H2: public GitHub catalog and local mirror imports

**Status:** opt-in public-only discovery and one-at-a-time full-history Git mirror import. This is an operator tool, not an always-on GitHub sync service, credential manager, LAN server, or automated migration of the whole account.

Requires local Node.js 20+ and Git. The HTTP catalog call and each mirror clone **require an internet connection** and explicit CLI approval. The plan command works offline after discovery. No GitHub token is accepted or stored.

## 1. Discover public repositories (internet required)

Run these from a cloned GitPorch checkout on the machine you want to use. Replace paths with existing absolute directories. For example, in PowerShell:

~~~powershell
New-Item -ItemType Directory -Force 'D:\PhiOSCatalog'
npm test
npm run bridge -- discover MichaelWave369 'D:\PhiOSCatalog' --i-approve-public-discovery
~~~

This contacts GitHub's public REST user-repositories endpoint and follows pagination in 100-repository pages, stopping when complete. It writes a **new** JSON catalog under the chosen directory. No existing file is overwritten. Discovery stops with an error rather than presenting a partial catalog if GitHub fails or the 3,000-public-repository safety limit is reached.

The JSON includes names, archival/fork indicators, rough GitHub-reported repo sizes and eligibility against GitPorch's current 100-character, Windows-safe repo-name rule. **Private repos are invisible to this endpoint.** GitHub may rate-limit unauthenticated public discovery.

## 2. Plan locally (no internet required)

Use the real catalog path returned above. The name below is illustrative:

~~~powershell
npm run bridge -- plan 'D:\PhiOSCatalog\gitporch-public-MichaelWave369-<generated-id>.json'
~~~

Every public catalog entry reports one of: `READY_TO_IMPORT`, `ALREADY_LOCAL`, or `UNSUPPORTED_NAME`. The plan is not proof that all your GitHub repos have been discovered or that all storage requirements are affordable. GitPorch now allows up to 2,048 supported local repositories; inventory refuses overflow rather than truncating. Check the destination machine's free disk space before importing large repositories.

## 3. Import one approved repository (internet required)

~~~powershell
npm run bridge -- import 'D:\PhiOSCatalog\gitporch-public-MichaelWave369-<generated-id>.json' PhiOS --i-approve-github-import
npm run homenode -- inventory
~~~

`PhiOS` must be an eligible name in the catalog, and the corresponding repository must still exist publicly on GitHub. The bridge constructs the GitHub HTTPS URL from the validated owner/name; it does not trust URLs supplied by catalog files and disables Git credential helpers for the clone.

The importer reserves a private staging directory, runs `git clone --mirror` into it, checks that refs exist, runs `git fsck`, removes the remote's configured origin, and only then promotes the verified bare Git repo into GitPorch's local `data/repos/` directory. It refuses existing repository names, including case-insensitive matches, and refuses new imports when 2,048 repo entries are present. On normal failures, staging and lock files are cleaned; on a machine crash, manually inspect orphan `.incoming-*` and `.import-lock-*` entries before recovery. Do not casually delete locks belonging to active imports.

**Imported means a local, independently usable Git repository**, not a GitHub issue/PR migration, an automatic build, or automatic replication. GitHub cannot modify the local copy on its own. There is deliberately no automatic push-back.

## 4. Verify that a GitPorch repo has a restorable snapshot

Use R1-H1 commands:

~~~powershell
New-Item -ItemType Directory -Force 'E:\PhiOSBackups'
npm run homenode -- backup PhiOS 'E:\PhiOSBackups'
# Copy the exact newly returned directory path:
npm run homenode -- verify 'E:\PhiOSBackups\gitporch-PhiOS-<generated-id>'
~~~

Until a separate migration tool is added, Git bundles **do not** contain Git LFS object contents, PRs, issues, wiki repositories, release assets, Actions output, submodule target repositories, private repos, or service credentials/config. Back up those separately. Even Git history on the server needs independent physical backup.

## EnterTheField.org server switching

No public site or production configuration is changed in this milestone. A future PhiOS/EnterTheField **Public / LAN HomeNode** selector must distinguish browser-local 127.0.0.1 from an authenticated LAN HomeNode on another computer. A public HTTPS site cannot simply point to an unauthenticated `git://` service or reach a private LAN automatically. Complete authenticated SSH/HTTPS, trusted discovery, browser mixed-content/private-network testing, and safe offline fallback before enabling it.

Keep the current GitPorch dashboard and Git daemon on 127.0.0.1. **Do not open or forward ports 3690 or 9418.**

**R1-H2 acceptance:** complete paginated public catalog, eligibility and offline plan, one approved verified Git mirror import, refusal to replace an existing repo, fail-closed cleanup and a successful R1-H1 backup. Tests prove behavior with local Git fixtures, **not** full production Windows/offline/LAN performance.
