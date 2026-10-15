// POST /api/hr/onboarding/plans/[id]/signoff - sign off; refuses while
// blocksTillAccess tasks are incomplete (TILL_ACCESS_BLOCKED).

import { hrGuard } from '@/lib/hr/guard';
import { signoffPlan } from '@/lib/hr/onboarding-service';

export const dynamic = 'force-dynamic';

const WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const POST = hrGuard(
  'hr.onboarding.manage',
  WRITE_ROLES,
)(async (_request, session, context?: { params: Promise<{ id: string }> }) => {
  const { id } = (await context?.params) ?? { id: '' };
  try {
    const plan = await signoffPlan(id, session.storeId || '', session.userId, session.role);
    return Response.json({ success: true, data: { id: plan.id, status: plan.status } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to sign off plan.';
    const status = message.includes('not found') ? 404 : message.includes('TILL_ACCESS_BLOCKED') ? 409 : 500;
    return Response.json({ success: false, error: message }, { status });
  }
});
