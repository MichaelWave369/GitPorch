import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createRepo, git } from '../src/git.mjs';
import { backupRepo } from '../src/homenode.mjs';
import { restoreBundleDrill } from '../src/homenode-restore-drill.mjs';
import { planPortableRecoveryKit } from '../src/homenode-portable-kit.mjs';
import { composeOfflineFieldEvidence } from '../src/homenode-field-evidence.mjs';

const exec = promisify(execFile);
const catalog = () => ({
  schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
  visibility: 'PUBLIC_ONLY', count: 1,
  repositories: [{ name: 'PhiOS', eligible: true }],
});
const SHA = v => createHash('sha256').update(v).digest('hex');
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r15-'));
  try {
    const f = { root, data: join(root, 'data'), backups: join(root, 'snapshots'),
      kit: join(root, 'prepared-kit'), copied: join(root, 'copied-kit'),
      restoreParent: join(root, 'disposable-restore'), evidence: join(root, 'evidence') };
    await Promise.all([f.backups, f.kit, f.copied, f.restoreParent, f.evidence].map(x => mkdir(x)));
    const repo = await createRepo(f.data, 'PhiOS');
    const work = join(root, 'work');
    await git(['init', '--initial-branch=main', work]);
    await git(['-C', work, '-c', 'user.name=Field Test',
      '-c', 'user.email=field@example.invalid',
      'commit', '--allow-empty', '-m', 'Field fixture root']);
    await git(['-C', work, 'push', repo.path, 'main']);
    const snapshot = await backupRepo('PhiOS', f.backups, f.data);
    await cp(snapshot.path, join(f.kit, 'snapshot'), { recursive: true });
    const ref = await planPortableRecoveryKit(catalog(), 'PhiOS', f.kit);
    f.reference = join(f.evidence, 'portable.json');
    await writeFile(f.reference, JSON.stringify(ref, null, 2) + '\n');
    await cp(f.kit, f.copied, { recursive: true });
    f.restore = await restoreBundleDrill(join(f.copied, 'snapshot'), f.restoreParent, { dataDir: f.data });
    return await fn(f);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const report = (f, observationFile = 'none') =>
  composeOfflineFieldEvidence(f.reference, f.copied,
    f.restore.restoredBareRepository, observationFile, f.data);
const observations = (extra = {}) => ({
  schema: 'gitporch.operator-field-observations.v0.1',
  observedAt: '2026-10-28T15:30:00-07:00',
  mediaLabel: 'Test removable SSD',
  separatePhysicalDeviceObserved: true,
  wanDisconnectedObserved: true,
  componentName: 'PhiOS local landing page',
  componentLaunchOutcome: 'PASS',
  operatorNotes: 'Operator states selected component launched while disconnected.',
  ...extra,
});

test('real copied kit and retained restored bare repository both verify against exact snapshot', async () => fixture(async f => {
  const first = await report(f);
  assert.equal(first.schema, 'gitporch.offline-field-evidence.v0.1');
  assert.equal(first.status, 'COPIED_KIT_AND_RESTORED_GIT_TECHNICALLY_RECHECKED_ONLY');
  assert.equal(first.kit.bundleSha256, f.restore.bundleSha256);
  assert.equal(first.restoredGit.status, 'RESTORED_BARE_GIT_FSCK_AND_REFS_MATCH_COPIED_KIT');
  assert.equal(first.restoredGit.restoredRefs, 1);
  assert.equal(first.restoredGit.remoteOriginAbsent, true);
  assert.equal(first.acceptance.copiedKitByteEqualityVerified, true);
  assert.equal(first.acceptance.restoredBareGitFsckAndRefsVerified, true);
  assert.equal(first.acceptance.independentPhysicalMediaProvenByTool, false);
  assert.equal(first.acceptance.wanDisconnectionMeasuredByTool, false);
  assert.equal(first.acceptance.selectedComponentExecutionMeasuredByTool, false);
  assert.equal(first.acceptance.fullPhiOSOfflineBootVerified, false);
  assert.equal(first.acceptance.completeOfflineRecoveryVerified, false);
  assert.equal(first.operator.status, 'NO_OPERATOR_OBSERVATIONS_SUPPLIED');
  assert.match(first.reportSha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(first).includes(f.root), false);
  const repeat = await report(f);
  assert.equal(repeat.reportSha256, first.reportSha256);
}));

test('even enthusiastic operator-reported success NEVER promotes WAN/media/launch or boot to verified', async () => fixture(async f => {
  const path = join(f.evidence, 'observations.json');
  await writeFile(path, JSON.stringify(observations(), null, 2));
  const r = await report(f, path);
  assert.equal(r.operator.status, 'UNSIGNED_OPERATOR_OBSERVATIONS_RECORDED_NOT_MEASURED');
  assert.equal(r.operator.observations.separatePhysicalDeviceClaim,
    'OPERATOR_REPORTED_TRUE_NOT_INDEPENDENTLY_VERIFIED');
  assert.equal(r.operator.observations.detachedWanClaim,
    'OPERATOR_REPORTED_TRUE_NOT_INDEPENDENTLY_VERIFIED');
  assert.equal(r.operator.observations.launchClaim,
    'OPERATOR_REPORTED_PASS_NOT_INDEPENDENTLY_VERIFIED');
  assert.equal(r.acceptance.independentPhysicalMediaProvenByTool, false);
  assert.equal(r.acceptance.wanDisconnectionMeasuredByTool, false);
  assert.equal(r.acceptance.selectedComponentExecutionMeasuredByTool, false);
  assert.equal(r.acceptance.completeOfflineRecoveryVerified, false);
  assert.equal(r.status, 'COPIED_KIT_AND_RESTORED_GIT_TECHNICALLY_RECHECKED_ONLY');
  assert.equal((await readdir(f.evidence)).length, 2);
}));

test('declared launch FAIL/NOT_RUN remains explicit and never passes technical launch', async () => {
  for (const outcome of ['FAIL', 'NOT_RUN']) {
    await fixture(async f => {
      const path = join(f.evidence, 'observation.json');
      await writeFile(path, JSON.stringify(observations({
        componentLaunchOutcome: outcome,
        separatePhysicalDeviceObserved: false, wanDisconnectedObserved: false,
      })));
      const r = await report(f, path);
      assert.equal(r.operator.observations.launchClaim,
        outcome === 'FAIL' ? 'OPERATOR_REPORTED_FAILURE' : 'NOT_RUN');
      assert.equal(r.operator.observations.detachedWanClaim, 'NOT_REPORTED_OR_NEGATIVE');
      assert.equal(r.acceptance.completeOfflineRecoveryVerified, false);
    });
  }
});

test('restored repo with missing refs or attached remote is refused, even after valid kit recheck', async () => {
  await fixture(async f => {
    await git(['--git-dir', f.restore.restoredBareRepository,
      'update-ref', '-d', 'refs/heads/main']);
    await assert.rejects(report(f), /refs|verification failed/);
  });
  await fixture(async f => {
    await git(['--git-dir', f.restore.restoredBareRepository,
      'config', 'remote.origin.url', 'https://invalid.example.test/outside']);
    await assert.rejects(report(f), /remote or unsafe object storage/);
  });
});

test('missing and corrupted copied kit assets make composition fail, never produce partial signed receipt', async () => fixture(async f => {
  await writeFile(join(f.copied, 'snapshot', 'repository.bundle'), 'broken');
  await assert.rejects(report(f), /Portable kit|verification|checksum/i);
}));

test('unknown, extra, malformed, or oversized operator observations are rejected without executing anything', async () => fixture(async f => {
  const p = join(f.evidence, 'operator.json');
  for (const data of [
    { ...observations(), schema: 'other.schema' },
    { ...observations(), extra: 'fake-attested' },
    { ...observations(), wanDisconnectedObserved: 'yes' },
    { ...observations(), componentLaunchOutcome: 'VERIFIED' },
    { ...observations(), operatorNotes: 'x'.repeat(9000) },
    { ...observations(), mediaLabel: '../secret' + '\n' },
  ]) {
    await writeFile(p, JSON.stringify(data));
    await assert.rejects(report(f, p), /Malformed|invalid or unsafe/);
  }
}));

test('restored repository cannot be inside kit or inside live GitPorch data', async () => fixture(async f => {
  await assert.rejects(composeOfflineFieldEvidence(
    f.reference, f.copied, f.copied, 'none', f.data), /separate from the kit/);
  await assert.rejects(composeOfflineFieldEvidence(
    f.reference, f.copied, f.restore.restoredBareRepository, 'none', f.restoreParent),
    /separate from the kit and live GitPorch data/);
}));

test('CLI operator smoke check verifies real Git and refuses missing parameters', async () => fixture(async f => {
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const env = { ...process.env, GITPORCH_DATA_DIR: f.data };
  const checked = JSON.parse((await exec(process.execPath, [
    cli, 'field-evidence', f.reference, f.copied,
    f.restore.restoredBareRepository, 'none',
  ], { env })).stdout);
  assert.equal(checked.restoredGit.gitFsckPassed, true);
  assert.equal(checked.operator.status, 'NO_OPERATOR_OBSERVATIONS_SUPPLIED');
  await assert.rejects(exec(process.execPath, [
    cli, 'field-evidence', f.reference, f.copied,
    f.restore.restoredBareRepository,
  ], { env }), error => error.code === 1 && /Invalid arguments/.test(error.stderr));
}));
