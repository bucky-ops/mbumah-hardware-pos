// GET /api/etims/invoices?storeId=xxx&status=ISSUED
//
// List SalesTransaction rows that have an eTIMS invoice number (i.e. were
// submitted to KRA via the new /api/etims/issue-invoice route). Returns a
// lightweight projection suitable for the eTIMS invoice-history table.
//
// Query params:
//   storeId — required
//   status  — optional filter: PENDING | ISSUED | CANCELLED | FAILED
//   limit   — default 50, max 200
//
// Auth: any authenticated user with store access.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['PENDING', 'ISSUED', 'CANCELLED', 'FAILED'];

async function listInvoicesHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null },
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;
  if (!storeId) {
    return Response.json({ success: false, error: 'storeId is required.' }, { status: 400 });
  }

  const status = searchParams.get('status') || '';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);

  const where: Record<string, unknown> = {
    storeId,
    etimsInvoiceNumber: { not: null },
  };
  if (status && VALID_STATUSES.includes(status)) {
    where.etimsStatus = status;
  }

  const transactions = await db.salesTransaction.findMany({
    where,
    select: {
      id: true,
      receiptNumber: true,
      totalAmount: true,
      paymentMethod: true,
      createdAt: true,
      etimsInvoiceNumber: true,
      etimsQrCode: true,
      etimsUrl: true,
      etimsStatus: true,
      etimsIssuedAt: true,
      customer: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Summary counts by status (for the dashboard cards).
  const statusCounts = await db.salesTransaction.groupBy({
    by: ['etimsStatus'],
    where: { storeId, etimsInvoiceNumber: { not: null } },
    _count: true,
  });

  const summary = statusCounts.reduce<Record<string, number>>((acc, row) => {
    if (row.etimsStatus) acc[row.etimsStatus] = row._count;
    return acc;
  }, {});

  return Response.json({
    success: true,
    data: transactions,
    summary,
  });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listInvoicesHandler),
  'ETIMS_INVOICES_LIST',
);
