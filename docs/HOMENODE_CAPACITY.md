# GitPorch HomeNode R1-H3: repository capacity and namespace

**Scope:** extend *local-only* GitPorch inventory from 200 to a maximum of **2,048 supported bare Git repositories**, without hiding overflow. Expand GitPorch's Windows-safe repository name limit from 48 to **100 characters**. The work does **not** expose or deploy a HomeNode server.

## What changed

- A shared repository policy module now defines the 2,048-repo capacity, 100-character name length and eight concurrent Git workers when listing repositories.
- The local list, integrity verifier, HTTP read-only dashboard, snapshot selector, and public import bridge share the same validated namespace policy.
- Inventory **throws** on overflow or unsupported visible bare-repository directory names instead of returning a misleading truncated result. Git repo symlink entries remain excluded from trusted repo listings.
- Manual local repository creation and the public mirror importer refuse creation when the store is already at capacity. The public import planner returns `AT_CAPACITY` for new names when full, not `READY_TO_IMPORT`.
- All existing repositories remain in their original paths and are untouched. No deletion, renaming, network service changes, credentials, or automatic downloads are introduced.
- Names like `CON`, `AUX`, `COM1` and `LPT9.txt` are rejected because Windows disallows these device basenames even with extensions. Other unsupported names remain explicitly unsupported, rather than silently rewritten.

## Acceptance

From a GitPorch checkout:

~~~powershell
npm test
npm run homenode -- inventory
npm run bridge -- plan 'D:\PhiOSCatalog\<existing-catalog>.json'
~~~

A catalog created under R1-H2 remains compatible. `plan` reevaluates eligibility using the new 100-character Windows-safe policy. No re-download is needed to re-plan.

Regression tests cover:
- A 100-character GitPorch name accepted and a 101-character name refused.
- Windows device-name rejection and existing safe-name compatibility.
- More than 200 real Git repositories listed without truncation.
- Over 2,048 repository directories rejected before returning a partial inventory or creating another repository.
- An unsupported `.git` directory triggers an explicit operator error.

## Operational caveats

- **Capacity is an upper bound, not a speed or disk-space guarantee.** A computer may run out of RAM, disk or time well before 2,048 repositories. The bounded inventory scan limits Git process concurrency, but can still take time on slow storage.
- Name and capacity checks are not a transactional multi-process quota system. Concurrent operator-initiated creates and imports on the same store require coordination; do not run them simultaneously.
- Running a server on another machine requires separately designed authenticated transport and service isolation. The existing localhost-only Git and dashboard listeners MUST NOT be port-forwarded or made publicly accessible.
- Local backup and public mirroring remain separate, operator-initiated actions. Private GitHub repositories, LFS objects, PRs, issues, release assets, and secrets still require independent backups.
- Manual operators should inspect unsupported bare-repo directories instead of renaming them blindly, especially when they may contain the only surviving source history.
- GitHub public catalog discovery retains its 3,000-repository safety cap, which is **not** the same as the 2,048 local-storage capacity.

**Status language:** code review and `npm test` on a real checkout are required before declaring this milestone green. No HomeNode hardware installation or LAN deployment has occurred.
