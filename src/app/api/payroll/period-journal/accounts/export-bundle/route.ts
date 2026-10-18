// GET /api/payroll/period-journal/accounts/export-bundle?periodId=...
//
// v2.107.0: the chart files its month — one governed exit that files EVERY
// account which posted inside the period's own days as its own CSV,
// zipped, with a MANIFEST that says what was filed and what was not.
//
// The filing family's arc: the period ledger files itself (v2.101.0), an
// account files its month (v2.103.0) and its year (v2.104.0), the picker
// makes any account askable (v2.105.0), the browse door shows the whole
// chart (v2.106.0) — and now the chart files ITSELF. Month-end stops
// being thirty-seven downloads.
//
// Contract:
//   • Guard: hr.payroll.read.all — the SAME guard the ledger route, the
//     drawer route, the accounts index and the single-account export
//     answer through. Who may read the chart may file it; the bundle
//     widens nothing.
//   • MONTH ONLY, by definition: the bundle files the period's own days
//     ([startDate, endDate + 1 day)) — the drawer's scope, the same bounds
//     the index's badges and the drill's month window serve. A year is one
//     account at a time (the account route files it); no window param is
//     accepted here, so the file can never call itself something it is not.
//   • The query mirrors the account route's EXACTLY (same scoping, same
//     isPosted + !isVoided honesty, same inclusive window arithmetic) —
//     the zip cannot disagree with the screen or the single exports
//     because it is built from the same truth, through the same pure
//     builders (buildAccountMovement → accountMovementToCsv →
//     buildAccountBundle).
//   • Quiet is a fact, not a file: an account with zero posted lines in
//     the window produces no CSV (a replay with zero rows has nothing to
//     say — the single route 404s on it), and the MANIFEST says how many
//     were left out and why. Nothing active at all → 404
//     NO_MOVEMENT_DATA (never an empty-looking archive).
//   • Exports are audit logged (PAYROLL_ACCOUNT_MOVEMENTS_BUNDLE_EXPORTED)
//     with COUNTS only — files, lines, bytes, quiet count; employee names
//     ride nothing (the manifest inside the zip carries the account codes,
//     and that is the record).

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import {
  buildAccountMovement,
  accountMovementToCsv,
} from '@/lib/hr/payroll/period-journal';
import { buildAccountBundle, type BundleAccountFile } from '@/lib/hr/payroll/account-bundle';
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

    // The period's own days, INCLUSIVE of the last one — the account
    // route's exact arithmetic, so the bundle, the badges and the drill
    // all serve one window.
    const monthEnd = new Date(period.endDate);
    monthEnd.setUTCDate(monthEnd.getUTCDate() + 1);

    // ONE pass for every account's prior balance (before the window) —
    // the opening aggregate, grouped per account, same honesty the single
    // route serves one account at a time.
    const prior = await db.journalEntryLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: accounts.map((a) => a.id) },
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
    const priorByAccount = new Map(prior.map((row) => [row.accountId, row]));

    // ONE pass for the window's lines, chronological (the dialog's order),
    // grouped per account in memory.
    const monthLines = await db.journalEntryLine.findMany({
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        journalEntry: {
          storeId: session.storeId || '',
          isPosted: true,
          isVoided: false,
          entryDate: { gte: period.startDate, lt: monthEnd },
        },
      },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { createdAt: 'asc' }],
      select: {
        accountId: true,
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
    const linesByAccount = new Map<string, typeof monthLines>();
    for (const line of monthLines) {
      const list = linesByAccount.get(line.accountId);
      if (list) list.push(line);
      else linesByAccount.set(line.accountId, [line]);
    }

    const { organizationName, scopeLabel } = await digestOrgAndScope(
      session.organizationId,
      session.storeId ?? null,
    );

    const windowLabel = `${period.startDate.toISOString().slice(0, 10)} → ${period.endDate.toISOString().slice(0, 10)}`;
    const accountFiles: BundleAccountFile[] = [];

    for (const account of accounts) {
      const lines = linesByAccount.get(account.id);
      if (!lines || lines.length === 0) continue; // quiet is a fact, not a file

      const priorRow = priorByAccount.get(account.id);
      const sources = lines.map((l) => ({
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
          debit: Number(priorRow?._sum.debit ?? 0),
          credit: Number(priorRow?._sum.credit ?? 0),
          priorLines: priorRow?._count._all ?? 0,
        },
        sources,
      );

      const file = accountMovementToCsv(movement, {
        organizationName,
        scopeLabel,
        periodName: period.name,
        windowLabel,
        windowNoun: 'month',
      });
      if (!file) continue; // unreachable while lines.length > 0; the guard keeps the route honest

      accountFiles.push({ accountCode: account.code, lineCount: lines.length, file });
    }

    if (accountFiles.length === 0) {
      return Response.json(
        {
          success: false,
          error: 'Nothing posted on any account inside the window — nothing to bundle.',
          code: 'NO_MOVEMENT_DATA',
        },
        { status: 404 },
      );
    }

    const bundle = buildAccountBundle(accountFiles, {
      organizationName,
      scopeLabel,
      periodName: period.name,
      windowLabel,
      totalAccounts: accounts.length,
      quietCount: accounts.length - accountFiles.length,
    });

    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PAYROLL_ACCOUNT_MOVEMENTS_BUNDLE_EXPORTED',
      resourceType: HrEntityType.DATA_EXPORT,
      resourceId: bundle.filename,
      storeId: session.storeId ?? undefined,
      metadata: {
        files: bundle.fileCount,
        postedLines: bundle.totalLines,
        byteSize: bundle.byteSize,
        quietAccounts: accounts.length - accountFiles.length,
        format: 'zip',
        channel: 'ad_hoc_download',
        window: windowLabel,
        windowKind: 'month',
        period: period.name,
      },
    }).catch(() => undefined);

    return new Response(new Uint8Array(bundle.bytes), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${bundle.filename}"`,
        'Content-Length': String(bundle.byteSize),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
