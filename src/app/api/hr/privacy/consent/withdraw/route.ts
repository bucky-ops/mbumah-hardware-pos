// POST /api/hr/privacy/consent/withdraw - withdraw the employee's active
// consent(s): sets withdrawnAt. The payroll gate reads `withdrawnAt: null`,
// so the next run honestly reports MISSING_CONSENT for this employee.
// Decisions reserved to hr.settings.manage (canDecideErasure).

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { canDecideErasure, withdrawConsent } from '@/lib/hr/data-protection';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.report.branch')(async (request: NextRequest, session) => {
  try {
    if (!canDecideErasure(session.role)) {
      return Response.json(
        {
          success: false,
          error: 'Only settings managers can withdraw consent records.',
          code: 'DECISION_FORBIDDEN',
        },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ success: true, data: await withdrawConsent(body, session) });
  } catch (error) {
    return toErrorResponse(error);
  }
});
