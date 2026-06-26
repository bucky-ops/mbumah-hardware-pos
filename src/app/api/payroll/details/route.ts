// GET /api/payroll/details
//
// Fetch payroll detail (payslip) records.
//   Query params:
//     payrollRunId   — get all payslips for a specific run
//     employeeId     — get all payslips for a specific employee
//     storeId        — tenant scoping (required for non-admin)
//     paymentStatus  — filter by PENDING / PAID / FAILED / HELD

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function listDetailsHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null }
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;
  const payrollRunId = searchParams.get('payrollRunId') || undefined;
  const employeeId = searchParams.get('employeeId') || undefined;
  const paymentStatus = searchParams.get('paymentStatus') || undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  if (!storeId && !payrollRunId && !employeeId) {
    return Response.json({ success: true, data: [] });
  }

  const where: Record<string, unknown> = {};
  if (storeId) where.storeId = storeId;
  if (payrollRunId) where.payrollRunId = payrollRunId;
  if (employeeId) where.employeeId = employeeId;
  if (paymentStatus) where.paymentStatus = paymentStatus;

  const details = await db.payrollDetail.findMany({
    where,
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          jobTitle: true,
          employmentType: true,
          bankName: true,
          bankAccountNumber: true,
        },
      },
      payrollRun: {
        select: {
          id: true,
          runType: true,
          status: true,
          payrollPeriod: {
            select: { id: true, name: true, startDate: true, endDate: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const data = details.map((d) => ({
    id: d.id,
    payrollRunId: d.payrollRunId,
    employeeId: d.employeeId,
    storeId: d.storeId,
    // Employee info (for display without a second query)
    employeeName: `${d.employee.firstName} ${d.employee.lastName}`,
    employeeEmail: d.employee.email,
    employeePhone: d.employee.phone,
    employeeJobTitle: d.employee.jobTitle,
    employmentType: d.employee.employmentType,
    bankName: d.employee.bankName,
    bankAccountNumber: d.employee.bankAccountNumber,
    // Period info
    periodName: d.payrollRun.payrollPeriod.name,
    periodStartDate: d.payrollRun.payrollPeriod.startDate.toISOString(),
    periodEndDate: d.payrollRun.payrollPeriod.endDate.toISOString(),
    runType: d.payrollRun.runType,
    runStatus: d.payrollRun.status,
    // Earnings
    basicSalary: d.basicSalary,
    houseAllowance: d.houseAllowance,
    transportAllowance: d.transportAllowance,
    medicalAllowance: d.medicalAllowance,
    otherAllowances: d.otherAllowances,
    overtimePay: d.overtimePay,
    grossPay: d.grossPay,
    // Statutory deductions
    paye: d.paye,
    nssf: d.nssf,
    nhif: d.nhif,
    housingLevy: d.housingLevy,
    // Other deductions
    payeArrears: d.payeArrears,
    loanDeduction: d.loanDeduction,
    otherDeductions: d.otherDeductions,
    totalDeductions: d.totalDeductions,
    netPay: d.netPay,
    // Working stats
    daysWorked: d.daysWorked,
    daysPresent: d.daysPresent,
    daysAbsent: d.daysAbsent,
    daysOnLeave: d.daysOnLeave,
    overtimeHours: d.overtimeHours,
    // Payment
    paymentStatus: d.paymentStatus,
    paymentRef: d.paymentRef,
    paymentDate: d.paymentDate?.toISOString() ?? null,
    payslipPdfUrl: d.payslipPdfUrl,
    // Audit
    deductionsBreakdown: d.deductionsBreakdown,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }));

  return Response.json({ success: true, data });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listDetailsHandler),
  'PAYROLL_DETAILS_LIST'
);
