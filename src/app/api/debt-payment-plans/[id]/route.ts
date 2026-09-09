// GET/PATCH/DELETE /api/debt-payment-plans/[id]
//
// Single-plan operations. PENDING_APPROVAL plans can be edited freely;
// ACTIVE plans may only be PAUSED or CANCELLED; DELETE is allowed only on
// PENDING_APPROVAL or CANCELLED plans.
//
// Task 12-d (debt-plan audit) changes:
//   - Tenant isolation now relies on Layer-4 tenancy: `debtPaymentPlan` was
//     added to STORE_SCOPED_MODELS in src/lib/db.ts, so this bare
//     `findUnique({ where: { id } })` is auto-narrowed to the caller's store
//     (previously any financial user could touch another store's plan by ID).
//   - GET applies the overdue sweep with the shared `markOverdueInstallments`
//     util and recomputes/persists totals with a single in-memory merge — the
//     old implementation re-fetched the whole plan twice more (3 queries +
//     2 reloads for one GET) and carried a dead `void markOverdueInstallments`
//     import hack instead of using the helper that was exported for exactly
//     this purpose.
//   - PATCH allows DEFAULTED → CANCELLED. The old transition table made a
//     DEFAULTED plan a dead end: payments/waivers were blocked (pay/waive
//     required ACTIVE/PAUSED), PATCH rejected every target, and DELETE only
//     accepted PENDING_APPROVAL/CANCELLED — the plan could never leave
//     DEFAULTED. (Pay/waive on DEFAULTED plans is separately enabled in
//     those routes so customers can catch up.)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  recalculatePlanTotals,
  markOverdueInstallments,
  getPlanStatus,
  serializePlanRow,
  type PlanStatus,
} from '@/lib/debt-plan-utils';

export const dynamic = 'force-dynamic';

const FINANCIAL_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;
const FINANCIAL_WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ALLOWED_PATCH_STATUSES: PlanStatus[] = ['PAUSED', 'CANCELLED', 'ACTIVE'];

// Shared include shape for the plan detail query (used by all fetches here).
const PLAN_INCLUDE = {
  customer: {
    select: { id: true, name: true, phone: true, email: true, currentDebtBalance: true, debtLimit: true },
  },
  debtLedger: {
    select: { id: true, amountOwed: true, amountPaid: true, balance: true, status: true, dueDate: true },
  },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  installments: { orderBy: { installmentNumber: 'asc' } },
} as const;

// ── GET: single plan with installments ───────────────────────────────────────

async function getPlanHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  let plan = await db.debtPaymentPlan.findUnique({
    where: { id },
    include: PLAN_INCLUDE,
  });

  if (!plan) {
    return Response.json(
      { success: false, error: 'Payment plan not found.' },
      { status: 404 },
    );
  }

  // Lazily apply overdue marking on read so the UI always reflects reality.
  // Task 12-d: uses the shared util; after persisting the status flips the
  // refreshed totals/status are merged IN MEMORY instead of re-fetching the
  // plan twice (the old code issued up to 3 full plan queries per GET).
  const now = new Date();
  const marked = markOverdueInstallments(plan.installments, now);
  const overdueInstallmentIds = plan.installments
    .filter((i, idx) => marked[idx].status === 'OVERDUE' && i.status !== 'OVERDUE')
    .map((i) => i.id);

  if (overdueInstallmentIds.length > 0) {
    await db.debtPlanInstallment.updateMany({
      where: { id: { in: overdueInstallmentIds } },
      data: { status: 'OVERDUE' },
    });

    const planWithMarked = { ...plan, installments: marked };
    const totals = recalculatePlanTotals(planWithMarked, marked);
    const derivedStatus = getPlanStatus({ ...planWithMarked, ...totals });
    await db.debtPaymentPlan.update({
      where: { id },
      data: { ...totals, status: derivedStatus },
    });

    plan = {
      ...planWithMarked,
      ...totals,
      status: derivedStatus,
    } as typeof plan;
  }

  return Response.json({ success: true, data: serializePlanRow(plan) });
}

// ── PATCH: update notes/status (with state-machine rules) ───────────────────

async function patchPlanHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  // Task 12-d: malformed JSON is a client bug → 400 (was a 500 via boundary).
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Request body is not valid JSON.' },
      { status: 400 },
    );
  }

  const existing = await db.debtPaymentPlan.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Payment plan not found.' },
      { status: 404 },
    );
  }

  const updates: Record<string, unknown> = {};
  const session = await getSessionFromRequest(request);
  const userId = session?.userId;

  // Notes can only be edited while PENDING_APPROVAL.
  if (typeof body.notes === 'string' && existing.status === 'PENDING_APPROVAL') {
    updates.notes = body.notes;
  } else if (typeof body.notes === 'string' && existing.status !== 'PENDING_APPROVAL') {
    return Response.json(
      { success: false, error: 'Notes can only be edited on pending plans.' },
      { status: 400 },
    );
  }

  // Status transitions.
  if (typeof body.status === 'string') {
    const target = body.status as PlanStatus;
    if (!ALLOWED_PATCH_STATUSES.includes(target)) {
      return Response.json(
        { success: false, error: `Status "${body.status}" is not directly settable via PATCH.` },
        { status: 400 },
      );
    }
    if (existing.status === 'PENDING_APPROVAL') {
      // PENDING_APPROVAL plans must be approved (POST /approve), not patched.
      return Response.json(
        { success: false, error: 'Pending plans must be approved first.' },
        { status: 400 },
      );
    }
    if (existing.status === 'ACTIVE' && target === 'PAUSED') {
      updates.status = 'PAUSED';
    } else if (existing.status === 'PAUSED' && target === 'ACTIVE') {
      updates.status = 'ACTIVE';
    } else if (
      (existing.status === 'ACTIVE' || existing.status === 'PAUSED') &&
      target === 'CANCELLED'
    ) {
      updates.status = 'CANCELLED';
      updates.cancelledAt = new Date();
    } else if (existing.status === 'DEFAULTED' && target === 'CANCELLED') {
      // Task 12-d: DEFAULTED plans were a state-machine dead end (no PATCH
      // transition accepted, pay/waive blocked, DELETE rejected) — the plan
      // could never leave DEFAULTED even when both parties agreed to abort.
      // Cancelling is the correct escape hatch; the underlying debt remains
      // collectible via the debt ledger outside the plan.
      updates.status = 'CANCELLED';
      updates.cancelledAt = new Date();
    } else {
      return Response.json(
        {
          success: false,
          error: `Cannot transition plan from ${existing.status} to ${target} via PATCH.`,
        },
        { status: 400 },
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 },
    );
  }

  const updated = await db.debtPaymentPlan.update({
    where: { id },
    data: updates,
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      debtLedger: { select: { id: true, amountOwed: true, balance: true, status: true } },
      installments: { orderBy: { installmentNumber: 'asc' } },
    },
  });

  await systemLog({
    action: 'DEBT_PAYMENT_PLAN_UPDATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Payment plan ${id} updated. Fields: ${Object.keys(updates).join(', ')}`,
    storeId: existing.storeId,
    userId: userId || undefined,
    metadata: { planId: id, updates },
  });

  return Response.json({ success: true, data: serializePlanRow(updated) });
}

// ── DELETE: only PENDING_APPROVAL or CANCELLED ──────────────────────────────

async function deletePlanHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const session = await getSessionFromRequest(request);
  const userId = session?.userId;

  const existing = await db.debtPaymentPlan.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Payment plan not found.' },
      { status: 404 },
    );
  }

  if (existing.status !== 'PENDING_APPROVAL' && existing.status !== 'CANCELLED') {
    return Response.json(
      {
        success: false,
        error: `Cannot delete a plan with status "${existing.status}". Only PENDING_APPROVAL or CANCELLED plans can be deleted.`,
      },
      { status: 400 },
    );
  }

  // Cascade deletes installments via Prisma schema (onDelete: Cascade).
  await db.debtPaymentPlan.delete({ where: { id } });

  await systemLog({
    action: 'DEBT_PAYMENT_PLAN_DELETED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Payment plan ${id} deleted.`,
    storeId: existing.storeId,
    userId: userId || undefined,
    metadata: {
      planId: id,
      customerId: existing.customerId,
      debtLedgerId: existing.debtLedgerId,
    },
  });

  return Response.json({
    success: true,
    message: 'Payment plan deleted successfully.',
  });
}

export const GET = withErrorBoundary(
  withFinancialAuth(getPlanHandler, FINANCIAL_READ_ROLES),
  'DEBT_PLAN_GET',
);

export const PATCH = withErrorBoundary(
  withFinancialAuth(patchPlanHandler, FINANCIAL_WRITE_ROLES),
  'DEBT_PLAN_UPDATE',
);

export const DELETE = withErrorBoundary(
  withFinancialAuth(deletePlanHandler, FINANCIAL_WRITE_ROLES),
  'DEBT_PLAN_DELETE',
);
