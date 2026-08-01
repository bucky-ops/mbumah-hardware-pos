// GET/PATCH/DELETE /api/debt-payment-plans/[id]
//
// Single-plan operations. PENDING_APPROVAL plans can be edited freely;
// ACTIVE plans may only be PAUSED or CANCELLED; DELETE is allowed only on
// PENDING_APPROVAL or CANCELLED plans.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  recalculatePlanTotals,
  markOverdueInstallments,
  getPlanStatus,
  toNumber,
  type PlanStatus,
} from '@/lib/debt-plan-utils';

export const dynamic = 'force-dynamic';

const FINANCIAL_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;
const FINANCIAL_WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ALLOWED_PATCH_STATUSES: PlanStatus[] = ['PAUSED', 'CANCELLED', 'ACTIVE'];

// ── GET: single plan with installments ───────────────────────────────────────

async function getPlanHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const plan = await db.debtPaymentPlan.findUnique({
    where: { id },
    include: {
      customer: {
        select: { id: true, name: true, phone: true, email: true, currentDebtBalance: true, debtLimit: true },
      },
      debtLedger: {
        select: { id: true, amountOwed: true, amountPaid: true, balance: true, status: true, dueDate: true },
      },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      installments: { orderBy: { installmentNumber: 'asc' } },
    },
  });

  if (!plan) {
    return Response.json(
      { success: false, error: 'Payment plan not found.' },
      { status: 404 },
    );
  }

  // Lazily apply overdue marking on read so the UI always reflects reality.
  const now = new Date();
  const overdueInstallmentIds = plan.installments
    .filter((i) => {
      if (i.status === 'PAID' || i.status === 'WAIVED') return false;
      return new Date(i.dueDate).getTime() < now.getTime() && i.status !== 'OVERDUE';
    })
    .map((i) => i.id);

  if (overdueInstallmentIds.length > 0) {
    await db.debtPlanInstallment.updateMany({
      where: { id: { in: overdueInstallmentIds } },
      data: { status: 'OVERDUE' },
    });
    // Re-fetch with updated statuses.
    const refreshed = await db.debtPaymentPlan.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, name: true, phone: true, email: true, currentDebtBalance: true, debtLimit: true },
        },
        debtLedger: {
          select: { id: true, amountOwed: true, amountPaid: true, balance: true, status: true, dueDate: true },
        },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        installments: { orderBy: { installmentNumber: 'asc' } },
      },
    });
    if (refreshed) {
      // Recompute totals and persist.
      const totals = recalculatePlanTotals(refreshed, refreshed.installments);
      const derivedStatus = getPlanStatus({
        ...refreshed,
        ...totals,
      });
      await db.debtPaymentPlan.update({
        where: { id },
        data: { ...totals, status: derivedStatus },
      });
      const finalPlan = await db.debtPaymentPlan.findUnique({
        where: { id },
        include: {
          customer: {
            select: { id: true, name: true, phone: true, email: true, currentDebtBalance: true, debtLimit: true },
          },
          debtLedger: {
            select: { id: true, amountOwed: true, amountPaid: true, balance: true, status: true, dueDate: true },
          },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          installments: { orderBy: { installmentNumber: 'asc' } },
        },
      });
      if (finalPlan) {
        return Response.json({ success: true, data: serializePlan(finalPlan) });
      }
    }
  }

  return Response.json({ success: true, data: serializePlan(plan) });
}

function serializePlan<T extends { installments: Array<Record<string, unknown>> }>(plan: T): Record<string, unknown> {
  return {
    ...plan,
    totalAmount: toNumber((plan as unknown as { totalAmount: unknown }).totalAmount),
    installmentAmount: toNumber((plan as unknown as { installmentAmount: unknown }).installmentAmount),
    amountPaid: toNumber((plan as unknown as { amountPaid: unknown }).amountPaid),
    balance: toNumber((plan as unknown as { balance: unknown }).balance),
    interestRate: toNumber((plan as unknown as { interestRate: unknown }).interestRate),
    lateFee: toNumber((plan as unknown as { lateFee: unknown }).lateFee),
    installments: plan.installments.map((i) => ({
      ...i,
      amountDue: toNumber(i.amountDue),
      amountPaid: toNumber(i.amountPaid),
      lateFeeApplied: toNumber(i.lateFeeApplied),
    })),
    debtLedger: (plan as unknown as { debtLedger: Record<string, unknown> | null }).debtLedger
      ? {
          ...(plan as unknown as { debtLedger: Record<string, unknown> }).debtLedger,
          amountOwed: toNumber((plan as unknown as { debtLedger: { amountOwed: unknown } }).debtLedger.amountOwed),
          amountPaid: toNumber((plan as unknown as { debtLedger: { amountPaid: unknown } }).debtLedger.amountPaid),
          balance: toNumber((plan as unknown as { debtLedger: { balance: unknown } }).debtLedger.balance),
        }
      : null,
  };
}

// ── PATCH: update notes/status (with state-machine rules) ───────────────────

async function patchPlanHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

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

  return Response.json({ success: true, data: serializePlan(updated) });
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

// Silence unused import — markOverdueInstallments is exported by the util
// module and may be reused by callers that operate on bulk installment lists.
void markOverdueInstallments;

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
