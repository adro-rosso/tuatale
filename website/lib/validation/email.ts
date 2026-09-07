/**
 * Email helpers for the post-order correction flow (Batch 4b).
 *
 * isValidEmail is a deliberately conservative format check — not RFC-5322-complete (nothing
 * short of sending truly validates an address), just enough to reject the obvious typo before
 * we write it to the order and send a confirmation. The confirmation-to-new-address is the
 * real "is this reachable?" test.
 *
 * maskEmail obscures an address for the old-address alert ("changed to a•••@example.com") so
 * the alert doesn't leak the full new address to whoever holds the old inbox.
 */

// Single @, no spaces, a dot-bearing domain with a 2+ char TLD. Length-capped to avoid
// pathological inputs. Intentionally simple and readable over exhaustive.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > 254) return false;
  return EMAIL_RE.test(v);
}

/**
 * Normalise for storage + comparison: trim + lowercase. Addresses are treated
 * case-insensitively here (the local-part technically can be case-sensitive, but no real
 * provider relies on it, and it keeps "same as current?" dedupe honest).
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Mask an address for display: first char of the local part + •••, domain kept. */
export function maskEmail(value: string): string {
  const v = value.trim();
  const at = v.indexOf('@');
  if (at <= 0) return '•••';
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  const head = local[0] ?? '';
  return `${head}•••@${domain}`;
}
