import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepo, git, listRepos, repoRoot, validSlug } from '../src/git.mjs';
import { assertLocalRepositoryCapacity, MAX_LOCAL_REPOSITORIES, MAX_REPOSITORY_NAME_LENGTH } from '../src/repository-policy.mjs';

async function withData(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gitporch-capacity-'));
  try { return await fn(join(root, 'data'), root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('supports 100-character repo names without unsafe Windows device names', () => {
  assert.equal(MAX_REPOSITORY_NAME_LENGTH, 100);
  assert.equal(validSlug('A'.repeat(100)), true);
  assert.equal(validSlug('A'.repeat(101)), false);
  for (const value of ['CON', 'nul', 'COM1', 'LPT9.txt', 'aux.xyz', 'prn', 'com1.anything'])
    assert.equal(validSlug(value), false, value);
  assert.equal(validSlug('CONSOLE'), true);
  assert.equal(validSlug('COM10'), true);
  assert.equal(validSlug('project-long-name-' + 'a'.repeat(65)), true);
  assert.doesNotThrow(() => assertLocalRepositoryCapacity(MAX_LOCAL_REPOSITORIES));
  assert.throws(() => assertLocalRepositoryCapacity(MAX_LOCAL_REPOSITORIES + 1), /capacity exceeded/);
});

test('more than 200 bare repositories are visible, not truncated, using bounded git workers', async () => withData(async data => {
  const source = await createRepo(data, 'seed');
  const root = repoRoot(data);
  for (let i = 0; i < 205; i++) {
    await cp(source.path, join(root, 'R' + String(i).padStart(4, '0') + '.git'), { recursive: true });
  }
  const repos = await listRepos(data);
  assert.equal(repos.length, 206);
  assert.ok(repos.some(repo => repo.name === 'R0204'));
}));

test('capacity overflow and unsupported on-disk names fail without a partial inventory', async () => withData(async data => {
  const root = repoRoot(data);
  await mkdir(root, { recursive: true });
  // Exactly MAX+1 empty folder fixtures; inventory must refuse BEFORE git subprocesses run.
  for (let i = 0; i <= MAX_LOCAL_REPOSITORIES; i++) {
    await mkdir(join(root, 'p' + i + '.git'));
  }
  await assert.rejects(listRepos(data), /capacity exceeded/);
  await assert.rejects(createRepo(data, 'newone'), /capacity reached/);
}));

test('malformed .git directory cannot disappear silently', async () => withData(async data => {
  const root = repoRoot(data);
  await mkdir(join(root, 'CON.git'), { recursive: true });
  await assert.rejects(listRepos(data), /Unsupported local Git repository directory/);
}));
