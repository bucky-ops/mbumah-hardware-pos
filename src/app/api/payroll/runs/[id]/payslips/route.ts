// GET /api/payroll/runs/[id]/payslips - payslip rows of one run

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { hasHrPermission } from '@/lib/hr/permissions';
import { buildPayslipView } from '@/lib/hr/payroll/payslip-view';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const run = await db.payrollRun.findFirst({
      where: { id, storeId: session.storeId || '' },
      include: {
        payrollPeriod: { select: { name: true, payDate: true } },
        details: {
          orderBy: [{ payslipNumber: 'asc' }, { createdAt: 'asc' }],
          include: {
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
        },
      },
    });
    if (!run) {
      return Response.json({ success: false, error: 'Payroll run not found.' }, { status: 404 });
    }
    const viewerCanUnmask = hasHrPermission(session.role, 'hr.employee.unmask.pii');
    const payslips = run.details.map((detail) =>
      buildPayslipView({
        detail,
        run: { runType: run.runType, status: run.status, payrollPeriod: run.payrollPeriod },
        employee: detail.employee,
        viewerCanUnmask,
      }),
    );
    return Response.json({ success: true, data: payslips });
  },
);
