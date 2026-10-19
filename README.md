# The GitPorch

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

## NOT yet implemented

Remote pushes, SSH access, accounts/permissions, PRs/issues, encrypted transport, independent CI, job isolation, artifact attestation, automated mirroring, TMC integration, or production network deployment.

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
