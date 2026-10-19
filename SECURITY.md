# Security and trust boundaries

**R0 is a single-user localhost prototype, not a remotely deployable forge.**

- The dashboard and GET-only API bind exclusively to `127.0.0.1`. They have no account system or remote-use authentication and are **not** designed for LAN/WAN exposure.
- The `git daemon` offers unauthenticated, **unencrypted, read-only** clone/fetch and disables `receive-pack` and `upload-archive`. It binds to loopback.
- Creating repositories and pushing Git commits requires filesystem access by the local operator; access control relies on OS permissions.
- Repository names are validated. No user-provided shell command is evaluated. Git is invoked through `execFile` with explicit arguments.
- Git metadata from commits is inserted into the UI as text, not HTML. The browser uses a restrictive CSP.
- `data/` is excluded from source control. Keep its actual contents private, with independent backups.
- Git commit identity and object hashes are not authentication, trust, or provenance proof.
- There is **no CI code execution in R0**. Don't run untrusted repository code on the host without sandboxing.
- Do not open local ports through a proxy, remote tunnel, or router; the design is not threat-modelled for that.
- A Git history integrity check is not a vulnerability scan. Rotate any accidentally exposed credentials.

Before remote use, design authenticated SSH or HTTPS transport, repository ACLs, isolation for CI workers, resource limits, signed audit receipts, and full penetration testing. Please send vulnerability reports privately to the maintainers rather than disclosing personal secrets in issues.

## Clubhouse R0.3 trust boundary

The local Clubhouse CLI can label contributors and record proposal or review events. These are **operator-entered text records**, not proof that a bot or person authored anything. Commit references are checked as locally present Git commit objects when submitted, but no CI, signature, identity, code review, PR merge, or delegated authorization is performed. Records use SHA-256 checksums to detect accidental modification, **not digital signatures or a tamper-proof audit log**. An actor with filesystem write access could rewrite or delete them; preserve independent backups. Only a local CLI can mutate; the HTTP endpoint is GET-only and loopback-bound. Treat proposal summaries as untrusted text.

## Porch Crew R1-A limitations

R1-A only executes fixed Git `rev-parse` and `fsck` commands using argument arrays, never repository-provided scripts or arbitrary job commands. The worker runs under the **same OS account as the operator** and is **not sandboxed**. It is limited to trusted local Git repositories and loopback-only UI; never submit or expose it to untrusted contributors. Job receipts use bare SHA-256 checksums, not identity signatures or tamper-resistant storage. Jobs which crashed or became incomplete remain `RUNNING_UNCERTAIN` and require deliberate local inspection. A `PASS` result verifies Git object integrity for a stable recorded HEAD only; it does not prove tests, application safety, or code authenticity.
