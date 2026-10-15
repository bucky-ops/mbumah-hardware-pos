// GET /api/payroll/payslips/[id]/trace - plain-language computation trace

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { describePayslip, parseTrace } from '@/lib/hr/payroll/payslip-view';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const detail = await db.payrollDetail.findFirst({
      where: { id, storeId: session.storeId || '' },
      select: { id: true, payslipNumber: true, computationTrace: true, rateTableIds: true, roundingAdjustmentCents: true },
    });
    if (!detail) {
      return Response.json({ success: false, error: 'Payslip not found.' }, { status: 404 });
    }
    const result = parseTrace(detail.computationTrace);
    if (!result) {
      return Response.json(
        { success: false, error: 'Stored computation trace is unreadable; re-prepare the run.', code: 'CORRUPT_TRACE' },
        { status: 422 },
      );
    }
    return Response.json({
      success: true,
      data: {
        payslipId: detail.id,
        payslipNumber: detail.payslipNumber,
        engineSteps: result.trace,
        plainLanguage: describePayslip(result),
        rateTableIds: result.rateTableIds,
        roundingAdjustmentCents: detail.roundingAdjustmentCents,
      },
    });
  },
);
