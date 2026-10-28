// PhiOS R0.17: operator-selected static dist verification and opt-in localhost preview.
// No build, install, file copying, WAN networking, automatic browser launch, or OS boot.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, posix } from 'node:path';

const SCHEMA = 'gitporch.offline-static-frontend.v0.1';
const ROOT_ROUTE = '/PhiOS/';
const HASH = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FILES = 512;
const MAX_DIRS = 128;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.webmanifest', 'application/manifest+json'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.gif', 'image/gif'], ['.ico', 'image/x-icon'],
  ['.webp', 'image/webp'], ['.avif', 'image/avif'], ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'], ['.ttf', 'font/ttf'], ['.otf', 'font/otf'],
  ['.wasm', 'application/wasm'], ['.txt', 'text/plain; charset=utf-8'],
  ['.mp3', 'audio/mpeg'], ['.ogg', 'audio/ogg'], ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'], ['.pdf', 'application/pdf'],
]);
const TEXT_SCAN = new Set(['.html', '.css']);
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'", "img-src 'self' data: blob:", "font-src 'self' data:",
  "media-src 'self' blob:", "worker-src 'self' blob:", "object-src 'none'",
  "frame-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
  "base-uri 'self'",
].join('; ');
function deny(message) { throw new Error(message); }
function hash(v) { return createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
function sha(b) { return createHash('sha256').update(b).digest('hex'); }
function canonical(p) {
  const full = resolve(p);
  return process.platform === 'win32' ? full.toLowerCase() : full;
}
function within(p, c) {
  const r = relative(canonical(p), canonical(c));
  return !r || (!r.startsWith('..') && !isAbsolute(r));
}
async function directory(p) {
  if (typeof p !== 'string' || !isAbsolute(p)) deny('Frontend directory must be an absolute existing folder');
  const full = resolve(p), st = await lstat(full);
  if (!st.isDirectory() || st.isSymbolicLink() ||
      canonical(await realpath(full)) !== canonical(full)) {
    deny('Frontend directory is missing or has redirected filesystem components');
  }
  return full;
}
async function boundedManifest(p) {
  if (typeof p !== 'string' || !isAbsolute(p)) deny('Frontend manifest must be an absolute file');
  const full = resolve(p), st = await lstat(full);
  if (!st.isFile() || st.isSymbolicLink() ||
      canonical(await realpath(full)) !== canonical(full) ||
      st.size > MAX_MANIFEST_BYTES) deny('Frontend manifest unsafe or too large');
  let data;
  try { data = JSON.parse(await readFile(full, 'utf8')); }
  catch { deny('Invalid frontend manifest JSON'); }
  if (!data || data.schema !== SCHEMA || data.basePath !== ROOT_ROUTE ||
      !HASH.test(data.manifestSha256 ?? '') ||
      !Array.isArray(data.files) || data.files.length > MAX_FILES) {
    deny('Invalid frontend manifest schema');
  }
  const { manifestSha256, ...core } = data;
  if (hash(core) !== manifestSha256) deny('Frontend manifest fingerprint mismatch');
  return data;
}
function ext(p) {
  const n = p.toLowerCase();
  const dot = n.lastIndexOf('.');
  return dot === -1 ? '' : n.slice(dot);
}
function safeSegment(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 100 &&
    !s.startsWith('.') && !s.endsWith('.') && !s.endsWith(' ') &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.@+-]*$/.test(s);
}
function checkedRef(url, relFile) {
  const v = url.trim();
  if (!v || v.startsWith('#') || /^data:|^blob:/i.test(v)) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(v)) {
    if (/^(?:https?:|\/\/)/i.test(v)) deny('External HTML/CSS static resource reference: requires offline replacement');
    return null; // mailto etc is navigation, not static resource
  }
  if (v.includes('\\') || v.includes('\0') || v.includes('%')) {
    deny('Unsupported escape or encoded static resource reference');
  }
  const location = v.split(/[?#]/)[0];
  if (!location) return null;
  let relativeFile;
  if (location.startsWith('/')) {
    if (!location.startsWith(ROOT_ROUTE)) {
      deny('Built frontend references an absolute resource outside /PhiOS/');
    }
    relativeFile = location.slice(ROOT_ROUTE.length);
  } else {
    relativeFile = posix.join(posix.dirname(relFile), location);
  }
  if (relativeFile.endsWith('/')) relativeFile += 'index.html';
  const segments = relativeFile.split('/');
  if (!segments.length || segments.some(s => !safeSegment(s))) {
    deny('Static resource reference has unsafe or unresolved path');
  }
  return segments.join('/');
}
function htmlStaticRefs(content, sourcePath) {
  const results = [];
  // Inspect only known loading tags, NOT navigation anchors. Vite output has
  // script src, stylesheet/modulepreload links, favicons and media tags.
  const tags = /<(script|link|img|source|video|audio)\b[^>]*>/gi;
  for (const m of content.matchAll(tags)) {
    const tag = m[1].toLowerCase(), raw = m[0];
    const at = tag === 'link' ? 'href' : 'src';
    const match = new RegExp('\\b' + at + '\\s*=\\s*(["\\x27])([^"\\x27]*)\\1', 'i').exec(raw);
    if (!match) continue;
    const ref = checkedRef(match[2], sourcePath);
    if (ref) results.push(ref);
  }
  return results;
}
function cssStaticRefs(content, sourcePath) {
  const results = [];
  for (const m of content.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)/gi)) {
    const ref = checkedRef(m[1] ?? m[2] ?? m[3], sourcePath);
    if (ref) results.push(ref);
  }
  for (const m of content.matchAll(/@import\s+["']([^"']+)["']/gi)) {
    const ref = checkedRef(m[1], sourcePath);
    if (ref) results.push(ref);
  }
  return results;
}
async function inspect(root) {
  const files = [], seen = new Set();
  let dirs = 0, totalBytes = 0;
  async function walk(abs, pathSegments) {
    if (++dirs > MAX_DIRS) deny('Static frontend exceeds bounded directory count');
    for (const item of await readdir(abs, { withFileTypes: true })) {
      if (!safeSegment(item.name)) deny('Unsafe frontend filename or hidden file');
      const segments = [...pathSegments, item.name];
      const rel = segments.join('/'), full = join(abs, item.name);
      if (seen.has(rel)) deny('Duplicate frontend path');
      seen.add(rel);
      const st = await lstat(full);
      if (st.isSymbolicLink() || canonical(await realpath(full)) !== canonical(full)) {
        deny('Frontend contains symlink or redirected entry');
      }
      if (st.isDirectory()) {
        await walk(full, segments);
        continue;
      }
      if (!st.isFile() || !MIME.has(ext(rel)) || st.size > MAX_FILE_BYTES) {
        deny('Unsupported or oversized frontend file: strict non-executable static asset types only');
      }
      if (files.length + 1 > MAX_FILES ||
          (totalBytes += st.size) > MAX_TOTAL_BYTES) {
        deny('Static frontend exceeds total file or byte cap');
      }
      const bytes = await readFile(full);
      if (bytes.length !== st.size) deny('Frontend asset changed during scan');
      files.push({ path: rel, bytes: st.size, sha256: sha(bytes) });
    }
  }
  await walk(root, []);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const known = new Set(files.map(f => f.path));
  if (!known.has('index.html')) deny('Built static frontend must have index.html at its root');
  const refs = new Set();
  for (const f of files) {
    if (!TEXT_SCAN.has(ext(f.path))) continue;
    // Earlier scan verified bytes; refuse changed files on second inspection.
    const b = await readFile(join(root, ...f.path.split('/')));
    if (b.length !== f.bytes || sha(b) !== f.sha256) {
      deny('Frontend changed while inspecting static dependencies');
    }
    const links = ext(f.path) === '.html' ?
      htmlStaticRefs(b.toString('utf8'), f.path) :
      cssStaticRefs(b.toString('utf8'), f.path);
    for (const path of links) {
      if (!known.has(path)) deny('Referenced local static asset is absent from frontend directory');
      refs.add(path);
    }
  }
  // A compiled JS bundle can create URLs dynamically. Do not mislabel its
  // transitive runtime dependencies or fetch calls as verified.
  const body = {
    schema: SCHEMA, basePath: ROOT_ROUTE, mode: 'OFFLINE_STATIC_BYTE_AND_HTML_CSS_REFERENCE_SCAN_ONLY',
    status: 'STATIC_FILES_VERIFIED_BROWSER_NOT_TESTED',
    summary: {
      files: files.length, directories: dirs, bytes: totalBytes,
      htmlCssStaticReferencesResolved: refs.size,
    },
    files,
    acceptance: {
      capturedFileBytesSHA256Verified: true,
      htmlCssReferencedLocalAssetsFound: true,
      dynamicJavaScriptAssetClosureVerified: false,
      runtimeNetworkCallsAbsent: false,
      offlineBrowserOpened: false,
      siteRenderedAndNavigationTested: false,
      builtFromTrustedSourceVerified: false,
      disconnectedPhysicalWanMeasured: false,
      completePhiOSOfflineRecoveryVerified: false,
    },
    notice: 'Selected dist bytes and direct HTML/CSS resource paths only. Compiled JS dynamic imports/fetches, source provenance, external services, service workers, browser execution, all route navigation, HTTP caching and physical network isolation are not proven. Never automatically opens a browser.',
  };
  return { ...body, manifestSha256: hash(body) };
}
export async function scanOfflineFrontend(rootPath) {
  return inspect(await directory(rootPath));
}
export async function verifyOfflineFrontend(manifestPath, rootPath) {
  const root = await directory(rootPath);
  const manifest = await boundedManifest(manifestPath);
  if (within(root, resolve(manifestPath))) {
    deny('Saved frontend manifest must be outside served asset root');
  }
  const actual = await inspect(root);
  if (actual.manifestSha256 !== manifest.manifestSha256 ||
      JSON.stringify(actual.files) !== JSON.stringify(manifest.files)) {
    deny('Built frontend files differ from saved manifest');
  }
  return {
    schema: 'gitporch.offline-static-frontend-verify.v0.1',
    status: 'FRONTEND_BYTES_AND_DIRECT_STATIC_REFERENCES_REVERIFIED_ONLY',
    manifestSha256: manifest.manifestSha256,
    files: actual.summary.files, bytes: actual.summary.bytes,
    networkUsed: false, writesMade: false, browserOpened: false,
    acceptance: actual.acceptance,
  };
}
function requestRelative(url) {
  if (typeof url !== 'string' || url.length > 4096 ||
      !url.startsWith(ROOT_ROUTE)) return null;
  const plain = url.split(/[?#]/)[0];
  const path = plain.slice(ROOT_ROUTE.length) || 'index.html';
  if (path.includes('%') || path.includes('\\') || path.includes('//') ||
      path.split('/').some(x => !safeSegment(x))) return null;
  return path;
}
function sendError(res, status) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(status === 404 ? 'Not found' : status === 405 ? 'Method not allowed' : 'Static frontend rejected');
}
/**
 * Explicit localhost-only process; CLI opt-in flag checked separately.
 * Returns the server for tests and for graceful CLI shutdown via Ctrl-C.
 */
export async function startOfflineFrontendServer(
  manifestPath, rootPath, port, options = {},
) {
  if (!Number.isSafeInteger(port) || (port !== 0 && (port < 1024 || port > 65535)) ||
      (port === 0 && options.allowEphemeralPort !== true)) {
    deny('Explicit port must be 1024..65535; ephemeral port is test-only');
  }
  const root = await directory(rootPath);
  await verifyOfflineFrontend(manifestPath, root);
  const manifest = await boundedManifest(manifestPath);
  const map = new Map(manifest.files.map(f => [f.path, f]));
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    const portActual = server.address()?.port;
    if (req.headers.host !== '127.0.0.1:' + portActual) {
      return sendError(res, 403);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(res, 405);
    }
    const path = requestRelative(req.url);
    const expected = path && map.get(path);
    if (!expected) return sendError(res, 404);
    try {
      const full = join(root, ...path.split('/'));
      const st = await lstat(full);
      if (!st.isFile() || st.isSymbolicLink() ||
          canonical(await realpath(full)) !== canonical(full) ||
          st.size !== expected.bytes || st.size > MAX_FILE_BYTES) {
        return sendError(res, 409);
      }
      const bytes = await readFile(full);
      if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256) {
        return sendError(res, 409);
      }
      res.writeHead(200, {
        'Content-Type': MIME.get(ext(path)),
        'Content-Length': bytes.length,
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      return sendError(res, 409);
    }
  });
  try {
    await new Promise((resolveStart, rejectStart) => {
      server.once('error', rejectStart);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', rejectStart);
        resolveStart();
      });
    });
  } catch {
    deny('Unable to bind explicit localhost-only preview port');
  }
  const actualPort = server.address().port;
  return { server, url: 'http://127.0.0.1:' + actualPort + ROOT_ROUTE,
    status: 'LOCALHOST_STATIC_PREVIEW_RUNNING_BROWSER_NOT_VERIFIED' };
}
