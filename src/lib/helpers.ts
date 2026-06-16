// Receipt & reference generators, formatting, calculations
//
// NOTE (M-03): All identifier generators below use Node's `crypto.randomBytes`
// instead of `Math.random()`. `Math.random()` is NOT cryptographically secure —
// its output is predictable enough that an attacker who observes a few outputs
// can reconstruct the PRNG state and forge receipt numbers, journal entry
// numbers, SKU codes, or (most critically) gift card codes. For identifiers
// that confer value or audit-trail authority, only a CSPRNG is acceptable.

import { randomBytes } from 'crypto';

/**
 * Generate a cryptographically-secure random numeric string of the given
 * digit count, zero-padded to that length. Uses rejection sampling on a
 * 32-bit unsigned integer drawn from `crypto.randomBytes` so the resulting
 * distribution is uniform (modulo the requested digit count).
 *
 * For receipt/journal/SKU numbers we don't strictly need uniformity (collisions
 * are caught by DB unique constraints and the date prefix narrows the space),
 * but the rejection step is cheap and removes any modulo bias.
 */
function secureRandomDigits(digits: number): string {
  // Maximum value we can represent with the requested digit count.
  const max = Math.pow(10, digits) - 1; // e.g. digits=5 -> 99999
  // Use a 32-bit unsigned integer from the CSPRNG, then rejection-sample to
  // the range [0, max] to avoid modulo bias.
  const limit = Math.floor(0xFFFFFFFF / (max + 1)) * (max + 1);
  let n: number;
  do {
    const buf = randomBytes(4);
    // Read as big-endian unsigned 32-bit
    n = buf.readUInt32BE(0);
  } while (n >= limit);
  const value = n % (max + 1);
  return String(value).padStart(digits, '0');
}

/**
 * Pick `length` characters uniformly at random from `alphabet` using
 * `crypto.randomBytes` for the entropy source. Used for gift card codes where
 * the alphabet is a curated set of unambiguous characters.
 *
 * Rejection sampling: for an alphabet of size K, we accept a byte only if it
 * is < floor(256 / K) * K; otherwise we draw another byte. This eliminates
 * modulo bias.
 */
function secureRandomFromAlphabet(alphabet: string, length: number): string {
  const k = alphabet.length;
  const limit = Math.floor(256 / k) * k;
  let out = '';
  let i = 0;
  // Draw a single large buffer and walk through it; if we exhaust it (very
  // unlikely for the small lengths we use), draw another.
  let buf = randomBytes(length * 2 + 8);
  while (out.length < length) {
    if (i >= buf.length) {
      buf = randomBytes(length * 2 + 8);
      i = 0;
    }
    const b = buf[i++];
    if (b < limit) {
      out += alphabet[b % k];
    }
  }
  return out;
}

export function generateReceiptNumber(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const random = secureRandomDigits(5);
  return `MBM-${dateStr}-${random}`;
}

// Format: JE-YYYYMMDD-XXXXX
export function generateJournalEntryNumber(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const random = secureRandomDigits(5);
  return `JE-${dateStr}-${random}`;
}

// Format: MBM-CAT-XXXX
export function generateSKU(categoryCode: string = 'GEN'): string {
  const random = secureRandomDigits(4);
  return `MBM-${categoryCode.toUpperCase()}-${random}`;
}

export function formatKES(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function calculateAgingBucket(dueDate: Date): string {
  const now = new Date();
  const due = new Date(dueDate);
  const diffMs = now.getTime() - due.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'CURRENT';
  if (diffDays <= 30) return 'DAYS_30';
  if (diffDays <= 60) return 'DAYS_60';
  return 'DAYS_90_PLUS';
}

export function calculateLateFee(
  ratePerDay: number,
  expectedReturnDate: Date,
  actualReturnDate: Date = new Date()
): number {
  const expected = new Date(expectedReturnDate);
  const actual = new Date(actualReturnDate);
  const diffMs = actual.getTime() - expected.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  return diffDays * ratePerDay;
}

// Format: GC-XXXX-XXXX-XXXX
export function generateGiftCardCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars: I, O, 0, 1
  const segments = 3;
  const segmentLength = 4;
  const parts: string[] = [];
  for (let s = 0; s < segments; s++) {
    parts.push(secureRandomFromAlphabet(chars, segmentLength));
  }
  return `GC-${parts.join('-')}`;
}

export function calculateLineTotal(
  pricePerUnit: number,
  quantity: number,
  discountPercent: number = 0,
  taxRate: number = 16
): { subtotal: number; discount: number; tax: number; total: number } {
  const subtotal = pricePerUnit * quantity;
  const discount = subtotal * (discountPercent / 100);
  const taxable = subtotal - discount;
  const tax = taxable * (taxRate / 100);
  const total = taxable + tax;
  return { subtotal, discount, tax, total };
}
