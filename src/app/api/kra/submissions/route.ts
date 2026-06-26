// GET /api/kra/submissions
//
// List KraSubmission audit rows — the full history of every KRA API call
// (submit attempts, status polls) for a given invoice or store.
//
// Query params:
//   storeId          — required (enforced by requireStoreAccess)
//   invoiceForKraId  — filter to a specific InvoiceForKRA
//   status           — PENDING | SUBMITTED | ACCEPTED | REJECTED | FAILED
//   limit            — default 50, max 200

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['PENDING', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'FAILED'];

async function listSubmissionsHandler(
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

  const invoiceForKraId = searchParams.get('invoiceForKraId') || '';
  const status = searchParams.get('status') || '';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);

  const where: Record<string, unknown> = { storeId };
  if (invoiceForKraId) where.invoiceForKraId = invoiceForKraId;
  if (status && VALID_STATUSES.includes(status)) where.status = status;

  const rows = await db.kraSubmission.findMany({
    where,
    include: {
      invoiceForKra: {
        select: {
          id: true,
          kraInvoiceNumber: true,
          submissionStatus: true,
          transaction: { select: { id: true, receiptNumber: true } },
        },
      },
    },
    orderBy: { submittedAt: 'desc' },
    take: limit,
  });

  return Response.json({ success: true, data: rows });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listSubmissionsHandler),
  'KRA_SUBMISSIONS_LIST',
);
