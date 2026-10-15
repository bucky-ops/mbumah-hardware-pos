// POST /api/recruitment/applicants/[id]/stage - record a pipeline stage

import { hrGuard } from '@/lib/hr/guard';
import { recordStage } from '@/lib/hr/recruitment-service';

export const dynamic = 'force-dynamic';

const WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const POST = hrGuard('hr.recruitment.manage', WRITE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const outcome = body.outcome === 'PASS' || body.outcome === 'FAIL' ? body.outcome : 'PENDING';
    try {
      const stage = await recordStage({
        applicantId: id,
        actorId: session.userId,
        actorRole: session.role,
        data: {
          stage: typeof body.stage === 'string' ? body.stage : '',
          outcome,
          notes: typeof body.notes === 'string' ? body.notes : undefined,
        },
      });
      return Response.json({ success: true, data: { id: stage.id } }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to record stage.';
      const status = message.includes('not found') ? 404 : message.includes('stage must') ? 400 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);
