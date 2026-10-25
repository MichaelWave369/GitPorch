#!/usr/bin/env node
import { discoverPublic, importPublicRepository, loadCatalog, planImport, saveCatalog } from './homenode-bridge.mjs';
const help = 'GitPorch HomeNode R1-H2: public GitHub discovery and one-at-a-time local import\n' +
  '  npm run bridge -- discover <github-owner> <absolute-existing-catalog-directory> --i-approve-public-discovery\n' +
  '  npm run bridge -- plan <absolute-catalog-file>\n' +
  '  npm run bridge -- import <absolute-catalog-file> <repository-name> --i-approve-github-import\n' +
  'This does NOT import private repositories, enable unattended sync or expose GitPorch on the LAN.';
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'discover' && args.length === 3 && args[2] === '--i-approve-public-discovery') {
    const catalog = await discoverPublic(args[0]);
    return console.log(JSON.stringify(await saveCatalog(catalog, args[1]), null, 2));
  }
  if (cmd === 'plan' && args.length === 1) return console.log(JSON.stringify(await planImport(await loadCatalog(args[0])), null, 2));
  if (cmd === 'import' && args.length === 3 && args[2] === '--i-approve-github-import') {
    return console.log(JSON.stringify(await importPublicRepository(await loadCatalog(args[0]), args[1]), null, 2));
  }
  if (cmd === 'help' || cmd === '--help' || !cmd) return console.log(help);
  throw new Error('Missing or invalid arguments or explicit network approval.\n' + help);
}
main().catch(error => { console.error('[HomeNode Bridge] ' + error.message); process.exitCode = 1; });
