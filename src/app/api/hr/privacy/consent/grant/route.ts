// POST /api/hr/privacy/consent/grant - grant the employee's data-processing
// consent (a NEW ConsentRecord; append-only history). Decisions reserved to
// hr.settings.manage (canDecideErasure) — the same key that decides erasures.

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { canDecideErasure, grantConsent } from '@/lib/hr/data-protection';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.report.branch')(async (request: NextRequest, session) => {
  try {
    if (!canDecideErasure(session.role)) {
      return Response.json(
        {
          success: false,
          error: 'Only settings managers can grant consent records.',
          code: 'DECISION_FORBIDDEN',
        },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ success: true, data: await grantConsent(body, session) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
