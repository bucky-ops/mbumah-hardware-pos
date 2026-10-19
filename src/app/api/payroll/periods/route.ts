// GET  /api/payroll/periods - list payroll periods for the store
// POST /api/payroll/periods - create a period (hr.payroll.prepare)

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';
import { PayrollLifecycleError } from '@/lib/hr/payroll/run-service';
import { bucketPendingDays, type GatePreview } from '@/lib/hr/payroll/gate-preview';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;
const MANAGE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(async (_request, session) => {
  const storeId = session.storeId || '';
  const periods = await db.payrollPeriod.findMany({
    where: { storeId },
    orderBy: { startDate: 'desc' },
    take: 60,
  });

  // v2.137.0: additive gate preview — pre-flight inside the prepare intent.
  // The SAME unapproved + employee where as the run gate (run-gate.ts
  // parity), fetched ONCE for the store (pending days are bounded — the
  // desk exists to clear them) and bucketed per period in memory, so the
  // list never runs one query per period. Consent is period-independent:
  // ONE count rides every row honestly (it would block any period's
  // prepare). A preview failure never kills the periods list — the field
  // degrades to null and the picker says "unavailable", never a guess.
  let gatePreview: GatePreview[] | null = null;
  try {
    const pendingDates = await db.attendanceRecord.findMany({
      where: {
        storeId,
        checkIn: { not: null },
        timesheetApprovedByUserId: null,
        employee: { storeId, deletedAt: null, status: 'ACTIVE' },
      },
      select: { date: true },
    });
    const missingConsent = await db.employee.count({
      where: { storeId, deletedAt: null, status: 'ACTIVE', consentRecords: { none: { withdrawnAt: null } } },
    });
    const checkedAt = new Date().toISOString();
    const buckets = bucketPendingDays(
      pendingDates.map((r) => r.date),
      periods.map((p) => ({
        id: p.id,
        startDate: p.startDate.toISOString(),
        endDate: p.endDate.toISOString(),
      })),
    );
    gatePreview = periods.map((p) => ({
      unapprovedDays: buckets[p.id] ?? 0,
      missingConsent,
      checkedAt,
    }));
  } catch {
    gatePreview = null;
  }

  const data = periods.map((p, i) => ({
    ...p,
    gatePreview: gatePreview ? gatePreview[i] : null,
  }));
  return Response.json({ success: true, data: data });
});

export const POST = hrGuard('hr.payroll.prepare', MANAGE_ROLES)(async (request, session) => {
  const body = await readJson(request);
  const storeId = session.storeId || '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const startDate = typeof body.startDate === 'string' ? new Date(body.startDate) : null;
  const endDate = typeof body.endDate === 'string' ? new Date(body.endDate) : null;
  const periodType = typeof body.periodType === 'string' ? body.periodType : 'MONTHLY';
  const payDate = typeof body.payDate === 'string' ? new Date(body.payDate) : null;

  if (!name || !startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return Response.json(
      { success: false, error: 'name, startDate, and endDate (ISO) are required.' },
      { status: 400 },
    );
  }
  if (endDate < startDate) {
    return Response.json(
      { success: false, error: 'endDate must be on or after startDate.', code: 'PERIOD_MISMATCH' },
      { status: 400 },
    );
  }
  try {
    const existing = await db.payrollPeriod.findFirst({
      where: { storeId, name },
      select: { id: true },
    });
    if (existing) {
      throw new PayrollLifecycleError(
        'PERIOD_EXISTS',
        `A payroll period named "${name}" already exists for this store.`,
      );
    }
    const period = await db.payrollPeriod.create({
      data: {
        storeId,
        name,
        startDate,
        endDate,
        payDate,
        periodType,
      },
    });
    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'CREATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: period.id,
      storeId,
      metadata: { kind: 'PayrollPeriod', name, periodType },
    });
    return Response.json({ success: true, data: period });
  } catch (error) {
    const mapped = payrollErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
});
