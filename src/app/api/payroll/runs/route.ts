// GET/POST /api/payroll/runs
//
// Manage payroll runs.
//   GET  — list runs for a store or period
//   POST — initiate a new payroll run (DRAFT status) and optionally process it
//          immediately (when ?process=true is passed)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';
import { processPayrollRun } from '@/lib/payroll-helpers';

export const dynamic = 'force-dynamic';

// ── GET: List payroll runs ───────────────────────────────────────────────────
async function listRunsHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null }
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;
  const payrollPeriodId = searchParams.get('payrollPeriodId') || undefined;
  const status = searchParams.get('status') || undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

  if (!storeId && !payrollPeriodId) {
    return Response.json({ success: true, data: [] });
  }

  const where: Record<string, unknown> = {};
  if (storeId) where.storeId = storeId;
  if (payrollPeriodId) where.payrollPeriodId = payrollPeriodId;
  if (status) where.status = status;

  const runs = await db.payrollRun.findMany({
    where,
    include: {
      payrollPeriod: {
        select: { id: true, name: true, startDate: true, endDate: true, status: true },
      },
      _count: { select: { details: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
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
    totalGross: r.totalGross,
    totalDeductions: r.totalDeductions,
    totalNet: r.totalNet,
    employeeCount: r.employeeCount,
    errorMessage: r.errorMessage,
    detailCount: r._count.details,
    periodName: r.payrollPeriod.name,
    periodStartDate: r.payrollPeriod.startDate.toISOString(),
    periodEndDate: r.payrollPeriod.endDate.toISOString(),
    periodStatus: r.payrollPeriod.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return Response.json({ success: true, data });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listRunsHandler),
  'PAYROLL_RUNS_LIST'
);

// ── POST: Initiate (and optionally process) a payroll run ────────────────────
async function createRunHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string }
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const shouldProcess = searchParams.get('process') === 'true';

  const body = await request.json();

  const { payrollPeriodId, storeId, runType } = body;

  if (!payrollPeriodId) {
    return Response.json(
      { success: false, error: 'payrollPeriodId is required.' },
      { status: 400 }
    );
  }
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  // Verify the period exists and belongs to the store
  const period = await db.payrollPeriod.findFirst({
    where: { id: payrollPeriodId, storeId },
  });
  if (!period) {
    return Response.json(
      { success: false, error: 'Payroll period not found for this store.' },
      { status: 404 }
    );
  }

  // Check for an existing non-voided run for this period (avoid duplicates)
  const existingRun = await db.payrollRun.findFirst({
    where: {
      payrollPeriodId,
      status: { in: ['DRAFT', 'PROCESSING', 'COMPLETED', 'PAID'] },
    },
    select: { id: true, status: true },
  });
  if (existingRun) {
    return Response.json(
      {
        success: false,
        error: `An active payroll run already exists for period "${period.name}" (status: ${existingRun.status}). Void it first to create a new run.`,
        code: 'RUN_EXISTS',
        existingRunId: existingRun.id,
      },
      { status: 409 }
    );
  }

  // Create the run (DRAFT status)
  const run = await db.payrollRun.create({
    data: {
      payrollPeriodId,
      storeId,
      runType: runType || 'REGULAR',
      status: 'DRAFT',
      initiatedBy: session.userId,
    },
  });

  await systemLog({
    action: 'PAYROLL_RUN_INITIATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Payroll run initiated for period "${period.name}" (${run.runType})`,
    storeId,
    userId: session.userId,
    metadata: { runId: run.id, periodId: payrollPeriodId, runType: run.runType },
  });

  // If ?process=true, immediately process the run
  if (shouldProcess) {
    try {
      const result = await processPayrollRun(run.id, session.userId);

      return Response.json({
        success: true,
        data: {
          id: run.id,
          payrollPeriodId: run.payrollPeriodId,
          storeId: run.storeId,
          runType: run.runType,
          status: result.errors.length === 0 ? 'COMPLETED' : 'COMPLETED_WITH_ERRORS',
          employeeCount: result.employeeCount,
          totalGross: result.totalGross,
          totalDeductions: result.totalDeductions,
          totalNet: result.totalNet,
          errors: result.errors,
          processed: true,
        },
      }, { status: 201 });
    } catch (err) {
      // Processing failed — return the run ID so the user can retry
      return Response.json({
        success: false,
        error: 'Payroll run created but processing failed.',
        detail: err instanceof Error ? err.message : 'Unknown error',
        runId: run.id,
      }, { status: 500 });
    }
  }

  // Return the DRAFT run (user will call /api/payroll/runs/[id]/process to process it)
  return Response.json({
    success: true,
    data: {
      id: run.id,
      payrollPeriodId: run.payrollPeriodId,
      storeId: run.storeId,
      runType: run.runType,
      status: run.status,
      processed: false,
    },
  }, { status: 201 });
}

export const POST = withErrorBoundary(
  requireStoreAccess(createRunHandler),
  'PAYROLL_RUNS_CREATE'
);
