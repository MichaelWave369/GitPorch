import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planVibeHistorySlice, MAX_PILOT_COMMITS } from '../src/muse-vibe-slice.mjs';

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', timeout: 20000, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  assert.equal(r.status, 0, 'git ' + args.join(' ') + ': ' + (r.stderr || r.error?.message || ''));
  return r.stdout.trim();
}
function fixture(t, includeSpecFromStart = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitporch-vibe-r09-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '--initial-branch=main');
  git(dir, 'config', 'user.name', 'GitPorch Vibe Test');
  git(dir, 'config', 'user.email', 'vibe-test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  if (includeSpecFromStart) {
    fs.mkdirSync(path.join(dir, 'vibe', 'examples'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'vibe', 'examples', 'sample.vibe'), 'intent Sample {}\n');
  }
  fs.writeFileSync(path.join(dir, 'README.md'), '# Fixture\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'Initial authentic Git commit');
  return dir;
}
function appendCommit(dir, index) {
  fs.appendFileSync(path.join(dir, 'README.md'), '\n' + index);
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '-m', 'Change ' + index);
}

test('R0.9 selects entire current real DAG when short, preserving SHA and Vibe source', t => {
  const dir = fixture(t);
  appendCommit(dir, 1);
  appendCommit(dir, 2);
  const head = git(dir, 'rev-parse', 'main');
  const before = git(dir, 'status', '--porcelain');
  const p = planVibeHistorySlice(dir, head);
  assert.equal(p.status, 'READ_ONLY_AUTHENTIC_HISTORY_SLICE_PLAN');
  assert.equal(p.pinnedMainSha, head);
  assert.equal(p.selectedGitTip, head);
  assert.equal(p.selectedIsCurrentMain, true);
  assert.equal(p.selectedReachableCommitCount, 3);
  assert.ok(p.selectedVibeSpecPaths.includes('vibe/examples/sample.vibe'));
  assert.equal(git(dir, 'status', '--porcelain'), before);
  assert.equal(git(dir, 'rev-parse', 'main'), head);
  assert.equal(p.execution.museInvoked, false);
});

test('R0.9 does not manufacture a 48-commit history: selects a real, complete historical ancestor', t => {
  const dir = fixture(t);
  for (let i = 0; i < MAX_PILOT_COMMITS + 5; i++) appendCommit(dir, i);
  const head = git(dir, 'rev-parse', 'main');
  const p = planVibeHistorySlice(dir, head);
  assert.equal(p.fullReachableCommitCount, MAX_PILOT_COMMITS + 6);
  assert.equal(p.selectedIsCurrentMain, false);
  assert.equal(p.historyScope, 'HISTORICAL_MAIN_ANCESTOR_ONLY_NOT_CURRENT_MAIN');
  assert.ok(p.selectedReachableCommitCount <= MAX_PILOT_COMMITS);
  assert.equal(git(dir, 'rev-list', '--count', p.selectedGitTip), String(p.selectedReachableCommitCount));
  assert.equal(git(dir, 'merge-base', p.selectedGitTip, head), p.selectedGitTip);
  assert.equal(git(dir, 'rev-parse', 'main'), head, 'read-only inspection must not move main');
});

test('R0.9 fails closed when .vibe files were added only outside eligible historical window', t => {
  const dir = fixture(t, false);
  for (let i = 0; i < MAX_PILOT_COMMITS + 2; i++) appendCommit(dir, i);
  fs.writeFileSync(path.join(dir, 'added-late.vibe'), 'intent Late {}\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'Vibe spec too recent for bounded prefix');
  assert.throws(() => planVibeHistorySlice(dir, git(dir, 'rev-parse', 'main')), /BLOCKED_NO_ELIGIBLE_VIBE_HISTORY/);
});

test('R0.9 refuses unreviewed main advancement, invalid pins and a dirty source', t => {
  const dir = fixture(t);
  const original = git(dir, 'rev-parse', 'main');
  assert.throws(() => planVibeHistorySlice(dir, 'abc'), /pinned 40-hex/);
  appendCommit(dir, 1);
  assert.throws(() => planVibeHistorySlice(dir, original), /pinned SHA mismatch/);
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'uncommitted');
  assert.throws(() => planVibeHistorySlice(dir, git(dir, 'rev-parse', 'main')), /not clean/);
});

test('R0.9 manual workflow is fixed-public-source, review-pinned, token-minimal and no-push', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/muse-vibe-pilot.yml', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../scripts/muse-live-vibe.sh', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /RUN_DISPOSABLE_VIBE_MUSE_TEST/);
  assert.match(workflow, /vibe_main_sha/);
  assert.match(workflow, /installer_sha256/);
  assert.match(workflow, /sha256sum --check --status/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(script, /https:\/\/github\.com\/MichaelWave369\/Vibe\.git/);
  assert.ok(script.includes('if [[ "$actual" != "$VIBE_PINNED_SHA" ]]'), 'actual Git SHA must match operator pin');
  assert.match(script, /git -C "\$SOURCE" remote remove origin/);
  assert.match(script, /--preserve-merge-commits --json/);
  assert.match(script, /--no-push --json/);
  assert.doesNotMatch(script, /(?:^|\n)\s*(?:git|muse) push\s/m);
  assert.doesNotMatch(script, /git\s+submodule\s+update|npm install|pip install/m);
});

test('R0.9 invalid approval reports FAILED preflight instead of silently skipping the entire job', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/muse-vibe-pilot.yml', import.meta.url), 'utf8');
  assert.match(workflow, /disposable_approval:\s*\n\s+description:[^\n]*\n\s+required: true\n\s+type: choice\n\s+default: DO_NOT_RUN\n\s+options:\n\s+- DO_NOT_RUN\n\s+- RUN_DISPOSABLE_VIBE_MUSE_TEST/);
  assert.doesNotMatch(workflow, /^\s{4}if:.*inputs\.disposable_approval/m,
    'a top-level job if silently skips everything and prevents useful diagnostics');
  const guard = workflow.indexOf('name: Validate operator approval and both pinned IDs');
  const checkout = workflow.indexOf('name: Checkout reviewed GitPorch source');
  const clone = workflow.indexOf('name: Clone only pinned public Vibe');
  const download = workflow.indexOf('name: Download reviewed Muse installer');
  assert.ok(guard > 0 && checkout > guard && clone > checkout && download > clone,
    'approval preflight must run before any checkout, third-party installer or public clone');
  assert.match(workflow, /if \[\[ "\$\{MUSE_VIBE_APPROVED:-\}" != "RUN_DISPOSABLE_VIBE_MUSE_TEST" \]\]; then/);
  assert.match(workflow, /::error title=R0\.9 approval required::/);
  assert.match(workflow, /\$\{VIBE_PINNED_SHA:-\}.*\^\[a-f0-9\]\{40\}/);
  assert.match(workflow, /\$\{MUSE_INSTALLER_SHA256:-\}.*\^\[A-Fa-f0-9\]\{64\}/);
  assert.match(workflow, /exit 2/);
});

test('R0.9 preserves public Vibe evidence artifact paths and diagnoses failed gates visibly', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/muse-vibe-pilot.yml', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../scripts/muse-live-vibe.sh', import.meta.url), 'utf8');
  assert.ok(!workflow.includes('${{ runner.temp }}}/'), 'stray brace prevents artifact uploads');
  for (const suffix of [
    'muse-installer-sha256.txt',
    'gitporch-muse-vibe-r09/*.json',
    'gitporch-muse-vibe-r09/*.txt',
    'gitporch-muse-vibe-r09/*.log',
    'gitporch-muse-vibe-r09/*.err',
  ]) {
    assert.ok(workflow.includes('${{ runner.temp }}/' + suffix), 'missing correct artifact path for ' + suffix);
  }
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(script, /failed_stage=%s/);
  assert.match(script, /for label in muse-internal-history-audit snapshot-audit status-audit evidence-packet/);
  assert.match(script, /R0\.9 diagnostic/);
  assert.match(script, /head -c 1200/);
});
test('R0.9 Bash syntax and manual-approval guards', t => {
  const script = fileURLToPath(new URL('../scripts/muse-live-vibe.sh', import.meta.url));
  const check = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-r09-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = spawnSync('bash', [script, 'prepare'], {
    encoding: 'utf8',
    env: {
      ...process.env, GITHUB_ACTIONS: 'false', MUSE_VIBE_APPROVED: 'RUN_DISPOSABLE_VIBE_MUSE_TEST',
      RUNNER_TEMP: dir, GITHUB_WORKSPACE: dir, VIBE_PINNED_SHA: 'a'.repeat(40),
    },
  });
  assert.equal(p.status, 2);
  assert.match(p.stderr, /manual disposable Vibe approval required/);
  assert.equal(fs.readdirSync(dir).length, 0);
});
