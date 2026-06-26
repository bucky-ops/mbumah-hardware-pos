// GET /api/reminders/debt
//
// List DebtReminder rows for a store — the audit trail of every reminder sent
// (or scheduled / failed) for overdue customer balances.
//
// Query params:
//   storeId      — required (enforced by requireStoreAccess)
//   status       — PENDING | SENT | FAILED | DELIVERED
//   reminderType — EMAIL | SMS | WHATSAPP | IN_APP
//   customerId   — filter to a specific customer's reminders
//   debtLedgerId — filter to a specific debt ledger's reminders
//   page         — 1-based (default 1)
//   limit        — default 25, max 100
//   sortBy       — sentAt | status | reminderType (default sentAt)
//   sortOrder    — asc | desc (default desc)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['PENDING', 'SENT', 'FAILED', 'DELIVERED'];
const VALID_TYPES = ['EMAIL', 'SMS', 'WHATSAPP', 'IN_APP'];
const VALID_SORT_FIELDS = ['sentAt', 'deliveredAt', 'status', 'reminderType'];

async function listRemindersHandler(
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
  const reminderType = searchParams.get('reminderType') || '';
  const customerId = searchParams.get('customerId') || '';
  const debtLedgerId = searchParams.get('debtLedgerId') || '';
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '25', 10), 1), 100);
  const sortByRaw = searchParams.get('sortBy') || 'sentAt';
  const sortBy = VALID_SORT_FIELDS.includes(sortByRaw) ? sortByRaw : 'sentAt';
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

  const where: Record<string, unknown> = { storeId };
  if (status && VALID_STATUSES.includes(status)) where.status = status;
  if (reminderType && VALID_TYPES.includes(reminderType)) where.reminderType = reminderType;
  if (customerId) where.customerId = customerId;
  if (debtLedgerId) where.debtLedgerId = debtLedgerId;

  const [rows, total] = await Promise.all([
    db.debtReminder.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        debtLedger: {
          select: {
            id: true,
            balance: true,
            dueDate: true,
            agingBucket: true,
          },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.debtReminder.count({ where }),
  ]);

  // Summary counts (for the UI's pipeline cards).
  const statusCounts = await db.debtReminder.groupBy({
    by: ['status'],
    where: { storeId },
    _count: true,
  });
  const channelCounts = await db.debtReminder.groupBy({
    by: ['reminderType'],
    where: { storeId },
    _count: true,
  });

  const summary = {
    total,
    byStatus: statusCounts.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count;
      return acc;
    }, {}),
    byChannel: channelCounts.reduce<Record<string, number>>((acc, row) => {
      acc[row.reminderType] = row._count;
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
  requireStoreAccess(listRemindersHandler),
  'DEBT_REMINDERS_LIST',
);
