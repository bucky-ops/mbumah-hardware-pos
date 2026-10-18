// GET /api/payroll/period-journal/account/export?periodId=...&accountCode=...
//
// v2.103.0: the account files its month — the governed CSV of the EXACT
// replay the movement dialog (v2.102.0) shows, through the same server
// builder family the period ledger export (v2.101.0), the report tabs
// (v2.58), the desk report (v2.70), the run digest (v2.53) and the
// performance exports (v2.96–v2.99) file through. The filing family reaches
// the drill's deepest layer: what an account's month looked like can now
// leave the console as a file, not a screenshot.
//
// Contract:
//   • Guard: hr.payroll.read.all — the SAME guard the ledger route, the
//     drawer route and the account route answer through; the export widens
//     nothing. Who may read an account's movement may file it.
//   • The file is the whole replay (no cap — a period is a bounded month),
//     chronological (the dialog's order), one row per posted line, plus an
//     Opening / Month totals / Closing footer whose Closing balance cell IS
//     the last replay row's running cell — the file closes its own loop.
//   • Nothing posted inside the window → 404 NO_MOVEMENT_DATA (never an
//     empty-looking sheet).
//   • Exports are audit logged (PAYROLL_ACCOUNT_MOVEMENT_EXPORTED) with
//     field-name-only metadata — counts, sizes and the account CODE ride
//     the row; employee names ride nothing.
//   • The query mirrors the account route's EXACTLY (same scoping, same
//     isPosted + !isVoided honesty, same inclusive window arithmetic) —
//     the file cannot disagree with the screen because it is built from
//     the same truth, through the same pure builder.

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import {
  buildAccountMovement,
  accountMovementToCsv,
  type AccountMovementSource,
} from '@/lib/hr/payroll/period-journal';
import { digestOrgAndScope } from '@/lib/hr/report-schedule-service';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(async (request, session) => {
  try {
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

    // The window is the period's own days inclusive: [startDate, endDate + 1 day) —
    // the account route's exact arithmetic, the file cannot disagree with the screen.
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

    if (movement.movements.length === 0) {
      return Response.json(
        {
          success: false,
          error: 'Nothing posted on this account inside the window — nothing to file.',
          code: 'NO_MOVEMENT_DATA',
        },
        { status: 404 },
      );
    }

    const { organizationName, scopeLabel } = await digestOrgAndScope(
      session.organizationId,
      session.storeId ?? null,
    );

    const windowLabel = `${period.startDate.toISOString().slice(0, 10)} → ${period.endDate.toISOString().slice(0, 10)}`;
    const file = accountMovementToCsv(movement, {
      organizationName,
      scopeLabel,
      periodName: period.name,
      windowLabel,
    });
    // Unreachable while movements.length > 0 (the builder's only null path is
    // the empty replay), but the guard keeps the route honest.
    if (!file) {
      return Response.json(
        {
          success: false,
          error: 'Nothing posted on this account inside the window — nothing to file.',
          code: 'NO_MOVEMENT_DATA',
        },
        { status: 404 },
      );
    }

    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PAYROLL_ACCOUNT_MOVEMENT_EXPORTED',
      resourceType: HrEntityType.DATA_EXPORT,
      resourceId: file.filename,
      storeId: session.storeId ?? undefined,
      metadata: {
        accountCode: account.code,
        count: movement.movements.length,
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
