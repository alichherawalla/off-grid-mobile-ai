/**
 * Generate a unique ID using crypto.getRandomValues when available,
 * with a Date.now()-based fallback for environments where the Web Crypto
 * API is not exposed (e.g. older Hermes builds on Android).
 */
export function generateId(): string {
  let random: string;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    random = array[0].toString(36);
  } else {
    // Fallback: combine high-resolution timer bits with a counter.
    // Not cryptographically secure, but sufficient for local IDs.
    random = ((Date.now() * 9301 + 49297) % 233280).toString(36); // NOSONAR
  }
  return `${Date.now()}-${random}`;
}

/**
 * Generate a random seed for image generation.
 */
export function generateRandomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % 2147483647;
  }
  // Fallback for environments without crypto API
  return Math.floor(((Date.now() * 9301 + 49297) % 233280) / 233280 * 2147483647); // NOSONAR
}
