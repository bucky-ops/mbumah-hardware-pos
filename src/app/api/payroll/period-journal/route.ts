// GET /api/payroll/period-journal?periodId=... — the period's journal entries
// (v2.100.0: the period opens its ledger).
//
// The runs table reads as periods (v2.98) and the header does the honest
// settled-money arithmetic — but the journal story lived in the accounting
// module, one navigation away. This endpoint hands the drawer the month's
// actual posted entries: per settled run, its combined journal (keyed
// payroll-run:{id}) with every line's account resolved.
//
// GUARD: exactly the runs list's read contract — same permission
// (hr.payroll.read.all), same roles. Reading a period's ledger widens
// nothing: who may see the runs may see what those runs posted.
//
// HONESTY: only POSTED/LOCKED runs carry journals (they posted them); runs
// in motion are returned as counts via the pure builder (period-journal.ts),
// never priced. A settled run with a missing journal is surfaced, not
// skipped — the header's arithmetic must be checkable down to the lines.

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { buildPeriodLedger, type LedgerEntrySource } from '@/lib/hr/payroll/period-journal';

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
    select: { id: true, name: true, startDate: true, endDate: true, payDate: true },
  });
  if (!period) {
    return Response.json(
      { success: false, error: 'Payroll period not found.' },
      { status: 404 },
    );
  }

  const runs = await db.payrollRun.findMany({
    where: { payrollPeriodId: periodId, storeId: session.storeId || '' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      runType: true,
      status: true,
      journalEntry: {
        select: {
          entryNumber: true,
          entryDate: true,
          description: true,
          totalDebit: true,
          totalCredit: true,
          lines: {
            orderBy: { createdAt: 'asc' },
            select: {
              debit: true,
              credit: true,
              description: true,
              account: { select: { code: true, name: true, type: true } },
            },
          },
        },
      },
    },
  });

  const entries: LedgerEntrySource[] = [];
  for (const run of runs) {
    if (!run.journalEntry) continue; // in-motion runs carry no journal — the builder counts them
    const je = run.journalEntry;
    entries.push({
      runId: run.id,
      runType: run.runType,
      entryNumber: je.entryNumber,
      entryDate: je.entryDate.toISOString(),
      description: je.description,
      totalDebit: Number(je.totalDebit),
      totalCredit: Number(je.totalCredit),
      lines: je.lines.map((l) => ({
        accountCode: l.account.code,
        accountName: l.account.name,
        accountType: l.account.type,
        debit: Number(l.debit),
        credit: Number(l.credit),
        description: l.description,
      })),
    });
  }

  const ledger = buildPeriodLedger(
    entries,
    runs.map((r) => ({ id: r.id, runType: r.runType, status: r.status })),
  );

  return Response.json({
    success: true,
    data: {
      period: {
        id: period.id,
        name: period.name,
        startDate: period.startDate.toISOString(),
        endDate: period.endDate.toISOString(),
        payDate: period.payDate?.toISOString() ?? null,
      },
      ...ledger,
    },
  });
});
