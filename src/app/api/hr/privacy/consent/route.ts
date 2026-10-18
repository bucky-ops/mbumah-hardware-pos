// GET /api/hr/privacy/consent - the consent ledger: every in-scope employee's
// data-processing consent state (ACTIVE / WITHDRAWN / NONE) + summary counts.
// Read-only; decisions (grant/withdraw) live on the sibling action routes and
// are reserved to hr.settings.manage (canDecideErasure), mirroring erasure.

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { canDecideErasure, listConsentRecords } from '@/lib/hr/data-protection';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const VIEW_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', VIEW_ROLES)(async (request: NextRequest, session) => {
  try {
    const ledger = await listConsentRecords(session);
    return Response.json({
      success: true,
      data: {
        records: ledger.records,
        summary: ledger.summary,
        canDecide: canDecideErasure(session.role),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
