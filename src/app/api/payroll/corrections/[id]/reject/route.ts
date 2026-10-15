// POST /api/payroll/corrections/[id]/reject - maker-checked rejection with reason

import { hrGuard } from '@/lib/hr/guard';
import {
  decidePayrollCorrection,
  payrollActorContext,
} from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const APPROVE_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.approve', APPROVE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const body = await readJson(request);
    try {
      const correction = await decidePayrollCorrection(
        payrollActorContext(session),
        id,
        'REJECTED',
        typeof body.reason === 'string' ? body.reason : undefined,
      );
      return Response.json({ success: true, data: correction });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
