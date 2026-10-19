// POST /api/recruitment/applicants/[id]/convert - hire: create employee +
// onboarding plan. Idempotent per (storeId, email); provenance preserved.

import { hrGuard } from '@/lib/hr/guard';
import { convertApplicantToEmployee } from '@/lib/hr/recruitment-service';
import { RECRUITMENT_WRITE_ROLES } from '@/lib/hr/recruitment-policy';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.recruitment.manage', RECRUITMENT_WRITE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const storeId = session.role === 'SUPER_ADMIN'
      ? (typeof body.storeId === 'string' && body.storeId) || session.storeId || ''
      : session.storeId || '';
    if (!storeId) {
      return Response.json({ success: false, error: 'No store context.' }, { status: 400 });
    }

    try {
      const result = await convertApplicantToEmployee({
        applicantId: id,
        storeId,
        actorId: session.userId,
        actorRole: session.role,
        data: {
          jobTitle: typeof body.jobTitle === 'string' ? body.jobTitle : undefined,
          employmentType: typeof body.employmentType === 'string' ? body.employmentType : undefined,
          basicSalary: typeof body.basicSalary === 'number' ? body.basicSalary : undefined,
          probationMonths: typeof body.probationMonths === 'number' ? body.probationMonths : undefined,
          acceptOfferId: typeof body.acceptOfferId === 'string' ? body.acceptOfferId : undefined,
        },
      });
      return Response.json({
        success: true,
        data: {
          employeeId: result.employee.id ?? null,
          created: result.created,
          onboardingPlanId: result.onboardingPlanId,
          tillAccess: 'Pending onboarding sign-off (cash-handling tasks gate till access).',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to convert applicant.';
      const status = message.includes('not found') || message.includes('convertible') ? 404 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);
