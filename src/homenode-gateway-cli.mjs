#!/usr/bin/env node
import { parseGatewayConfig, loadGatewayCredentials, startGateway } from './homenode-gateway.mjs';

const help = [
  'GitPorch HomeNode R1-H4: experimental authenticated, read-only LAN capability gateway.',
  '  npm run gateway -- preflight',
  '  npm run gateway -- serve --i-accept-lan-read-only',
  'Requires bind address and absolute TLS certificate, key and bearer-token file paths.',
  'Do not port-forward or connect this experimental interface to a public website.',
].join('\n');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === 'preflight') {
    const config = parseGatewayConfig();
    await loadGatewayCredentials(config.files, config.bind);
    console.log(JSON.stringify({
      preflight: 'CONFIGURATION_FILES_READABLE', interface: config.bind, port: config.port,
      caveat: 'Certificate SAN, validity, key match and token checked; CA trust and network safety are not certified. No listener started.',
    }, null, 2));
    return;
  }
  if (args.length === 2 && args[0] === 'serve' && args[1] === '--i-accept-lan-read-only') {
    const config = parseGatewayConfig();
    const server = await startGateway(config);
    console.log('[HomeNode Gateway] Experimental read-only capability endpoint on https://' + config.bind + ':' + config.port);
    console.log('[HomeNode Gateway] No Git operations, browser CORS, public website integration, or filesystem data exposed.');
    const stop = () => server.close();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') return console.log(help);
  throw new Error('Explicit consent or valid command is missing.\n' + help);
}

main().catch(error => { console.error('[HomeNode Gateway] ' + error.message); process.exitCode = 1; });
