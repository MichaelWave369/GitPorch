import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupRepo, inventory, verifyBackup } from '../src/homenode.mjs';
import { createRepo, git } from '../src/git.mjs';

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-homenode-test-'));
  try {
    const data = join(root, 'data');
    const copies = join(root, 'copies');
    await mkdir(copies);
    return await fn({ root, data, copies });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('creates a complete snapshot, verifies restore and refuses tampering', async () => fixture(async ({ root, data, copies }) => {
  const repo = await createRepo(data, 'PhiOS');
  const work = join(root, 'work');
  await git(['init', '--initial-branch=main', work]);
  await git(['-C', work, '-c', 'user.name=HomeNode', '-c', 'user.email=local@example.invalid', 'commit', '--allow-empty', '-m', 'snapshot test']);
  await git(['-C', work, 'tag', 'v1']);
  await git(['-C', work, 'push', repo.path, '--all']);
  await git(['-C', work, 'push', repo.path, '--tags']);
  assert.equal((await inventory(data)).count, 1);
  const result = await backupRepo('PhiOS', copies, data);
  assert.equal(result.verified, true);
  assert.equal((await verifyBackup(result.path)).refs, 2);
  const m = JSON.parse(await readFile(join(result.path, 'snapshot.json')));
  assert.deepEqual(m.refs.map(r => r.name), ['refs/heads/main', 'refs/tags/v1']);
  const bundle = join(result.path, 'repository.bundle');
  await writeFile(bundle, 'tampered');
  await assert.rejects(verifyBackup(result.path), /checksum\/size/);
}));

test('refuses empty repo and backup inside repository store; does not leave partial snapshots', async () => fixture(async ({ data, copies }) => {
  await createRepo(data, 'empty');
  await assert.rejects(backupRepo('empty', copies, data), /Empty repository/);
  assert.deepEqual(await readdir(copies), []);
  await assert.rejects(backupRepo('empty', join(data, 'repos'), data), /outside/);
  await assert.rejects(backupRepo('../escape', copies, data), /Invalid repository/);
  await assert.rejects(backupRepo('empty', 'relative', data), /absolute/);
}));
