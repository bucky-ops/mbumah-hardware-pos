// POST  /api/recruitment/applicants/[id]/offer - draft an offer
// PATCH /api/recruitment/applicants/[id]/offer?offerId=... - approve and send

import { hrGuard } from '@/lib/hr/guard';
import { approveAndSendOffer, createOffer } from '@/lib/hr/recruitment-service';

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

    // Money arrives as integer cents (spec rule 16). Reject floats.
    const salaryCents = body.proposedSalaryCents;
    if (typeof salaryCents !== 'number' || !Number.isInteger(salaryCents) || salaryCents <= 0) {
      return Response.json(
        { success: false, error: 'proposedSalaryCents must be a positive integer (money is integer cents).' },
        { status: 400 },
      );
    }
    if (typeof body.startDate !== 'string') {
      return Response.json({ success: false, error: 'startDate is required.' }, { status: 400 });
    }

    try {
      const offer = await createOffer({
        applicantId: id,
        actorId: session.userId,
        actorRole: session.role,
        data: {
          proposedSalaryCents: salaryCents,
          startDate: new Date(body.startDate),
          positionId: typeof body.positionId === 'string' ? body.positionId : undefined,
          payGradeId: typeof body.payGradeId === 'string' ? body.payGradeId : undefined,
        },
      });
      return Response.json({ success: true, data: { id: offer.id } }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create offer.';
      const status = message.includes('not found') ? 404 : message.includes('integer') ? 400 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);

export const PATCH = hrGuard('hr.offer.approve', WRITE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    await context?.params;
    const offerId = new URL(request.url).searchParams.get('offerId');
    if (!offerId) {
      return Response.json({ success: false, error: 'offerId is required.' }, { status: 400 });
    }
    try {
      const offer = await approveAndSendOffer(offerId, session.userId, session.role);
      return Response.json({ success: true, data: { id: offer.id, status: offer.status } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to approve offer.';
      const status = message.includes('not found') ? 404 : message.includes('only DRAFT') ? 409 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);
