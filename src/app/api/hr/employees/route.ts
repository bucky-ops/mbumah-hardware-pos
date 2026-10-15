// GET  /api/hr/employees - list branch employees (PII stripped, summaries only)
// POST /api/hr/employees - create an employee record
//
// Permissions: hr.employee.read.own_branch (list), hr.employee.create (create).
// PII handling: the list payload never contains statutory identifiers or bank
// details (docs/EMS_SECURITY_PRIVACY_NOTES.md). Branch scope is resolved by
// requireStoreAccess; client storeId is ignored.

import { hrGuard } from '@/lib/hr/guard';
import { createEmployee, listEmployees } from '@/lib/hr/employee-service';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const GET = hrGuard('hr.employee.read.own_branch', READ_ROLES)(
  async (request, session) => {
    const url = new URL(request.url);
    const storeId = session.role === 'SUPER_ADMIN'
      ? url.searchParams.get('storeId') || session.storeId || ''
      : session.storeId || '';

    if (!storeId) {
      return Response.json({ success: false, error: 'No store context.' }, { status: 400 });
    }

    const employees = await listEmployees({
      storeId,
      includeArchived: url.searchParams.get('includeArchived') === '1',
      status: url.searchParams.get('status') || undefined,
      search: url.searchParams.get('q') || undefined,
    });

    return Response.json({ success: true, data: employees, count: employees.length });
  },
);

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
      return Response.json({ success: true, data: result.employee, id: result.id }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create employee.';
      const status = message.includes('not found') ? 404 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);
