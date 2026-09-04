'use client';

/**
 * receipt-qr — QR payload construction for receipts.
 *
 * PAYLOAD FORMAT (prompt Phase 3):
 *   `TX:<receiptNumber>|Date:<createdAt ISO>|Total:<totalAmount>`
 *
 * A self-contained summary is used instead of a verification URL because the
 * app does not (yet) expose a public /verify/:id endpoint — a QR encoding a
 * URL would 404 when scanned. Swap `buildReceiptQrPayload` to the URL format
 * once a public verification route ships; no other code needs to change.
 */

import type { TransactionItem } from '@/lib/api';

export function buildReceiptQrPayload(transaction: TransactionItem): string {
  return [
    `TX:${transaction.receiptNumber}`,
    `Date:${transaction.createdAt}`,
    `Total:${transaction.totalAmount}`,
  ].join('|');
}
