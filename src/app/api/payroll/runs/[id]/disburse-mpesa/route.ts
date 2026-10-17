// POST /api/payroll/runs/[id]/disburse-mpesa - disburse pending payslips of a
// posted/locked run via M-Pesa B2C (SalaryPayment). v2.21.0.
//
// v2.22.0 adds the recovery modes selected by `mode` in the JSON body:
//   • "all" (default)       → disburseRunViaMpesa: every eligible PENDING payslip
//   • "retry-failed"        → retryFailedPayrollB2C: only payslips whose latest
//                             B2C attempt FAILED and which are still unpaid
//   • "refresh-stuck"       → refreshStuckPayrollB2C: re-query PROCESSING
//                             transactions with no result callback for
//                             B2C_STALE_PROCESSING_MS
//
// Permission model mirrors the manual disburse endpoint: STORE_OWNER with the
// hr.payroll.disburse permission (disbursement is a checker-level action).
// When Daraja B2C credentials are absent this runs in MOCK mode in
// development only; production refuses with B2C_NOT_CONFIGURED.

import { hrGuard } from '@/lib/hr/guard';
import {
  disburseRunViaMpesa,
  refreshStuckPayrollB2C,
  retryFailedPayrollB2C,
  type B2CStaleResult,
  type B2CDisburseSummary,
} from '@/lib/hr/payroll/disbursement-service';
import {
  payrollActorContext,
  notifyPayrollRunDisbursed,
  notifyEmployeesPaid,
} from '@/lib/hr/payroll/run-service';
import { payrollErrorResponse, readJson } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const DISBURSE_ROLES = ['STORE_OWNER'] as const;

export const POST = hrGuard('hr.payroll.disburse', DISBURSE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const body = (await readJson(request)) as { mode?: string; detailIds?: unknown };
    const mode = body.mode === 'retry-failed' || body.mode === 'refresh-stuck' ? body.mode : 'all';
    // v2.34.0: row-level Retry targeting — only string ids, deduped, capped
    // so a malformed payload can never widen the query beyond reason.
    const detailIds = Array.isArray(body.detailIds)
      ? [...new Set(body.detailIds.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64))].slice(0, 50)
      : undefined;
    try {
      if (mode === 'refresh-stuck') {
        const result: B2CStaleResult = await refreshStuckPayrollB2C(
          payrollActorContext(session),
          id,
        );
        return Response.json({ success: true, data: result });
      }
      const summary: B2CDisburseSummary = await (mode === 'retry-failed'
        ? () => retryFailedPayrollB2C(payrollActorContext(session), id, detailIds)
        : () => disburseRunViaMpesa(payrollActorContext(session), id))();
      // v2.50.0: the disbursement digest rides the 'all' batch only — a
      // retry or refresh is a partial recovery, and re-notifying on every
      // retry would spam the payroll group. BEST-EFFORT by contract: the
      // batch above is already durable; a digest failure must never fail
      // the request.
      // v2.51.0: the personal "you've been paid" fan-out rides the same
      // 'all' batch — but ONLY for rows that actually settled PAID (mock
      // receipts). A live row still in flight (SENT) is not "paid"; its
      // notice arrives from the Daraja result webhook when the receipt lands.
      let digest = null;
      let paidNotices = null;
      if (mode === 'all') {
        const actor = payrollActorContext(session);
        digest = await notifyPayrollRunDisbursed({
          runId: id,
          storeId: actor.storeId,
          actorId: actor.actorId,
          mode: summary.mode === 'mock' ? 'mpesa-mock' : 'mpesa',
          eligible: summary.eligible,
          initiated: summary.initiated,
          alreadyInitiated: summary.alreadyInitiated,
          paidNow: summary.receipts.length,
          failed: summary.failed.length,
          skipped: summary.skipped.length,
          ...(summary.backoffSkipped !== undefined
            ? { backoffSkipped: summary.backoffSkipped }
            : {}),
          ...(summary.maxAttemptSkipped !== undefined
            ? { maxAttemptSkipped: summary.maxAttemptSkipped }
            : {}),
          paymentRef: null,
          disbursedAtIso: new Date().toISOString(),
          rows: (summary.results ?? []).map((r) => ({
            employeeName: r.employeeName,
            employeeCode: r.employeeCode,
            net: r.net,
            status: r.status,
            receipt: r.receipt ?? null,
          })),
        }).catch((err) => {
          console.warn('[payroll] b2c disbursement digest failed (best-effort):', err);
          return null;
        });
        paidNotices = await notifyEmployeesPaid({
          runId: id,
          storeId: actor.storeId,
          mode: summary.mode === 'mock' ? 'mpesa-mock' : 'mpesa',
          paidDetails: (summary.results ?? [])
            .filter((r) => r.status === 'PAID' && typeof r.detailId === 'string')
            .map((r) => ({ detailId: r.detailId as string, receipt: r.receipt ?? null })),
          disbursedAtIso: new Date().toISOString(),
        }).catch((err) => {
          console.warn('[payroll] b2c paid notices failed (best-effort):', err);
          return null;
        });
      }
      return Response.json({ success: true, data: summary, digest, paidNotices });
    } catch (error) {
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
