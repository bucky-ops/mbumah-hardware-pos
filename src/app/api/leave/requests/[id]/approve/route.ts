// POST /api/leave/requests/[id]/approve - approve with optional delegation

import { hrGuard } from '@/lib/hr/guard';
import { decideLeaveRequest } from '@/lib/hr/leave-service';

export const dynamic = 'force-dynamic';

const ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER'] as const;

export const POST = hrGuard('hr.leave.approve.branch', ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    try {
      const result = await decideLeaveRequest(
        id,
        session.storeId || '',
        session.userId,
        session.role,
        'APPROVED',
        undefined,
        typeof body.delegateApproverUserId === 'string' ? body.delegateApproverUserId : undefined,
      );
      return Response.json({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to approve.';
      return Response.json({ success: false, error: message }, { status: message.includes('not found') ? 404 : 500 });
    }
  },
);
