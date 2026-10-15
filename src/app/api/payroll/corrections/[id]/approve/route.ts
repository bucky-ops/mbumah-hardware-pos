// POST /api/payroll/corrections/[id]/approve - maker-checked approve (reverse + replace)

import { hrGuard } from '@/lib/hr/guard';
import {
  decidePayrollCorrection,
  payrollActorContext,
} from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const APPROVE_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.approve', APPROVE_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    try {
      const correction = await decidePayrollCorrection(
        payrollActorContext(session),
        id,
        'APPROVED',
      );
      return Response.json({ success: true, data: correction });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
