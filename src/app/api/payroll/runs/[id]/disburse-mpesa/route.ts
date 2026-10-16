// POST /api/payroll/runs/[id]/disburse-mpesa - disburse pending payslips of a
// posted/locked run via M-Pesa B2C (SalaryPayment). v2.21.0.
//
// Permission model mirrors the manual disburse endpoint: STORE_OWNER with the
// hr.payroll.disburse permission (disbursement is a checker-level action).
// When Daraja B2C credentials are absent this runs in MOCK mode in
// development only; production refuses with B2C_NOT_CONFIGURED.

import { hrGuard } from '@/lib/hr/guard';
import {
  disburseRunViaMpesa,
  type B2CDisburseSummary,
} from '@/lib/hr/payroll/disbursement-service';
import { payrollActorContext } from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const DISBURSE_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.disburse', DISBURSE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    await readJson(request);
    try {
      const summary: B2CDisburseSummary = await disburseRunViaMpesa(
        payrollActorContext(session),
        id,
      );
      return Response.json({ success: true, data: summary });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
