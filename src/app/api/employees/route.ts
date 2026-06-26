// GET/POST /api/employees
//
// Employee management for payroll & HR.
//   GET  — list employees for a store (filter by status, employmentType)
//   POST — create a new employee record

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ── GET: List employees ──────────────────────────────────────────────────────
async function listEmployeesHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null }
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;
  const status = searchParams.get('status') || undefined;
  const employmentType = searchParams.get('employmentType') || undefined;
  const search = searchParams.get('search') || undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  if (!storeId) {
    return Response.json({ success: true, data: [] });
  }

  const where: Record<string, unknown> = { storeId };
  if (status) where.status = status;
  if (employmentType) where.employmentType = employmentType;
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { nationalId: { contains: search } },
    ];
  }

  const employees = await db.employee.findMany({
    where,
    include: {
      user: { select: { id: true, email: true, name: true, role: true } },
      _count: {
        select: {
          payrollDetails: true,
          leaveRequests: true,
          attendanceRecords: true,
        },
      },
    },
    orderBy: { firstName: 'asc' },
    take: limit,
  });

  const data = employees.map((e) => ({
    id: e.id,
    storeId: e.storeId,
    userId: e.userId,
    user: e.user,
    firstName: e.firstName,
    lastName: e.lastName,
    fullName: `${e.firstName} ${e.lastName}`,
    email: e.email,
    phone: e.phone,
    nationalId: e.nationalId,
    kraPin: e.kraPin,
    nssfNumber: e.nssfNumber,
    nhifNumber: e.nhifNumber,
    photoUrl: e.photoUrl,
    jobTitle: e.jobTitle,
    role: e.role,
    employmentType: e.employmentType,
    hireDate: e.hireDate.toISOString(),
    terminationDate: e.terminationDate?.toISOString() ?? null,
    status: e.status,
    basicSalary: e.basicSalary,
    hourlyRate: e.hourlyRate,
    houseAllowance: e.houseAllowance,
    transportAllowance: e.transportAllowance,
    medicalAllowance: e.medicalAllowance,
    otherAllowances: e.otherAllowances,
    payeExempt: e.payeExempt,
    nssfExempt: e.nssfExempt,
    nhifExempt: e.nhifExempt,
    bankName: e.bankName,
    bankAccountName: e.bankAccountName,
    bankAccountNumber: e.bankAccountNumber,
    bankBranchCode: e.bankBranchCode,
    emergencyContactName: e.emergencyContactName,
    emergencyContactPhone: e.emergencyContactPhone,
    notes: e.notes,
    payrollDetailCount: e._count.payrollDetails,
    leaveRequestCount: e._count.leaveRequests,
    attendanceRecordCount: e._count.attendanceRecords,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }));

  return Response.json({ success: true, data });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listEmployeesHandler),
  'EMPLOYEES_LIST'
);

// ── POST: Create a new employee ──────────────────────────────────────────────
async function createEmployeeHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string }
): Promise<Response> {
  const body = await request.json();

  const {
    storeId, firstName, lastName, email, phone, nationalId, kraPin,
    nssfNumber, nhifNumber, jobTitle, role, employmentType, hireDate,
    basicSalary, hourlyRate, houseAllowance, transportAllowance,
    medicalAllowance, otherAllowances, payeExempt, nssfExempt, nhifExempt,
    bankName, bankAccountName, bankAccountNumber, bankBranchCode,
    emergencyContactName, emergencyContactPhone, emergencyContactRelation,
    notes, userId,
  } = body;

  // Validation
  if (!storeId || !firstName || !lastName || !hireDate) {
    return Response.json(
      { success: false, error: 'storeId, firstName, lastName, and hireDate are required.' },
      { status: 400 }
    );
  }

  const hireDateParsed = new Date(hireDate);
  if (isNaN(hireDateParsed.getTime())) {
    return Response.json(
      { success: false, error: 'Invalid hireDate format. Use ISO 8601.' },
      { status: 400 }
    );
  }

  // Check unique email per store (if email provided)
  if (email) {
    const existing = await db.employee.findUnique({
      where: { storeId_email: { storeId, email: email.toLowerCase().trim() } },
      select: { id: true },
    });
    if (existing) {
      return Response.json(
        { success: false, error: `An employee with email "${email}" already exists for this store.` },
        { status: 409 }
      );
    }
  }

  const employee = await db.employee.create({
    data: {
      storeId,
      userId: userId || null,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email ? email.toLowerCase().trim() : null,
      phone: phone || null,
      nationalId: nationalId || null,
      kraPin: kraPin || null,
      nssfNumber: nssfNumber || null,
      nhifNumber: nhifNumber || null,
      jobTitle: jobTitle || null,
      role: role || 'STAFF',
      employmentType: employmentType || 'PERMANENT',
      hireDate: hireDateParsed,
      status: 'ACTIVE',
      basicSalary: basicSalary || 0,
      hourlyRate: hourlyRate || null,
      houseAllowance: houseAllowance || 0,
      transportAllowance: transportAllowance || 0,
      medicalAllowance: medicalAllowance || 0,
      otherAllowances: otherAllowances || 0,
      payeExempt: payeExempt || false,
      nssfExempt: nssfExempt || false,
      nhifExempt: nhifExempt || false,
      bankName: bankName || null,
      bankAccountName: bankAccountName || null,
      bankAccountNumber: bankAccountNumber || null,
      bankBranchCode: bankBranchCode || null,
      emergencyContactName: emergencyContactName || null,
      emergencyContactPhone: emergencyContactPhone || null,
      emergencyContactRelation: emergencyContactRelation || null,
      notes: notes || null,
    },
  });

  await systemLog({
    action: 'EMPLOYEE_CREATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Employee created: ${employee.firstName} ${employee.lastName} (${employee.jobTitle || 'No title'})`,
    storeId,
    userId: session.userId,
    metadata: { employeeId: employee.id, role: employee.role, employmentType: employee.employmentType },
  });

  return Response.json({
    success: true,
    data: {
      id: employee.id,
      storeId: employee.storeId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      fullName: `${employee.firstName} ${employee.lastName}`,
      email: employee.email,
      jobTitle: employee.jobTitle,
      role: employee.role,
      employmentType: employee.employmentType,
      hireDate: employee.hireDate.toISOString(),
      status: employee.status,
      basicSalary: employee.basicSalary,
    },
  }, { status: 201 });
}

export const POST = withErrorBoundary(
  requireStoreAccess(createEmployeeHandler),
  'EMPLOYEES_CREATE'
);
