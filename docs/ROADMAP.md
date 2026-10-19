# GitPorch roadmap

| Milestone | Function | Status |
| --- | --- | --- |
| R0 | Local bare Git hosting, loopback-only clone daemon, read-only browser dashboard, native tests | Implemented in merged PR #1 |
| R0.2 | Windows service packaging; checked backup/restore | Planned |
| R1 | **The Porch Crew**: independent build queue, isolated workers, logs, verifiable evidence | Planned |
| R2 | Authenticated SSH push, users, repo permissions and receipts | Planned |
| R3 | Pull requests, branch protection, code review, issues, artifacts, actual-status badges | Planned |
| R4 | Optional GitHub/GitLab mirroring and governed AI-agent adapters | Planned |

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

| Public showcase | Static GitHub Pages demo with isolated synthetic Git history and no backend calls | PR #2 proposed |
