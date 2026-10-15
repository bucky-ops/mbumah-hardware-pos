// GET /api/payroll/payslips/[id] - single payslip (PII masked per viewer)

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { hasHrPermission } from '@/lib/hr/permissions';
import { buildPayslipView } from '@/lib/hr/payroll/payslip-view';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const detail = await db.payrollDetail.findFirst({
      where: { id, storeId: session.storeId || '' },
      include: {
        payrollRun: {
          select: { runType: true, status: true, payrollPeriod: { select: { name: true, payDate: true } } },
        },
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            nationalId: true,
            kraPin: true,
            nssfNumber: true,
            nhifNumber: true,
            bankAccountNumber: true,
            bankAccountName: true,
            phone: true,
          },
        },
      },
    });
    if (!detail) {
      return Response.json({ success: false, error: 'Payslip not found.' }, { status: 404 });
    }
    const viewerCanUnmask = hasHrPermission(session.role, 'hr.employee.unmask.pii');
    const view = buildPayslipView({
      detail,
      run: detail.payrollRun,
      employee: detail.employee,
      viewerCanUnmask,
    });
    return Response.json({ success: true, data: view });
  },
);
