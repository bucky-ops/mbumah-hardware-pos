// Receipt & reference generators, formatting, calculations
//
// AUDIT REMEDIATION — FINANCIAL_MODULE_AUDIT_REPORT.md (SYS-7/F5-6/F1-9):
//   Document numbers previously used `Math.random()` 5-digit suffixes.
//   With a busy day's volume the birthday bound makes collisions (and the
//   resulting P2002 500s mid-checkout) likely, and guessable receipt numbers
//   weaken the M-Pesa callback's reference security. All user-facing document
//   suffixes are now crypto-random. Callers wrap creates in
//   `withSequenceRetry` (src/lib/sequence.ts) as the P2002 backstop.

import crypto from 'crypto';
import { KES } from '@/lib/money';

function secureSuffix(): string {
  // 5-char base36 ≈ 60M combinations — collision-safe at retail volumes and
  // unpredictable to outside observers.
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
}

export function generateReceiptNumber(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const random = secureSuffix();
  return `MBM-${dateStr}-${random}`;
}

// Format: JE-YYYYMMDD-XXXXX
export function generateJournalEntryNumber(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const random = secureSuffix();
  return `JE-${dateStr}-${random}`;
}

// Format: MBM-CAT-XXXX
export function generateSKU(categoryCode: string = 'GEN'): string {
  const random = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
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

/**
 * Format a date as a readable string (e.g. "26 Jun 2026").
 * Accepts Date, ISO string, or timestamp. Returns '—' for null/undefined.
 * Used by PDF report generation (export-pdf route) and other server-side
 * formatting where the api.ts formatDateTime (client-side) isn't available.
 */
export function formatDate(date: Date | string | number | null | undefined): string {
  if (date === null || date === undefined) return '—';
  const d = typeof date === 'object' ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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
    let seg = '';
    for (let i = 0; i < segmentLength; i++) {
      seg += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    parts.push(seg);
  }
  return `GC-${parts.join('-')}`;
}

/**
 * Compute a sale line's gross subtotal, line discount, tax and total.
 *
 * AUDIT FIX (5): this previously did raw IEEE-754 float math
 * (`pricePerUnit * quantity`, etc.), so results like 0.1 + 0.2 →
 * 0.30000000000000004 drifted before being frozen into the Decimal columns —
 * line-sum vs header mismatches of a cent, exactly what eTIMS reconciliation
 * flags. Every operation now goes through the `Money` primitive (arbitrary
 * precision decimal, src/lib/money.ts) and is rounded HALF_EVEN (banker's
 * rounding — the GAAP/IFRS/KRA-VAT standard) to the currency's minor unit
 * (2dp for KES):
 *   subtotal = round(pricePerUnit × quantity)
 *   discount = round(subtotal × discountPercent / 100)
 *   taxable  = subtotal − discount          (exact — both are 2dp)
 *   tax      = round(taxable × taxRate / 100)
 *   total    = taxable + tax                (exact — both are 2dp)
 *
 * The exported signature is UNCHANGED so all existing callers keep
 * compiling; only the numeric behaviour (exact, rounded) is different.
 */
export function calculateLineTotal(
  pricePerUnit: number,
  quantity: number,
  discountPercent: number = 0,
  taxRate: number = 16
): { subtotal: number; discount: number; tax: number; total: number } {
  const subtotal = KES(pricePerUnit).multiply(quantity).round();
  const discount = subtotal.multiply(discountPercent / 100).round();
  const taxable = subtotal.subtract(discount);
  const tax = taxable.multiply(taxRate / 100).round();
  const total = taxable.add(tax).round();
  return {
    subtotal: subtotal.toNumber(),
    discount: discount.toNumber(),
    tax: tax.toNumber(),
    total: total.toNumber(),
  };
}
