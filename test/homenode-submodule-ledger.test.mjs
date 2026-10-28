import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { git } from '../src/git.mjs';
import { saveCatalog } from '../src/homenode-bridge.mjs';
import { auditSubmoduleRecovery } from '../src/homenode-submodule-ledger.mjs';

const exec = promisify(execFile);
function catalog(...names) {
  return { schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
    visibility: 'PUBLIC_ONLY', count: names.length,
    repositories: names.map(name => ({ name, eligible: true })) };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r10-'));
  try {
    const f = { root, data: join(root, 'data'), catalogs: join(root, 'catalogs') };
    await mkdir(f.catalogs);
    return await fn(f);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function initGit(f, name) {
  const bare = join(f.data, 'repos', name + '.git');
  const work = join(f.root, name + '-work');
  await mkdir(dirname(bare), { recursive: true });
  await git(['init', '--bare', '--initial-branch=main', bare]);
  await git(['init', '--initial-branch=main', work]);
  return { bare, work };
}
async function commitRepo(work, message) {
  await git(['-C', work, '-c', 'user.name=R10', '-c',
    'user.email=r10@example.invalid', 'commit', '--allow-empty', '-m', message]);
  return (await git(['-C', work, 'rev-parse', 'HEAD'])).trim();
}
async function pushGit(f, repo) {
  await git(['-C', repo.work, '-c', 'core.hooksPath=' + join(f.root, 'disabled-test-hooks'),
    'push', repo.bare, 'main']);
}
async function setup(f, options = {}) {
  const parent = await initGit(f, 'PhiOS');
  let targetSha = 'b'.repeat(40);
  let target;
  if (options.target !== false) {
    target = await initGit(f, 'PhiAssets');
    await writeFile(join(target.work, 'README.md'), 'target module source\n');
    await git(['-C', target.work, 'add', 'README.md']);
    targetSha = await commitRepo(target.work, 'target commit');
    await pushGit(f, target);
  }
  const gitlinkSha = options.fakeCommit ? 'b'.repeat(40) : targetSha;
  const path = 'deps/assets';
  let configPath = options.orphan ? 'deps/other' : path;
  let configText = '[submodule "assets"]\n\tpath = ' + configPath +
    '\n\turl = ' + (options.url ?? 'https://github.com/MichaelWave369/PhiAssets.git') + '\n';
  if (options.badConfig) configText = '[include]\npath = ../../secrets\n';
  await writeFile(join(parent.work, 'README.md'), 'parent project\n');
  if (options.config !== false) {
    await writeFile(join(parent.work, '.gitmodules'), configText);
  }
  await git(['-C', parent.work, 'add', '.']);
  if (options.link !== false) {
    const count = options.links ?? 1;
    for (let i = 0; i < count; i++) {
      const name = i ? 'deps/other-' + i : path;
      await git(['-C', parent.work, 'update-index', '--add', '--cacheinfo',
        '160000,' + gitlinkSha + ',' + name]);
    }
  }
  await commitRepo(parent.work, 'parent references external commit');
  await pushGit(f, parent);
  return { parent, target, targetSha, gitlinkSha, c: catalog('PhiOS', 'PhiAssets') };
}
const report = (f, s) => auditSubmoduleRecovery(s.c, 'PhiOS', 'main', f.data);

test('exact target commit reachable in independently fsck-verified public bare mirror', async () => fixture(async f => {
  const s = await setup(f);
  const before = await readdir(join(f.data, 'repos'));
  const r = await report(f, s);
  assert.equal(r.schema, 'gitporch.public-submodule-recovery-ledger.v0.1');
  assert.equal(r.status, 'ALL_DETECTED_TIP_GITLINK_COMMITS_LOCALLY_PRESENT_ONLY');
  assert.equal(r.summary.gitlinks, 1);
  assert.equal(r.summary.locallyVerifiedTargetCommits, 1);
  assert.equal(r.summary.missingOrUnverified, 0);
  assert.equal(r.summary.allDetectedTipTargetsAvailableOnly, true);
  assert.equal(r.submodules[0].path, 'deps/assets');
  assert.equal(r.submodules[0].commit, s.targetSha);
  assert.equal(r.submodules[0].targetRepository, 'PhiAssets');
  assert.equal(r.submodules[0].urlPolicy, 'EXACT_PUBLIC_OWNER_TARGET');
  assert.equal(r.submodules[0].status, 'TARGET_COMMIT_IN_VERIFIED_LOCAL_MIRROR_ONLY');
  assert.match(r.reportSha256, /^[a-f0-9]{64}$/);
  for (const value of Object.values(r.acceptance)) assert.equal(value, false);
  const again = await report(f, s);
  assert.equal(r.reportSha256, again.reportSha256);
  assert.deepEqual(await readdir(join(f.data, 'repos')), before);
  assert.equal(JSON.stringify(r).includes(f.root), false);
  assert.equal(JSON.stringify(r).includes('https://github.com'), false);
}));

test('target repository absent is distinctly unverified, not a successful commit recovery', async () => fixture(async f => {
  const s = await setup(f, { target: false });
  const r = await report(f, s);
  assert.equal(r.status, 'SUBMODULE_RECOVERY_GAPS');
  assert.equal(r.summary.missingOrUnverified, 1);
  assert.equal(r.submodules[0].status, 'TARGET_MIRROR_UNAVAILABLE_UNVERIFIED');
  assert.equal(r.submodules[0].targetMirrorStatus, 'NOT_LOCAL');
}));

test('target is local and healthy but exact gitlink commit missing', async () => fixture(async f => {
  const s = await setup(f, { fakeCommit: true });
  const r = await report(f, s);
  assert.equal(r.summary.locallyVerifiedTargetCommits, 0);
  assert.equal(r.submodules[0].status, 'TARGET_COMMIT_CHECK_FAILED_UNVERIFIED');
  assert.equal(r.status, 'SUBMODULE_RECOVERY_GAPS');
}));

test('unapproved owner, SSH and non-catalog public targets are not fetched or named as verified', async () => {
  for (const url of ['git@github.com:MichaelWave369/PhiAssets.git',
    'file:///root/notallowed',
    'https://evil.invalid/x',
    'https://github.com/AnotherOwner/PhiAssets.git']) {
    await fixture(async f => {
      const s = await setup(f, { url });
      const r = await report(f, s);
      assert.equal(r.submodules[0].status, 'TARGET_SOURCE_NOT_APPROVED_UNVERIFIED');
      assert.equal(r.submodules[0].targetRepository, undefined);
      assert.equal(JSON.stringify(r).includes(url), false);
      assert.equal(r.summary.locallyVerifiedTargetCommits, 0);
    });
  }
  await fixture(async f => {
    const s = await setup(f);
    s.c = catalog('PhiOS');
    const r = await report(f, s);
    assert.equal(r.submodules[0].urlPolicy, 'TARGET_NOT_IN_PUBLIC_CATALOG');
    assert.equal(r.submodules[0].status, 'TARGET_SOURCE_NOT_APPROVED_UNVERIFIED');
  });
});

test('missing config, unrelated declaration and zero gitlinks remain unverified', async () => {
  await fixture(async f => {
    const s = await setup(f, { config: false });
    const r = await report(f, s);
    assert.equal(r.submodules[0].status, 'GITLINK_WITHOUT_MATCHING_CONFIG_UNVERIFIED');
    assert.equal(r.summary.declaredSubmodules, 0);
  });
  await fixture(async f => {
    const s = await setup(f, { orphan: true });
    const r = await report(f, s);
    assert.equal(r.summary.configPathsWithoutGitlink, 1);
    assert.equal(r.summary.allDetectedTipTargetsAvailableOnly, false);
  });
  await fixture(async f => {
    const s = await setup(f, { link: false });
    const r = await report(f, s);
    assert.equal(r.status, 'NO_GITLINKS_AT_SELECTED_TIP_UNVERIFIED');
    assert.equal(r.summary.gitlinks, 0);
    assert.equal(r.summary.configPathsWithoutGitlink, 1);
  });
});

test('reject unsupported .gitmodules syntax rather than silently skipping declarations', async () => fixture(async f => {
  const s = await setup(f, { badConfig: true });
  await assert.rejects(report(f, s), /Unsupported .gitmodules section/);
}));

test('24-gitlink scope cap refuses partial ledger', async () => fixture(async f => {
  const s = await setup(f, { links: 25 });
  await assert.rejects(report(f, s), /More than 24 Gitlinks/);
}));

test('foreign/private/malformed catalogs, unsafe branch and unverified parent fail closed', async () => fixture(async f => {
  const s = await setup(f);
  for (const c of [
    { ...s.c, visibility: 'PRIVATE' }, { ...s.c, owner: 'Unknown' },
    { ...s.c, count: 999 }, catalog('PhiOS', 'phios'),
  ]) await assert.rejects(auditSubmoduleRecovery(c, 'PhiOS', 'main', f.data));
  await assert.rejects(auditSubmoduleRecovery(s.c, 'PhiOS', '../main', f.data));
  await assert.rejects(auditSubmoduleRecovery(s.c, 'NotPublic', 'main', f.data));
  await rm(s.parent.bare, { recursive: true, force: true });
  await assert.rejects(report(f, s), /not locally verified/);
}));

test('CLI reads exact public catalog with no online approval or filesystem writes', async () => fixture(async f => {
  const s = await setup(f);
  const saved = await saveCatalog(s.c, f.catalogs);
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const env = { ...process.env, GITPORCH_DATA_DIR: f.data };
  const before = await readdir(join(f.data, 'repos'));
  const stdout = await exec(process.execPath, [cli, 'submodule-ledger',
    saved.path, 'PhiOS', 'main'], { env });
  const ledger = JSON.parse(stdout.stdout);
  assert.equal(ledger.summary.locallyVerifiedTargetCommits, 1);
  assert.deepEqual(await readdir(join(f.data, 'repos')), before);
  await assert.rejects(exec(process.execPath, [cli, 'submodule-ledger',
    saved.path, 'PhiOS'], { env }),
    e => e.code === 1 && /Invalid arguments/.test(e.stderr));
}));
