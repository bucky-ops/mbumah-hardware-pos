// GET  /api/recruitment/applicants - pipeline list for the session store
// POST /api/recruitment/applicants - register an applicant (consent required)

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { createApplicant } from '@/lib/hr/recruitment-service';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER'] as const;
const WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const GET = hrGuard('hr.recruitment.read.branch', READ_ROLES)(
  async (request, session) => {
    const status = new URL(request.url).searchParams.get('status');
    const applicants = await db.applicant.findMany({
      where: {
        job: { storeId: session.storeId },
        deletedAt: null,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        job: { select: { title: true } },
        stages: { orderBy: { createdAt: 'desc' }, take: 1, select: { stage: true, outcome: true } },
      },
    });
    return Response.json({ success: true, data: applicants });
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

    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!fullName || !email) {
      return Response.json({ success: false, error: 'fullName and email are required.' }, { status: 400 });
    }
    if (body.consentGranted !== true) {
      return Response.json(
        { success: false, error: 'Applicant consent is required before registering personal data.' },
        { status: 400 },
      );
    }

    try {
      const applicant = await createApplicant({
        jobId: typeof body.jobId === 'string' ? body.jobId : '',
        storeId: session.storeId,
        actorId: session.userId,
        actorRole: session.role,
        data: {
          fullName,
          email,
          phone: typeof body.phone === 'string' ? body.phone : undefined,
          coverNote: typeof body.coverNote === 'string' ? body.coverNote : undefined,
          consentGranted: true,
        },
      });
      return Response.json({ success: true, data: { id: applicant.id } }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to register applicant.';
      const status = message.includes('not found') ? 404 : message.includes('consent') ? 400 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);
