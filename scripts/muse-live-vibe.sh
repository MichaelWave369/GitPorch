#!/usr/bin/env bash
# R0.9: operator-approved real PUBLIC Vibe Git/Muse compatibility pilot.
# Called only from manually dispatched ephemeral GitHub Actions; never push.
set -Eeuo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true || "${MUSE_VIBE_APPROVED:-}" != RUN_DISPOSABLE_VIBE_MUSE_TEST ]]; then
  echo 'Refusing R0.9: manual disposable Vibe approval required.' >&2; exit 2
fi
if [[ -z "${RUNNER_TEMP:-}" || "$RUNNER_TEMP" != /* || -z "${GITHUB_WORKSPACE:-}" || "$GITHUB_WORKSPACE" != /* ]]; then
  echo 'Absolute GitHub Actions paths required.' >&2; exit 2
fi
if [[ ! "${VIBE_PINNED_SHA:-}" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Invalid or missing pinned public Vibe main commit SHA.' >&2; exit 2
fi
if [[ $# -ne 1 || ! "$1" =~ ^(prepare|run)$ ]]; then
  echo 'Usage: scripts/muse-live-vibe.sh prepare|run' >&2; exit 2
fi
ACTION="$1"
ROOT="$(realpath "$RUNNER_TEMP")/gitporch-muse-vibe-r09"
CODE="$(realpath "$GITHUB_WORKSPACE")"
SOURCE="$ROOT/source"
MUSE="$ROOT/muse"
MIRROR="$ROOT/mirror"
if [[ ! -f "$CODE/src/muse-vibe-slice.mjs" || ! -f "$CODE/src/muse-history-verify.mjs" ]]; then
  echo 'Reviewed Vibe slice and fidelity verifiers missing.' >&2; exit 2
fi
stage() { printf 'current_stage=%s\n' "$1" > "$ROOT/run-stage.txt"; }
on_failure() {
  ec=$?
  local current_stage
  current_stage="$(cat "$ROOT/run-stage.txt" 2>/dev/null || true)"
  printf 'failed_action=%s\nfailed_stage=%s\nexit_code=%s\n' "$ACTION" "$current_stage" "$ec" > "$ROOT/runner-error.txt"
  echo "::error title=R0.9 failed before completing audits::Action $ACTION, $current_stage, exit $ec. Inspect uploaded public-only evidence." >&2
  exit "$ec"
}
if [[ "$ACTION" == prepare ]]; then
  if [[ -e "$ROOT" || -L "$ROOT" ]]; then
    echo 'Refusing to reuse a prior disposable test directory.' >&2; exit 2
  fi
  mkdir -m 700 "$ROOT"
  trap on_failure ERR
  stage clone_pinned_public_vibe
  export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1
  # Fixed public URL, no credential helper, no hook execution, no submodules.
  git -c credential.helper= -c core.hooksPath=/dev/null clone --single-branch --branch main \
    'https://github.com/MichaelWave369/Vibe.git' "$SOURCE" > "$ROOT/vibe-clone.log" 2>&1
  actual="$(git -C "$SOURCE" rev-parse --verify refs/heads/main)"
  if [[ "$actual" != "$VIBE_PINNED_SHA" ]]; then
    echo 'Public Vibe main advanced since reviewed pin. Refusing new content.' >&2; exit 2
  fi
  stage select_authentic_historical_slice
  node "$CODE/src/muse-vibe-slice.mjs" inspect "$SOURCE" "$VIBE_PINNED_SHA" \
    > "$ROOT/vibe-slice-plan.json" 2> "$ROOT/vibe-slice-plan.err"
  tip="$(node -e 'const f=require("fs");const p=JSON.parse(f.readFileSync(process.argv[1],"utf8"));if(p.schema!=="gitporch.muse-vibe-r09-slice-plan.v1"||!(/^[a-f0-9]{40}$/).test(p.selectedGitTip))process.exit(2);process.stdout.write(p.selectedGitTip)' "$ROOT/vibe-slice-plan.json")"
  stage isolate_real_git_history
  # Mutations happen only to the freshly cloned throwaway Git directory.
  git -C "$SOURCE" -c core.hooksPath=/dev/null -c core.fsmonitor=false checkout --force -B main "$tip" \
    > "$ROOT/vibe-checkout.log" 2>&1
  git -C "$SOURCE" remote remove origin
  if [[ -n "$(git -C "$SOURCE" remote)" || "$(git -C "$SOURCE" rev-parse main)" != "$tip" ]]; then
    echo 'Detached Vibe source has an unexpected remote or head.' >&2; exit 2
  fi
  [[ -z "$(git -C "$SOURCE" status --porcelain=v1 --untracked-files=all)" ]] || {
    echo 'Disposable Vibe worktree is dirty.' >&2; exit 2;
  }
  stage independent_git_history_baseline
  node "$CODE/src/muse-bridge-history-baseline.mjs" "$SOURCE" main \
    > "$ROOT/git-history-baseline.json" 2> "$ROOT/git-history-baseline.err"
  node -e '
    const fs=require("fs"), p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const b=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
    if(p.selectedGitTip!==b.source.head || p.selectedReachableCommitCount!==b.source.commitCount)process.exit(2);
  ' "$ROOT/vibe-slice-plan.json" "$ROOT/git-history-baseline.json"
  printf 'pinned_public_vibe_main=%s\nselected_authentic_tip=%s\nno_push=true\n' "$VIBE_PINNED_SHA" "$tip" > "$ROOT/prepare-summary.txt"
  echo 'R0.9 public Vibe slice prepared without Muse. Full original Git ancestry retained.'
  exit 0
fi
if [[ ! -f "$ROOT/prepare-summary.txt" || ! -f "$ROOT/vibe-slice-plan.json" ]]; then
  echo 'Disposable preflight was not completed.' >&2; exit 2
fi
if [[ "${HOME:-}" != "$RUNNER_TEMP/muse-home" || ! -d "$HOME" ]]; then
  echo 'Refusing Muse without isolated runner-temp HOME.' >&2; exit 2
fi
for binary in node git muse; do command -v "$binary" >/dev/null || exit 2; done
trap on_failure ERR
stage validate_pinned_disconnected_source
node -e '
 const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
 if(p.pinnedMainSha!==process.argv[2]||p.selectedGitTip!==process.argv[3])process.exit(2);
' "$ROOT/vibe-slice-plan.json" "$VIBE_PINNED_SHA" "$(git -C "$SOURCE" rev-parse main)"
[[ -z "$(git -C "$SOURCE" remote)" ]] || { echo 'Unexpected Git remote.' >&2; exit 2; }
stage muse_cli_contract
muse --version > "$ROOT/muse-version.txt" 2>&1
muse bridge git-import --help > "$ROOT/import-help.txt" 2>&1
muse bridge git-export --help > "$ROOT/export-help.txt" 2>&1
grep -Fq -- '--preserve-merge-commits' "$ROOT/import-help.txt" || { echo 'Merge preservation unavailable.' >&2; exit 2; }
grep -Fq -- '--no-push' "$ROOT/export-help.txt" || { echo 'Explicit no-push unavailable.' >&2; exit 2; }
stage muse_init_and_import
mkdir -m 700 "$MUSE"
(
  cd "$MUSE"
  muse init > "$ROOT/muse-init.log" 2>&1
  muse bridge git-import "$SOURCE" --branch main --preserve-merge-commits --json \
    > "$ROOT/muse-import.log" 2>&1
  muse checkout --force main > "$ROOT/muse-checkout.log" 2>&1
)
r07_failed=0
stage muse_historical_readbacks
(
  cd "$MUSE"
  muse read-commit --help > "$ROOT/muse-read-commit-help.txt" 2>&1 || true
  muse read-snapshot --help > "$ROOT/muse-read-snapshot-help.txt" 2>&1 || true
  muse cat-object --help > "$ROOT/muse-cat-object-help.txt" 2>&1 || true
)
node "$CODE/src/muse-history-verify.mjs" capture "$ROOT/git-history-baseline.json" \
  "$ROOT/muse-import.log" "$MUSE" "$ROOT" \
  > "$ROOT/muse-internal-history-audit.json" 2> "$ROOT/muse-internal-history-audit.err" || r07_failed=1
stage git_mirror
git -c core.hooksPath=/dev/null init --initial-branch=muse-mirror "$MIRROR" > "$ROOT/mirror-init.log" 2>&1
git -C "$MIRROR" config --local user.name 'GitPorch Vibe Pilot'
git -C "$MIRROR" config --local user.email 'synthetic@example.invalid'
git -C "$MIRROR" config --local commit.gpgsign false
git -C "$MIRROR" commit --allow-empty -m 'disposable mirror seed' > "$ROOT/mirror-seed.log" 2>&1
[[ -z "$(git -C "$MIRROR" remote)" ]] || { echo 'Mirror cannot have Git remotes.' >&2; exit 2; }
stage muse_no_push_export
(
  cd "$MUSE"
  muse bridge git-export --git-dir "$MIRROR" --git-branch muse-mirror --no-push --json \
    > "$ROOT/muse-export.log" 2>&1
  muse bridge git-status --git-dir "$SOURCE" --json \
    > "$ROOT/muse-status.json" 2> "$ROOT/muse-status.err"
)
stage independent_audits
failed=0
[[ "$r07_failed" == 0 ]] || failed=1
node "$CODE/src/muse-bridge-snapshot-audit.mjs" "$SOURCE" "$MIRROR" \
  > "$ROOT/snapshot-audit.json" 2> "$ROOT/snapshot-audit.err" || failed=1
node "$CODE/src/muse-bridge-status-audit.mjs" "$SOURCE" "$MIRROR" "$ROOT/muse-status.json" \
  > "$ROOT/status-audit.json" 2> "$ROOT/status-audit.err" || failed=1
node "$CODE/src/muse-bridge-evidence-packet.mjs" "$SOURCE" "$MIRROR" \
  "$ROOT/muse-status.json" "$ROOT/muse-version.txt" "$ROOT/muse-import.log" "$ROOT/muse-export.log" \
  > "$ROOT/evidence-packet.json" 2> "$ROOT/evidence-packet.err" || failed=1
printf 'real_public_vibe_commits=true\nhistorical_slice_only=true\nfailed_checks=%s\nno_push=true\nhuman_review_required=true\n' "$failed" > "$ROOT/run-summary.txt"
if [[ "$failed" != 0 ]]; then
  stage blocked
  echo "::error title=R0.9 compatibility audit failed::Muse was installed and the public Vibe preflight completed. At least one historical-byte, final-snapshot or status audit failed." >&2
  # Print bounded, PUBLIC-fixture-only diagnostic summaries so a broken
  # artifact uploader never turns a real failure into an opaque red X.
  # Preserve complete JSON/ERR logs in the upload-artifact stage.
  for label in muse-internal-history-audit snapshot-audit status-audit evidence-packet; do
    if [[ -s "$ROOT/$label.json" ]]; then
      node -e '
        const fs=require("node:fs"), file=process.argv[1], label=process.argv[2];
        try {
          const v=JSON.parse(fs.readFileSync(file,"utf8"));
          const codes=Array.isArray(v.problems) ? v.problems.slice(0,12).map(x=>x.code) :
            Array.isArray(v.findings) ? v.findings.slice(0,12) : 
            Array.isArray(v.blockers) ? v.blockers.slice(0,12) : [];
          const differences=v.differences && typeof v.differences==="object" ?
            Object.fromEntries(Object.entries(v.differences).map(([k,x])=>[k,Array.isArray(x)?x.length:"unknown"])) : undefined;
          console.error("[R0.9 diagnostic] "+JSON.stringify({label,status:v.status??"UNREPORTED",codes,differences}));
        } catch { console.error("[R0.9 diagnostic] "+label+": JSON unreadable or incomplete"); }
      ' "$ROOT/$label.json" "$label" || true
    else
      echo "[R0.9 diagnostic] $label: no JSON report" >&2
    fi
    if [[ -s "$ROOT/$label.err" ]]; then
      echo "[R0.9 diagnostic] $label stderr (first 1200 bytes):" >&2
      head -c 1200 "$ROOT/$label.err" >&2 || true
      echo >&2
    fi
  done
  exit 1
fi
stage complete
echo 'Vibe history slice passed bounded Muse readback and Git export; operator review required.'
