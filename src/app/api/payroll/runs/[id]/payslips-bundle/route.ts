// GET /api/payroll/runs/[id]/payslips-bundle - one zip, every payslip (v2.83.0)
//
// The run hands every slip over: every PayrollDetail in the run goes through
// the SAME buildPayslipView → buildPayslipPdf pipeline the per-row PDF column
// uses — identical PII masking per viewer ([REDACTED] unless the viewer holds
// hr.employee.unmask.pii) — plus a _MANIFEST.csv naming what is inside, all
// zipped by the zero-dependency STORE writer (zip-store.ts).
//
// Contract:
//   • Same guard + roles as the per-payslip PDF route (hr.payroll.read.all).
//     No new visibility: the bundle shows exactly what the dialog's payslip
//     table already shows these roles, as a single download.
//   • Branch-scoped: the run must match session.storeId — a cross-branch id
//     404s instead of leaking another branch's payroll.
//   • Status: no gate beyond the slips existing — a DRAFT with prepared
//     slips may be zipped exactly as its slips are individually downloadable.
//     Zero details → honest 400 NO_PAYSLIPS (there is nothing to hand over).
//   • Export is audit logged (DATA_EXPORT) with field-name-only metadata,
//     same as the digest CSV export.

import { hrGuard } from '@/lib/hr/guard';
import { hasHrPermission } from '@/lib/hr/permissions';
import { buildPayslipView } from '@/lib/hr/payroll/payslip-view';
import { buildPayslipPdf } from '@/lib/hr/payroll/payslip-pdf';
import { buildStoreZip, sanitizeZipEntryName } from '@/lib/hr/payroll/zip-store';
import { payrollBundleFilename, buildBundleManifestCsv, bundleEntryFilenames } from '@/lib/hr/payroll/payslip-bundle';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    try {
      // Branch-scoped (mirrors the digest CSV + PDF routes).
      const run = await db.payrollRun.findFirst({
        where: { id, storeId: session.storeId || '' },
        select: {
          id: true,
          runType: true,
          status: true,
          payrollPeriod: { select: { name: true, payDate: true } },
        },
      });
      if (!run) {
        return Response.json({ success: false, error: 'Payroll run not found.', code: 'NOT_FOUND' }, { status: 404 });
      }

      const details = await db.payrollDetail.findMany({
        where: { payrollRunId: run.id, storeId: session.storeId || '' },
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
      });
      if (details.length === 0) {
        return Response.json(
          { success: false, error: 'This run has no payslips yet — prepare it first, then hand the bundle over.', code: 'NO_PAYSLIPS' },
          { status: 400 },
        );
      }

      // Deterministic order: issued slips by payslip number, un-issued after
      // (by id) — the manifest and the zip agree on this order, always.
      const ordered = [...details].sort((a, b) => {
        if (a.payslipNumber && b.payslipNumber) return a.payslipNumber.localeCompare(b.payslipNumber);
        if (a.payslipNumber) return -1;
        if (b.payslipNumber) return 1;
        return a.id.localeCompare(b.id);
      });

      const viewerCanUnmask = hasHrPermission(session.role, 'hr.employee.unmask.pii');
      const now = new Date();

      // Slip file names first (the manifest lists them), then the bytes.
      const filenames = bundleEntryFilenames(ordered.map((d) => ({ payslipNumber: d.payslipNumber, detailId: d.id })));
      const entries = ordered.map((detail, i) => {
        const view = buildPayslipView({
          detail,
          run: { runType: run.runType, status: run.status, payrollPeriod: run.payrollPeriod },
          employee: detail.employee,
          viewerCanUnmask,
        });
        return {
          employeeName: `${detail.employee.firstName} ${detail.employee.lastName}`.trim(),
          payslipNumber: detail.payslipNumber,
          net: Number(detail.netPay),
          filename: sanitizeZipEntryName(filenames[i]),
          pdf: buildPayslipPdf(view),
        };
      });

      const manifest = buildBundleManifestCsv({
        periodName: run.payrollPeriod?.name ?? 'Payroll run',
        runType: run.runType,
        status: run.status,
        generatedAt: now,
        entries: entries.map(({ payslipNumber, employeeName, filename, net }) => ({ payslipNumber, employeeName, filename, net })),
      });

      const files: Array<{ name: string; data: Uint8Array }> = [
        { name: '_MANIFEST.csv', data: new TextEncoder().encode(manifest) },
        ...entries.map((e) => ({ name: e.filename, data: e.pdf })),
      ];
      const zip = buildStoreZip(files, now);
      const filename = payrollBundleFilename(run.payrollPeriod?.name ?? 'Payroll run', run.runType, now);

      await hrAudit({
        actorId: session.userId,
        actorRole: session.role,
        action: 'PAYROLL_RUN_BUNDLE_EXPORTED',
        resourceType: HrEntityType.DATA_EXPORT,
        resourceId: filename,
        storeId: session.storeId ?? undefined,
        metadata: {
          runId: run.id,
          runType: run.runType,
          status: run.status,
          format: 'zip',
          byteSize: zip.byteLength,
          slipCount: entries.length,
          channel: 'ad_hoc_download',
        },
      }).catch(() => undefined);

      return new Response(new Uint8Array(zip), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(zip.byteLength),
          'X-Payroll-Bundle-Filename': filename,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
