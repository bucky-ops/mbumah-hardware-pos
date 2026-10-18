// POST /api/hr/privacy/retention-sweep - run the retention sweep NOW instead
// of waiting for the nightly cron (v2.124.0: the broom answers the desk).
// The dry run (v2.123.0) shows what would be anonymised; this is the
// destructive sibling, so the UI asks twice and the API itself stays a
// single audited decision — runHrRetentionSweep attributes the actor and
// audits every batch it anonymises, and legal holds skip their scopes
// exactly as they do at night. Decisions reserved to hr.settings.manage
// (canDecideErasure) — the same key that decides erasures, consent records,
// and legal holds.

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { canDecideErasure, runHrRetentionSweep } from '@/lib/hr/data-protection';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.report.branch')(async (request: NextRequest, session) => {
  try {
    if (!canDecideErasure(session.role)) {
      return Response.json(
        {
          success: false,
          error: 'Only settings managers can run the retention sweep early.',
          code: 'DECISION_FORBIDDEN',
        },
        { status: 403 },
      );
    }
    const results = await runHrRetentionSweep(session.organizationId, session.userId);
    return Response.json({ success: true, data: { results, sweptAt: new Date().toISOString() } }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
