// POST /api/payroll/runs/[id]/post - idempotent posting (journal + payslips)

import { hrGuard } from '@/lib/hr/guard';
import { postPayrollRun, payrollActorContext } from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const POST_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.post', POST_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    try {
      const result = await postPayrollRun(payrollActorContext(session), id);
      return Response.json({ success: true, data: result });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
