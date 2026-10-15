// POST /api/payroll/runs/[id]/disburse - mark payslips PAID (manual confirmation)

import { hrGuard } from '@/lib/hr/guard';
import { disbursePayrollRun, payrollActorContext } from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const DISBURSE_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.disburse', DISBURSE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const body = await readJson(request);
    try {
      const result = await disbursePayrollRun(
        payrollActorContext(session),
        id,
        typeof body.paymentRef === 'string' ? body.paymentRef : undefined,
      );
      return Response.json({ success: true, data: result });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
