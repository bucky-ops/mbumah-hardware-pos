// GET /api/payroll/period-journal/export?periodId=...
//
// v2.101.0: the ledger files itself — the governed CSV of the EXACT entries
// the period ledger drawer (v2.100.0) shows, through the same server builder
// family the report tabs (v2.58), the desk report (v2.70), the run digest
// (v2.53) and the performance exports (v2.96–v2.99) file through. The filing
// family reaches the payroll ledger: what a month POSTED can now leave the
// console as a file, not a screenshot.
//
// Contract:
//   • Guard: hr.payroll.read.all — the SAME guard the runs list and the
//     ledger route answer through; the export widens nothing. Who may read
//     a period's journals may file them.
//   • The file is the whole period's posted journals (no cap — a period is
//     a bounded month, not a stream), entries newest first (the drawer's
//     order), one row per journal line, plus a Totals line that proves the
//     file balances BY ITSELF.
//   • No posted entries → 404 NO_LEDGER_DATA (never an empty-looking sheet).
//   • Exports are audit logged (PAYROLL_PERIOD_LEDGER_EXPORTED) with
//     field-name-only metadata — counts and sizes ride the row, never
//     employee names.

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { buildPeriodLedger, periodLedgerToCsv, type LedgerEntrySource } from '@/lib/hr/payroll/period-journal';
import { digestOrgAndScope } from '@/lib/hr/report-schedule-service';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(async (request, session) => {
  try {
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

    // The SAME shape the drawer's rows come from — the file cannot disagree
    // with the screen (scope, shape, order all inherited).
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
      if (!run.journalEntry) continue;
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
    const ledger = buildPeriodLedger(entries, runs.map((r) => ({ id: r.id, runType: r.runType, status: r.status })));

    if (ledger.entries.length === 0) {
      return Response.json(
        { success: false, error: 'Nothing has posted in this period — nothing to file.', code: 'NO_LEDGER_DATA' },
        { status: 404 },
      );
    }

    const { organizationName, scopeLabel } = await digestOrgAndScope(
      session.organizationId,
      session.storeId ?? null,
    );

    // The window is the PERIOD'S OWN range — a period is a bounded month,
    // the file covers it whole; no cap means no cap-honesty line needed.
    const windowLabel = `${period.startDate.toISOString().slice(0, 10)} → ${period.endDate.toISOString().slice(0, 10)}`;
    const file = periodLedgerToCsv(ledger.entries, {
      organizationName,
      scopeLabel,
      periodName: period.name,
      windowLabel,
    });
    // Unreachable while entries.length > 0 (the builder's only null path is
    // the empty list), but the guard keeps the route honest.
    if (!file) {
      return Response.json(
        { success: false, error: 'Nothing has posted in this period — nothing to file.', code: 'NO_LEDGER_DATA' },
        { status: 404 },
      );
    }

    const lineCount = ledger.entries.reduce((s, e) => s + e.lines.length, 0);
    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PAYROLL_PERIOD_LEDGER_EXPORTED',
      resourceType: HrEntityType.DATA_EXPORT,
      resourceId: file.filename,
      storeId: session.storeId ?? undefined,
      metadata: {
        count: ledger.entries.length,
        lineCount,
        byteSize: file.byteSize,
        format: 'csv',
        channel: 'ad_hoc_download',
        window: windowLabel,
        period: period.name,
      },
    }).catch(() => undefined);

    return new Response(file.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Content-Length': String(file.byteSize),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
