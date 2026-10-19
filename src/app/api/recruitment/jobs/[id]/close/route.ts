// POST /api/recruitment/jobs/[id]/close - close an OPEN job to new applicants (v2.125.0)
//
// Jobs stayed OPEN forever: nothing in the app ever set the schema's CLOSED
// status. Closing stops intake (createApplicant refuses CLOSED jobs by its
// own status check) without rewriting history — the job stays listed and its
// pipeline remains visible.

import { hrGuard } from '@/lib/hr/guard';
import { closeJob } from '@/lib/hr/recruitment-service';
import { RECRUITMENT_WRITE_ROLES } from '@/lib/hr/recruitment-policy';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.recruitment.manage', RECRUITMENT_WRITE_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    try {
      const job = await closeJob({ jobId: id, actorId: session.userId, actorRole: session.role });
      return Response.json({ success: true, data: { id: job.id, status: job.status } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to close job.';
      const status = message.includes('not found') ? 404 : message.includes('only OPEN jobs') ? 409 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);
