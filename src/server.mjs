import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { listRepos, readCommits, getHttpPort, getDataDir, getGitPort } from './git.mjs';
import { summary as crewSummary } from './clubhouse.mjs';
import { queueSnapshot } from './porch-crew.mjs';
import { snapshot as sandboxSnapshot } from './sandbox-ci.mjs';
import { doctor as recoveryDoctor } from './recovery.mjs';
import { phirunnersSnapshot } from './phirunners.mjs';
import { artifactSnapshot } from './artifact-forge.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);
function reply(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  res.end(body);
}
const json = (res, status, value) => reply(res, status, JSON.stringify(value));

export function makeHandler({ dataDir = getDataDir(), daemonState = () => 'not_started' } = {}) {
  return async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method !== 'GET') return json(res, 405, { error: 'READ_ONLY_HTTP', message: 'R0 has no browser mutations. Use the local CLI.' });
      if (path === '/api/status') return json(res, 200, {
        service: 'The GitPorch', version: '0.1.0', mode: 'LOCAL_READ_ONLY',
        http: '127.0.0.1', gitTransport: daemonState(), gitPort: getGitPort(),
        caveat: 'Remote pushing, authentication, PR reviews and CI execution are not in R0',
      });
      if (path === '/api/repos') return json(res, 200, { repositories: await listRepos(dataDir) });
      if (path === '/api/clubhouse') return json(res, 200, await crewSummary(dataDir));
      if (path === '/api/porch-crew') return json(res, 200, await queueSnapshot(dataDir));
      if (path === '/api/sandbox-tests') return json(res, 200, await sandboxSnapshot(dataDir));
      if (path === '/api/recovery') return json(res, 200, await recoveryDoctor(dataDir));
      if (path === '/api/phirunners') return json(res, 200, await phirunnersSnapshot(dataDir));
      if (path === '/api/artifacts') return json(res, 200, await artifactSnapshot(dataDir));
      const matched = /^\/api\/repos\/([a-zA-Z0-9._-]+)\/commits$/.exec(path);
      if (matched) {
        const commits = await readCommits(dataDir, matched[1], 12);
        return commits === null ? json(res, 404, { error: 'NOT_FOUND' }) : json(res, 200, { commits });
      }
      if (assets.has(path)) {
        const [name, type] = assets.get(path);
        return reply(res, 200, await readFile(join(publicDir, name)), type);
      }
      return json(res, 404, { error: 'NOT_FOUND' });
    } catch (e) {
      console.error('[GitPorch] Request failed:', e.message);
      return json(res, 500, { error: 'INTERNAL_ERROR' });
    }
  };
}
export function createHttpServer(opts = {}) { return http.createServer(makeHandler(opts)); }
export async function startHttp({ dataDir = getDataDir(), daemonState } = {}) {
  const server = createHttpServer({ dataDir, daemonState });
  const port = getHttpPort();
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  console.log(`[GitPorch] Front porch: http://127.0.0.1:${server.address().port}/`);
  return server;
}
