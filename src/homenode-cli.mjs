#!/usr/bin/env node
import { backupRepo, inventory, verifyBackup } from './homenode.mjs';
import { restoreBundleDrill } from './homenode-restore-drill.mjs';
import { publicBackupCoverage } from './homenode-backup-coverage.mjs';
import { loadCatalog } from './homenode-bridge.mjs';
import { auditPublicExternalAssetGaps } from './homenode-asset-gaps.mjs';
import { planLocalLfsIntake, intakeLocalLfsObject, verifyLocalLfsObject } from './homenode-lfs-intake.mjs';
import { planGitHubLfsDownload, acquireGitHubLfsObject } from './homenode-lfs-download.mjs';
import { auditLfsRecoveryManifest } from './homenode-lfs-manifest.mjs';
import { auditSubmoduleRecovery } from './homenode-submodule-ledger.mjs';
import { inventoryPublicReleaseAssets } from './homenode-release-inventory.mjs';
import { planReleaseAssetArchive, acquireReleaseAsset, verifyReleaseAssetArchive } from './homenode-release-archive.mjs';
import { offlineRecoveryReadiness } from './homenode-offline-readiness.mjs';
import { planPortableRecoveryKit, verifyPortableRecoveryKit } from './homenode-portable-kit.mjs';
import { composeOfflineFieldEvidence } from './homenode-field-evidence.mjs';
import { preflightRecoveredRuntime } from './homenode-runtime-preflight.mjs';
import { scanOfflineFrontend, verifyOfflineFrontend, startOfflineFrontendServer } from './homenode-frontend-offline.mjs';

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
  '  node src/homenode-cli.mjs lfs-manifest <catalog> <repo> <branch> <absolute-asset-root>  (offline, read-only)',
  '  node src/homenode-cli.mjs submodule-ledger <catalog> <parent-repo> <branch>  (offline, read-only)',
  '  node src/homenode-cli.mjs release-inventory <catalog> <public-repo> --i-approve-public-release-lookup  (online metadata, no download)',
  '  node src/homenode-cli.mjs release-archive-plan <catalog> <saved-inventory> <repo> <asset-id> <absolute-archive-root>  (offline preview)',
  '  node src/homenode-cli.mjs release-archive <catalog> <saved-inventory> <repo> <asset-id> <absolute-archive-root> <plan-sha256> --i-approve-release-download',
  '  node src/homenode-cli.mjs release-archive-verify <catalog> <saved-inventory> <repo> <asset-id> <absolute-archive-root>  (offline readback)',
  '  node src/homenode-cli.mjs offline-readiness <catalog> <repo> <branch> <backup-root> <lfs-root> <saved-release-inventory|none> <release-archive-root|none>  (offline evidence)',
  '  node src/homenode-cli.mjs portable-kit-plan <catalog> <public-repo> <existing-kit-root>  (offline, read-only)',
  '  node src/homenode-cli.mjs portable-kit-verify <saved-kit-manifest.json> <copied-kit-root>  (offline, read-only)',
  '  node src/homenode-cli.mjs field-evidence <saved-kit-manifest> <copied-kit-root> <restored-bare-repo> <operator-observations.json|none>  (offline, read-only)',
  '  node src/homenode-cli.mjs runtime-preflight <saved-kit-manifest> <copied-kit-root> <restored-bare-repo> <branch>  (offline, no code execution)',
  '  node src/homenode-cli.mjs frontend-scan <absolute-built-dist-root>  (offline SHA256/static-reference manifest)',
  '  node src/homenode-cli.mjs frontend-verify <saved-dist-manifest.json> <absolute-copied-dist-root>  (offline readback)',
  '  node src/homenode-cli.mjs frontend-serve <saved-dist-manifest.json> <absolute-copied-dist-root> <port> --i-approve-loopback-preview  (explicit 127.0.0.1 only)',
  'Remote network only with explicit public release lookup, approved LFS fetch, or approved release-asset download. Frontend preview binds 127.0.0.1 only after consent. No unattended sync/install.',
].join('\n');

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'inventory' && !args.length) return console.log(JSON.stringify(await inventory(), null, 2));
  if (command === 'backup' && args.length === 2) return console.log(JSON.stringify(await backupRepo(args[0], args[1]), null, 2));
  if (command === 'verify' && args.length === 1) return console.log(JSON.stringify(await verifyBackup(args[0]), null, 2));
  if (command === 'frontend-scan' && args.length === 1)
    return console.log(JSON.stringify(await scanOfflineFrontend(args[0]), null, 2));
  if (command === 'frontend-verify' && args.length === 2)
    return console.log(JSON.stringify(await verifyOfflineFrontend(args[0], args[1]), null, 2));
  if (command === 'frontend-serve' && args.length === 4 && args[3] === '--i-approve-loopback-preview') {
    if (!/^[1-9]\d{3,4}$/.test(args[2])) throw new Error('Explicit preview port must be 1024..65535');
    const preview = await startOfflineFrontendServer(args[0], args[1], Number(args[2]));
    console.log(JSON.stringify({ ...preview, server: undefined }, null, 2));
    console.error('[HomeNode] Local preview running. Manually open ' + preview.url + ' in your browser. Ctrl-C stops it. Not a browser or offline WAN certification.');
    return;
  }
  if (command === 'runtime-preflight' && args.length === 4)
    return console.log(JSON.stringify(await preflightRecoveredRuntime(...args), null, 2));
  if (command === 'field-evidence' && args.length === 4)
    return console.log(JSON.stringify(await composeOfflineFieldEvidence(...args), null, 2));
  if (command === 'portable-kit-plan' && args.length === 3)
    return console.log(JSON.stringify(await planPortableRecoveryKit(await loadCatalog(args[0]), args[1], args[2]), null, 2));
  if (command === 'portable-kit-verify' && args.length === 2)
    return console.log(JSON.stringify(await verifyPortableRecoveryKit(args[0], args[1]), null, 2));
  if (command === 'offline-readiness' && args.length === 7)
    return console.log(JSON.stringify(await offlineRecoveryReadiness(await loadCatalog(args[0]), ...args.slice(1)), null, 2));
  if (command === 'release-archive-plan' && args.length === 5)
    return console.log(JSON.stringify(await planReleaseAssetArchive(await loadCatalog(args[0]), ...args.slice(1)), null, 2));
  if (command === 'release-archive' && args.length === 7 && args[6] === '--i-approve-release-download')
    return console.log(JSON.stringify(await acquireReleaseAsset(await loadCatalog(args[0]), ...args.slice(1, 6)), null, 2));
  if (command === 'release-archive-verify' && args.length === 5)
    return console.log(JSON.stringify(await verifyReleaseAssetArchive(await loadCatalog(args[0]), ...args.slice(1)), null, 2));
  if (command === 'release-inventory' && args.length === 3 && args[2] === '--i-approve-public-release-lookup')
    return console.log(JSON.stringify(await inventoryPublicReleaseAssets(await loadCatalog(args[0]), args[1]), null, 2));
  if (command === 'submodule-ledger' && args.length === 3)
    return console.log(JSON.stringify(await auditSubmoduleRecovery(await loadCatalog(args[0]), ...args.slice(1)), null, 2));
  if (command === 'lfs-manifest' && args.length === 4)
    return console.log(JSON.stringify(await auditLfsRecoveryManifest(await loadCatalog(args[0]), ...args.slice(1)), null, 2));
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
