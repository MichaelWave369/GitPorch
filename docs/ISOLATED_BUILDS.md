# R1-F2: isolated fixed-recipe static web builds

R1-F2 performs **one actual static-site transformation** inside a pinned local Node 22 Alpine Docker image. It combines exactly `docs/index.html`, `docs/styles.css`, and `docs/app.js` from an R1-F1 source artifact into a single HTML output with inline CSS/JS. The input HTML must contain the canonical two relative tags exactly once. It **does not bundle third-party imports, images or other linked assets** and is not necessarily independently deployable.

## Explicit operator workflow

1. Prepare a **trusted** local GitPorch repository with a commit including those three files.
2. Complete an approved Porch Crew Docker Node test on that HEAD, then use `npm run artifacts -- bundle <repo> <completed-test-job-id> --i-approve-source-archive`.
3. Find that source bundle ID using `npm run artifacts -- list`.
4. Run the build only after reviewing its source and installed immutable local image:

```powershell
npm run builds -- static-web <source-artifact-id> --i-approve-isolated-build
npm run builds -- list
npm start
# Visit http://127.0.0.1:3690/#builds
```

The output and checksum-protected manifest are written under ignored private `data/builds/<id>.html` and `.json`. The local `GET /api/builds` returns receipt metadata **only**, never build HTML, and is strictly read-only. The Pages showcase has no access to private builds.

## Fixed recipe and constraints

- The only recipe is `STATIC_WEB_ONEFILE_V1`: read three regular non-symlink UTF-8 files, replace exactly one fixed stylesheet tag and one fixed JS tag with inline content, then emit base64-encoded HTML over bounded container stdout.
- The Docker runner inherits existing conservative controls: pinned image, `--pull=never`, `--network none`, non-root user, read-only root filesystem, dropped Linux capabilities, no-new-privileges, limited CPU/memory/PIDs, fixed shell command and read-only source/recipe mounts. It never runs repository-provided commands on the host.
- Source input total at most 96 KiB, output at most 128 KiB, inventory limited to 25 builds, per-Docker run at most 90 seconds. No package downloads, dependency installation, automated GitHub merges, remote APIs or public posting.
- A passing build means Docker locally reported an exit code of zero, the expected output contract was parsed and the HTML bytes were stored with SHA-256. It is **not proof of independent execution**, safety, reproducibility, or authentic runtime attestations.
- Outputs may contain JavaScript that runs when opened in a browser. Treat them as untrusted and do not open unknown builds in a privileged browsing context.
- A source artifact must remain checksum-valid throughout the build, and the Git HEAD must match its original commit. Altered/partial build shelf contents cause inventory to fail closed.
- An interrupted Docker CLI can leave a container running. On timeout the tool attempts `docker rm -f`; inspect actual processes/containers before manually recovering. This R1-F2 prototype does not provide full durable queue or crash recovery for in-flight build operations. Its result manifests exist only after successful completion.

## Next steps

Add append-only attempt records including failed/aborted runs, replay with reproducibility comparisons, and stronger host-isolation controls before permitting untrusted PRs. Build an optional GitHub Bridge only after a separate security review. The `docs/` demo remains fictional.
