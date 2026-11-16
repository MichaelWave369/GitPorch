#!/usr/bin/env bash
# Explicitly approved, disposable GitPorch x Muse live smoke test.
# Intended only for a manually dispatched, unprivileged GitHub Actions runner.
set -Eeuo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${MUSE_DISPOSABLE_APPROVED:-}" != "RUN_DISPOSABLE_MUSE_TEST" ]]; then
  echo 'Refusing live Muse test: manual GitHub Actions approval is required.' >&2
  exit 2
fi
if [[ -z "${RUNNER_TEMP:-}" || -z "${GITHUB_WORKSPACE:-}" || "${RUNNER_TEMP}" != /* ]]; then
  echo 'Missing absolute GitHub Actions workspace/temporary directory.' >&2
  exit 2
fi
ROOT="$(realpath "$RUNNER_TEMP")/gitporch-muse-r06"
CODE="$(realpath "$GITHUB_WORKSPACE")"
if [[ -e "$ROOT" || -L "$ROOT" ]]; then
  echo 'Refusing to reuse an existing test directory.' >&2
  exit 2
fi
if [[ ! -f "$CODE/src/muse-bridge-pilot.mjs" || ! -f "$CODE/src/muse-bridge-evidence-packet.mjs" ]]; then
  echo 'Required GitPorch source code is missing.' >&2
  exit 2
fi
for binary in node git muse; do command -v "$binary" >/dev/null || { echo "Missing required command: $binary" >&2; exit 2; }; done
# Real Muse runs only with a fresh, isolated home. No operator keychain or
# pre-existing Muse auth, remotes or configuration should be visible.
if [[ "${HOME:-}" != "$RUNNER_TEMP/muse-home" || ! -d "$HOME" ]]; then
  echo 'Refusing non-isolated Muse HOME.' >&2
  exit 2
fi
mkdir -m 700 "$ROOT"
STAGE=preflight
stage() {
  STAGE="$1"
  printf 'current_stage=%s\n' "$STAGE" > "$ROOT/run-stage.txt"
}
on_failure() {
  ec=$?
  printf 'failed_stage=%s\nexit_code=%s\n' "$STAGE" "$ec" > "$ROOT/runner-error.txt"
  exit "$ec"
}
trap on_failure ERR
stage preflight
cd "$CODE"
{
  printf 'run_class=DISPOSABLE_GITHUB_ACTIONS\n'
  node --version
  git --version
  python3.14 --version
} > "$ROOT/runner-versions.txt" 2>&1
stage muse_version
muse --version > "$ROOT/muse-version.txt" 2>&1
muse bridge git-import --help > "$ROOT/import-help.txt" 2>&1
muse bridge git-export --help > "$ROOT/export-help.txt" 2>&1
if ! grep -Fq -- '--no-push' "$ROOT/export-help.txt"; then
  echo 'Muse export help lacks explicit --no-push; refusing export.' >&2
  exit 2
fi
stage synthetic_fixture
node src/muse-bridge-pilot.mjs fixture "$ROOT/source" --i-approve-disposable-fixture > "$ROOT/fixture.json" 2> "$ROOT/fixture.err"
node src/muse-bridge-history-baseline.mjs "$ROOT/source" main > "$ROOT/git-history-baseline.json" 2> "$ROOT/history.err"
if [[ -n "$(git -C "$ROOT/source" remote)" ]]; then
  echo 'Synthetic Git source unexpectedly has remotes.' >&2
  exit 2
fi
stage muse_init
mkdir -m 700 "$ROOT/muse"
(
  cd "$ROOT/muse"
  muse init > "$ROOT/muse-init.log" 2>&1
  stage muse_import
  muse bridge git-import "$ROOT/source" --branch main --json > "$ROOT/muse-import.log" 2>&1
  # Only in our freshly created disposable directory; never in a user checkout.
  stage muse_checkout
  muse checkout --force main > "$ROOT/muse-checkout.log" 2>&1
)
# R0.7 reads Muse's *stored* commits and historical snapshots, not merely
# the import progress lines. This check is read-only. Preserve failure details,
# then continue the export so one mismatch does not conceal other evidence.
r07_failed=0
stage muse_internal_history_audit
node src/muse-history-verify.mjs capture "$ROOT/git-history-baseline.json" "$ROOT/muse-import.log" "$ROOT/muse" > "$ROOT/muse-internal-history-audit.json" 2> "$ROOT/muse-internal-history-audit.err" || r07_failed=1
# A separate, newly-created mirror with no Git remote. The first export's
# ancestry is not a reconstruction of the original Git history.
stage mirror_init
git init --initial-branch=muse-mirror "$ROOT/mirror" > "$ROOT/mirror-init.log" 2>&1
git -C "$ROOT/mirror" config --local user.name 'GitPorch Smoke Fixture'
git -C "$ROOT/mirror" config --local user.email 'synthetic@example.invalid'
git -C "$ROOT/mirror" config --local commit.gpgsign false
git -C "$ROOT/mirror" commit --allow-empty -m 'disposable mirror seed' > "$ROOT/mirror-seed.log" 2>&1
if [[ -n "$(git -C "$ROOT/mirror" remote)" ]]; then
  echo 'Synthetic mirror unexpectedly has remotes.' >&2
  exit 2
fi
(
  cd "$ROOT/muse"
  # Explicitly no push and no remote; writes are limited to the disposable mirror.
  stage muse_export
  muse bridge git-export --git-dir "$ROOT/mirror" --git-branch muse-mirror --no-push --json > "$ROOT/muse-export.log" 2>&1
  stage muse_status
  muse bridge git-status --git-dir "$ROOT/source" --json > "$ROOT/muse-status.json" 2> "$ROOT/muse-status.err"
)
# Do not let one failed gate conceal results from the other two.
stage evidence_audits
fail=0
if [[ "$r07_failed" -ne 0 ]]; then fail=1; fi
node src/muse-bridge-snapshot-audit.mjs "$ROOT/source" "$ROOT/mirror" > "$ROOT/snapshot-audit.json" 2> "$ROOT/snapshot-audit.err" || fail=1
node src/muse-bridge-status-audit.mjs "$ROOT/source" "$ROOT/mirror" "$ROOT/muse-status.json" > "$ROOT/status-audit.json" 2> "$ROOT/status-audit.err" || fail=1
node src/muse-bridge-evidence-packet.mjs "$ROOT/source" "$ROOT/mirror" "$ROOT/muse-status.json" "$ROOT/muse-version.txt" "$ROOT/muse-import.log" "$ROOT/muse-export.log" > "$ROOT/evidence-packet.json" 2> "$ROOT/evidence-packet.err" || fail=1
printf 'evidence_checks_failed=%s\nreal_muse_used=true\nhuman_review_required=true\n' "$fail" > "$ROOT/run-summary.txt"
if [[ "$fail" -ne 0 ]]; then
  stage blocked
  echo 'One or more evidence gates failed; see uploaded synthetic logs.' >&2
  exit 1
fi
stage complete
printf 'Disposable Muse bridge trial complete; human review is still required.\n'
