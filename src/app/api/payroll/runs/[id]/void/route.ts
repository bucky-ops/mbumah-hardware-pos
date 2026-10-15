// POST /api/payroll/runs/[id]/void - cancel a pre-post run

import { hrGuard } from '@/lib/hr/guard';
import { voidPayrollRun, payrollActorContext } from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const APPROVE_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.approve', APPROVE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    // The legacy POS tab sends { reason }; carry it into the audit metadata.
    const body = await readJson(request);
    try {
      const run = await voidPayrollRun(payrollActorContext(session), id, {
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
      return Response.json({ success: true, data: run });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
