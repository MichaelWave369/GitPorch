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

## R1-B experimental Docker test runner

R1-B runs repository test files in a Docker container. Docker Engine is an **additional attack surface**, and container boundaries are not guaranteed to withstand malicious code or vulnerabilities in the kernel or daemon. This is **not a production-grade untrusted-code execution service**. The local operator must explicitly invoke each worker and provide a pinned, already-loaded image; the worker uses network isolation, dropped capabilities, non-root UID, read-only root FS, no Docker socket mount, resource restrictions, and a fixed Node test command. Only run repositories you trust; never expose the worker to remote submissions. A `PASS` means a locally run container reported a valid TAP summary and zero exit status on the pinned Git commit. It is **not a cryptographic attestation**, audit, malware verdict, provenance proof, or generalized build certification. Job receipts use checksum validation, not signatures, and the source archive is staged temporarily on the Docker host.

## R1-C local evidence verification

R1-C checks Docker's inspected immutable image identity against the queued identity before invoking `docker run`. A mismatch is an **ERROR**, never PASS. The local runner stores hashes of its observed stdout/stderr, exit code and image ID, but **the worker computes these hashes itself**. A compromised local account or Docker daemon can forge the records and their checksum. Neither signed attestations, external transparency logs, remote witnesses, secure hardware keys nor multi-tenant malicious-code isolation are available. Do not interpret a locally parsed TAP summary as independent verification of untrusted code. The public website must never show real private worker logs, result files, or local repository identities.

## R1-D1 manual job recovery

The recovery doctor only reads existing queue receipts and lock metadata. The manual abort command acquires the same exclusive `worker.lock` path as each queue's worker before writing a single `ABORTED_UNVERIFIED` disposition. It refuses existing locks and will not kill jobs, clear a lock, restart uncertain work, overwrite a previously recorded PASS or pretend a human checkbox proves a worker was stopped. The operator's affirmative CLI flag is **not a technical proof of process termination**. Recover only after inspecting active processes and Docker containers and backing up the runtime data. Receipts remain checksum-protected local records, not signed, tamper-resistant, or independently witnessed.

Manual recovery receipts are **not signed** and are not trustworthy against an attacker controlling the local filesystem or operator account.

## R1-D2 experimental offline signed reports

The separate operator signing tool uses Ed25519, but the first pilot creates an **unencrypted PEM private key under ignored `data/signer/`**. File modes are best effort and Windows filesystem ACLs may differ. Treat local compromise or exfiltration of that key as full compromise of the operator's signature authority. The operator must confirm each signing action; there is no network signing endpoint, no key rotation/revocation protocol, and no hardware-backed or independent witness. `signatureValid` proves the provided report was signed by the holder of the separately trusted key and its signed contents are intact. **It is not proof of authentic CI execution, non-compromised Docker, honest bot identity, approved merge, independent attestation or code security.** The report contains potentially private repo and test details. GitHub Pages does not load or publish signatures, private keys or local job results.

## R1-D3 separate-key witness

Witness signing verifies an existing Ed25519 operator report using a separately trusted operator public key and countersigns the complete canonical original report hash. The verifier requires *both* trusted public keys and rejects same-key operator/witness signatures. This **does not establish actual independent people, machines, honest tests, trustable timestamps, noncompromised containers or operational separation**. Both keys can still be controlled by one malicious operator. The witness key generated by this experimental tool is **unencrypted**, and the caller chooses its storage directory. Generate it outside the repo, protect OS filesystem permissions, confirm key fingerprints independently, and do not share either private key. No server-side signing or background key management exists.
