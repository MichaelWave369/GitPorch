#!/usr/bin/env node
import { discoverPublic, importPublicRepository, loadCatalog, planImport, saveCatalog } from './homenode-bridge.mjs';
import { auditPublicMirrors } from './homenode-mirror-audit.mjs';
import { preparePublicBatch, importApprovedPublicBatch } from './homenode-batch.mjs';
const help = 'GitPorch HomeNode R1-H2: public GitHub discovery and one-at-a-time local import\n' +
  '  npm run bridge -- discover <github-owner> <absolute-existing-catalog-directory> --i-approve-public-discovery\n' +
  '  npm run bridge -- plan <absolute-catalog-file>\n' +
  '  npm run bridge -- audit <absolute-catalog-file> [--require-all-local-objects-verified]  (OFFLINE; no writes)\n' +
  '  npm run bridge -- import <absolute-catalog-file> <repository-name> --i-approve-github-import\n' +
  '  npm run bridge -- batch-plan <absolute-catalog-file> <name1,name2,...name5>  (OFFLINE, no writes)\n' +
  '  npm run bridge -- batch-import <absolute-catalog-file> <name1,name2,...name5> <64hex-plan-sha256> --i-approve-public-batch-import\n' +
  'This does NOT import private repositories, enable unattended sync or expose GitPorch on the LAN.';
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'discover' && args.length === 3 && args[2] === '--i-approve-public-discovery') {
    const catalog = await discoverPublic(args[0]);
    return console.log(JSON.stringify(await saveCatalog(catalog, args[1]), null, 2));
  }
  if (cmd === 'plan' && args.length === 1) return console.log(JSON.stringify(await planImport(await loadCatalog(args[0])), null, 2));
  if (cmd === 'audit' && (args.length === 1 || (args.length === 2 && args[1] === '--require-all-local-objects-verified'))) {
    const report = await auditPublicMirrors(await loadCatalog(args[0]));
    console.log(JSON.stringify(report, null, 2));
    if (args.length === 2 && report.summary.objectsVerifiedOnly !== report.summary.total) process.exitCode = 2;
    return;
  }
  if (cmd === 'batch-plan' && args.length === 2) {
    return console.log(JSON.stringify(await preparePublicBatch(await loadCatalog(args[0]), args[1]), null, 2));
  }
  if (cmd === 'batch-import' && args.length === 4 && args[3] === '--i-approve-public-batch-import') {
    const report = await importApprovedPublicBatch(await loadCatalog(args[0]), args[1], args[2]);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'LOCAL_GIT_IMPORTS_COMPLETED_ONLY') process.exitCode = 2;
    return;
  }
  if (cmd === 'import' && args.length === 3 && args[2] === '--i-approve-github-import') {
    return console.log(JSON.stringify(await importPublicRepository(await loadCatalog(args[0]), args[1]), null, 2));
  }
  if (cmd === 'help' || cmd === '--help' || !cmd) return console.log(help);
  throw new Error('Missing or invalid arguments or explicit network approval.\n' + help);
}
main().catch(error => { console.error('[HomeNode Bridge] ' + error.message); process.exitCode = 1; });
