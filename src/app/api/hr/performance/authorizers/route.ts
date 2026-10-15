// GET /api/hr/performance/authorizers - eligible recovery authorizers for
// asset LOST/DAMAGED dispositions (active users holding hr.asset.manage,
// excluding the caller so self-authorization is impossible in the UI too).

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const ELIGIBLE_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'];

export const GET = hrGuard('hr.asset.manage')(async (_request, session) => {
  try {
    const users = await db.user.findMany({
      where: { isActive: true, role: { in: ELIGIBLE_ROLES }, id: { not: session.userId } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
      take: 100,
    });
    return Response.json({
      success: true,
      data: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
