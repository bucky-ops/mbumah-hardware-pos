// POST /api/payroll/runs/[id]/approve - maker-checked approval

import { hrGuard } from '@/lib/hr/guard';
import { approvePayrollRun, payrollActorContext } from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const APPROVE_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.approve', APPROVE_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    try {
      // v2.47.0: the response carries the fail-soft approval-digest result
      // (recipients, email status, CSV filename/size) so the run dialog can
      // show an honest "who was told" notice instead of guessing.
      const { run, digest } = await approvePayrollRun(payrollActorContext(session), id);
      return Response.json({ success: true, data: run, digest });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
