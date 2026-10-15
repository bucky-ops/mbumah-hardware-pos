// GET  /api/hr/onboarding/plans - list plans with task progress
// POST /api/hr/onboarding/plans - create a plan for an employee

import { hrGuard } from '@/lib/hr/guard';
import { createPlan, listPlans } from '@/lib/hr/onboarding-service';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER'] as const;
const WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const GET = hrGuard('hr.onboarding.manage', READ_ROLES)(
  async (_request, session) => {
    const plans = await listPlans(session.storeId || '');
    return Response.json({ success: true, data: plans });
  },
);

export const POST = hrGuard('hr.onboarding.manage', WRITE_ROLES)(
  async (request, session) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }
    const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
    if (!employeeId) {
      return Response.json({ success: false, error: 'employeeId is required.' }, { status: 400 });
    }
    const plan = await createPlan(
      employeeId,
      session.storeId,
      session.userId,
      session.role,
      typeof body.templateKey === 'string' ? body.templateKey : 'STANDARD',
    );
    return Response.json({ success: true, data: { id: plan.id } }, { status: 201 });
  },
);
