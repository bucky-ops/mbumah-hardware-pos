// POST /api/payments/mpesa/stkpush
//
// AUDIT REMEDIATION — FINANCIAL_MODULE_AUDIT_REPORT.md:
//   • SYS-1 (P0): this endpoint was unauthenticated — anyone could fire
//     STK pushes to arbitrary phone numbers. Now requires an authenticated
//     session (cashier-level roles).
//   • F6-2 (P0): the initiation logic moved to `src/lib/mpesa-daraja.ts` so
//     the checkout flow can invoke it IN-PROCESS (via the transactional
//     outbox) instead of the broken relative-URL `fetch` it used before.

import { type NextRequest } from 'next/server';
import { withErrorBoundary } from '@/lib/logger';
import { requireAuth } from '@/lib/auth';
import { initiateStkPush } from '@/lib/mpesa-daraja';

export const dynamic = 'force-dynamic';

interface StkPushBody {
  phone?: string;
  phoneNumber?: string;
  amount: number | string;
  accountReference?: string;
  transactionDesc?: string;
  storeId?: string;
  transactionId?: string;
}

async function stkPushHandler(
  request: NextRequest,
  ..._args: unknown[]
): Promise<Response> {
  const body = (await request.json()) as StkPushBody;

  const rawPhone = body.phone || body.phoneNumber;
  const amount = parseFloat(String(body.amount));

  if (!rawPhone || !amount || amount <= 0) {
    return Response.json(
      {
        success: false,
        error: 'phone (or phoneNumber) and a positive amount are required.',
      },
      { status: 400 },
    );
  }

  const result = await initiateStkPush({
    phone: String(rawPhone),
    amount,
    accountReference: body.accountReference,
    transactionDesc: body.transactionDesc,
    storeId: body.storeId,
    transactionId: body.transactionId,
  });

  return Response.json({ success: true, data: result });
}

// SYS-1: session required — any authenticated staff role may trigger a push
// for a sale they are serving (cashiers initiate; the callback settles).
export const POST = withErrorBoundary(
  requireAuth(stkPushHandler as (...args: unknown[]) => Promise<Response>),
  'MPESA_STK_PUSH'
);
