# Artifact Forge R1-F1: source bundles with provenance

**This milestone is source packaging, not a general-purpose build engine.** It creates a bounded `git archive --format=tar <pinned-commit>` from the exact repository HEAD covered by a locally reported successful Porch Crew Docker test. It never executes source code during packaging.

## Local operator workflow

1. Create a GitPorch repository and push a commit (see README).
2. Use `npm run phirunners -- enqueue-tests <repo> <pinned-node22-image-id>`, then `npm run phirunners -- work-tests-once --i-approve-container-tests` in your trusted local Docker environment.
3. Find a **completed PASS** job ID with `npm run phirunners -- status`. The job must have valid local Docker execution-evidence fields and match the current repository HEAD exactly.
4. Explicitly create the source archive:

```powershell
npm run artifacts -- bundle hello-world <completed-test-job-id> --i-approve-source-archive
npm run artifacts -- list
npm start
# Local dashboard at http://127.0.0.1:3690/#artifacts
```

The archive and JSON receipt live under ignored private `data/artifacts/`, with an opaque ID filename. No archive is served over HTTP; `GET /api/artifacts` only returns verified non-sensitive metadata (repository name, commit, test job ID, image ID, size, SHA-256, status). The public GitHub Pages showcase never receives local artifact data.

## Evidence and limitations

- `GIT_COMMIT_SOURCE_TAR_V1` is the **only** fixed recipe. No user-defined shell commands, package installs, Docker image pulls, remote publishing, or deployments.
- The archive is at most **8 MiB**, command timeout **30 seconds**, storage capped at **30 bundles**, and local receipt/files must all match on each inventory read. Corrupt or partial records fail closed rather than displaying success.
- SHA-256 detects altered archive bytes; receipt checksums detect accidents, **not malicious rewriting**. The source archive is not a compiled executable, an attested/reproducible build, a signed release, or a malware scan.
- The linked Docker PASS is an existing **locally reported** result, not proof that Docker actually executed independently. Tests run only when separately approved. Neither PASS nor archive creation authorizes a GitHub PR merge.
- Moving HEAD causes new packaging attempts to require a passing Docker test for the new commit. A previously packaged commit remains a historical archive tied to its original SHA.
- Archives can contain untrusted data (including symlinks) from Git trees. Do not unpack them into privileged directories or execute their contents.
- The registry's read-only inventory hashes every local archive; the bounded storage size keeps this manageable. Manual tampering or partial crash writes can block inventory and require offline inspection. Do not silently delete locks, modify results, or convert unknown states to PASS.

## Security boundary

This is a single-operator localhost prototype. The HTTP API is GET-only; artifact creation requires an explicit local CLI flag. Do not expose `data/`, Docker sockets, filesystem push access, or the local web server to public networks.

Later R1-F milestones can add **explicit allowlisted compilation recipes in isolated containers**, deterministic rebuild comparisons, retained logs, and signed artifact attestations after threat-model review. R1-G addresses worker capability registry and potential multi-machine protocols; no remote runner is implemented here.
