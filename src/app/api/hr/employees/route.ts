// GET  /api/hr/employees - list branch employees (PII stripped, summaries only)
// POST /api/hr/employees - create an employee record
//
// Permissions: the list reads through a ROLE-KEYED key (v2.113.0 fix): the
// route previously pinned hr.employee.read.own_branch, which only HR_MANAGER
// and BRANCH_MANAGER hold — a STORE_OWNER (hr.employee.read.all) was 403'd on
// a list the UI links everywhere. The spec maps owner to "all", HR/branch
// manager to employee read; ACCOUNTANT holds neither (payroll + reports only).
// PII handling: the list payload never contains statutory identifiers or bank
// details (docs/EMS_SECURITY_PRIVACY_NOTES.md). Branch scope: session-resolved
// for branch-scoped roles; since v2.113.0 an explicit storeId is honored for
// ORG-scope roles only when the store belongs to their organization (the same
// scope model the org summary serves).

import type { NextRequest } from 'next/server';
import { requireStoreAccess, recordPermissionDenied, type AuthSession } from '@/lib/auth';
import { hasHrPermission, type HrPermissionKey } from '@/lib/hr/permissions';
import { isHrModuleEnabled } from '@/lib/hr/feature-flag';
import {
  createEmployee,
  listEmployees,
  parseExpiringDays,
  storeInOrganization,
} from '@/lib/hr/employee-service';
// Onboarding-time consent capture (v2.120.0): the route rides the SAME audited
// grantConsent path the Privacy tab's decision routes use — vocabulary (purpose,
// policy version, lawful basis) stays pinned in the lib, never re-declared here.
// Deliberately NOT imported: withdrawConsent — withdrawal is a data-protection
// DECISION reserved to hr.settings.manage; onboarding only ever FILES the
// consent the new hire already signed (see the POST comment below).
import { grantConsent } from '@/lib/hr/data-protection';
import { StageGError } from '@/lib/hr/stage-g-shared';
import { resolveReportScope } from '@/lib/hr/reports';
import { hrGuard } from '@/lib/hr/guard';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

/**
 * v2.113.0: the read key each role resolves. Every role here holds its key
 * in the permission map (fail-closed for anyone else — including ACCOUNTANT,
 * whose spec grant stops at payroll reads and reports).
 */
const READ_KEY_BY_ROLE: Record<string, HrPermissionKey> = {
  HR_MANAGER: 'hr.employee.read.all',
  BRANCH_MANAGER: 'hr.employee.read.own_branch',
  STORE_OWNER: 'hr.employee.read.all',
};

export const GET = requireStoreAccess(
  async (request: NextRequest, session) => {
    // 1. Module flag (the hrGuard contract, mirrored — the guard composes ONE
    //    static permission key, and this route legitimately resolves TWO).
    const enabled = await isHrModuleEnabled(session.organizationId);
    if (!enabled) {
      return Response.json(
        { success: false, error: 'The Employee Management System is disabled for this organization.', code: 'FEATURE_DISABLED' },
        { status: 403 },
      );
    }
    // 2. Role-keyed permission (fail-closed; SUPER_ADMIN bypasses inside hasHrPermission).
    const readKey = READ_KEY_BY_ROLE[session.role];
    if (!readKey || !hasHrPermission(session.role, readKey)) {
      await recordPermissionDenied({
        session,
        permission: readKey ?? 'hr.employee.read.own_branch',
        request,
        resource: new URL(request.url).pathname,
      });
      return Response.json(
        { success: false, error: 'You do not have permission to perform this HR action.', code: 'PERMISSION_DENIED' },
        { status: 403 },
      );
    }
    return listHandler(request, session);
  },
  READ_ROLES,
);

async function listHandler(request: NextRequest, session: AuthSession) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('storeId') || '';
  // v2.113.0: an explicit storeId is honored for ORG-scope roles (the same
  // scope model the org summary serves — SUPER_ADMIN/STORE_OWNER/ACCOUNTANT/
  // HR_MANAGER) ONLY when the store belongs to the caller's organization
  // (fail-closed 403 on any miss). Every other role keeps the session's own
  // store — client storeId stays ignored exactly as before.
  let storeId = '';
  if (session.role === 'SUPER_ADMIN') {
    storeId = requested || session.storeId || '';
  } else if (resolveReportScope(session) === 'ORG') {
    if (requested) {
      if (!(await storeInOrganization(requested, session.organizationId))) {
        return Response.json(
          { success: false, error: 'PERMISSION_DENIED: that branch is outside your organization.' },
          { status: 403 },
        );
      }
      storeId = requested;
    } else {
      storeId = session.storeId || '';
    }
  } else {
    storeId = session.storeId || '';
  }

  if (!storeId) {
    return Response.json({ success: false, error: 'No store context.' }, { status: 400 });
  }

  // v2.113.0: ?expiring=<days> narrows to employees whose documents expire
  // inside the window (clamped 1..365; invalid values are ignored).
  const expiringDays = parseExpiringDays(url.searchParams.get('expiring'));

  const employees = await listEmployees({
    storeId,
    includeArchived: url.searchParams.get('includeArchived') === '1',
    status: url.searchParams.get('status') || undefined,
    search: url.searchParams.get('q') || undefined,
    ...(expiringDays ? { expiringWithinDays: expiringDays } : {}),
  });

  // v2.120.0: the affordance rides the answer — canCreate resolves through the
  // SAME permission key the POST guard pins below, so the page never shows an
  // onboard door the server would refuse (the consent card's canDecide
  // pattern, applied to hiring).
  return Response.json({
    success: true,
    data: employees,
    count: employees.length,
    canCreate: hasHrPermission(session.role, 'hr.employee.create'),
    ...(expiringDays ? { expiringDays } : {}),
  });
}

export const POST = hrGuard('hr.employee.create', WRITE_ROLES)(
  async (request, session) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    if (!firstName || !lastName) {
      return Response.json(
        { success: false, error: 'firstName and lastName are required.' },
        { status: 400 },
      );
    }

    // Ignore client storeId: the branch is the session's resolved store
    // (SUPER_ADMIN may pass an explicit storeId they administer).
    const storeId = session.role === 'SUPER_ADMIN'
      ? (typeof body.storeId === 'string' && body.storeId) || session.storeId || ''
      : session.storeId || '';
    if (!storeId) {
      return Response.json({ success: false, error: 'No store context.' }, { status: 400 });
    }

    // Onboarding-time consent capture (v2.120.0): `consentPayrollProcessing`
    // records a FACT of the hiring paperwork — "the employee signed the
    // payroll consent form" — through the same audited grantConsent path the
    // Privacy tab uses. It is NOT the data-protection DECISION surface:
    // grant/withdraw for existing employees stays with hr.settings.manage
    // (403 DECISION_FORBIDDEN on the consent routes). Anyone who may create
    // an employee (hr.employee.create) may file the consent their new hire
    // signed; withdrawal is never reachable from onboarding.
    const consentRequested = body.consentPayrollProcessing === true;
    let consent: {
      granted: boolean;
      reason?: string;
      consentId?: string;
      purpose?: string;
      policyVersion?: string;
      grantedAt?: string;
    } = { granted: false, reason: consentRequested ? 'CONSENT_GRANT_FAILED' : 'NOT_REQUESTED' };

    try {
      const result = await createEmployee({
        storeId,
        actorId: session.userId,
        actorRole: session.role,
        data: {
          firstName,
          lastName,
          email: typeof body.email === 'string' ? body.email : undefined,
          phone: typeof body.phone === 'string' ? body.phone : undefined,
          nationalId: typeof body.nationalId === 'string' ? body.nationalId : undefined,
          kraPin: typeof body.kraPin === 'string' ? body.kraPin : undefined,
          nssfNumber: typeof body.nssfNumber === 'string' ? body.nssfNumber : undefined,
          nhifNumber: typeof body.nhifNumber === 'string' ? body.nhifNumber : undefined,
          jobTitle: typeof body.jobTitle === 'string' ? body.jobTitle : undefined,
          role: typeof body.role === 'string' ? body.role : undefined,
          employmentType: typeof body.employmentType === 'string' ? body.employmentType : undefined,
          hireDate: typeof body.hireDate === 'string' ? new Date(body.hireDate) : undefined,
          basicSalary: typeof body.basicSalary === 'number' ? body.basicSalary : undefined,
          hourlyRate: typeof body.hourlyRate === 'number' ? body.hourlyRate : undefined,
          houseAllowance: typeof body.houseAllowance === 'number' ? body.houseAllowance : undefined,
          transportAllowance: typeof body.transportAllowance === 'number' ? body.transportAllowance : undefined,
          medicalAllowance: typeof body.medicalAllowance === 'number' ? body.medicalAllowance : undefined,
          otherAllowances: typeof body.otherAllowances === 'number' ? body.otherAllowances : undefined,
          bankName: typeof body.bankName === 'string' ? body.bankName : undefined,
          bankAccountName: typeof body.bankAccountName === 'string' ? body.bankAccountName : undefined,
          reportingToId: typeof body.reportingToId === 'string' ? body.reportingToId : undefined,
          notes: typeof body.notes === 'string' ? body.notes : undefined,
        },
      });

      if (consentRequested) {
        // A consent glitch must never lose the hire: the employee is already
        // created here, so a failed grant rides back as an honest outcome
        // (reason code) inside a 201 — the dialog renders it rose and points
        // at the Privacy tab. Only a total route failure would 5xx, and then
        // the employee create would have failed with it.
        try {
          const grant = await grantConsent({ employeeId: result.id }, session);
          consent = {
            granted: true,
            consentId: grant.consentId,
            purpose: grant.purpose,
            policyVersion: grant.policyVersion,
            grantedAt: grant.grantedAt,
          };
        } catch (error) {
          consent = {
            granted: false,
            reason: error instanceof StageGError ? error.code : 'CONSENT_GRANT_FAILED',
          };
        }
      }

      return Response.json({ success: true, data: result.employee, id: result.id, consent }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create employee.';
      const status = message.includes('not found') ? 404 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);
