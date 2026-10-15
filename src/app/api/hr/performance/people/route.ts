// GET /api/hr/performance/people - lightweight employee picker list for the
// performance/goals/asset/discipline consoles (hr.performance.review).
// Returns id + display name + job title only - no PII-grade fields.

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { employeeScopeWhere, toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.performance.review')(async (_request, session) => {
  try {
    const people = await db.employee.findMany({
      where: { status: 'ACTIVE', AND: [employeeScopeWhere(session)] },
      select: { id: true, firstName: true, lastName: true, jobTitle: true, employeeCode: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 300,
    });
    return Response.json({
      success: true,
      data: people.map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        jobTitle: p.jobTitle ?? null,
        employeeCode: p.employeeCode ?? null,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
