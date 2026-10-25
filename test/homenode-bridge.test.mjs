import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { discoverPublic, importMirrorFromSource, loadCatalog, planImport, saveCatalog } from '../src/homenode-bridge.mjs';
import { backupRepo } from '../src/homenode.mjs';

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-bridge-'));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const example = (name) => ({ name, owner: { login: 'MichaelWave369' }, private: false,
  archived: false, fork: false, size: 1, default_branch: 'main' });

test('public discovery paginates completely, marks unsupported names, and plans locally', async () => fixture(async root => {
  const page1 = Array.from({ length: 100 }, (_, i) => example('repo' + i));
  const page2 = [example('CON')];
  const urls = [];
  const fetcher = async url => { urls.push(url); return { ok: true, json: async () => urls.length === 1 ? page1 : page2 }; };
  const catalog = await discoverPublic('MichaelWave369', fetcher);
  assert.equal(catalog.count, 101);
  assert.equal(catalog.repositories[100].eligible, false);
  assert.match(urls[1], /page=2/);
  const location = await saveCatalog(catalog, root);
  assert.equal(location.eligible, 100);
  const saved = await loadCatalog(location.path);
  assert.equal((await planImport(saved, join(root, 'data'))).ready, 100);
  await assert.rejects(discoverPublic('../evil'), /Invalid GitHub username/);
  await assert.rejects(discoverPublic('MichaelWave369', async () => ({ ok: false, status: 403 })), /403/);
  await writeFile(location.path, JSON.stringify({ ...catalog, count: 999 }));
  await assert.rejects(loadCatalog(location.path), /Invalid public catalog/);
}));

test('mirror import is non-overwriting, preserves refs, and creates a restorable GitPorch repo', async () => fixture(async root => {
  const work = join(root, 'work');
  const data = join(root, 'data');
  const backups = join(root, 'backups');
  await mkdir(backups);
  await git(['init', '--initial-branch=main', work]);
  await git(['-C', work, '-c', 'user.name=Bridge Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'original']);
  await git(['-C', work, 'tag', 'v1']);
  const result = await importMirrorFromSource('Original', work, data);
  assert.equal(result.status, 'IMPORTED_VERIFIED');
  assert.equal(result.refs, 2);
  assert.equal((await planImport({ owner: 'MichaelWave369', repositories: [{ name: 'Original', eligible: true }] }, data)).repositories[0].status, 'ALREADY_LOCAL');
  await assert.rejects(importMirrorFromSource('Original', work, data), /already exists/);
  assert.equal((await backupRepo('Original', backups, data)).verified, true);
  await assert.rejects(git(['--git-dir', result.localPath, 'config', '--get', 'remote.origin.url']), /./);
  assert.deepEqual((await readdir(join(data, 'repos'))).filter(x => x.startsWith('.incoming-')), []);
}));

test('failed clone never creates a destination repo and releases import lock', async () => fixture(async root => {
  const data = join(root, 'data');
  await assert.rejects(importMirrorFromSource('Absent', join(root, 'does-not-exist'), data));
  assert.deepEqual(await readdir(join(data, 'repos')), []);
}));


test('R1-H2 catalogs re-evaluate stale eligibility under expanded Windows-safe naming', async () => fixture(async root => {
  const longName = 'LongProject' + 'A'.repeat(52);
  const oldCatalog = {
    schema: 'gitporch.public-catalog.v1', owner: 'MichaelWave369',
    visibility: 'PUBLIC_ONLY', count: 2, repositories: [
      { name: longName, eligible: false, reason: 'Old 48-character limit' },
      { name: 'CON', eligible: true, reason: null },
    ],
  };
  const file = join(root, 'old-catalog.json');
  await writeFile(file, JSON.stringify(oldCatalog));
  const loaded = await loadCatalog(file);
  assert.equal(loaded.repositories[0].eligible, true);
  assert.equal(loaded.repositories[1].eligible, false);
  const plan = await planImport(loaded, join(root, 'data'));
  assert.equal(plan.ready, 1);
  assert.equal(plan.repositories[1].status, 'UNSUPPORTED_NAME');
}));
