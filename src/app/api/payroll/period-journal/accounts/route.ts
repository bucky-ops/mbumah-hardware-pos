// GET /api/payroll/period-journal/accounts?periodId=...
// v2.105.0 — the ledger answers for any account.
//
// Until now the drill opened only where a ledger line happened to sit: an
// account this period never touched was unreachable, however real its year.
// The picker's index fixes the reach — the org's chart of accounts, lite,
// each row carrying how many posted, never-voided lines it owns INSIDE the
// anchored period's own days ([startDate, endDate + 1 day) — the exact
// bounds the drill serves, so "in this month" on a suggestion means the
// same window the drill will replay).
//
// GUARD: exactly the drill route's read contract — same permission
// (hr.payroll.read.all), same roles. Listing who may be asked widens
// nothing: who may read the ledger may read the chart it draws from.
//
// TENANT SCOPE: the period resolves store-scoped first (404 for a foreign
// one); the accounts resolve through the store's organization (accounts
// are unique per org+code); the activity count groups lines under the
// store's posted, never-voided journal entries only — a voided entry is a
// closed door (the ledger's stance), an unposted one does not exist yet.
//
// HONESTY: a READ endpoint — no audit row (only exports land those). The
// index is display data for the picker; the drill route remains the one
// truth about what an account actually posted. An account with zero lines
// in the window is listed with periodLines 0 — quiet is a fact, not an
// error, and the badge says so instead of hiding the account.

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(async (request, session) => {
  const url = new URL(request.url);
  const periodId = url.searchParams.get('periodId');
  if (!periodId) {
    return Response.json(
      { success: false, error: 'periodId is required.' },
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
  if (!store) {
    return Response.json(
      { success: false, error: 'Store not found.' },
      { status: 404 },
    );
  }

  const accounts = await db.account.findMany({
    where: { organizationId: store.organizationId },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true, type: true, normalBalance: true },
  });

  // The period's own days, INCLUSIVE of the last one — the same bounds the
  // account route serves, so the badge and the replay can never disagree
  // about what "this month" means.
  const monthEnd = new Date(period.endDate);
  monthEnd.setUTCDate(monthEnd.getUTCDate() + 1);
  const activity = await db.journalEntryLine.groupBy({
    by: ['accountId'],
    where: {
      journalEntry: {
        storeId: session.storeId || '',
        isPosted: true,
        isVoided: false,
        entryDate: { gte: period.startDate, lt: monthEnd },
      },
    },
    _count: { _all: true },
  });
  const counts = new Map(activity.map((row) => [row.accountId, row._count._all]));

  return Response.json({
    success: true,
    data: {
      period: { id: period.id, name: period.name },
      count: accounts.length,
      accounts: accounts.map((a) => ({
        code: a.code,
        name: a.name,
        type: a.type,
        normalBalance: a.normalBalance,
        periodLines: counts.get(a.id) ?? 0,
      })),
    },
  });
});
