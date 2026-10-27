// Smergeon v0.6 / GitPorch read-only intake. Not a signed worker record or PASS.
import { createHash, timingSafeEqual } from 'node:crypto';

export const SCHEMA = 'smergeon.surgical-handoff.v0.6';
const DOMAIN = 'smergeon-surgical-handoff-v0.6\n';
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^smergeon\/repair-pr[1-9][0-9]*-[0-9a-f]{8}-[0-9a-f]{10}$/;
const PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const PATH_EXTS = ['.py','.js','.jsx','.ts','.tsx','.css','.html','.json',
  '.md','.txt','.toml','.yml','.yaml'];
const STATUSES = new Set(['STAGED_ONLY','DRAFT_CREATED']);
const WARNING = 'Checksum is not a signature, CI result, authenticated custody, Anti-M completion, GitPorch worker record, or approval to merge.';

const GITPORCH = Object.freeze({
  kind: 'UNSIGNED_REPAIR_PROPOSAL',
  worker_execution_verified: false,
  signed_evidence: false,
  witnessed: false,
  outcome: 'UNVERIFIED',
});
const ANTIM = Object.freeze({
  kind: 'SHADOW_REVIEW_ONLY',
  execution_authority: false,
  closure_authority: false,
  ledger_write: false,
  done: false,
  provenance: 'OPERATOR_REPORT',
});
const CLAIMS = Object.freeze({
  origin: 'LOCAL_SELF_REPORT',
  verified_root_cause: false,
  ci_verified: false,
  independently_witnessed: false,
  source_branch_modified: false,
  merges_performed: 0,
  permission_granted: false,
});

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (value, expected) => object(value)
  && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
const ascii = value => typeof value === 'string' && /^[\x20-\x7e]+$/.test(value);
const eqFixed = (value, target) => keys(value, Object.keys(target))
  && Object.keys(target).every(key => value[key] === target[key]);
const compare = (a, b) => Buffer.isBuffer(a) && Buffer.isBuffer(b)
  && a.length === b.length && timingSafeEqual(a,b);

// Canonicalize the schema's ASCII-only JSON to match Python's json.dumps
// with sort_keys=True, separators=(',', ':'), ensure_ascii=True.
// No arbitrary nested user content or floating-point values are admitted.
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value))
    return String(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  throw Error('Unsupported handoff value');
}
function sha256(body) {
  return createHash('sha256').update(DOMAIN + canonical(body), 'utf8').digest('hex');
}
function pathValid(name) {
  if (!ascii(name) || name.length > 180 || !PATH.test(name)) return false;
  const parts = name.split('/');
  return parts.every(x => x !== '.' && x !== '..' && !x.startsWith('.'))
    && !['node_modules','vendor','dist','build'].includes(parts[0].toLowerCase())
    && PATH_EXTS.some(ext => name.toLowerCase().endsWith(ext));
}
function urlValid(repo, number, url) {
  // Exact-match only: rejects fragments, queries, credentials and alternate hosts.
  return typeof url === 'string' &&
    url === 'https://github.com/' + repo + '/pull/' + number;
}
function invalid(reason) {
  return {
    outcome: 'REJECT',
    reason,
    trust: 'UNSIGNED_UNVERIFIED',
    acceptedAsSignedEvidence: false,
    verifiedWorkerRun: false,
    antiMCompletion: false,
    executionAuthority: false,
    mergeAuthority: false,
  };
}

/** Only validates format and checksum. Returns REVIEW_ONLY, never PASS/DONE. */
export function inspectSmergeonReceipt(receipt, { expectedChecksum = null } = {}) {
  try {
    if (!keys(receipt, ['schema','body','checksum_sha256','trust','warning'])
        || receipt.schema !== SCHEMA || receipt.trust !== 'UNSIGNED_UNVERIFIED'
        || receipt.warning !== WARNING)
      return invalid('WRONG_ENVELOPE');
    const b = receipt.body;
    if (!keys(b, ['schema','event','source','operation','draft','handoff','claims'])
        || b.schema !== SCHEMA || !STATUSES.has(b.event))
      return invalid('WRONG_BODY');
    if (!keys(b.source, ['repository','pull_request','head_sha','plan_fingerprint'])
        || !keys(b.operation, ['id','branch','file_path','before_blob_sha','after_blob_sha'])
        || !keys(b.draft, ['number','url'])
        || !keys(b.handoff, ['gitporch','anti_m']))
      return invalid('WRONG_SUBJECT');
    const s = b.source, op = b.operation;
    if (!ascii(s.repository) || !REPO.test(s.repository)
        || ['.','..'].includes(s.repository.split('/')[1])
        || !Number.isSafeInteger(s.pull_request) || s.pull_request < 1
        || !HEX40.test(s.head_sha)
        || !HEX64.test(s.plan_fingerprint)
        || !HEX64.test(op.id) || !HEX40.test(op.before_blob_sha)
        || !HEX40.test(op.after_blob_sha)
        || op.before_blob_sha === op.after_blob_sha || !pathValid(op.file_path))
      return invalid('BAD_BINDING');
    const expectedBranch = 'smergeon/repair-pr' + s.pull_request + '-' +
      s.head_sha.slice(0,8) + '-' + op.id.slice(0,10);
    if (typeof op.branch !== 'string' || !BRANCH.test(op.branch)
        || op.branch !== expectedBranch)
      return invalid('BAD_BRANCH');
    if (b.event === 'STAGED_ONLY') {
      if (b.draft.number !== null || b.draft.url !== null)
        return invalid('UNSUPPORTED_DRAFT_CLAIM');
    } else if (!Number.isSafeInteger(b.draft.number) || b.draft.number < 1 ||
        !urlValid(s.repository,b.draft.number,b.draft.url)) {
      return invalid('UNSUPPORTED_DRAFT_CLAIM');
    }
    if (!eqFixed(b.handoff.gitporch,GITPORCH) ||
        !eqFixed(b.handoff.anti_m,ANTIM) || !eqFixed(b.claims,CLAIMS))
      return invalid('FORBIDDEN_AUTHORITY_CLAIM');
    if (!HEX64.test(receipt.checksum_sha256)) return invalid('INVALID_CHECKSUM');
    // Only allow ASCII strings in accepted body. This bounds Python/JS parity.
    // All admitted fields have already been checked against ASCII patterns
    // or fixed ASCII-only constants.
    const digest = sha256(b);
    if (!compare(Buffer.from(digest,'hex'),
                 Buffer.from(receipt.checksum_sha256,'hex')))
      return invalid('CHECKSUM_MISMATCH');
    if (expectedChecksum !== null &&
        (!HEX64.test(expectedChecksum) ||
         !compare(Buffer.from(digest,'hex'), Buffer.from(expectedChecksum,'hex'))))
      return invalid('EXTERNAL_CHECKSUM_MISMATCH');
    return {
      outcome: 'REVIEW_ONLY',
      reason: 'FORMAT_AND_CHECKSUM_CONSISTENT_NOT_AUTHENTICATED',
      trust: 'UNSIGNED_UNVERIFIED',
      checksumMatches: true,
      externallyPinned: expectedChecksum !== null,
      event: b.event,
      repository: s.repository,
      sourcePullRequest: s.pull_request,
      headSha: s.head_sha,
      planFingerprint: s.plan_fingerprint,
      operationFingerprint: op.id,
      filePath: op.file_path,
      draftPullRequest: b.draft.number,
      draftUrl: b.draft.url,
      acceptedAsSignedEvidence: false,
      verifiedWorkerRun: false,
      antiMCompletion: false,
      executionAuthority: false,
      mergeAuthority: false,
    };
  } catch {
    return invalid('MALFORMED_RECEIPT');
  }
}
