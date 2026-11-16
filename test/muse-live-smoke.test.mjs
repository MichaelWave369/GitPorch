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
  assert.match(script, /muse bridge git-import "\$ROOT\/source" --branch main --json/);
  assert.match(script, /muse bridge git-export --git-dir "\$ROOT\/mirror" --git-branch muse-mirror --no-push --json/);
  assert.match(script, /muse checkout --force main/);
  assert.match(script, /refusing|Refusing/);
  assert.doesNotMatch(script, /(?:^|\n)\s*(?:git|muse) push\s/m);
  assert.match(script, /node src\/muse-bridge-evidence-packet\.mjs/);
});
