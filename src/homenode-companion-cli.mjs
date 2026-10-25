#!/usr/bin/env node
import { X509Certificate, createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { loadCompanionTrust, parseCompanionConfig, selectCompanionMode } from './homenode-companion.mjs';

const help = [
  'GitPorch R1-H5: Native HomeNode companion (one-shot, no server or browser bridge).',
  '  npm run companion -- status --mode offline',
  '  npm run companion -- status --mode public',
  '  npm run companion -- status --mode local',
  '  npm run companion -- preflight',
  '  npm run companion -- fingerprint <absolute-certificate-PEM-path>',
  'Only local mode makes an HTTPS request. Pin certificates independently before setting trust.',
].join('\n');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 3 && args[0] === 'status' && args[1] === '--mode') {
    console.log(JSON.stringify(await selectCompanionMode(args[2]), null, 2));
    return;
  }
  if (args.length === 1 && args[0] === 'preflight') {
    const config = parseCompanionConfig();
    await loadCompanionTrust(config);
    console.log(JSON.stringify({ preflight: 'LOCAL_TRUST_CONFIG_VERIFIED_OFFLINE',
      note: 'Pinned leaf cert, SAN, validity and secret format checked. No network connection or firewall security is certified.' }, null, 2));
    return;
  }
  if (args.length === 2 && args[0] === 'fingerprint') {
    if (!isAbsolute(args[1])) throw new Error('Certificate path must be absolute');
    const file = await lstat(args[1]);
    if (!file.isFile() || file.size < 1 || file.size > 1024 * 1024) throw new Error('Invalid certificate file');
    const cert = new X509Certificate(await readFile(args[1]));
    console.log(JSON.stringify({ certificateSha256: createHash('sha256').update(cert.raw).digest('hex'),
      notice: 'Verify this value through a trusted out-of-band channel before pinning; reading it locally alone is not trust.' }, null, 2));
    return;
  }
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') return console.log(help);
  throw new Error('Unknown command.\n' + help);
}
main().catch(error => {
  console.error('[HomeNode Companion] ' + (String(error.message).split(':')[0] || 'COMMAND_FAILED'));
  process.exitCode = 1;
});
