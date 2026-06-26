// GET /api/reminders/debt/overdue
//
// List customers with overdue debts for a store — the data the UI uses to
// render the "Overdue Customers" board before any reminders are sent.
//
// Wraps the identifyOverdueCustomers() helper from src/lib/debt-helpers.ts,
// which aggregates all overdue DebtLedger rows per customer and returns:
//   • customerId / customerName / phone / email
//   • totalOverdue  — sum of all overdue balances
//   • oldestDueDate — the earliest due date among the customer's debts
//   • agingBucket   — the WORST bucket across the customer's debts
//                     (CURRENT < DAYS_30 < DAYS_60 < DAYS_90_PLUS)
//   • debts[]       — per-debt detail (id, balance, dueDate, agingBucket)
//
// Query params:
//   storeId       — required (enforced by requireStoreAccess)
//   daysThreshold — minimum days past due to be included (default 1)
//   limit         — cap the customer count (default 50, max 500)

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess } from '@/lib/auth';
import { identifyOverdueCustomers, AgingBucket } from '@/lib/debt-helpers';

export const dynamic = 'force-dynamic';

// Bucket display order for sorting worst-first.
const BUCKET_ORDER: Record<AgingBucket, number> = {
  CURRENT: 0,
  DAYS_30: 1,
  DAYS_60: 2,
  DAYS_90_PLUS: 3,
};

async function listOverdueHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null },
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;

  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const daysThreshold = Math.max(parseInt(searchParams.get('daysThreshold') || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 500);

  const customers = await identifyOverdueCustomers(storeId, daysThreshold);

  // Sort worst-aging + largest-balance first.
  customers.sort((a, b) => {
    const bucketDiff = BUCKET_ORDER[b.agingBucket] - BUCKET_ORDER[a.agingBucket];
    if (bucketDiff !== 0) return bucketDiff;
    return b.totalOverdue - a.totalOverdue;
  });

  const trimmed = customers.slice(0, limit);

  // Summary aggregates for the UI.
  const summary = {
    customerCount: customers.length,
    totalOverdue: customers.reduce((sum, c) => sum + c.totalOverdue, 0),
    byBucket: {
      DAYS_30: customers.filter((c) => c.agingBucket === AgingBucket.DAYS_30).length,
      DAYS_60: customers.filter((c) => c.agingBucket === AgingBucket.DAYS_60).length,
      DAYS_90_PLUS: customers.filter((c) => c.agingBucket === AgingBucket.DAYS_90_PLUS).length,
    },
  };

  // Also fetch how many PENDING reminders exist per customer — useful for
  // the UI to show "reminder scheduled" badges alongside each customer.
  const pendingCounts = await db.debtReminder.groupBy({
    by: ['customerId'],
    where: {
      storeId,
      status: 'PENDING',
      customerId: { in: trimmed.map((c) => c.customerId) },
    },
    _count: true,
  });
  const pendingMap = new Map(pendingCounts.map((r) => [r.customerId, r._count]));

  const data = trimmed.map((c) => ({
    ...c,
    pendingReminders: pendingMap.get(c.customerId) || 0,
  }));

  return Response.json({ success: true, data, summary });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listOverdueHandler),
  'DEBT_OVERDUE_LIST',
);
