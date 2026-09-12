// POST /api/payroll/runs/[id]/void
//
// Void a payroll run that was never paid and never posted to the general
// ledger. This is the functional "correcting entry" for broken runs — e.g.
// the June 2026 SUPPLEMENTAL run that booked deductions (housing levy) on
// zero earnings, producing netPay −2,699.99 — without polluting the GL with
// a reversing journal entry for a transaction that never posted.
//
// Guards (a run can ONLY be voided when it is safe to do so):
//   1. Run exists (404) and belongs to the caller's store (403).
//   2. Run is not already PAID or VOIDED (409).
//   3. NO detail row has paymentStatus PAID (money never left the till).
//   4. NO journal entry references this run (nothing to reverse in the GL).
//
// The run keeps its totals for audit purposes; status becomes VOIDED and a
// human-readable reason is recorded. Audit trail entry is written.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function voidRunHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
  ...args: unknown[]
): Promise<Response> {
  // NEXT-16 FIX: dynamic route context arrives as { params: Promise<{ id }> }
  // — the wrapper forwards it via args.slice(1), so args[0] is the context,
  // NOT the params object itself.
  const context = args[0] as RouteContext | undefined;
  if (!context?.params) {
    return Response.json(
      { success: false, error: 'Payroll run ID is required.' },
      { status: 400 }
    );
  }
  const { id: runId } = await context.params;

  if (!runId) {
    return Response.json(
      { success: false, error: 'Payroll run ID is required.' },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const reason = typeof (body as { reason?: unknown })?.reason === 'string'
    ? (body as { reason: string }).reason.trim().slice(0, 500)
    : '';

  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { payrollPeriod: { select: { name: true } } },
  });

  if (!run) {
    return Response.json(
      { success: false, error: 'Payroll run not found.' },
      { status: 404 }
    );
  }

  // Tenant scoping: non-admin can only void their own store's runs
  if (session.storeId && run.storeId !== session.storeId && session.role !== 'SUPER_ADMIN') {
    return Response.json(
      { success: false, error: 'You can only void payroll runs for your own store.' },
      { status: 403 }
    );
  }

  if (run.status === 'PAID') {
    return Response.json(
      { success: false, error: 'Payroll run is PAID — money has moved. Use a reversing run / journal entry through finance instead.' },
      { status: 409 }
    );
  }
  if (run.status === 'VOIDED') {
    return Response.json(
      { success: false, error: 'Payroll run is already VOIDED.' },
      { status: 409 }
    );
  }

  // Guard: no employee may have been paid on this run
  const paidDetails = await db.payrollDetail.count({
    where: { payrollRunId: runId, paymentStatus: 'PAID' },
  });
  if (paidDetails > 0) {
    return Response.json(
      { success: false, error: `${paidDetails} payslip(s) on this run are already PAID — cannot void. Use finance to reverse instead.` },
      { status: 409 }
    );
  }

  // Guard: no journal entry may reference this run (GL is untouched → void is safe)
  const linkedJournal = await db.journalEntry.findFirst({
    where: { referenceType: 'PAYROLL', referenceId: runId },
    select: { id: true, entryNumber: true },
  });
  if (linkedJournal) {
    return Response.json(
      { success: false, error: `Run has posted journal entry ${linkedJournal.entryNumber} — cannot void here. Use a reversing journal entry through finance.` },
      { status: 409 }
    );
  }

  const voidedRun = await db.payrollRun.update({
    where: { id: runId },
    data: {
      status: 'VOIDED',
      errorMessage: `[VOIDED by ${session.email}] ${reason || 'No reason provided.'}`,
    },
    include: { payrollPeriod: { select: { name: true } } },
  });

  await systemLog({
    action: 'PAYROLL_RUN_VOIDED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Payroll run ${voidedRun.payrollPeriod.name} (${run.runType}) voided by ${session.email}. Reason: ${reason || 'not provided'}`,
    storeId: run.storeId,
    userId: session.userId,
    metadata: {
      runId,
      previousStatus: run.status,
      totalGross: Number(run.totalGross),
      totalDeductions: Number(run.totalDeductions),
      totalNet: Number(run.totalNet),
      reason: reason || null,
    },
  });

  // Tamper-evident audit entry (best-effort — never blocks the void)
  try {
    const { auditTrail } = await import('@/lib/audit-trail');
    await auditTrail.log({
      action: 'UPDATE',
      resourceType: 'PayrollRun',
      resourceId: runId,
      actorId: session.userId,
      storeId: run.storeId,
      oldValues: { status: run.status },
      newValues: { status: 'VOIDED', reason: reason || null },
    });
  } catch (error) {
    console.error('Failed to write audit entry for payroll run void:', error);
  }

  return Response.json({
    success: true,
    data: {
      id: voidedRun.id,
      status: voidedRun.status,
      periodName: voidedRun.payrollPeriod.name,
      runType: voidedRun.runType,
      previousTotals: {
        totalGross: Number(voidedRun.totalGross),
        totalDeductions: Number(voidedRun.totalDeductions),
        totalNet: Number(voidedRun.totalNet),
      },
    },
  });
}

export const POST = withErrorBoundary(
  requireStoreAccess(voidRunHandler),
  'PAYROLL_RUN_VOID'
);
