// POST /api/payroll/runs/[id]/submit - send a prepared run for approval
// (superset of the Phase 4.6 route list: the state machine needs an explicit
// submit step so the preparer's identity is captured for maker-checker)

import { hrGuard } from '@/lib/hr/guard';
import { submitPayrollRun, payrollActorContext } from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const PREPARE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.prepare', PREPARE_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    try {
      const run = await submitPayrollRun(payrollActorContext(session), id);
      return Response.json({ success: true, data: run });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
