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
import { calculateLineItem, formatKES as canonicalFormatKES } from '@/lib/utils/financialMath';

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

// Format: MBM-<BRANCH>-CAT-XXXX when a branch code is supplied, MBM-CAT-XXXX otherwise.
// Branch-coded SKUs make every product traceable to the branch that stocks it
// (e.g. MBM-JUJ-CEM-0042 = Juja Main, Cement category).
export function generateSKU(categoryCode: string = 'GEN', branchCode?: string | null): string {
  const random = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  const branch = normalizeBranchCode(branchCode);
  const cat = categoryCode.toUpperCase();
  return branch ? `MBM-${branch}-${cat}-${random}` : `MBM-${cat}-${random}`;
}

/**
 * Normalize a human branch code: trim, uppercase, keep A-Z/0-9 only, 2-6 chars.
 * Returns null for anything that cannot form a valid code (used to reject or
 * auto-derive branch codes at the API boundary).
 */
export function normalizeBranchCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length >= 2 && code.length <= 6 ? code : null;
}

/**
 * Staff number format: MBM-<branchCode>-E<NNN> (e.g. MBM-JUJ-E001).
 * `seq` is the per-branch 1-based sequence. Returns null without a valid
 * branch code (callers must resolve the store's code first).
 */
export function formatEmployeeCode(branchCode: string, seq: number): string | null {
  const branch = normalizeBranchCode(branchCode);
  if (!branch || !Number.isFinite(seq) || seq < 1) return null;
  return `MBM-${branch}-E${String(Math.floor(seq)).padStart(3, '0')}`;
}

/**
 * Canonical KES formatting (en-KE, exactly 2 decimal places) — delegated to
 * the central financialMath utility so server-rendered PDFs show the exact
 * same string as the UI, receipts, e-mails and WhatsApp messages.
 */
export const formatKES = canonicalFormatKES;

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
 * FINANCIAL MATH AUDIT — UNIFORM FORMULA (src/lib/utils/financialMath.ts):
 * every operation runs in decimal.js (never IEEE-754 float) and rounds
 * HALF_UP to 2dp at the line level:
 *   subtotal = round_HUP(pricePerUnit × quantity)
 *   discount = round_HUP(subtotal × discountPercent / 100)
 *   net      = subtotal − discount
 *   VAT-INCLUSIVE (POS retail default — shelf price includes VAT):
 *     tax      = net − round_HUP(net / 1.16)
 *     total    = net                       (customer pays the shelf price)
 *   VAT-EXCLUSIVE (B2B / wholesale — pass `isVatInclusive = false`):
 *     tax      = round_HUP(net × taxRate / 100)
 *     total    = net + tax
 * Exempt lines (taxRate 0) always carry tax = 0.
 *
 * Because each line is exact at 2dp, document totals aggregate without
 * off-by-one-cent drift (see aggregateDocument in financialMath).
 *
 * The exported shape ({ subtotal, discount, tax, total }) is UNCHANGED so
 * all existing callers keep compiling; only the numeric behaviour (exact,
 * rounded, VAT-inclusive) is different. NOTE the semantic flip: `total` is
 * now the VAT-INCLUSIVE gross the customer pays — the header formula in
 * checkout was updated in the same audit to `subtotal − lineDiscounts −
 * cartDiscount` (VAT is inside the lines, never added on top).
 */
export function calculateLineTotal(
  pricePerUnit: number,
  quantity: number,
  discountPercent: number = 0,
  taxRate: number = 16,
  isVatInclusive: boolean = true
): { subtotal: number; discount: number; tax: number; total: number } {
  const line = calculateLineItem(quantity, pricePerUnit, discountPercent, isVatInclusive, taxRate);
  return {
    subtotal: line.subtotal,
    discount: line.discountAmount,
    tax: line.vatAmount,
    total: line.lineGrossTotal,
  };
}

/**
 * Deterministic destination SKU for inter-store transfers.
 *
 * Product.sku is GLOBALLY unique in this schema, so a destination store can
 * never reuse the origin product's SKU. Transfers therefore derive the
 * destination catalog row's SKU as `<originSku>--<toStoreCode>` using the
 * destination branch's human code (e.g. MBM-THI-0042--NAK) so the received
 * stock carries the branch code of the store it now belongs to. Falls back
 * to `<originSku>--<toStoreId>` when the store has no code yet (legacy data),
 * which also keeps every historical transfer SKU stable.
 *
 * Stable per (origin product, destination store) pair so repeated transfers
 * always increment the same destination row instead of creating duplicates.
 *
 * Returns null when the origin product has no SKU (nothing to derive from).
 */
export function deriveTransferDestinationSku(
  originSku: string | null | undefined,
  toStoreId: string,
  toStoreCode?: string | null
): string | null {
  if (!originSku || !toStoreId) return null;
  const code = normalizeBranchCode(toStoreCode);
  return `${originSku}--${code || toStoreId}`;
}
