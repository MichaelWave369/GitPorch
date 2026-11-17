#!/usr/bin/env node
// Operator-only local evidence intake; no Muse/Git binaries or network calls.
import { getDataDir } from './git.mjs';
import { inspectMuseEvidenceFolder, publishMuseEvidenceFolder, museBridgeShelf } from './muse-bridge-shelf.mjs';

const help = [
  'GitPorch x Muse R0.8 - unsigned local evidence shelf',
  '',
  '  npm run muse:bridge-status -- inspect <extracted-evidence-dir> <GitHub-run-id>',
  '  npm run muse:bridge-status -- publish <extracted-evidence-dir> <GitHub-run-id> --i-approve-local-receipt',
  '  npm run muse:bridge-status -- status',
  '',
  'The directory must contain six files from the manual Muse Actions ZIP:',
  'git-history-baseline.json, muse-import.log, muse-internal-history-audit.json,',
  'snapshot-audit.json, status-audit.json, and muse-status.json.',
  'Only the approved publish command writes a sanitized, unsigned receipt',
  'to GITPORCH_DATA_DIR/muse-bridge-receipts.',
  'Neither inspect nor publish runs Muse, fetches URLs, pushes code,',
  'signs receipts or touches other repositories. The HTTP UI is GET-only.',
].join('\n');

try {
  const [action, folder, runId, approval, ...extra] = process.argv.slice(2);
  if (action === 'status' && !folder && !runId && !approval && !extra.length) {
    console.log(JSON.stringify(museBridgeShelf(getDataDir()), null, 2));
  } else if (action === 'inspect' && folder && runId && !approval && !extra.length) {
    console.log(JSON.stringify(inspectMuseEvidenceFolder(folder, runId).summary, null, 2));
  } else if (action === 'publish' && folder && runId && approval === '--i-approve-local-receipt' && !extra.length) {
    console.log(JSON.stringify(publishMuseEvidenceFolder(getDataDir(), folder, runId), null, 2));
  } else if (['--help','-h','help'].includes(action ?? 'help') && !folder && !runId) {
    console.log(help);
  } else {
    throw new Error('Invalid or unapproved arguments.\n\n' + help);
  }
} catch (error) {
  console.error('[GitPorch Muse] ' + error.message);
  process.exitCode = 1;
}
