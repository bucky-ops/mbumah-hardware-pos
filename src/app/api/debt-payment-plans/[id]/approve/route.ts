// POST /api/debt-payment-plans/[id]/approve
//
// Approve a PENDING_APPROVAL plan: set status → ACTIVE and record the
// approving user. Only senior financial roles can approve.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import { toNumber } from '@/lib/debt-plan-utils';

export const dynamic = 'force-dynamic';

const APPROVE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function approvePlanHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const session = await getSessionFromRequest(request);
  if (!session) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }

  const existing = await db.debtPaymentPlan.findUnique({
    where: { id },
    include: { customer: { select: { name: true } } },
  });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Payment plan not found.' },
      { status: 404 },
    );
  }

  if (existing.status !== 'PENDING_APPROVAL') {
    return Response.json(
      {
        success: false,
        error: `Cannot approve a plan with status "${existing.status}". Only PENDING_APPROVAL plans can be approved.`,
      },
      { status: 400 },
    );
  }

  const updated = await db.debtPaymentPlan.update({
    where: { id },
    data: {
      status: 'ACTIVE',
      approvedById: session.userId,
    },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      debtLedger: { select: { id: true, amountOwed: true, balance: true, status: true } },
      installments: { orderBy: { installmentNumber: 'asc' } },
    },
  });

  await systemLog({
    action: 'DEBT_PAYMENT_PLAN_APPROVED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Payment plan ${id} approved for customer ${existing.customer?.name ?? 'unknown'} by ${session.email}.`,
    storeId: existing.storeId,
    userId: session.userId,
    metadata: {
      planId: id,
      customerId: existing.customerId,
      approvedById: session.userId,
      totalAmount: toNumber(existing.totalAmount),
    },
  });

  return Response.json({ success: true, data: updated });
}

export const POST = withErrorBoundary(
  withFinancialAuth(approvePlanHandler, APPROVE_ROLES),
  'DEBT_PLAN_APPROVE',
);
