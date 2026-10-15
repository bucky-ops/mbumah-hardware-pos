// POST /api/hr/onboarding/plans/[id]/tasks/[taskId]/complete - idempotent task completion

import { hrGuard } from '@/lib/hr/guard';
import { completeTask } from '@/lib/hr/onboarding-service';

export const dynamic = 'force-dynamic';

const WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const POST = hrGuard(
  'hr.onboarding.manage',
  WRITE_ROLES,
)(async (request, session, context?: { params: Promise<Record<string, string>> }) => {
  const params = (await context?.params) ?? { id: '', taskId: '' };
  try {
    const task = await completeTask(params.id ?? '', params.taskId ?? '', session.storeId || '', session.userId, session.role);
    return Response.json({ success: true, data: { id: task.id, isComplete: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to complete task.';
    const status = message.includes('not found') ? 404 : 500;
    return Response.json({ success: false, error: message }, { status });
  }
});
