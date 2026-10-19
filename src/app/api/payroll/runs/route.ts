// GET  /api/payroll/runs - list runs (optionally ?periodId=)
// POST /api/payroll/runs - create a run (hr.payroll.prepare)
//
// v2.18.9: this endpoint now drives the EMS run lifecycle. The list keeps the
// legacy tab contract (periodName, numeric money fields, detailCount) so the
// existing POS Payroll tab keeps rendering; new consumers read the same
// payload plus the lifecycle fields.
// v2.86.0: submittedAt/submittedById join the additive payload — the runs
// table shows the handover's age on every waiting run ("waiting since EAT").
//
// ?process=true (legacy tab "run payroll now"): the governed lifecycle never
// auto-posts (spec rule 21 - the preparer cannot approve, and posting needs a
// maker-checked approval). The flag now maps to prepare + submit-for-approval:
// payslips are computed and the run lands in PENDING_APPROVAL instead of
// silently ignoring the flag.

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import {
  createPayrollRun,
  preparePayrollRun,
  submitPayrollRun,
  payrollActorContext,
  PayrollLifecycleError,
} from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;
const PREPARE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

const toMoney = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(async (request, session) => {
  const url = new URL(request.url);
  const periodId = url.searchParams.get('periodId') ?? url.searchParams.get('payrollPeriodId') ?? undefined;
  const status = url.searchParams.get('status') || undefined;
  const runs = await db.payrollRun.findMany({
    where: {
      storeId: session.storeId || '',
      ...(periodId ? { payrollPeriodId: periodId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      payrollPeriod: { select: { name: true, payDate: true, startDate: true, endDate: true } },
      _count: { select: { details: true, gateEvents: true } },
      // The last attempt's outcome — newest clock wins, createdAt breaks
      // ties (two attempts can share a clock only in a same-instant tx).
      gateEvents: {
        orderBy: [{ checkedAt: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: { outcome: true },
      },
    },
  });
  const data = runs.map((r) => ({
    id: r.id,
    payrollPeriodId: r.payrollPeriodId,
    storeId: r.storeId,
    runType: r.runType,
    status: r.status,
    initiatedBy: r.initiatedBy,
    processedAt: r.processedAt?.toISOString() ?? null,
    paidAt: r.paidAt?.toISOString() ?? null,
    totalGross: toMoney(r.totalGross),
    totalDeductions: toMoney(r.totalDeductions),
    totalNet: toMoney(r.totalNet),
    employeeCount: r.employeeCount,
    errorMessage: r.errorMessage,
    detailCount: r._count.details,
    journalEntryId: r.journalEntryId,
    preparedByUserId: r.preparedByUserId,
    // v2.86.0: the handover's stamp rides the list too, so the runs table can
    // say how long a PENDING_APPROVAL run has been waiting (additive).
    submittedAt: r.submittedAt?.toISOString() ?? null,
    submittedById: r.submittedById,
    approvedByUserId: r.approvedByUserId,
    // v2.135.0: the frozen gate verdict rides the list (additive) — the runs
    // table can say what the gate said when this run was prepared, without a
    // per-run detail fetch. Null for pre-v2.135.0 runs (honest absence).
    gateCheckedAt: r.gateCheckedAt?.toISOString() ?? null,
    gateSummary: r.gateSummary ?? null,
    // v2.139.0: the trail's compact surface rides too — the run's attempt
    // count (one gateEvents row per prepare attempt since v2.138.0) and the
    // LAST attempt's outcome, so the table answers "how did this run get
    // here" at a glance. Zero for pre-v2.138.0 runs (honest absence — the
    // chip renders nothing, never a guessed attempt).
    gateAttemptCount: r._count.gateEvents,
    gateLastOutcome: r.gateEvents[0]?.outcome ?? null,
    periodName: r.payrollPeriod.name,
    periodStartDate: r.payrollPeriod.startDate.toISOString(),
    periodEndDate: r.payrollPeriod.endDate.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    payrollPeriod: r.payrollPeriod,
  }));
  return Response.json({ success: true, data });
});

export const POST = hrGuard('hr.payroll.prepare', PREPARE_ROLES)(async (request, session) => {
  const body = await readJson(request);
  const process = new URL(request.url).searchParams.get('process') === 'true';
  if (typeof body.payrollPeriodId !== 'string') {
    return Response.json(
      { success: false, error: 'payrollPeriodId is required.' },
      { status: 400 },
    );
  }
  try {
    const ctx = payrollActorContext(session);
    const { run, replay } = await createPayrollRun(ctx, {
      payrollPeriodId: body.payrollPeriodId,
      runType: typeof body.runType === 'string' ? body.runType : undefined,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
    });

    let finalRun = run;
    if (process && !replay) {
      // Legacy "run payroll now" → governed lifecycle: compute payslips and
      // submit for maker-checked approval. Posting still requires a
      // different approver; nothing can auto-post through this route.
      await preparePayrollRun(ctx, run.id);
      finalRun = await submitPayrollRun(ctx, run.id);
    }
    return Response.json(
      { success: true, data: finalRun, replay },
      { status: replay ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof PayrollLifecycleError && error.issues) {
      return Response.json(
        {
          success: false,
          error: error.message.replace(/^[A-Z_]+: /, ''),
          code: error.code,
          issues: error.issues,
        },
        { status: error.status },
      );
    }
    const mapped = payrollErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
});
