// GET  /api/payroll/corrections - list corrections (?status=)
// POST /api/payroll/corrections - request a correction (hr.payroll.correct)

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import {
  requestPayrollCorrection,
  payrollActorContext,
  CORRECTION_TYPES,
} from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;
const REQUEST_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(async (request, session) => {
  const status = new URL(request.url).searchParams.get('status');
  const corrections = await db.payrollCorrection.findMany({
    where: {
      storeId: session.storeId || '',
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      employee: { select: { employeeCode: true, firstName: true, lastName: true } },
      run: { select: { status: true, runType: true, payrollPeriod: { select: { name: true } } } },
      originalDetail: { select: { payslipNumber: true, netPay: true } },
      replacementRun: { select: { id: true, status: true } },
    },
  });
  return Response.json({ success: true, data: corrections });
});

export const POST = hrGuard('hr.payroll.correct', REQUEST_ROLES)(async (request, session) => {
  const body = await readJson(request);
  const correctionType = typeof body.correctionType === 'string' ? body.correctionType : '';
  if (!CORRECTION_TYPES.includes(correctionType as (typeof CORRECTION_TYPES)[number])) {
    return Response.json(
      { success: false, error: `correctionType must be one of ${CORRECTION_TYPES.join(', ')}.` },
      { status: 400 },
    );
  }
  if (typeof body.originalDetailId !== 'string') {
    return Response.json(
      { success: false, error: 'originalDetailId is required.' },
      { status: 400 },
    );
  }
  const amountCents =
    typeof body.amountCents === 'number' ? body.amountCents : Number(body.amountCents ?? 0);
  try {
    const correction = await requestPayrollCorrection(payrollActorContext(session), {
      originalDetailId: body.originalDetailId,
      correctionType: correctionType as (typeof CORRECTION_TYPES)[number],
      amountCents: Number.isFinite(amountCents) ? amountCents : 0,
      reason: typeof body.reason === 'string' ? body.reason : '',
    });
    return Response.json({ success: true, data: correction }, { status: 201 });
  } catch (error) {
    const mapped = payrollErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
});
