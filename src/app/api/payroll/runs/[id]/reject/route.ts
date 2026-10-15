// POST /api/payroll/runs/[id]/reject - send a submitted run back with a reason

import { hrGuard } from '@/lib/hr/guard';
import { rejectPayrollRun, payrollActorContext } from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const APPROVE_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.approve', APPROVE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const body = await readJson(request);
    try {
      const run = await rejectPayrollRun(
        payrollActorContext(session),
        id,
        typeof body.reason === 'string' ? body.reason : '',
      );
      return Response.json({ success: true, data: run });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
