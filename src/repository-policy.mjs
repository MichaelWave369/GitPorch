// Shared local storage policy. Intentionally conservative for Windows-first HomeNode builds.
export const MAX_LOCAL_REPOSITORIES = 2048;
export const MAX_REPOSITORY_NAME_LENGTH = 100;
export const LOCAL_REPOSITORY_SCAN_CONCURRENCY = 8;

// Windows rejects these basenames even when a file has a suffix (such as .git).
const DEVICE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

export function validLocalRepositoryName(value) {
  return typeof value === 'string' &&
    value.length >= 1 && value.length <= MAX_REPOSITORY_NAME_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
    !value.endsWith('.') && !value.toLowerCase().endsWith('.git') &&
    !DEVICE.test(value);
}

export function assertLocalRepositoryCapacity(count) {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_LOCAL_REPOSITORIES) {
    throw new Error('GitPorch local repository capacity exceeded or unknown (' +
      MAX_LOCAL_REPOSITORIES + ' max); no partial inventory returned');
  }
}
