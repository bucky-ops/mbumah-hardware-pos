// POST /api/hr/privacy/legal-hold - set or release a legal hold for one
// retention scope (HrSetting legalHold:<scope>). Releasing lets the nightly
// sweep anonymise that scope's expired records again — the destructive
// direction, so the UI asks twice; the API itself stays a single audited
// decision. Decisions reserved to hr.settings.manage (canDecideErasure) —
// the same key that decides erasures and consent records.

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { canDecideErasure, setLegalHold } from '@/lib/hr/data-protection';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.report.branch')(async (request: NextRequest, session) => {
  try {
    if (!canDecideErasure(session.role)) {
      return Response.json(
        {
          success: false,
          error: 'Only settings managers can set or release legal holds.',
          code: 'DECISION_FORBIDDEN',
        },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ success: true, data: await setLegalHold(body, session) }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
