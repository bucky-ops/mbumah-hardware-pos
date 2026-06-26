// GET /api/kra/invoices
//
// List InvoiceForKRA rows for a store, with filters + pagination.
//
// Query params:
//   storeId       — required (enforced by requireStoreAccess)
//   status        — PENDING | SUBMITTED | ACCEPTED | REJECTED | FAILED
//   transactionId — filter by originating transaction
//   search        — match on kraInvoiceNumber or receiptNumber
//   page          — 1-based (default 1)
//   limit         — default 25, max 100
//   sortBy        — createdAt | submittedAt | acceptedAt | submissionStatus (default createdAt)
//   sortOrder     — asc | desc (default desc)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['PENDING', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'FAILED'];
const VALID_SORT_FIELDS = ['createdAt', 'submittedAt', 'acceptedAt', 'submissionStatus', 'kraInvoiceNumber'];

async function listInvoicesHandler(
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

  const status = searchParams.get('status') || '';
  const transactionId = searchParams.get('transactionId') || '';
  const search = searchParams.get('search') || '';
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '25', 10), 1), 100);
  const sortByRaw = searchParams.get('sortBy') || 'createdAt';
  const sortBy = VALID_SORT_FIELDS.includes(sortByRaw) ? sortByRaw : 'createdAt';
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

  const where: Record<string, unknown> = { storeId };
  if (status && VALID_STATUSES.includes(status)) where.submissionStatus = status;
  if (transactionId) where.transactionId = transactionId;
  if (search) {
    where.OR = [
      { kraInvoiceNumber: { contains: search } },
      { transaction: { receiptNumber: { contains: search } } },
    ];
  }

  const [rows, total] = await Promise.all([
    db.invoiceForKRA.findMany({
      where,
      include: {
        transaction: {
          select: {
            id: true,
            receiptNumber: true,
            totalAmount: true,
            paymentMethod: true,
            createdAt: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
        _count: { select: { submissions: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.invoiceForKRA.count({ where }),
  ]);

  // Summary counts by status (for the UI's pipeline cards).
  const statusCounts = await db.invoiceForKRA.groupBy({
    by: ['submissionStatus'],
    where: { storeId },
    _count: true,
  });

  const summary = {
    total,
    byStatus: statusCounts.reduce<Record<string, number>>((acc, row) => {
      acc[row.submissionStatus] = row._count;
      return acc;
    }, {}),
  };

  return Response.json({
    success: true,
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
    summary,
  });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listInvoicesHandler),
  'KRA_INVOICES_LIST',
);
