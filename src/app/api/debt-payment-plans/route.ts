// GET/POST /api/debt-payment-plans
//
// Debt Payment Plans — installment-based repayment schedules for outstanding
// customer debts. Mirrors the auth/tenancy pattern of /api/debt and the
// financial routes: `withErrorBoundary(withFinancialAuth(...))`.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  calculateInstallmentSchedule,
  calculateEndDate,
  calculateInstallmentAmount,
  toNumber,
  type PlanFrequency,
} from '@/lib/debt-plan-utils';

export const dynamic = 'force-dynamic';

const FINANCIAL_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;
const FINANCIAL_WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

const VALID_FREQUENCIES: PlanFrequency[] = ['WEEKLY', 'BI_WEEKLY', 'MONTHLY'];

// ── GET: list plans ──────────────────────────────────────────────────────────

async function listPlansHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const customerId = searchParams.get('customerId') || '';
  const status = searchParams.get('status') || '';
  const overdueOnly = searchParams.get('overdue') === 'true';

  const where: Record<string, unknown> = { storeId };
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;
  if (overdueOnly) where.installmentsOverdue = { gt: 0 };

  const plans = await db.debtPaymentPlan.findMany({
    where,
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          currentDebtBalance: true,
        },
      },
      debtLedger: {
        select: { id: true, amountOwed: true, balance: true, status: true },
      },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      _count: { select: { installments: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Serialize Decimal fields to numbers for the API response.
  const serialized = plans.map((plan) => ({
    ...plan,
    totalAmount: toNumber(plan.totalAmount),
    installmentAmount: toNumber(plan.installmentAmount),
    amountPaid: toNumber(plan.amountPaid),
    balance: toNumber(plan.balance),
    interestRate: toNumber(plan.interestRate),
    lateFee: toNumber(plan.lateFee),
    startDate: plan.startDate,
    endDate: plan.endDate,
    completedAt: plan.completedAt,
    cancelledAt: plan.cancelledAt,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    debtLedger: plan.debtLedger
      ? {
          ...plan.debtLedger,
          amountOwed: toNumber(plan.debtLedger.amountOwed),
          balance: toNumber(plan.debtLedger.balance),
        }
      : null,
  }));

  return Response.json({ success: true, data: serialized });
}

// ── POST: create a new plan + scheduled installments ────────────────────────

async function createPlanHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    customerId,
    debtLedgerId,
    totalAmount,
    installmentCount,
    frequency,
    startDate,
    interestRate,
    lateFee,
    notes,
    autoCharge,
  } = body ?? {};

  // ── Validate required fields ──────────────────────────────────────────────
  if (!storeId || !customerId || !debtLedgerId) {
    return Response.json(
      {
        success: false,
        error: 'storeId, customerId, and debtLedgerId are required.',
      },
      { status: 400 },
    );
  }

  const total = toNumber(totalAmount);
  if (!Number.isFinite(total) || total <= 0) {
    return Response.json(
      { success: false, error: 'totalAmount must be greater than zero.' },
      { status: 400 },
    );
  }

  const count = parseInt(String(installmentCount), 10);
  if (!Number.isFinite(count) || count < 1 || count > 60) {
    return Response.json(
      { success: false, error: 'installmentCount must be between 1 and 60.' },
      { status: 400 },
    );
  }

  const freq: PlanFrequency = VALID_FREQUENCIES.includes(frequency as PlanFrequency)
    ? (frequency as PlanFrequency)
    : 'MONTHLY';

  const start = startDate ? new Date(startDate) : new Date();
  if (Number.isNaN(start.getTime())) {
    return Response.json(
      { success: false, error: 'startDate is not a valid date.' },
      { status: 400 },
    );
  }
  // Don't allow start dates more than 1 day in the past (grace for timezone).
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  if (start.getTime() < oneDayAgo.getTime()) {
    return Response.json(
      { success: false, error: 'startDate cannot be in the past.' },
      { status: 400 },
    );
  }

  const rate = toNumber(interestRate);
  const fee = toNumber(lateFee);

  // ── Validate referenced entities ──────────────────────────────────────────
  const session = await getSessionFromRequest(request);
  const createdById = session?.userId;
  if (!createdById) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }

  const [debtLedger, customer] = await Promise.all([
    db.debtLedger.findUnique({ where: { id: debtLedgerId } }),
    db.customer.findUnique({ where: { id: customerId } }),
  ]);

  if (!debtLedger) {
    return Response.json(
      { success: false, error: 'Debt ledger entry not found.' },
      { status: 404 },
    );
  }
  if (debtLedger.storeId !== storeId) {
    return Response.json(
      { success: false, error: 'Debt ledger does not belong to this store.' },
      { status: 403 },
    );
  }
  if (!customer) {
    return Response.json(
      { success: false, error: 'Customer not found.' },
      { status: 404 },
    );
  }

  // Don't allow a plan larger than the outstanding debt balance (+ tiny epsilon).
  const debtBalance = toNumber(debtLedger.balance);
  if (total > debtBalance + 0.5) {
    return Response.json(
      {
        success: false,
        error: `Plan total (KES ${total.toLocaleString()}) exceeds outstanding debt balance (KES ${debtBalance.toLocaleString()}).`,
      },
      { status: 400 },
    );
  }

  // Block duplicate active plans on the same debt ledger.
  const existingActive = await db.debtPaymentPlan.findFirst({
    where: {
      debtLedgerId,
      status: { in: ['PENDING_APPROVAL', 'ACTIVE', 'PAUSED'] },
    },
    select: { id: true },
  });
  if (existingActive) {
    return Response.json(
      {
        success: false,
        error: 'An active payment plan already exists for this debt. Cancel it first.',
      },
      { status: 409 },
    );
  }

  // ── Calculate schedule ────────────────────────────────────────────────────
  const schedule = calculateInstallmentSchedule(total, count, freq, start, rate);
  const endDate = calculateEndDate(start, count, freq);
  const installmentAmount = calculateInstallmentAmount(total, count, rate);

  // ── Persist plan + installments atomically ────────────────────────────────
  const created = await db.$transaction(async (tx) => {
    const plan = await tx.debtPaymentPlan.create({
      data: {
        storeId,
        customerId,
        debtLedgerId,
        createdById,
        status: 'PENDING_APPROVAL',
        totalAmount: total,
        installmentCount: count,
        installmentAmount,
        frequency: freq,
        startDate: start,
        endDate,
        amountPaid: 0,
        balance: total,
        installmentsPaid: 0,
        installmentsOverdue: 0,
        interestRate: rate,
        lateFee: fee,
        notes: typeof notes === 'string' ? notes : null,
        autoCharge: Boolean(autoCharge),
      },
    });

    await tx.debtPlanInstallment.createMany({
      data: schedule.map((s) => ({
        planId: plan.id,
        installmentNumber: s.installmentNumber,
        dueDate: s.dueDate,
        amountDue: s.amountDue,
        amountPaid: 0,
        status: 'SCHEDULED',
      })),
    });

    return plan;
  });

  // Reload with relations for the response.
  const fullPlan = await db.debtPaymentPlan.findUnique({
    where: { id: created.id },
    include: {
      customer: {
        select: { id: true, name: true, phone: true, email: true, currentDebtBalance: true },
      },
      debtLedger: {
        select: { id: true, amountOwed: true, balance: true, status: true },
      },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      installments: { orderBy: { installmentNumber: 'asc' } },
    },
  });

  await systemLog({
    action: 'DEBT_PAYMENT_PLAN_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Payment plan created for customer ${customer.name}: KES ${total.toLocaleString()} over ${count} ${freq.toLowerCase()} installments.`,
    storeId,
    userId: createdById,
    metadata: {
      planId: created.id,
      customerId,
      debtLedgerId,
      totalAmount: total,
      installmentCount: count,
      frequency: freq,
      interestRate: rate,
      lateFee: fee,
    },
  });

  // Serialize decimals before returning.
  const serialized = fullPlan
    ? {
        ...fullPlan,
        totalAmount: toNumber(fullPlan.totalAmount),
        installmentAmount: toNumber(fullPlan.installmentAmount),
        amountPaid: toNumber(fullPlan.amountPaid),
        balance: toNumber(fullPlan.balance),
        interestRate: toNumber(fullPlan.interestRate),
        lateFee: toNumber(fullPlan.lateFee),
        installments: fullPlan.installments.map((i) => ({
          ...i,
          amountDue: toNumber(i.amountDue),
          amountPaid: toNumber(i.amountPaid),
          lateFeeApplied: toNumber(i.lateFeeApplied),
        })),
        debtLedger: fullPlan.debtLedger
          ? {
              ...fullPlan.debtLedger,
              amountOwed: toNumber(fullPlan.debtLedger.amountOwed),
              balance: toNumber(fullPlan.debtLedger.balance),
            }
          : null,
      }
    : null;

  return Response.json({ success: true, data: serialized }, { status: 201 });
}

export const GET = withErrorBoundary(
  withFinancialAuth(listPlansHandler, FINANCIAL_READ_ROLES),
  'DEBT_PLANS_LIST',
);

export const POST = withErrorBoundary(
  withFinancialAuth(createPlanHandler, FINANCIAL_WRITE_ROLES),
  'DEBT_PLAN_CREATE',
);
