// POST /api/recruitment/applicants/[id]/reject - reject with a 90-day retention window (v2.125.0)
//
// The desk could move candidates forward (stage, offer, hire) but had no way
// to close a candidacy that goes nowhere — rejected candidates were stuck in
// the pipeline forever. rejectApplicant already existed in the service (it
// sets REJECTED + the 90-day dataRetentionUntil the retention sweep reads);
// this route finally exposes it with the same write gate as its siblings.

import { hrGuard } from '@/lib/hr/guard';
import { rejectApplicant } from '@/lib/hr/recruitment-service';
import { RECRUITMENT_WRITE_ROLES } from '@/lib/hr/recruitment-policy';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.recruitment.manage', RECRUITMENT_WRITE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return Response.json({ success: false, error: 'A rejection reason is required — it rides the audit log.' }, { status: 400 });
    }

    try {
      const result = await rejectApplicant(id, session.userId, session.role, reason);
      return Response.json({
        success: true,
        data: { retentionUntil: result.retentionUntil.toISOString() },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reject applicant.';
      const status = message.includes('not found') ? 404 : message.includes('cannot be rejected') || message.includes('already left') ? 409 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);
