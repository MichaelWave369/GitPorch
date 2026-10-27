# Smergeon Recovery Ward · read-only GitPorch intake v0.1

GitPorch can inspect an **unsigned Smergeon v0.6 surgical handoff receipt**
locally. This is a **proposal intake**, not a GitPorch completed worker record,
a signature, a test result, an automated repair, or an Anti-M DONE state.

## CLI

Requires Node.js 20+. No dependencies, network connection, Docker, Git writes,
secrets, signers, imported plugins, or service setup.

    node src/smergeon-intake-cli.mjs path/to/smergeon-receipt.json

With a digest that you saved **independently** of the receipt:

    node src/smergeon-intake-cli.mjs path/to/smergeon-receipt.json --expected-sha256 PASTE_64_HEX

You can also use \`npm run smergeon -- path/to/smergeon-receipt.json\`.

If valid, the machine result is **REVIEW_ONLY** and trust remains
**UNSIGNED_UNVERIFIED**. The result includes the source PR, commit SHA,
fingerprints, repair path and optional draft URL, plus literal \`false\`
values for execution authority, verified worker run, signed evidence,
Anti-M completion and merge authority.

Malformed, altered, unsupported or privilege-claiming receipts are
**REJECT**. The tool validates the Smergeon v0.6 exact JSON shape,
the Python-compatible SHA-256 canonical checksum, safe GitHub URL/branch,
and fixed unsigned handoff claims. Max file size: 16 KiB.

### Trust boundaries

- A matching checksum means the data are internally consistent, **not signed**.
  An attacker may replace the receipt and recompute its checksum.
- An independently saved checksum can identify a change relative to that
  checksum, but does not establish who created the original data.
- Even valid \`DRAFT_CREATED\` means only that Smergeon reported a draft-PR
  creation. GitPorch does not independently fetch GitHub state.
- Receipt statements do not become GitPorch \`DONE\`/PASS worker evidence.
  This tool intentionally does not call \`evidence-signatures.mjs\`,
  \`witness-evidence.mjs\`, any job queue, CI executor, Git writer or server.
- The Anti-M shadow lane stays advisory. No imports into SuperPhiVessel
  Evidence Gate, source trust registry or closure ledger are performed.
- Refuse overpromoted claims instead of silently downgrading their contents.
- Inspect the original code diff, run independent tests, and explicitly
  approve any changes through ordinary GitHub reviews.

Cross-language tests include checksums computed with Python
\`json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=True)\`,
which is the exact Smergeon canonicalization for this ASCII-only schema.

**Ledger above ego. First, do no merge harm.**
