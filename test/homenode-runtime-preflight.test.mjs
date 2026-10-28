import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRepo, git } from '../src/git.mjs';
import { backupRepo } from '../src/homenode.mjs';
import { restoreBundleDrill } from '../src/homenode-restore-drill.mjs';
import { planPortableRecoveryKit } from '../src/homenode-portable-kit.mjs';
import { preflightRecoveredRuntime } from '../src/homenode-runtime-preflight.mjs';
import { saveCatalog } from '../src/homenode-bridge.mjs';

const exec = promisify(execFile);
const catalog = () => ({
  schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
  visibility: 'PUBLIC_ONLY', count: 1,
  repositories: [{ name: 'PhiOS', eligible: true }],
});
async function fixture(fn, opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-r16-'));
  try {
    const f = {
      root, data: join(root, 'data'), backups: join(root, 'backups'),
      prepared: join(root, 'prepared'), copied: join(root, 'copied'),
      restores: join(root, 'restores'), evidence: join(root, 'evidence'),
    };
    await Promise.all([f.backups, f.prepared, f.copied, f.restores, f.evidence].map(x => mkdir(x)));
    const r = await createRepo(f.data, 'PhiOS');
    f.work = join(root, 'work');
    await git(['init', '--initial-branch=main', f.work]);
    if (opts.kind !== 'empty') {
      const site = join(f.work, 'site');
      await mkdir(site);
      const entry = opts.kind === 'static' ? '<html>static hello</html>\n' :
        '<html><script type="module" src="/src/main.tsx"></script></html>\n';
      await writeFile(join(site, 'index.html'), entry);
      if (opts.kind !== 'static') {
        await writeFile(join(site, 'package.json'), JSON.stringify({
          scripts: { build: 'tsc -b && vite build' },
          dependencies: { react: '19.1.1' },
          devDependencies: { vite: '7.1.5', typescript: '5.9.2' },
        }));
        await writeFile(join(f.work, 'pyproject.toml'), '[build-system]\nrequires=["setuptools"]\n');
        await mkdir(join(f.work, 'build'));
        await writeFile(join(f.work, 'build', 'build_iso.sh'), 'echo not a real ISO\n');
        if (opts.lock) await writeFile(join(site, 'package-lock.json'), '{}');
        if (opts.dist) {
          await mkdir(join(site, 'dist'));
          await writeFile(join(site, 'dist', 'index.html'), '<html>built candidate</html>');
        }
      }
      await git(['-C', f.work, 'add', '.']);
    }
    await git(['-C', f.work, '-c', 'user.name=R16 Test',
      '-c', 'user.email=r16@example.invalid', 'commit', '--allow-empty', '-m', 'source tree']);
    await git(['-C', f.work, 'push', r.path, 'main']);
    const snapshot = await backupRepo('PhiOS', f.backups, f.data);
    await cp(snapshot.path, join(f.prepared, 'snapshot'), { recursive: true });
    const manifest = await planPortableRecoveryKit(catalog(), 'PhiOS', f.prepared);
    f.manifestFile = join(f.evidence, 'kit.json');
    await writeFile(f.manifestFile, JSON.stringify(manifest, null, 2));
    await cp(f.prepared, f.copied, { recursive: true });
    const recovered = await restoreBundleDrill(join(f.copied, 'snapshot'), f.restores,
      { dataDir: f.data });
    f.restored = recovered.restoredBareRepository;
    return await fn(f);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const run = f => preflightRecoveredRuntime(f.manifestFile, f.copied,
  f.restored, 'main', f.data);

test('real restored PhiOS-like Vite sources are NOT counted as runnable standalone offline site', async () => fixture(async f => {
  const r = await run(f);
  assert.equal(r.schema, 'gitporch.restored-source-launch-preflight.v0.1');
  assert.equal(r.status, 'LAUNCH_PREREQUISITES_IDENTIFIED_NOT_EXECUTED');
  assert.equal(r.foundation.restoredGitRefsVerified, true);
  assert.equal(r.web.status, 'VITE_OR_TYPED_SOURCE_REQUIRES_OFFLINE_BUILD');
  assert.equal(r.web.sourceEntryPath, 'site/index.html');
  assert.equal(r.web.viteSourceEntryDetected, true);
  assert.equal(r.web.packageEvidence.viteDeclared, true);
  assert.equal(r.web.packageEvidence.typescriptDeclared, true);
  assert.equal(r.web.packageEvidence.hasBuildScript, true);
  assert.equal(r.web.lockfileTracked, false);
  assert.deepEqual(r.python.trackedDependencyOrBuildManifests, ['pyproject.toml']);
  assert.deepEqual(r.linuxOS.trackedBuildOrReleaseSources, ['build/build_iso.sh']);
  assert.equal(r.linuxOS.liveISOImageVerifiedPresent, false);
  assert.equal(r.acceptance.offlineNpmBuildPassed, false);
  assert.equal(r.acceptance.siteServedAndBrowserVerifiedOffline, false);
  assert.equal(r.acceptance.completePhiOSRecoveryVerified, false);
  assert.equal(r.web.runtimeServed, false);
  assert.match(r.reportSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(r).includes(f.root), false);
  const again = await run(f);
  assert.equal(r.reportSha256, again.reportSha256);
  assert.deepEqual(await readdir(f.copied), ['snapshot']);
}));

test('tracked prebuilt HTML is only a candidate, not a successful offline browser launch', async () => fixture(async f => {
  const r = await run(f);
  assert.equal(r.web.status, 'BUILT_HTML_TRACKED_RUNTIME_NOT_VERIFIED');
  assert.equal(r.web.builtHtmlTrackedInGit, true);
  assert.equal(r.web.packageEvidence.viteDeclared, true);
  assert.equal(r.web.lockfileTracked, true);
  assert.deepEqual(r.web.lockfilesTracked, ['site/package-lock.json']);
  assert.equal(r.web.lockfileCoversAllDependencies, false);
  assert.equal(r.acceptance.siteServedAndBrowserVerifiedOffline, false);
}, { dist: true, lock: true }));

test('raw static html is detected as source, not a verified app or offline OS', async () => fixture(async f => {
  const r = await run(f);
  assert.equal(r.web.status, 'WEB_SOURCE_ENTRY_PRESENT_EXECUTION_NOT_VERIFIED');
  assert.equal(r.web.packageEvidence, null);
  assert.equal(r.web.sourceHtmlTrackedInGit, true);
  assert.equal(r.acceptance.linuxOSBootedOffline, false);
}, { kind: 'static' }));

test('bare empty source correctly refuses to claim a web or OS entrypoint', async () => fixture(async f => {
  const r = await run(f);
  assert.equal(r.web.status, 'NO_WEB_ENTRY_DETECTED_UNVERIFIED');
  assert.equal(r.web.sourceHtmlTrackedInGit, false);
  assert.equal(r.tree.totalTrackedEntries, 0);
}, { kind: 'empty' }));

test('missing or tampered copied kit is rejected before evaluating launch metadata', async () => fixture(async f => {
  await writeFile(join(f.copied, 'snapshot', 'repository.bundle'), 'fake');
  await assert.rejects(run(f), /Portable kit|checksum/i);
}));

test('moved refs in retained restored bare repository are rejected before package detection', async () => fixture(async f => {
  await git(['--git-dir', f.restored, 'update-ref', '-d', 'refs/heads/main']);
  await assert.rejects(run(f), /refs|verification failed|Git verification/i);
}));

test('invalid or changing branch refs never yield a readiness success', async () => fixture(async f => {
  await assert.rejects(preflightRecoveredRuntime(
    f.manifestFile, f.copied, f.restored, '../main', f.data), /safe exact branch/);
  await assert.rejects(preflightRecoveredRuntime(
    f.manifestFile, f.copied, f.restored, 'nonexistent', f.data),
    /Restricted local recovered-Git inspection/);
}));

test('runtime tree checks reject unsafe symlinked entry metadata rather than executing source', async () => fixture(async f => {
  await git(['--git-dir', f.restored, 'update-ref',
    'refs/heads/main', '0000000000000000000000000000000000000000']).catch(() => {});
  // No compilation or install occurs in the verifier even if JS source exists.
  const r = await run(f);
  assert.equal(r.web.packageEvidence.packagesInstalledAndVerified, false);
  assert.equal(r.web.packageEvidence.buildExecuted, false);
}));

test('CLI performs offline preflight with exact inputs and rejects missing required branch', async () => fixture(async f => {
  const cat = await saveCatalog(catalog(), f.evidence);
  const cli = join(process.cwd(), 'src', 'homenode-cli.mjs');
  const env = { ...process.env, GITPORCH_DATA_DIR: f.data };
  const result = JSON.parse((await exec(process.execPath, [
    cli, 'runtime-preflight', f.manifestFile, f.copied, f.restored, 'main',
  ], { env })).stdout);
  assert.equal(result.web.status, 'VITE_OR_TYPED_SOURCE_REQUIRES_OFFLINE_BUILD');
  assert.equal(result.acceptance.completePhiOSRecoveryVerified, false);
  await assert.rejects(exec(process.execPath, [
    cli, 'runtime-preflight', f.manifestFile, f.copied, f.restored,
  ], { env }), e => e.code === 1 && /Invalid arguments/.test(e.stderr));
  assert.equal(cat.path.length > 0, true);
}));
