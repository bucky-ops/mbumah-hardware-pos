// GET  /api/recruitment/jobs - list recruitment jobs for the session store
// POST /api/recruitment/jobs - open a job (HR_MANAGER, STORE_OWNER)

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { createJob } from '@/lib/hr/recruitment-service';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER'] as const;
const WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const GET = hrGuard('hr.recruitment.read.branch', READ_ROLES)(
  async (_request, session) => {
    const jobs = await db.recruitmentJob.findMany({
      where: { storeId: session.storeId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        position: { select: { title: true } },
        _count: { select: { applicants: true } },
      },
    });
    return Response.json({ success: true, data: jobs });
  },
);

export const POST = hrGuard('hr.recruitment.manage', WRITE_ROLES)(
  async (request, session) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return Response.json({ success: false, error: 'title is required.' }, { status: 400 });
    }

    try {
      const job = await createJob({
        storeId: session.storeId,
        organizationId: session.organizationId,
        actorId: session.userId,
        actorRole: session.role,
        data: {
          title,
          description: typeof body.description === 'string' ? body.description : undefined,
          openings: typeof body.openings === 'number' ? body.openings : undefined,
          positionId: typeof body.positionId === 'string' ? body.positionId : undefined,
        },
      });
      return Response.json({ success: true, data: { id: job.id } }, { status: 201 });
    } catch (error) {
      return Response.json(
        { success: false, error: error instanceof Error ? error.message : 'Unable to create job.' },
        { status: 500 },
      );
    }
  },
);
