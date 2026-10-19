// GET /api/hr/privacy/consent/export - EVERY in-scope employee's consent
// timeline as ONE flat RFC 4180 CSV (v2.132.0, the export-honesty theme's
// fourth beat: case list v2.115 → access ledger v2.118 → one drawer's
// timeline v2.130 → the whole branch). One row per consent cycle; the
// columns are the timeline payload's own (who, when, what purpose, which
// policy, how long stood) — there is no content column to leak. Read-only:
// same guard trio as the ledger itself, because a branch-level extract is a
// view right taken broadly — decisions (grant/withdraw) stay reserved to
// settings managers on their own routes.

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { exportConsentTimelines } from '@/lib/hr/data-protection';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const VIEW_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', VIEW_ROLES)(
  async (request: NextRequest, session) => {
    try {
      const { csv, filename } = await exportConsentTimelines(session);
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
