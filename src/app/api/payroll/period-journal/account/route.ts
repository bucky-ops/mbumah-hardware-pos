// GET /api/payroll/period-journal/account?periodId=...&accountCode=...[&window=month|year]
// The account opens its month (v2.102.0) — and, since v2.104.0, its year.
//
// Click a ledger line and the account's month movement opens beside the
// drawer. This endpoint hands that drill its whole story, resolved from
// the REAL journal — not just the drawer's payroll entries:
//   • opening — every POSTED, never-voided line the account carries before
//     the window's first day (any source: sales, payments, payroll),
//     aggregated, not guessed; zero prior lines means the account starts
//     the month (or the year) at zero and says so;
//   • movements — the posted lines INSIDE the window's days, chronological
//     (oldest first, stable on equal stamps) so the running balance tells
//     the story forward;
//   • the pure builder (period-journal.ts) recomputes the running balance
//     on the account's NORMAL side and proves the closing at money
//     precision — the route never trusts its own sums.
//
// v2.104.0 — THE YEAR WINDOW: window=year widens the drill to the calendar
// year the period's first day lives in ([Jan 1, next Jan 1) in UTC — no
// timezone roulette on stored dates). The periodId still anchors the year
// AND the scope: the period is tenant-resolved first, its year derived from
// its own startDate. The response echoes window and names the period
// honestly ('2026', not a fake period) so the UI cannot call a year a
// month. An unknown window value is a 400, never a silent month — a
// category that does not exist must not be invented.
//
// GUARD: exactly the ledger route's read contract — same permission
// (hr.payroll.read.all), same roles. Reading an account's movement widens
// nothing: who may read the ledger may read what it posted, account by
// account, month by month, year by year.
//
// HONESTY: isPosted + !isVoided everywhere — a voided entry is a closed
// door (same stance as the drawer), an unposted entry does not exist yet.
// The window is INCLUSIVE of its days: month = [startDate, endDate + 1
// day); year = [Jan 1, next Jan 1) — an entry posted on the closing day
// belongs to its window, midnight of the day after does not. A read
// endpoint, like the ledger read: no audit row (only exports land those).

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

  // v2.104.0: the window — 'month' (default, the v2.102 behavior) or 'year'.
  // An unknown value is a 400: a window that does not exist must not
  // silently mean a month.
  const windowParam = url.searchParams.get('window');
  if (windowParam !== null && windowParam !== 'month' && windowParam !== 'year') {
    return Response.json(
      { success: false, error: 'window must be "month" or "year".' },
      { status: 400 },
    );
  }
  const window: 'month' | 'year' = windowParam === 'year' ? 'year' : 'month';

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

  // The window's bounds, INCLUSIVE of its days. Month: the period's own
  // days — [startDate, endDate + 1 day). Year (v2.104.0): the calendar
  // year the period's first day lives in — [Jan 1, next Jan 1) in UTC, no
  // timezone roulette on stored dates. The prior aggregate reaches back
  // over EVERY posted line before the window's first day (any source).
  const year = period.startDate.getUTCFullYear();
  const monthEnd = new Date(period.endDate);
  monthEnd.setUTCDate(monthEnd.getUTCDate() + 1);
  const windowStart = window === 'year' ? new Date(Date.UTC(year, 0, 1)) : period.startDate;
  const windowEnd = window === 'year' ? new Date(Date.UTC(year + 1, 0, 1)) : monthEnd;
  const windowLabel =
    window === 'year'
      ? `${year}-01-01 → ${year}-12-31`
      : `${period.startDate.toISOString().slice(0, 10)} → ${period.endDate.toISOString().slice(0, 10)}`;
  // A year is not a period — the response names it '2026', never a fake
  // period name, and echoes the window so the UI cannot desync.
  const displayName = window === 'year' ? String(year) : period.name;

  const prior = await db.journalEntryLine.aggregate({
    where: {
      accountId: account.id,
      journalEntry: {
        storeId: session.storeId || '',
        isPosted: true,
        isVoided: false,
        entryDate: { lt: windowStart },
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
        entryDate: { gte: windowStart, lt: windowEnd },
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

  // The window label rides the payload — the same label the CSV files.
  return Response.json({
    success: true,
    data: {
      period: { name: displayName, windowLabel },
      window,
      ...movement,
    },
  });
});
