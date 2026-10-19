# GitPorch PhiBots Clubhouse · R0.3

The Clubhouse makes **local contribution records**, not autonomous Git merges. It is intended for a trusted single-user workstation. The GitPorch repository remains public; real contributor records remain in the local, ignored `data/crew` directory.

## CLI

```bash
node src/clubhouse-cli.mjs register helper1 builder "Sample Helper"
node src/clubhouse-cli.mjs list
# After pushing a commit to a real LOCAL GitPorch bare repository:
node src/clubhouse-cli.mjs propose helper1 my-project <full-40-character-sha1> "Document the next build"
# Only after manual review at the local workstation:
node src/clubhouse-cli.mjs decide <proposal-id> ACCEPTED "Reviewed, no merge performed" --confirm-local-review
```

The local dashboard displays these records through GET `/api/clubhouse`. The HTTP API remains read-only and localhost-only; the CLI is required for modifications. User-entered labels can be fictional and **do not authenticate bot identities**. Git object checks establish only that a commit object exists locally at submission time, not that the code was tested. A recorded review decision does not initiate Git operations or grant branch access.

## Receipt limitations

Receipts live in `data/crew/members`, `data/crew/proposals`, and `data/crew/decisions` as separate JSON files. Exclusive file creation prevents accidental overwrite of the same record ID. Checksums detect basic file modification but offer **no signature, no trusted timestamp, no authenticated identity, no tamper-proof storage, and no deletion detection**. An attacker controlling the filesystem can rewrite records and checksums. Protect the directory with operating system permissions and independent backups.

The local read-only endpoint will return an error if existing records fail validation; it does not silently bypass corrupted records.

The **public GitHub Pages clubhouse** is an entirely separate static visualization populated with three fictional PhiBots and synthetic proposals. It never reads your local files or calls any backend. The Porch Crew independent CI, signature and approval pipeline is still planned.
