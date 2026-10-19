#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { getDataDir, repoRoot, createRepo, listRepos, verifyRepo, getGitPort } from './git.mjs';
import { startHttp } from './server.mjs';

const help = `THE GITPORCH · local-first Git hosting · R0

Commands:
  node src/cli.mjs init <name>  Create a bare local repository
  node src/cli.mjs list         List repositories and local push paths
  node src/cli.mjs verify <name> Git object integrity check
  node src/cli.mjs serve        Start read-only Git transport + dashboard

Requirements: Node.js 20+ and Git installed locally.
Environment: GITPORCH_DATA_DIR, GITPORCH_HTTP_PORT (3690), GITPORCH_GIT_PORT (9418).
Only 127.0.0.1 binds. Nothing is exposed publicly. No web API can push code.
`;

async function serve(dataDir) {
  await mkdir(repoRoot(dataDir), { recursive: true });
  let daemonState = 'starting';
  const gitPort = getGitPort();
  const args = ['daemon', '--reuseaddr', `--base-path=${repoRoot(dataDir)}`, '--export-all',
    '--listen=127.0.0.1', `--port=${gitPort}`, '--enable=upload-pack',
    '--disable=receive-pack', '--disable=upload-archive', '--log-destination=stderr', repoRoot(dataDir)];
  const daemon = spawn('git', args, { stdio: ['ignore','ignore','pipe'], windowsHide: true });
  daemon.stderr.on('data', buffer => console.error('[Git daemon]', String(buffer).trim()));
  daemon.on('error', e => { daemonState = 'failed'; console.error('[Git daemon] Unable to start:', e.message); });
  daemon.on('exit', (code) => { daemonState = 'stopped'; console.warn(`[Git daemon] Exited with code ${code}`); });
  daemonState = 'starting';
  const server = await startHttp({ dataDir, daemonState: () => daemonState });
  daemonState = daemon.exitCode === null && !daemon.killed ? 'starting_or_available' : 'stopped';
  console.log(`[GitPorch] Read-only clone transport: git://127.0.0.1:${gitPort}/<name>.git`);
  console.log('[GitPorch] To push, use a local filesystem Git remote. No network pushes in R0.');
  const stop = () => { daemon.kill(); server.close(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function main() {
  const [command = 'help', name] = process.argv.slice(2);
  const dataDir = getDataDir();
  switch (command) {
    case 'init': {
      if (!name) throw new Error('Missing repository name. Use init <name>');
      const out = await createRepo(dataDir, name);
      console.log(`Created ${out.name}.git\nLocal push path: ${out.path}`);
      break;
    }
    case 'list': {
      const repos = await listRepos(dataDir);
      if (!repos.length) console.log('No repositories yet. Run: node src/cli.mjs init my-first-repo');
      for (const r of repos) console.log(`${r.name}\t${r.branches.join(', ') || '(empty)'}\t${r.localPushPath}`);
      break;
    }
    case 'verify': {
      if (!name) throw new Error('Missing repository name. Use verify <name>');
      console.log(JSON.stringify(await verifyRepo(dataDir, name), null, 2));
      break;
    }
    case 'serve': await serve(dataDir); break;
    case 'help': case '--help': case '-h': console.log(help); break;
    default: throw new Error(`Unknown command: ${command}.\n${help}`);
  }
}
main().catch(e => { console.error(`[GitPorch] ${e.message}`); process.exitCode = 1; });
