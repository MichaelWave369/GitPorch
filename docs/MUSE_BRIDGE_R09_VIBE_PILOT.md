# GitPorch × Muse R0.9: authentic Vibe Git history pilot

**State: implementation in review, not yet tested with the real Vibe repository or the real Muse CLI.**

The [R0.7 synthetic six-commit trial](https://github.com/MichaelWave369/GitPorch/actions/runs/43997723043) passed against Muse 0.2.2rc9. R0.8 displays its unsigned local evidence. R0.9 aims at real, *original Git commits* from public [MichaelWave369/Vibe](https://github.com/MichaelWave369/Vibe). This is **not** a Vibe-aware Muse semantic plugin or production MuseHub synchronization.

## Authentic historical slice instead of fake truncated ancestry

The existing R0.4 and R0.7 verifiers enforce caps on commits, blobs and sizes. A shallow clone of recent history can disguise missing parents and must **not** be presented as a full-fidelity result.

The new *read-only* planner:
1. Requires a clean, full non-shallow Vibe clone and an exact operator-reviewed 40-character Git SHA for the public main tip.
2. Lists all Git commits reachable from that main tip in parent-before-child order; considers only the **earliest 48**.
3. Picks the latest eligible **first-parent ancestor** in this window with a tracked .vibe file and at most 256 tracked paths.
4. Reports the original selected Git object ID, all its reachable ancestors, the .vibe paths, the pinned main tip, and whether those tips coincide.
5. **Fails closed** if no eligible .vibe history exists within those bounds, or if the current public head moved.

The selected tip may be a **historical ancestor**, not today's Vibe main. Later features and commits are out of scope. The independent R0.4 baseline imposes additional caps and may still refuse the slice. The planner never fabricates Git commits, drops parents, fetches remotes, writes files, invokes Muse, or pushes.

To inspect an *already present* public Vibe clone locally, run from GitPorch:

~~~powershell
git ls-remote https://github.com/MichaelWave369/Vibe.git refs/heads/main
npm run muse:vibe-plan -- inspect "C:\absolute\path\to\Vibe" <reviewed-main-40hex>
~~~

## Explicit manual GitHub Actions run

Only after review and merge, go to **GitPorch → Actions → Muse × Vibe R0.9 Real Git History Pilot (manual only) → Run workflow** on main.

Supply all three independent inputs:

- **disposable_approval**: choose `RUN_DISPOSABLE_VIBE_MUSE_TEST` from the dropdown. The default is `DO_NOT_RUN` and intentionally **does not** authorize anything.
- **vibe_main_sha** = the reviewed 40-hex public Vibe main Git commit ID. The trial refuses any newer unreviewed tip.
- **installer_sha256** = the separately verified, reviewed 64-hex SHA-256 of https://musehub.ai/install.sh. It pins the installer *script only*, not Muse distributions and dependencies.

**Troubleshooting skipped jobs:** On November 17, 2026, [manual run #44189834732](https://github.com/MichaelWave369/GitPorch/actions/runs/44189834732) was marked `skipped` *before any steps ran*. The R0.9 job previously had a job-level condition comparing an operator-typed approval string. An exact mismatch could silently skip the whole job, producing no logs or artifact. The workflow now offers an explicit approval dropdown and always starts with a **fail-fast** validation step. If `DO_NOT_RUN`, a missing pin, or malformed hash is submitted, that job will **fail with a visible explanation** before checkout, Vibe clone, installer download, or Muse execution. Selecting approval does not override either pin or later safety gate.

The workflow runs **only** on manual dispatch. It uses an ephemeral GitHub runner with read-only repository permission, no persisted checkout credentials and no supplied repository secrets. Normal PR CI does not install Muse or clone the public Vibe repo.

**Preflight runs before installing Muse:** clone the exact fixed public URL into runner temp (no hooks, no submodule recursion, no project scripts); compare the live main SHA with the reviewed pin; run the planner; move main to the selected historical commit **only within the throwaway clone**; remove origin and confirm no remotes; produce the independent Git R0.4 baseline and cross-check the selected tip and commit count. Any preflight failure blocks the installer.

**Real Muse trial only after preflight:** use the independently hashed installer with isolated runner-temp HOME/XDG settings; require merge preservation and no-push support; import the bounded historical Git DAG with merge preservation; read back every Muse commit, snapshot and actual blob bytes; export just the current snapshot to a separate, new no-remote Git mirror with **--no-push**; independently audit the Git snapshot, import/export status and evidence packet. Neither Muse nor Git push commands are issued.

The upload-artifact step runs on **success and failure**, preserving the public-only evidence for 7 days. Review the historical scope in vibe-slice-plan.json, plus git-history-baseline.json, muse-internal-history-audit.json (or .err), snapshot-audit.json, status-audit.json and evidence-packet.json.

### What a pass would mean

Only that the **selected authentic historical Vibe Git DAG and tracked file bytes** passed this tested Muse version and Git export path, within the recorded limits. It would NOT verify Vibe's semantic intent, current-main compatibility when the slice is historical, author's provenance, cryptographic attestations, executable modes inside Muse, full Git ancestry on export, agent identities, or production MuseHub sync.

The R0.8 bridge dashboard currently stores *unsigned R0.7-style receipt summaries* without original repository identity and selected historical scope. **Do not publish an R0.9 receipt to that dashboard yet**; a future display revision should label Vibe, pinned public main, chosen historical SHA and evidence origin separately.

## Run #8/#9 failure diagnosis and evidence hardening (November 17, 2026)

- [Manual run #44195951348](https://github.com/MichaelWave369/GitPorch/actions/runs/44195951348) stopped in the **new explicit approval preflight**, because the dropdown was left at `DO_NOT_RUN`. No Git clone or Muse code was run.
- [Manual run #44196108057](https://github.com/MichaelWave369/GitPorch/actions/runs/44196108057) **passed approval**, pinned public Vibe clone, authentic historical-slice baseline, installer SHA256 check and installation of Muse **0.2.2rc11**. It then reached the real Vibe history/import/export verification and reported that **at least one fidelity gate failed**. This is not yet sufficient to attribute an issue to Muse or GitPorch.
- Critically, the earlier workflow artifact `path` expressions contained a **stray closing brace** after `${{ runner.temp }}`, resolving to a path like `/home/runner/work/_temp}/...`. GitHub therefore uploaded **no diagnostic evidence** for run #9, despite the `if: always()` step.

This fix repairs the artifact paths, makes a missing artifact a visible upload error, records the runner's failed stage, and prints **bounded, public-source-only** summaries of the internal history, final snapshot, status receipt, and evidence packet when an audit fails. The complete JSON and stderr files are uploaded for operator inspection on the next manually approved run. It is impossible to reconstruct the missing run #9 evidence from the job log alone.

Before another test, independently recheck *both* the Vibe `main` Git SHA and the reviewed Muse installer bytes. The prior pins are historical observations and may be stale. No manual workflow is dispatched by this PR.
## Later experiments

**R0.9B:** Vibe semantic-diff/merge comparison using detached copied files, separate offline runtime, actual Vibe tools, and human-reviewed results. This trial does not execute Vibe's Python code or install its dependencies.

**R1.0 research:** Evaluate a Vibe-specific Muse domain adapter and optional Agentora integration only after scoped fidelity, permission and auth contracts are verified.
