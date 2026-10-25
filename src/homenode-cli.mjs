#!/usr/bin/env node
import { backupRepo, inventory, verifyBackup } from './homenode.mjs';

const help = [
  'GitPorch HomeNode R1-H1 (single-operator, localhost only)',
  '  node src/homenode-cli.mjs inventory',
  '  node src/homenode-cli.mjs backup <repo-name> <absolute-existing-backup-directory>',
  '  node src/homenode-cli.mjs verify <absolute-snapshot-directory>',
  'No GitHub network access, overwrite, remote push, automatic sync or system install.',
].join('\n');

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'inventory' && !args.length) return console.log(JSON.stringify(await inventory(), null, 2));
  if (command === 'backup' && args.length === 2) return console.log(JSON.stringify(await backupRepo(args[0], args[1]), null, 2));
  if (command === 'verify' && args.length === 1) return console.log(JSON.stringify(await verifyBackup(args[0]), null, 2));
  if (command === 'help' || command === '--help' || !command) return console.log(help);
  throw new Error('Invalid arguments.\n' + help);
}
main().catch(error => { console.error('[HomeNode] ' + error.message); process.exitCode = 1; });
