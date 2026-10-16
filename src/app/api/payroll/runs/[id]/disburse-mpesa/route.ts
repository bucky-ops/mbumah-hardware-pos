// POST /api/payroll/runs/[id]/disburse-mpesa - disburse pending payslips of a
// posted/locked run via M-Pesa B2C (SalaryPayment). v2.21.0.
//
// v2.22.0 adds the recovery modes selected by `mode` in the JSON body:
//   • "all" (default)       → disburseRunViaMpesa: every eligible PENDING payslip
//   • "retry-failed"        → retryFailedPayrollB2C: only payslips whose latest
//                             B2C attempt FAILED and which are still unpaid
//   • "refresh-stuck"       → refreshStuckPayrollB2C: re-query PROCESSING
//                             transactions with no result callback for
//                             B2C_STALE_PROCESSING_MS
//
// Permission model mirrors the manual disburse endpoint: STORE_OWNER with the
// hr.payroll.disburse permission (disbursement is a checker-level action).
// When Daraja B2C credentials are absent this runs in MOCK mode in
// development only; production refuses with B2C_NOT_CONFIGURED.

import { hrGuard } from '@/lib/hr/guard';
import {
  disburseRunViaMpesa,
  refreshStuckPayrollB2C,
  retryFailedPayrollB2C,
  type B2CStaleResult,
  type B2CDisburseSummary,
} from '@/lib/hr/payroll/disbursement-service';
import { payrollActorContext } from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const DISBURSE_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.disburse', DISBURSE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const body = (await readJson(request)) as { mode?: string };
    const mode = body.mode === 'retry-failed' || body.mode === 'refresh-stuck' ? body.mode : 'all';
    try {
      if (mode === 'refresh-stuck') {
        const result: B2CStaleResult = await refreshStuckPayrollB2C(
          payrollActorContext(session),
          id,
        );
        return Response.json({ success: true, data: result });
      }
      const summary: B2CDisburseSummary = await (mode === 'retry-failed'
        ? retryFailedPayrollB2C
        : disburseRunViaMpesa)(payrollActorContext(session), id);
      return Response.json({ success: true, data: summary });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
