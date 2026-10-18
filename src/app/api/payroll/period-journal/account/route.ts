// GET /api/payroll/period-journal/account?periodId=...&accountCode=...
// The account opens its month (v2.102.0).
//
// Click a ledger line and the account's month movement opens beside the
// drawer. This endpoint hands that drill its whole story, resolved from
// the REAL journal — not just the drawer's payroll entries:
//   • opening — every POSTED, never-voided line the account carries before
//     the period's first day (any source: sales, payments, payroll),
//     aggregated, not guessed; zero prior lines means the account starts
//     the month at zero and says so;
//   • movements — the posted lines INSIDE the period's days, chronological
//     (oldest first, stable on equal stamps) so the running balance tells
//     the story forward;
//   • the pure builder (period-journal.ts) recomputes the running balance
//     on the account's NORMAL side and proves the closing at money
//     precision — the route never trusts its own sums.
//
// GUARD: exactly the ledger route's read contract — same permission
// (hr.payroll.read.all), same roles. Reading an account's movement widens
// nothing: who may read the ledger may read what it posted, account by
// account.
//
// HONESTY: isPosted + !isVoided everywhere — a voided entry is a closed
// door (same stance as the drawer), an unposted entry does not exist yet.
// The window is the period's own days INCLUSIVE: gte startDate, lt
// endDate + 1 day — an entry posted on the closing day belongs to the
// month, midnight of the day after does not. A read endpoint, like the
// ledger read: no audit row (only exports land those).

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import {
  buildAccountMovement,
  type AccountMovementSource,
} from '@/lib/hr/payroll/period-journal';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(async (request, session) => {
  const url = new URL(request.url);
  const periodId = url.searchParams.get('periodId');
  const accountCode = url.searchParams.get('accountCode');
  if (!periodId || !accountCode) {
    return Response.json(
      { success: false, error: 'periodId and accountCode are required.' },
      { status: 400 },
    );
  }

  const period = await db.payrollPeriod.findFirst({
    where: { id: periodId, storeId: session.storeId || '' },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
  if (!period) {
    return Response.json(
      { success: false, error: 'Payroll period not found.' },
      { status: 404 },
    );
  }

  const store = await db.store.findUnique({
    where: { id: session.storeId || '' },
    select: { organizationId: true },
  });
  const account = store
    ? await db.account.findFirst({
        where: { code: accountCode, organizationId: store.organizationId },
        select: { id: true, code: true, name: true, type: true, normalBalance: true },
      })
    : null;
  if (!account) {
    return Response.json(
      { success: false, error: `No account ${accountCode} in this organization.` },
      { status: 404 },
    );
  }

  // The window is the period's own days inclusive: [startDate, endDate + 1 day).
  const windowEnd = new Date(period.endDate);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);

  const prior = await db.journalEntryLine.aggregate({
    where: {
      accountId: account.id,
      journalEntry: {
        storeId: session.storeId || '',
        isPosted: true,
        isVoided: false,
        entryDate: { lt: period.startDate },
      },
    },
    _sum: { debit: true, credit: true },
    _count: { _all: true },
  });

  const monthLines = await db.journalEntryLine.findMany({
    where: {
      accountId: account.id,
      journalEntry: {
        storeId: session.storeId || '',
        isPosted: true,
        isVoided: false,
        entryDate: { gte: period.startDate, lt: windowEnd },
      },
    },
    orderBy: [{ journalEntry: { entryDate: 'asc' } }, { createdAt: 'asc' }],
    select: {
      debit: true,
      credit: true,
      description: true,
      journalEntry: {
        select: {
          entryNumber: true,
          entryDate: true,
          description: true,
          referenceType: true,
          payrollRuns: { select: { runType: true }, take: 1 },
        },
      },
    },
  });

  const sources: AccountMovementSource[] = monthLines.map((l) => ({
    entryNumber: l.journalEntry.entryNumber,
    entryDate: l.journalEntry.entryDate.toISOString(),
    entryDescription: l.journalEntry.description,
    source: l.journalEntry.payrollRuns[0]?.runType ?? l.journalEntry.referenceType ?? 'JOURNAL',
    debit: Number(l.debit),
    credit: Number(l.credit),
    lineDescription: l.description,
  }));

  const movement = buildAccountMovement(
    {
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      normalBalance: account.normalBalance,
    },
    {
      debit: Number(prior._sum.debit ?? 0),
      credit: Number(prior._sum.credit ?? 0),
      priorLines: prior._count._all,
    },
    sources,
  );

  // The period's window, dayKey form — the same label the CSV files.
  const windowLabel = `${period.startDate.toISOString().slice(0, 10)} → ${period.endDate.toISOString().slice(0, 10)}`;

  return Response.json({
    success: true,
    data: {
      period: { name: period.name, windowLabel },
      ...movement,
    },
  });
});
