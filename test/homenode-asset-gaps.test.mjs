import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, lstat, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { git } from '../src/git.mjs';
import { saveCatalog } from '../src/homenode-bridge.mjs';
import { auditPublicExternalAssetGaps } from '../src/homenode-asset-gaps.mjs';

const exec = promisify(execFile);
const OID = 'a'.repeat(64);
const SUB_SHA = 'b'.repeat(40);
const POINTER = 'version https://git-lfs.github.com/spec/v1\n' +
  'oid sha256:' + OID + '\nsize 12345\n';

function catalog(...names) {
  return {
    schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
    visibility: 'PUBLIC_ONLY', count: names.length,
    repositories: names.map(name => ({ name, eligible: true })),
  };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r06-'));
  try { return await fn({ root, data: join(root, 'data'), catalogs: join(root, 'catalogs') }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function initMirror(f, name = 'PhiOS', options = {}) {
  const store = join(f.data, 'repos'), bare = join(store, name + '.git');
  const work = join(f.root, 'work-' + name);
  await mkdir(store, { recursive: true });
  await git(['init', '--bare', '--initial-branch=main', bare]);
  await git(['init', '--initial-branch=main', work]);
  if (options.pointer) {
    await writeFile(join(work, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    await writeFile(join(work, 'big.bin'), options.malformed ? POINTER.replace('oid sha256:', 'oid sha1:') : POINTER);
  }
  if (options.submodule) {
    await writeFile(join(work, '.gitmodules'),
      '[submodule "deps/lib"]\n\tpath = deps/lib\n\turl = https://example.invalid/unavailable.git\n');
  }
  await git(['-C', work, 'add', '.']);
  if (options.malformed) {
    // Git LFS clean filters can silently turn malformed test data into a
    // valid pointer-to-a-pointer. Pin the literal unfiltered blob in the index.
    const literal = await git(['-C', work, 'hash-object', '-w', '--no-filters', 'big.bin']);
    await git(['-C', work, 'update-index', '--add', '--cacheinfo',
      '100644,' + literal + ',big.bin']);
  }
  if (options.submodule) {
    await git(['-C', work, 'update-index', '--add', '--cacheinfo',
      '160000,' + SUB_SHA + ',deps/lib']);
  }
  await git(['-C', work, '-c', 'user.name=AssetFixture',
    '-c', 'user.email=assets@example.invalid',
    'commit', '--allow-empty', '-m', 'initial'], { timeout: 10_000 });
  // Fake LFS pointers are intentionally not backed by payloads. Prevent
  // host-installed Git LFS pre-push hooks from making a network call in CI.
  await git(['-C', work, '-c', 'core.hooksPath=' + join(f.root, 'nonexistent-test-hooks'),
    'push', bare, 'main'], { timeout: 10_000 });
  return { work, bare, store };
}

test('genuine LFS pointer, attributes and submodule gitlink show gaps, not payload claims', async () => fixture(async f => {
  const gitSource = await initMirror(f, 'PhiOS', { pointer: true, submodule: true });
  const before = await readdir(gitSource.store);
  const report = await auditPublicExternalAssetGaps(catalog('PhiOS'), 'PhiOS', f.data);
  assert.equal(report.schema, 'gitporch.public-external-asset-gaps.v0.1');
  assert.equal(report.mode, 'OFFLINE_READ_ONLY_SCOPED_TIP_ASSET_GAP_AUDIT');
  assert.equal(report.findings.scannedWithTipEvidence, 1);
  assert.equal(report.findings.lfsPointerObjectsFound, 1);
  assert.equal(report.findings.submoduleGitlinksFound, 1);
  const row = report.repositories[0];
  assert.equal(row.status, 'TIP_SCAN_EVIDENCE_ONLY');
  assert.equal(row.headCount, 1);
  assert.equal(row.headsInspected, 1);
  assert.equal(row.lfsPointerObjectsFound, 1);
  assert.equal(row.lfsDeclaredBytes, 12345);
  assert.equal(row.lfsAttributesDeclared, true);
  assert.equal(row.submoduleGitlinksFound, 1);
  assert.equal(row.submoduleConfigPresent, true);
  assert.equal(row.releaseAssets, 'UNKNOWN_NOT_PART_OF_GIT');
  assert.equal(row.lfsPayloadBytesPreserved, false);
  assert.equal(row.submoduleTargetReposPreserved, false);
  assert.equal(row.releaseAssetBytesPreserved, false);
  assert.equal(row.historyBeyondInspectedBranchTipsScanned, false);
  for (const claim of Object.values(report.acceptance)) assert.equal(claim, false);
  assert.equal(JSON.stringify(report).includes('example.invalid'), false);
  assert.equal(JSON.stringify(report).includes(f.root), false);
  assert.deepEqual(await readdir(gitSource.store), before);
}));

test('no detected tip-level pointers is not a claim that LFS/releases do not exist', async () => fixture(async f => {
  await initMirror(f, 'GitPorch');
  const result = await auditPublicExternalAssetGaps(catalog('GitPorch'), 'GitPorch', f.data);
  assert.equal(result.repositories[0].status, 'TIP_SCAN_EVIDENCE_ONLY');
  assert.equal(result.repositories[0].lfsPointerObjectsFound, 0);
  assert.equal(result.repositories[0].submoduleGitlinksFound, 0);
  assert.equal(result.repositories[0].releaseAssets, 'UNKNOWN_NOT_PART_OF_GIT');
  assert.equal(result.acceptance.fullHistoryScanned, false);
}));

test('missing local mirrors stay unverified; exact public names and max five enforced', async () => fixture(async f => {
  const c = catalog('PhiOS', 'LENZ', 'BTM', 'GitPorch', 'PhiARK', 'Other');
  const result = await auditPublicExternalAssetGaps(c, 'PhiOS,LENZ', f.data);
  assert.equal(result.findings.limitedOrFailed, 2);
  assert.deepEqual(result.repositories.map(x => x.status),
    ['MIRROR_UNAVAILABLE_UNVERIFIED', 'MIRROR_UNAVAILABLE_UNVERIFIED']);
  await assert.rejects(lstat(f.data), { code: 'ENOENT' });
  const attempts = [
    [{ ...c, visibility: 'PRIVATE' }, 'PhiOS'],
    [{ ...c, owner: 'Other' }, 'PhiOS'],
    [c, 'phios'],
    [c, 'DoesNotExist'],
    [c, 'PhiOS,PhiOS'],
    [c, 'PhiOS,,BTM'],
    [c, 'PhiOS,LENZ,BTM,GitPorch,PhiARK,Other'],
  ];
  for (const [input, names] of attempts) {
    await assert.rejects(auditPublicExternalAssetGaps(input, names, f.data));
  }
}));

test('corrupted LFS pointer does not masquerade as a complete scan', async () => fixture(async f => {
  await initMirror(f, 'PhiOS', { pointer: true, malformed: true });
  const r = await auditPublicExternalAssetGaps(catalog('PhiOS'), 'PhiOS', f.data);
  assert.equal(r.repositories[0].status, 'TIP_SCAN_ERROR_UNVERIFIED');
  assert.equal(r.findings.scannedWithTipEvidence, 0);
  assert.equal(r.acceptance.lfsPayloadVerified, false);
}));

test('eight-distinct-branch-tip limit explicitly marks incomplete, never green', async () => fixture(async f => {
  const source = await initMirror(f);
  for (let i = 1; i <= 9; i++) {
    await git(['-C', source.work, '-c', 'user.name=AssetFixture',
      '-c', 'user.email=assets@example.invalid', 'commit', '--allow-empty', '-m', 'branch tip ' + i]);
    await git(['-C', source.work, 'branch', 'extra-' + i]);
  }
  await git(['-C', source.work, '-c', 'core.hooksPath=' + join(f.root, 'nonexistent-test-hooks'),
    'push', source.bare, '--all']);
  const report = await auditPublicExternalAssetGaps(catalog('PhiOS'), 'PhiOS', f.data);
  const row = report.repositories[0];
  assert.equal(row.headCount, 10);
  assert.equal(row.headsInspected, 8);
  assert.equal(row.status, 'TIP_SCAN_LIMITED_UNVERIFIED');
  assert.equal(row.tipInspectionCompleteWithinLimits, false);
  assert.equal(report.findings.limitedOrFailed, 1);
}));

test('CLI scans only selected existing public mirrors; no network approval flags or writes', async () => fixture(async f => {
  await mkdir(f.catalogs);
  await initMirror(f, 'PhiOS', { pointer: true });
  const c = await saveCatalog(catalog('PhiOS', 'Other'), f.catalogs);
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const env = { ...process.env, GITPORCH_DATA_DIR: f.data };
  const run = await exec(process.execPath, [cli, 'asset-gaps', c.path, 'PhiOS,Other'], { env });
  const report = JSON.parse(run.stdout);
  assert.equal(report.repositories[0].lfsPointerObjectsFound, 1);
  assert.equal(report.repositories[1].status, 'MIRROR_UNAVAILABLE_UNVERIFIED');
  assert.deepEqual((await readdir(join(f.data, 'repos'))), ['PhiOS.git']);
  await assert.rejects(exec(process.execPath, [cli, 'asset-gaps', c.path], { env }),
    e => e.code === 1 && /Invalid arguments/.test(e.stderr));
}));

test('inherited Git config/credential injection cannot make local scan fetch remotely', async () => fixture(async f => {
  await initMirror(f, 'PhiOS', { pointer: true });
  const keys = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_ASKPASS'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'url.https://example.invalid/.insteadOf';
    process.env.GIT_CONFIG_VALUE_0 = f.data;
    process.env.GIT_ASKPASS = 'unexpected-askpass';
    const r = await auditPublicExternalAssetGaps(catalog('PhiOS'), 'PhiOS', f.data);
    assert.equal(r.repositories[0].status, 'TIP_SCAN_EVIDENCE_ONLY');
  } finally {
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}));
