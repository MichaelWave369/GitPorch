import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, createRepo, listRepos, readCommits, verifyRepo, validSlug, repoRoot } from '../src/git.mjs';
import { createHttpServer } from '../src/server.mjs';

async function withData(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gitporch-tests-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('rejects unsafe repository names', () => {
  for (const name of ['../secret','..', '.', '-flag', 'project.git', 'name/', 'name\\other', 'a b', '', 'a'.repeat(101), 'a.', 'é', 'x\n', 'CON', 'nul.data', 'LPT1'])
    assert.equal(validSlug(name), false);
  for (const name of ['my-repo', 'test_thing', 'v1.2', 'ABC123', 'a'.repeat(100)]) assert.equal(validSlug(name), true);
});

test('creates real bare repos and reads pushed Git commits', async () => withData(async dir => {
  const created = await createRepo(dir, 'DemoRepo');
  assert.equal(await git(['--git-dir', created.path, 'rev-parse', '--is-bare-repository']), 'true');
  await assert.rejects(createRepo(dir, 'demorepo'), /case-insensitive/);
  assert.equal((await listRepos(dir))[0].latest, null);
  const work = join(dir, 'work');
  await git(['init', '--initial-branch=main', work]);
  await git(['-C', work, '-c', 'user.name=Porch Tester', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'first floorboard']);
  await git(['-C', work, 'push', created.path, 'HEAD:main']);
  const listed = await listRepos(dir);
  assert.deepEqual(listed[0].branches, ['main']);
  assert.equal(listed[0].latest.subject, 'first floorboard');
  const commits = await readCommits(dir, 'DemoRepo');
  assert.equal(commits[0].author, 'Porch Tester');
  assert.equal((await verifyRepo(dir, 'DemoRepo')).status, 'PASS');
  assert.equal(await readCommits(dir, 'nothere'), null);
}));

test('symlinked repo-like entries are not listed', async () => withData(async dir => {
  const created = await createRepo(dir, 'real');
  await symlink(created.path, join(repoRoot(dir), 'other.git'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual((await listRepos(dir)).map(x => x.name), ['real']);
}));

test('local HTTP API exposes only GET-only routes', async () => withData(async dir => {
  await createRepo(dir, 'sample');
  const server = createHttpServer({ dataDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const status = await fetch(origin+'/api/status');
    assert.equal((await status.json()).mode, 'LOCAL_READ_ONLY');
    const repos = await fetch(origin+'/api/repos');
    assert.equal((await repos.json()).repositories.length, 1);
    assert.equal(repos.headers.get('access-control-allow-origin'), null);
    assert.match(repos.headers.get('content-security-policy'), /frame-ancestors/);
    const result = await fetch(origin+'/api/repos',{method:'POST'});
    assert.equal(result.status, 405);
    assert.equal((await result.json()).error, 'READ_ONLY_HTTP');
    assert.equal((await fetch(origin+'/unknown')).status, 404);
    assert.match(await (await fetch(origin)).text(), /Well, git on/);
  } finally { await new Promise(resolve=>server.close(resolve)); }
}));
