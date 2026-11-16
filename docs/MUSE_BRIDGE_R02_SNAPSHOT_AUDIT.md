# GitPorch × Muse R0.2: read-only mirror snapshot audit

**State (2026-11-16):** Local Git-only audit implemented and tested. **No Muse release was installed or executed by this change. No live Git ↔ Muse bridge result is claimed.**

## Upstream release context

- Muse Getting Started: https://musehub.ai/muse/getting-started (the documentation illustrates `muse 0.2.2rc7`; this is **not** evidence of which binary an operator has).
- Muse issue #141, https://staging.musehub.ai/gabriel/muse/issues/141: target-specific export ownership, unrelated untracked-file staging, and push-default safety were marked fixed in production in 0.2.2rc1.
- Muse issue #140, https://staging.musehub.ai/gabriel/muse/issues/140: merge-parent and full-tree import improvements were marked shipped in 0.2.2rc1, but other import fidelity concerns remain open. Do **not** treat the entire ticket as fixed.
- Before any real bridge test, inspect current upstream docs, check `muse --version` and the help for the installed CLI, and use only disposable local repositories.

## What this change verifies

`src/muse-bridge-snapshot-audit.mjs` is a **read-only** Node.js + Git command. It compares two *committed Git trees*: the original synthetic source `main` and a disposable exported mirror branch `muse-mirror`. It:
- reads tracked file paths, raw blob bytes (SHA-256), Git modes (`100644`, `100755`, `120000`) and HEADs;
- reports missing, extra, content-changed, and executable-mode-changed entries in explicit JSON lists;
- fails closed for unsupported Git tree entries, large audit input (more than 1,000 tracked paths or 16 MiB per blob), invalid branch refs and non-root or overlapping directories;
- never installs or executes Muse, checks out, commits, fetches, pushes or writes files. No API credentials are needed.

A `PASS_SNAPSHOT_ONLY` means only that the **two selected Git commit snapshots** match exactly across those checked fields. It does **not** establish Muse import fidelity, ancestry/topology preservation, historical snapshots, author attribution, cryptographic signatures, drift behavior, or CI correctness. The JSON explicitly lists those as `unverified`.

## Preparation and dry-run acceptance

On a machine with Node.js 20+ and Git, inside a fresh GitPorch checkout:

```powershell
# Use a new empty workspace. NEVER point this at your GitPorch data or live repos.
New-Item -ItemType Directory -Force 'D:\MuseBridgePilot'

npm test
node src/muse-bridge-pilot.mjs fixture 'D:\MuseBridgePilot\synthetic-git' --i-approve-disposable-fixture
node src/muse-bridge-pilot.mjs inspect 'D:\MuseBridgePilot\synthetic-git'
node src/muse-bridge-pilot.mjs plan 'D:\MuseBridgePilot\synthetic-git' 'D:\MuseBridgePilot\synthetic-muse' 'D:\MuseBridgePilot\synthetic-mirror'
```

**Do not run the Muse commands until a reviewed Muse CLI is separately installed, `muse --version` has been recorded, and the operator has approved the isolated test.** Use `docs/MUSE_BRIDGE_PILOT.md` for the staged import/checkout/status/export procedure. The mirror must be a fresh, disposable non-bare Git working tree with its export commit on `muse-mirror`, never an existing checkout or the original source. Explicitly confirm the CLI's local-only/no-push behavior with `muse bridge git-export --help` before export.

After a human has run the isolated Muse test and checked that it did not touch production data, inspect the two **committed trees**:

```powershell
node src/muse-bridge-snapshot-audit.mjs 'D:\MuseBridgePilot\synthetic-git' 'D:\MuseBridgePilot\synthetic-mirror'
```

The command exits **0** for `PASS_SNAPSHOT_ONLY`, **2** for `FAIL_SNAPSHOT`, and **1** for invalid input / inability to audit. A dirty working tree is not audited: this command compares committed refs, **not** working files. Review `git status` independently in the disposable mirror and keep Muse's raw JSON output plus exact CLI version as separate evidence.

## Gate to next milestone

To claim `MUSE_INTEGRATION_VERIFIED`, a later PR must supply operator-reviewed live CLI transcripts and independent evidence for all applicable issue #140/#141 conditions: Git ancestry and commit mapping, historical tree equivalence, full final snapshot, deletion and file-mode fidelity, export isolation (including untracked target files), no push, sync drift and fail-closed behavior. A snapshot-only pass is **not** sufficient.

**Do not merge a Muse adapter or enable unattended sync merely because this utility's local tests pass.**
