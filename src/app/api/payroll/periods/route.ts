// GET/POST /api/payroll/periods
//
// Manage payroll periods (cycles) for a store.
//   GET  — list periods for a store (optionally filtered by status)
//   POST — create a new payroll period (DRAFT status)

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ── GET: List payroll periods for a store ────────────────────────────────────
async function listPeriodsHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null }
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;

  if (!storeId) {
    return Response.json({ success: true, data: [] });
  }

  const status = searchParams.get('status') || undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

  const where: Record<string, unknown> = { storeId };
  if (status) {
    where.status = status;
  }

  const periods = await db.payrollPeriod.findMany({
    where,
    include: {
      _count: { select: { runs: true } },
    },
    orderBy: { startDate: 'desc' },
    take: limit,
  });

  const data = periods.map((p) => ({
    id: p.id,
    storeId: p.storeId,
    name: p.name,
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    payDate: p.payDate?.toISOString() ?? null,
    status: p.status,
    periodType: p.periodType,
    totalGross: p.totalGross,
    totalDeductions: p.totalDeductions,
    totalNet: p.totalNet,
    employeeCount: p.employeeCount,
    runCount: p._count.runs,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return Response.json({ success: true, data });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listPeriodsHandler),
  'PAYROLL_PERIODS_LIST'
);

// ── POST: Create a new payroll period ────────────────────────────────────────
async function createPeriodHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string }
): Promise<Response> {
  const body = await request.json();

  const { storeId, name, startDate, endDate, payDate, periodType, notes } = body;

  // Validation
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return Response.json(
      { success: false, error: 'Period name is required (e.g. "January 2026").' },
      { status: 400 }
    );
  }
  if (!startDate || !endDate) {
    return Response.json(
      { success: false, error: 'startDate and endDate are required.' },
      { status: 400 }
    );
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return Response.json(
      { success: false, error: 'Invalid date format. Use ISO 8601 (YYYY-MM-DD).' },
      { status: 400 }
    );
  }
  if (start > end) {
    return Response.json(
      { success: false, error: 'startDate must be before or equal to endDate.' },
      { status: 400 }
    );
  }

  // Check for duplicate period name within the store
  const existing = await db.payrollPeriod.findUnique({
    where: { storeId_name: { storeId, name: name.trim() } },
    select: { id: true },
  });
  if (existing) {
    return Response.json(
      { success: false, error: `A payroll period named "${name}" already exists for this store.` },
      { status: 409 }
    );
  }

  const period = await db.payrollPeriod.create({
    data: {
      storeId,
      name: name.trim(),
      startDate: start,
      endDate: end,
      payDate: payDate ? new Date(payDate) : null,
      periodType: periodType || 'MONTHLY',
      status: 'DRAFT',
      notes: notes || null,
    },
  });

  await systemLog({
    action: 'PAYROLL_PERIOD_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Payroll period "${period.name}" created (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)})`,
    storeId,
    userId: session.userId,
    metadata: { periodId: period.id, name: period.name },
  });

  return Response.json({
    success: true,
    data: {
      id: period.id,
      storeId: period.storeId,
      name: period.name,
      startDate: period.startDate.toISOString(),
      endDate: period.endDate.toISOString(),
      payDate: period.payDate?.toISOString() ?? null,
      status: period.status,
      periodType: period.periodType,
      notes: period.notes,
      createdAt: period.createdAt.toISOString(),
      updatedAt: period.updatedAt.toISOString(),
    },
  }, { status: 201 });
}

export const POST = withErrorBoundary(
  requireStoreAccess(createPeriodHandler),
  'PAYROLL_PERIODS_CREATE'
);
