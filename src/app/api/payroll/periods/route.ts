// GET  /api/payroll/periods - list payroll periods for the store
// POST /api/payroll/periods - create a period (hr.payroll.prepare)

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';
import { PayrollLifecycleError } from '@/lib/hr/payroll/run-service';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;
const MANAGE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(async (_request, session) => {
  const periods = await db.payrollPeriod.findMany({
    where: { storeId: session.storeId || '' },
    orderBy: { startDate: 'desc' },
    take: 60,
  });
  return Response.json({ success: true, data: periods });
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
