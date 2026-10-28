#!/usr/bin/env node
import { backupRepo, inventory, verifyBackup } from './homenode.mjs';
import { restoreBundleDrill } from './homenode-restore-drill.mjs';
import { publicBackupCoverage } from './homenode-backup-coverage.mjs';
import { loadCatalog } from './homenode-bridge.mjs';
import { auditPublicExternalAssetGaps } from './homenode-asset-gaps.mjs';
import { planLocalLfsIntake, intakeLocalLfsObject, verifyLocalLfsObject } from './homenode-lfs-intake.mjs';
import { planGitHubLfsDownload, acquireGitHubLfsObject } from './homenode-lfs-download.mjs';

const help = [
  'GitPorch HomeNode R1-H1 (single-operator, localhost only)',
  '  node src/homenode-cli.mjs inventory',
  '  node src/homenode-cli.mjs backup <repo-name> <absolute-existing-backup-directory>',
  '  node src/homenode-cli.mjs verify <absolute-snapshot-directory>',
  '  node src/homenode-cli.mjs drill <absolute-snapshot-directory> <absolute-existing-restore-parent> --i-confirm-local-restore',
  '  node src/homenode-cli.mjs coverage <absolute-public-catalog-file> <absolute-existing-backup-root>  (offline, no source changes)',
  '  node src/homenode-cli.mjs asset-gaps <absolute-public-catalog-file> <name1,name2,...name5>  (offline, no writes)',
  '  node src/homenode-cli.mjs lfs-plan <catalog> <repo> <branch> <tracked-path> <absolute-payload-file> <absolute-asset-root>',
  '  node src/homenode-cli.mjs lfs-intake <catalog> <repo> <branch> <tracked-path> <absolute-payload-file> <absolute-asset-root> <plan-sha256> --i-approve-lfs-byte-intake',
  '  node src/homenode-cli.mjs lfs-verify <catalog> <repo> <branch> <tracked-path> <absolute-asset-root>  (offline, no writes)',
  '  node src/homenode-cli.mjs lfs-fetch-plan <catalog> <repo> <branch> <tracked-path> <absolute-asset-root>  (offline plan)',
  '  node src/homenode-cli.mjs lfs-fetch <catalog> <repo> <branch> <tracked-path> <absolute-asset-root> <plan-sha256> --i-approve-github-lfs-download',
  'No GitHub network access, overwrite, remote push, automatic sync or system install.',
].join('\n');

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'inventory' && !args.length) return console.log(JSON.stringify(await inventory(), null, 2));
  if (command === 'backup' && args.length === 2) return console.log(JSON.stringify(await backupRepo(args[0], args[1]), null, 2));
  if (command === 'verify' && args.length === 1) return console.log(JSON.stringify(await verifyBackup(args[0]), null, 2));
  if (command === 'lfs-fetch-plan' && args.length === 5)
    return console.log(JSON.stringify(await planGitHubLfsDownload(await loadCatalog(args[0]), ...args.slice(1)), null, 2));
  if (command === 'lfs-fetch' && args.length === 7 && args[6] === '--i-approve-github-lfs-download')
    return console.log(JSON.stringify(await acquireGitHubLfsObject(await loadCatalog(args[0]), ...args.slice(1, 6)), null, 2));
  if (command === 'lfs-plan' && args.length === 6)
    return console.log(JSON.stringify(await planLocalLfsIntake(await loadCatalog(args[0]), ...args.slice(1)), null, 2));
  if (command === 'lfs-intake' && args.length === 8 && args[7] === '--i-approve-lfs-byte-intake')
    return console.log(JSON.stringify(await intakeLocalLfsObject(await loadCatalog(args[0]), ...args.slice(1, 7)), null, 2));
  if (command === 'lfs-verify' && args.length === 5)
    return console.log(JSON.stringify(await verifyLocalLfsObject(await loadCatalog(args[0]), ...args.slice(1)), null, 2));
  if (command === 'asset-gaps' && args.length === 2)
    return console.log(JSON.stringify(await auditPublicExternalAssetGaps(await loadCatalog(args[0]), args[1]), null, 2));
  if (command === 'coverage' && args.length === 2)
    return console.log(JSON.stringify(await publicBackupCoverage(await loadCatalog(args[0]), args[1]), null, 2));
  if (command === 'drill' && args.length === 3 && args[2] === '--i-confirm-local-restore')
    return console.log(JSON.stringify(await restoreBundleDrill(args[0], args[1]), null, 2));
  if (command === 'help' || command === '--help' || !command) return console.log(help);
  throw new Error('Invalid arguments.\n' + help);
}
main().catch(error => { console.error('[HomeNode] ' + error.message); process.exitCode = 1; });
