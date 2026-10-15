// GET /api/payroll/payslips/[id]/pdf - payslip PDF (PII masked per viewer)

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { hasHrPermission } from '@/lib/hr/permissions';
import { buildPayslipView } from '@/lib/hr/payroll/payslip-view';
import { buildPayslipPdf } from '@/lib/hr/payroll/payslip-pdf';

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
    const pdf = buildPayslipPdf(view);
    const filename = `${(detail.payslipNumber ?? `payslip-${detail.id}`).replace(/[^A-Za-z0-9._-]/g, '')}.pdf`;
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
);
