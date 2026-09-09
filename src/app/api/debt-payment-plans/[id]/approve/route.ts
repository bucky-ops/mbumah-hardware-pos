// POST /api/debt-payment-plans/[id]/approve
//
// Approve a PENDING_APPROVAL plan: set status → ACTIVE and record the
// approving user. Only senior financial roles can approve.
//
// Task 12-d (debt-plan audit) changes:
//   - The status check + update are now a single ATOMIC conditional
//     `updateMany({ where: { id, status: 'PENDING_APPROVAL' } })` — two
//     concurrent approvals could previously both pass the pre-check and both
//     write, the second silently overwriting the first approver's record.
//   - `approvedAt` is now stamped alongside approvedById (schema migration
//     20260909120000_add_plan_approved_at) so the segregation-of-duties
//     trail records WHO and WHEN.
//   - The response is serialized through the shared `serializePlanRow`
//     helper — this route previously returned the raw Prisma row with
//     unserialized Decimal fields (JSON.stringify emits those as strings,
//     which broke numeric consumers of the response).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import { serializePlanRow, toNumber } from '@/lib/debt-plan-utils';

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

  // AUDIT REMEDIATION (F9-4): segregation of duties — the requester can never
  // be the approver. DebtPaymentPlan.createdById is the user who raised the
  // plan; block self-approval with 409 before any state change.
  if (existing.createdById === session.userId) {
    return Response.json(
      { success: false, error: 'Cannot approve your own payment plan (segregation of duties).' },
      { status: 409 },
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

  // Task 12-d: ATOMIC conditional approval. The predicate guarantees only the
  // first concurrent approver wins; a race loser gets a 409 instead of
  // silently overwriting the winner's approvedById/approvedAt.
  const claimed = await db.debtPaymentPlan.updateMany({
    where: { id, status: 'PENDING_APPROVAL' },
    data: {
      status: 'ACTIVE',
      approvedById: session.userId,
      approvedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    return Response.json(
      {
        success: false,
        error: 'Approval conflict: the plan was already approved or cancelled concurrently. Refresh and retry.',
      },
      { status: 409 },
    );
  }

  const updated = await db.debtPaymentPlan.findUnique({
    where: { id },
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
      approvedAt: new Date().toISOString(),
      totalAmount: toNumber(existing.totalAmount),
    },
  });

  return Response.json({ success: true, data: updated ? serializePlanRow(updated) : null });
}

export const POST = withErrorBoundary(
  withFinancialAuth(approvePlanHandler, APPROVE_ROLES),
  'DEBT_PLAN_APPROVE',
);
