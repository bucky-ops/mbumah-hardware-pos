// POST /api/payroll/runs/[id]/validate - compute + validate + persist payslips
// (the "prepare" step of the lifecycle; safe to re-run while DRAFT/REJECTED)

import { hrGuard } from '@/lib/hr/guard';
import {
  preparePayrollRun,
  payrollActorContext,
  PayrollLifecycleError,
} from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const PREPARE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.prepare', PREPARE_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    try {
      const result = await preparePayrollRun(payrollActorContext(session), id);
      return Response.json({ success: true, data: result });
    } catch (error) {
      // Gate failures carry the per-employee issue list for the UI.
      if (error instanceof PayrollLifecycleError && error.issues) {
        return Response.json(
          {
            success: false,
            error: error.message.replace(/^[A-Z_]+: /, ''),
            code: error.code,
            issues: error.issues,
          },
          { status: error.status },
        );
      }
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
