// MBUMAH HARDWARE POS - STK Push in-flight dedupe (v2.18.3.2)
//
// Natural-window idempotency for M-Pesa STK Push initiation. The M-Pesa
// callback route is already idempotent (terminal-state gate + atomic claim +
// one-receipt-per-store unique constraint), so a retried callback can never
// double post; what this module closes is the double PROMPT: a client retry
// after a network blip used to fire a second Daraja STK Push for the same
// payment, making the customer's phone ring twice.
//
// Design constraints honored:
//   - No schema change, no unique index, no data migration: the dedupe is a
//     query over existing MpesaTransaction rows (status PENDING/PROCESSING).
//   - Optional and backward compatible: callers that send no idempotencyKey
//     keep the exact pre-v2.18.3.2 behavior.
//   - Window-bounded (default 10 minutes): a legitimate NEW payment with the
//     same phone and amount after the window always initiates normally.
//   - Per-instance (in one shared database across all branches, the query
//     itself is cross-instance; only callers that pass a different storeId
//     or a different phone/amount never collide).

import { db } from '@/lib/db';

export const STK_IDEMPOTENCY_WINDOW_MINUTES = 10;

export interface InFlightStkPushQuery {
  /** Resolved, scope-safe store id (optional: null matches any store). */
  storeId?: string | null;
  /** Raw phone as received; normalised with the Daraja helper internally. */
  phone: string;
  amount: number;
  /** Lookup window in minutes (default 10). */
  windowMinutes?: number;
}

export interface InFlightStkPushMatch {
  id: string;
  checkoutRequestId: string | null;
  phoneNumber: string | null;
  amount: unknown;
  status: string;
  createdAt: Date;
}

/**
 * Find an in-flight STK Push for the same store + phone + amount within the
 * dedupe window. Returns the most recent match, or null when the caller
 * should initiate a fresh push.
 */
export async function findInFlightStkPush(
  query: InFlightStkPushQuery
): Promise<InFlightStkPushMatch | null> {
  const { normalisePhone } = await import('@/lib/mpesa-daraja');
  const phone = normalisePhone(String(query.phone || ''));
  if (!phone) return null;

  const windowMinutes = query.windowMinutes ?? STK_IDEMPOTENCY_WINDOW_MINUTES;
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  const match = await db.mpesaTransaction.findFirst({
    where: {
      status: { in: ['PENDING', 'PROCESSING'] },
      phoneNumber: phone,
      amount: query.amount,
      createdAt: { gte: since },
      ...(query.storeId ? { storeId: query.storeId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      checkoutRequestId: true,
      phoneNumber: true,
      amount: true,
      status: true,
      createdAt: true,
    },
  });

  return match ?? null;
}
