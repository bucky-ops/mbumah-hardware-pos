// GET /api/self-service/me/payslips/[id]/pdf — the employee's own payslip PDF
// (v2.161.0). The spec's Phase 4.6 built the payslip PDF for HR viewers; the
// EMPLOYEE could see the breakdown in the portal but could never take the
// document home. This route closes that gap with the SAME two builders the
// HR route uses (buildPayslipView + buildPayslipPdf — one source of truth,
// the PII masking included): statutory ids are masked unless the caller
// holds hr.employee.unmask.pii, exactly like /api/self-service/me/payslips/[id].
//
// Own-data rule (Phase 4.7 acceptance 1): a payslip that is not yours is a
// 404, never a 403 — existence is not leaked.
//
// Honest lifecycle gate: a DRAFT/PENDING_APPROVAL/APPROVED row is NOT yet a
// payslip — rows become immutable payslips the moment the run POSTS (the
// sanctioned issuance write stamps payslipNumber + payslipIssuedAt). A
// non-issued detail answers 409 NOT_ISSUED; the portal's dialog says the
// same in plain language.

import type { NextRequest } from 'next/server';
import { hasHrPermission } from '@/lib/hr/permissions';
import { db } from '@/lib/db';
import { buildPayslipView } from '@/lib/hr/payroll/payslip-view';
import { buildPayslipPdf } from '@/lib/hr/payroll/payslip-pdf';
import { selfServiceGuard, selfServiceErrorResponse } from '@/lib/hr/self-service';
import type { AuthSession } from '@/lib/auth';
import type { SelfEmployee } from '@/lib/hr/self-service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = selfServiceGuard('hr.payroll.read.own')(
  async (_request: NextRequest, session: AuthSession, employee: SelfEmployee, context?: Ctx) => {
    try {
      const { id } = (await context?.params) ?? { id: '' };
      const detail = await db.payrollDetail.findFirst({
        where: { id, employeeId: employee.id },
        include: {
          payrollRun: {
            select: {
              runType: true,
              status: true,
              payrollPeriod: { select: { name: true, payDate: true } },
            },
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
        return Response.json(
          { success: false, error: 'Payslip not found.', code: 'PAYSLIP_NOT_FOUND' },
          { status: 404 },
        );
      }
      if (!detail.payslipIssuedAt) {
        return Response.json(
          {
            success: false,
            error: 'This payslip has not been issued yet — it becomes available for download once the run posts.',
            code: 'NOT_ISSUED',
          },
          { status: 409 },
        );
      }
      // Same masking posture as the JSON detail route: masked unless the
      // caller holds hr.employee.unmask.pii (computed server-side, never
      // from a client-supplied parameter).
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
    } catch (error) {
      return selfServiceErrorResponse(error);
    }
  },
);
