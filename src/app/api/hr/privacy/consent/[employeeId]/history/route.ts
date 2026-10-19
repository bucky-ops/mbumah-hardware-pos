// GET /api/hr/privacy/consent/[employeeId]/history - one employee's full
// append-only consent timeline (v2.129.0): every grant, withdrawal, and
// re-grant stays on file and the drawer reads them verbatim. Read-only;
// decisions (grant/withdraw) live on the sibling action routes. Same guard
// trio as the ledger itself — reading history is a view right, not a
// decision right (reads are never reserved to settings managers).

import type { NextRequest } from 'next/server';
import { hrGuard, type HrRouteContext } from '@/lib/hr/guard';
import { listConsentHistory } from '@/lib/hr/data-protection';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const VIEW_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', VIEW_ROLES)(
  async (request: NextRequest, session, context?: HrRouteContext) => {
    try {
      // the shared HrRouteContext alias types params as { id } (the erasure
      // routes' segment); THIS segment is [employeeId], so the runtime shape
      // is cast to what the folder actually serves — a malformed context
      // degrades to '' which the service answers with the honest 404
      const params = (await context?.params) as { employeeId?: string } | undefined;
      const history = await listConsentHistory(session, params?.employeeId ?? '');
      return Response.json({ success: true, data: history });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
