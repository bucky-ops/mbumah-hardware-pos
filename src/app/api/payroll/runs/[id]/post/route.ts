// POST /api/payroll/runs/[id]/post - idempotent posting (journal + payslips)

import { hrGuard } from '@/lib/hr/guard';
import { postPayrollRun, payrollActorContext } from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const POST_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.post', POST_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    try {
      // v2.48.0: a FRESH post carries the fail-soft posting-digest result
      // (recipients, email status, CSV filename/size) so the run dialog can
      // show an honest "who was told" notice. The idempotent replay path
      // returns no digest — a retried post never re-notifies anyone.
      const { run, journalEntryId, replay, digest } = await postPayrollRun(
        payrollActorContext(session),
        id,
      );
      return Response.json({ success: true, data: { run, journalEntryId, replay }, digest });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
