// GET /api/payroll/runs/[id]/digest-csv - on-demand run digest CSV (v2.53.0)
//
// The filing file for ONE payroll run, downloadable on demand from the Pay
// Runs desk. Built by the SAME payrollRunDigestToCsv builder the v2.47.0
// approval and v2.48.0 posting emails use, so a downloaded CSV can never
// disagree with the CSV that rode the digest email for the same run.
//
// Contract:
//   • Same guard + roles as the run detail route (hr.payroll.read.all) —
//     the CSV carries names + staff codes + money, exactly what the run
//     dialog's payslip table already shows these roles. No new visibility.
//   • Branch-scoped: the run must match session.storeId (mirrors the detail
//     route), so a cross-branch id 404s instead of leaking.
//   • Status gate: APPROVED files the approval variant; POSTED/LOCKED file
//     the posted variant (payslip range included). Drafts, pending runs,
//     rejections, voids and failures refuse with 400 RUN_NOT_EXPORTABLE —
//     a digest labelled "Approved by Approver" for a run nobody approved
//     would be a lie.
//   • Empty run (no rows AND all-zero totals) → honest 404 NO_RUN_DATA.
//   • Export is audit logged (DATA_EXPORT) with field-name-only metadata.

import { hrGuard } from '@/lib/hr/guard';
import { buildRunDigestExport, payrollRunExportDecision } from '@/lib/hr/payroll/run-service';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    try {
      // Load branch-scoped (mirrors the run detail route): a cross-branch id
      // 404s instead of leaking another branch's payroll.
      const run = await db.payrollRun.findFirst({
        where: { id, storeId: session.storeId || '' },
        select: {
          id: true,
          runType: true,
          status: true,
          approvedByUserId: true,
          approvedAt: true,
          postedByUserId: true,
          postedAt: true,
          totalGross: true,
          totalDeductions: true,
          totalNet: true,
          employeeCount: true,
          payrollPeriod: { select: { name: true } },
          store: { select: { name: true } },
        },
      });
      if (!run) {
        return Response.json({ success: false, error: 'Payroll run not found.', code: 'NOT_FOUND' }, { status: 404 });
      }

      const decision = payrollRunExportDecision(run.status);
      if (!decision.ok) {
        return Response.json(
          { success: false, error: decision.error, code: decision.code },
          { status: decision.status },
        );
      }

      const csv = await buildRunDigestExport({
        run,
        periodName: run.payrollPeriod?.name ?? 'Payroll run',
        storeName: run.store?.name ?? 'MBUMAH HARDWARE',
        now: new Date(),
      });
      if (!csv) {
        return Response.json(
          { success: false, error: 'Nothing to file for this run yet — no payslip rows and no totals.', code: 'NO_RUN_DATA' },
          { status: 404 },
        );
      }

      await hrAudit({
        actorId: session.userId,
        actorRole: session.role,
        action: 'PAYROLL_RUN_DIGEST_EXPORTED',
        resourceType: HrEntityType.DATA_EXPORT,
        resourceId: csv.filename,
        storeId: session.storeId ?? undefined,
        metadata: {
          runId: run.id,
          runType: run.runType,
          status: run.status,
          variant: decision.variant,
          format: 'csv',
          byteSize: csv.byteSize,
          channel: 'ad_hoc_download',
        },
      }).catch(() => undefined);

      return new Response(Buffer.from(csv.content, 'base64'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${csv.filename}"`,
          'Content-Length': String(csv.byteSize),
          'X-Digest-Csv-Filename': csv.filename,
          'X-Digest-Csv-Size': String(csv.byteSize),
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
