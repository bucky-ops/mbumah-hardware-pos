// GET /api/hr/privacy/retention - the retention desk: the reviewable retention
// policies folded with their live legal-hold state (what the nightly sweep
// will and will not touch). Read-only; the hold/release decisions live on the
// sibling action route and are reserved to hr.settings.manage
// (canDecideErasure), mirroring erasure and consent.

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { canDecideErasure, listRetentionPolicies } from '@/lib/hr/data-protection';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const VIEW_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', VIEW_ROLES)(async (request: NextRequest, session) => {
  try {
    const desk = await listRetentionPolicies(session);
    return Response.json({
      success: true,
      data: {
        policies: desk.policies,
        heldCount: desk.heldCount,
        canDecide: canDecideErasure(session.role),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
