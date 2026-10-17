// POST /api/payroll/runs/[id]/disburse - mark payslips PAID (manual confirmation)

import { hrGuard } from '@/lib/hr/guard';
import { disbursePayrollRun, payrollActorContext } from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const DISBURSE_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.disburse', DISBURSE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const body = await readJson(request);
    try {
      // v2.50.0: the digest rides the manual confirmation the same way it
      // rides the B2C batch — the payroll group hears the money moved, and
      // the honest "who was told" banner shows in the run dialog.
      // v2.51.0: paidNotices rides too — every portal-linked employee in the
      // batch is told "you've been paid" with their own receipt.
      const { disbursed, digest, paidNotices } = await disbursePayrollRun(
        payrollActorContext(session),
        id,
        typeof body.paymentRef === 'string' ? body.paymentRef : undefined,
      );
      return Response.json({ success: true, data: { disbursed }, digest, paidNotices });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
