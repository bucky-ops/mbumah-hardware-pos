// GET /api/system/post - Power-On Self-Test report (v2.14.0)
//
// Development: public (no auth) so local boot diagnostics work out of the box.
// Production: SUPER_ADMIN only - the report names env presence and table
// counts, which must not be publicly enumerable.

import { type NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { runPostChecks } from '@/lib/post';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const session = await getSessionFromRequest(request).catch(() => null);
    if (!session) {
      return Response.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }
    if (session.role !== 'SUPER_ADMIN') {
      return Response.json(
        { success: false, error: 'Insufficient permissions.' },
        { status: 403 }
      );
    }
  }

  const report = await runPostChecks();
  return Response.json({ success: true, data: report });
}
