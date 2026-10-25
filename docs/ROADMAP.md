# GitPorch roadmap

| Milestone | Function | Status |
| --- | --- | --- |
| R0 | Local bare Git hosting, loopback-only clone daemon, read-only browser dashboard, native tests | Implemented in merged PR #1 |
| R0.3 | PhiBots Clubhouse: local commit-linked proposals and operator review notes; public fictional showcase | Merged PR #3 |
| R0.2 | Windows service packaging; checked backup/restore | Planned |
| R1-A | **The Porch Crew**: local Git fsck queue, commit-pinned receipts, interrupted-job uncertainty; no code tests | Merged PR #4 |
| R1-B | **Opt-in Node.js tests in restricted, network-disabled Docker containers**; unsigned local receipts | Merged PR #5 |
| R1-C | Strict pinned-image verification, operator Docker preflight, stricter TAP validation, output hashes (unsigned) | Merged PR #6 |
| R1-D1 | Local recovery doctor, operator-only ABORTED_UNVERIFIED disposition, lock-safe recovery; no automatic retry | Merged PR #7 |
| R1-D2 | **Offline Ed25519 operator-signed local result reports**, separate trusted-key verification; not witnessed CI | Merged PR #8 |
| R1-D3 | **Offline second-key countersignature** of operator reports; two-key verification, no independent run proof | Merged PR #9 |
| R1-D4A | **Offline public-key trust registry** and current-policy revocation; explicit enrollment, no trust-on-first-use | Merged PR #10 |
| R1-D4B1 | **Opt-in passphrase-encrypted Ed25519 operator vault**, signed reports compatible with existing verifier; no migration | Merged PR #11 |
| R1-D4B2A | **Non-destructive passphrase rewrap**, staged encrypted vault with same signing identity and explicit verification | PR #12 proposed |
| R1-E | **ΦRunners** unified local CLI + read-only queue pulse, real outcome totals, fail-closed corrupt/changed lane handling | Merged PR #13 |
| R1-F1 | **Artifact Forge:** operator-approved source bundles, SHA-256 checked inventory and test-job provenance | Merged PR #14 |\n| R1-F2 | **Fixed static-web build** in restricted Docker from an approved source archive; SHA-256 output/receipt metadata, no remote publishing or broad script execution | Proposed PR |\n| R1-F3 | Durable failure receipts, independent reruns, reproducibility checks and stronger custody | Planned |
| R1-G | Local capability registry and separate-machine transport threat model; no remote execution until security review | Planned |
| R1-D4B2B | **Distinct signing-key identity** transition, OS/hardware key custody, signed anti-rollback policy and independent reruns | Planned |
| R2 | Authenticated SSH push, users, repo permissions and receipts | Planned |
| R3 | Pull requests, branch protection, code review, issues, artifacts, actual-status badges | Planned |
| R4 | Optional GitHub/GitLab mirroring and governed AI-agent adapters | Planned |
| R1-H1 | **HomeNode**: local inventory and per-repo non-overwriting Git bundle snapshots with SHA-256 and verified mirror restore; no LAN/sync | Merged PR #16 |
| R1-H2 | **Public GitHub bridge**: paginated public catalog, offline import plan and one-at-a-time verified mirror import; no sync/private data | Merged PR #17 |
| R1-H3 | **Capacity & namespace**: up to 2,048 local repos, Windows-safe 100-character names, bounded Git worker scans, fail-closed overflow/no truncated listing | Proposed PR |
| R1-H4 | Optional authenticated LAN read-only status boundary, trust model, and PhiOS/EnterTheField endpoint selection design | Planned |
| Pages | Public static demonstration with fictional history only | Merged PR #2 |

**Non-negotiable invariants**

1. Git is authoritative for repository history. We don't reinvent Git.
2. Original data stays in private local storage. No real memories in source control.
3. Unknown job outcomes are never displayed as green.
4. Publishing, merging and other privileged actions require explicit human authority.
5. R1 CI will not depend on GitHub Actions; R0 does not execute repository-supplied code.
6. Porch / Commons / Interconnects / TMC integration occurs only after interface tests.
7. Remote network access is disabled until the authentication and isolation threat model is ready.

### Why no React dependencies in R0?

The first milestone proves the underlying Git hosting and dashboard can run with only Node and Git **without contacting a package registry or external service**. The client is standards-based HTML/CSS/JS; React can be layered on later without changing the Git storage backend.

