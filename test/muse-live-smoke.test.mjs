import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/muse-live-smoke.yml'), 'utf8');
const scriptPath = path.join(root, 'scripts/muse-live-smoke.sh');
const script = fs.readFileSync(scriptPath, 'utf8');

test('R0.6 is explicitly manually dispatched, credential-minimal and hash-pinned', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /inputs\.disposable_approval == 'RUN_DISPOSABLE_MUSE_TEST'/);
  assert.match(workflow, /installer_sha256:/);
  assert.match(workflow, /sha256sum --check --status/);
  assert.match(workflow, /python-version: '3\.14'/);
  assert.match(workflow, /if: always\(\)/);
});

test('R0.6 disposable runner script passes Bash syntax check', () => {
  const p = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
});

test('R0.6 refuses execution outside approved manual GitHub Actions', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitporch-muse-r06-guard-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const env = {
    ...process.env, RUNNER_TEMP: tmp, GITHUB_WORKSPACE: root,
    MUSE_DISPOSABLE_APPROVED: 'RUN_DISPOSABLE_MUSE_TEST', GITHUB_ACTIONS: 'false',
  };
  let p = spawnSync('bash', [scriptPath], { encoding: 'utf8', env });
  assert.equal(p.status, 2);
  assert.match(p.stderr, /manual GitHub Actions approval is required/);
  env.GITHUB_ACTIONS = 'true';
  env.MUSE_DISPOSABLE_APPROVED = 'not-authorized';
  p = spawnSync('bash', [scriptPath], { encoding: 'utf8', env });
  assert.equal(p.status, 2);
  assert.equal(fs.existsSync(path.join(tmp, 'gitporch-muse-r06')), false);
});

test('R0.6 runs only documented operations against synthetic directories and never Git pushes', () => {
  assert.match(script, /muse bridge git-import "\$ROOT\/source" --branch main --preserve-merge-commits --json/);
  assert.match(script, /grep -Fq -- '--preserve-merge-commits' "\$ROOT\/import-help.txt"/);
  assert.match(script, /muse bridge git-export --git-dir "\$ROOT\/mirror" --git-branch muse-mirror --no-push --json/);
  assert.match(script, /muse checkout --force main/);
  assert.match(script, /refusing|Refusing/);
  assert.doesNotMatch(script, /(?:^|\n)\s*(?:git|muse) push\s/m);
  assert.match(script, /node src\/muse-bridge-evidence-packet\.mjs/);
});


test('R0.6 keeps installer and live CLI in the same ephemeral HOME and XDG paths', () => {
  assert.match(workflow, /export HOME="\$RUNNER_TEMP\/muse-home"/g);
  assert.ok(workflow.match(/export HOME="\$RUNNER_TEMP\/muse-home"/g)?.length === 2);
  assert.ok(workflow.match(/export XDG_DATA_HOME="\$HOME\/.local\/share"/g)?.length === 2);
  assert.ok(workflow.match(/export XDG_CONFIG_HOME="\$HOME\/.config"/g)?.length === 2);
  assert.match(script, /Refusing non-isolated Muse HOME/);
  assert.match(script, /current_stage=%s/);
  assert.match(script, /failed_stage=%s/);
  assert.match(script, /stage muse_import/);
  assert.match(script, /stage muse_export/);
  assert.match(script, /stage evidence_audits/);
});

test('R0.6 refuses approved-looking invocation with nonisolated HOME', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitporch-muse-r06-home-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const mockBin = path.join(tmp, 'bin');
  fs.mkdirSync(mockBin);
  const fakeMuse = path.join(mockBin, 'muse');
  fs.writeFileSync(fakeMuse, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(fakeMuse, 0o755);
  const env = {
    ...process.env,
    PATH: mockBin + path.delimiter + process.env.PATH,
    GITHUB_ACTIONS: 'true', MUSE_DISPOSABLE_APPROVED: 'RUN_DISPOSABLE_MUSE_TEST',
    RUNNER_TEMP: tmp, GITHUB_WORKSPACE: root, HOME: tmp,
  };
  const p = spawnSync('bash', [scriptPath], { encoding: 'utf8', env });
  assert.equal(p.status, 2);
  assert.match(p.stderr, /Refusing non-isolated Muse HOME/);
  assert.equal(fs.existsSync(path.join(tmp, 'gitporch-muse-r06')), false);
});
