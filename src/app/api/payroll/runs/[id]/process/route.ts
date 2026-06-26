// POST /api/payroll/runs/[id]/process
//
// Process an existing DRAFT payroll run: calculate pay for all active
// employees, create PayrollDetail records, update aggregate totals.
//
// This is the "process now" endpoint — called after a run is created in
// DRAFT status, or to retry a FAILED run.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';
import { processPayrollRun } from '@/lib/payroll-helpers';

export const dynamic = 'force-dynamic';

async function processRunHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
  ...args: unknown[]
): Promise<Response> {
  // Extract the run ID from the route params (Next.js 16 passes params via args)
  const params = args[0] as { id: string };
  const runId = params?.id;

  if (!runId) {
    return Response.json(
      { success: false, error: 'Payroll run ID is required.' },
      { status: 400 }
    );
  }

  // Verify the run exists and belongs to the caller's store
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, storeId: true, status: true, payrollPeriod: { select: { name: true } } },
  });

  if (!run) {
    return Response.json(
      { success: false, error: 'Payroll run not found.' },
      { status: 404 }
    );
  }

  // Tenant scoping: non-admin can only process their own store's runs
  if (session.storeId && run.storeId !== session.storeId && session.role !== 'SUPER_ADMIN') {
    return Response.json(
      { success: false, error: 'You can only process payroll runs for your own store.' },
      { status: 403 }
    );
  }

  if (run.status === 'COMPLETED' || run.status === 'PAID') {
    return Response.json(
      {
        success: false,
        error: `Payroll run is already ${run.status}. Void it first to reprocess.`,
        code: 'ALREADY_PROCESSED',
      },
      { status: 409 }
    );
  }

  // Process the run
  const result = await processPayrollRun(runId, session.userId);

  await systemLog({
    action: 'PAYROLL_RUN_PROCESS_TRIGGERED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Payroll run processed for period "${run.payrollPeriod.name}": ${result.employeeCount} employees, net KES ${result.totalNet.toLocaleString()}${result.errors.length > 0 ? `, ${result.errors.length} error(s)` : ''}`,
    storeId: run.storeId,
    userId: session.userId,
    metadata: {
      runId,
      employeeCount: result.employeeCount,
      totalGross: result.totalGross,
      totalNet: result.totalNet,
      errorCount: result.errors.length,
    },
  });

  return Response.json({
    success: true,
    data: {
      payrollRunId: result.payrollRunId,
      employeeCount: result.employeeCount,
      totalGross: result.totalGross,
      totalDeductions: result.totalDeductions,
      totalNet: result.totalNet,
      errors: result.errors,
      status: result.errors.length === 0 ? 'COMPLETED' : 'COMPLETED_WITH_ERRORS',
    },
  });
}

export const POST = withErrorBoundary(
  requireStoreAccess(processRunHandler),
  'PAYROLL_RUN_PROCESS'
);
