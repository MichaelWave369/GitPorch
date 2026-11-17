# GitPorch × Muse R0.8: read-only local bridge status

**State:** local implementation in review. A passing R0.7 synthetic Git ↔ Muse trial exists as
[Actions run #43997723043](https://github.com/MichaelWave369/GitPorch/actions/runs/43997723043),
using real Muse 0.2.2rc9 with explicit merge preservation. Six Git commits, both
parents of the fixture's merge, every historical tracked path and raw blob
bytes were checked. This is NOT evidence of arbitrary repository compatibility
or a production MuseHub synchronization service.

## Purpose and boundaries

R0.8 turns *manually downloaded* evidence from a prior explicitly approved Muse
trial into a simple localhost dashboard panel. There is no Muse binary invocation
in this feature, no MuseHub connection, no automatic GitHub download, no
credentials, no Git push/pull, and no background tasks.

- The CLI independently replays **the imported Muse commit and snapshot
  records against the original Git history baseline**, using the existing R0.7
  verifier. It also checks final Git snapshot and saved drift audit PASS reports,
  agreeing Git and Muse HEAD, six source file digests, and the import/export
  status receipt.
- On a complete match, the operator can publish a **sanitized, unsigned local
  receipt**. The receipt contains summary counters, Git SHA ↔ Muse commit
  mappings, last recorded import time, drift, executable-warning count,
  scope limits, and fingerprints of the six input evidence files.
- The local GET-only API at **/api/muse-bridge** displays up to 12 recent
  receipts. Public Pages never receives these receipts. Browser writes are
  refused. If a receipt file is malformed, modified, or the shelf is unsafe,
  ALL results are withheld rather than showing stale green indicators.
- SHA-256 fingerprints detect incidental changes relative to the saved
  unsigned evidence. The receipts are **NOT cryptographically signed,
  authenticated, independently witnessed, or tamper-proof**. A privileged
  attacker who controls files can replace a receipt and its hash.
- **EVIDENCE REPLAYED · UNSIGNED** does not mean a new live Muse run.
  No mode preservation inside Muse, author signatures, live remote drift or
  Git ancestry restoration by Muse export is claimed.

## Setup (Windows PowerShell)

1. Download the **muse-gitporch-r06-synthetic-evidence** ZIP artifact from
   [successful R0.7 live run #43997723043](https://github.com/MichaelWave369/GitPorch/actions/runs/43997723043).
   GitHub normally retains this run's artifact for 7 days, so keep your own
   copy for local evidence if needed.
2. Extract the artifact to a directory under your control:

~~~powershell
$zip = Join-Path $HOME 'Downloads\muse-gitporch-r06-synthetic-evidence.zip'
$extract = Join-Path $env:TEMP 'gitporch-muse-r07-evidence'
Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
$evidence = Join-Path $extract 'gitporch-muse-r06'
~~~

3. From your GitPorch checkout (Node 20+), inspect **without writing**:

~~~powershell
npm run muse:bridge-status -- inspect $evidence 43997723043
~~~

4. Only after you personally review the evidence, approve saving a **summary
   receipt** locally (no source contents copied):

~~~powershell
npm run muse:bridge-status -- publish $evidence 43997723043 --i-approve-local-receipt
npm run muse:bridge-status -- status
npm start
~~~

Open **http://127.0.0.1:3690/#muse-bridge**. If GitPorch is already
running, refresh the page. Nothing in this action starts a Muse process.
To use an alternate local receipt store, set GITPORCH_DATA_DIR first, for
example "$env:GITPORCH_DATA_DIR='D:\GitPorchData'".

## Required evidence files

The extracted folder must contain:
- git-history-baseline.json (independent Git graph and raw-file SHA-256)
- muse-import.log (actual, newline-delimited Muse commit import receipts)
- muse-internal-history-audit.json (Muse readbacks and cat-object byte digests)
- snapshot-audit.json (Git final-export comparison)
- status-audit.json (no-drift comparison)
- muse-status.json (observed import/export tip references and timestamp)

Missing, inconsistent, oversized, or symlinked inputs fail closed. The original
logs stay in the extracted archive directory; the local receipt shelf contains
only a summary and the six SHA-256 evidence-file digests.

## Next milestone: bounded real-repository pilot

Before any production sync, perform an **operator-reviewed disposable clone**
of one small PUBLIC Git repo, e.g. PhiTyper, then repeat the same historical
verification on the clone and a *separate* Muse store, with no remote pushes.
New tests should cover incremental imports, deletion history, side branches,
special filenames and executable modes. After that, design optional
authenticated MuseHub coordination; do not put tokens in browser storage
or expose GitPorch's current unauthenticated localhost API to the LAN.

The working bridge stays independent: GitPorch preserves original Git
history in recoverable Git bundles, Muse owns its native history, and MuseHub
can host collaboration only through a later separately reviewed connection.
