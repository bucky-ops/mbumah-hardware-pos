'use client';

/**
 * receipt-qr — QR payload construction for receipts.
 *
 * PAYLOAD FORMAT (v2.5.0 — Feature: QR code on receipts):
 *   `<origin>/r/<receiptNumber>` — a link to the PUBLIC DIGITAL RECEIPT page
 *   (src/app/r/[receiptNumber]/page.tsx), which renders a colored, digital,
 *   mobile-friendly copy of the receipt. Scanning the QR with any phone
 *   camera opens it — no app, no login.
 *
 * HISTORY: before v2.5.0 the QR carried a self-contained summary
 * (`TX:<receipt>|Date:<iso>|Total:<amount>`) because no public receipt page
 * existed. The public page ships in v2.5.0, so the QR now links to it.
 * If `window` is unavailable (SSR/prerender of client components) the
 * function falls back to the legacy text payload; the canvas is drawn
 * client-side only, so the URL form is what customers actually scan.
 */

import type { TransactionItem } from '@/lib/api';

export function buildReceiptQrPayload(transaction: TransactionItem): string {
  const receipt = transaction.receiptNumber;

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/r/${encodeURIComponent(receipt)}`;
  }

  // SSR / non-browser fallback (never scanned — canvas renders client-side).
  return [
    `TX:${receipt}`,
    `Date:${transaction.createdAt}`,
    `Total:${transaction.totalAmount}`,
  ].join('|');
}
