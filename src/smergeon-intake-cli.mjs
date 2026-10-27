#!/usr/bin/env node
// Read-only local Smergeon surgical receipt review. No network, trust promotion, or writes.
import { open } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { inspectSmergeonReceipt } from './smergeon-intake.mjs';

const args = process.argv.slice(2);
const usage = 'Usage: node src/smergeon-intake-cli.mjs RECEIPT.json [--expected-sha256 64_hex_chars]';
async function main() {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    return args.length ? 0 : 2;
  }
  const [path, ...options] = args;
  if (!path || path.startsWith('--') ||
      !(options.length === 0 || (options.length === 2 && options[0] === '--expected-sha256'))) {
    console.error(usage);
    return 2;
  }
  const expectedChecksum = options.length ? options[1] : null;
  if (expectedChecksum !== null && !/^[0-9a-f]{64}$/.test(expectedChecksum)) {
    console.error('Expected checksum must be 64 lowercase hex characters.');
    return 2;
  }
  let handle;
  try {
    handle = await open(path, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16384)
      throw Error('Not a bounded regular receipt file.');
    const buffer = Buffer.alloc(16385);
    const { bytesRead } = await handle.read(buffer,0,buffer.length,0);
    if (bytesRead > 16384) throw Error('Oversize receipt.');
    const json = new TextDecoder('utf-8', { fatal: true })
      .decode(buffer.subarray(0,bytesRead));
    const result = inspectSmergeonReceipt(JSON.parse(json), { expectedChecksum });
    // Prints ONLY validated allowlisted fields; never prints arbitrary receipt text.
    console.log(JSON.stringify(result, null, 2));
    return result.outcome === 'REVIEW_ONLY' ? 0 : 1;
  } catch {
    console.error('Unable to inspect receipt: invalid file, encoding or JSON.');
    return 2;
  } finally {
    if (handle) await handle.close();
  }
}
process.exitCode = await main();
