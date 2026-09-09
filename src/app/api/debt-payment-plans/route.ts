// GET/POST /api/debt-payment-plans
//
// Debt Payment Plans — installment-based repayment schedules for outstanding
// customer debts. Mirrors the auth/tenancy pattern of /api/debt and the
// financial routes: `withErrorBoundary(withFinancialAuth(...))`.
//
// Task 12-d (debt-plan audit) changes:
//   GET  — pagination (page/pageSize), a store-wide stale-overdue sweep, live
//          per-plan overdue counts, and a `nextInstallment` on every row so
//          plan cards can render the next due date without loading details.
//          The overdue filter now uses a live installment predicate instead
//          of the previously-stale denormalized counter.
//   POST — malformed-JSON guard, strict frequency validation, bounded
//          interestRate/lateFee, a customer↔store consistency check (defense
//          for the SUPER_ADMIN tenant bypass), a tighter ledger-balance
//          epsilon, and `installmentAmount` derived from the actual schedule
//          (fixes the flat-vs-pro-rated interest divergence).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  calculateInstallmentSchedule,
  calculateEndDate,
  serializePlanRow,
  serializeInstallmentRow,
  toNumber,
  type PlanFrequency,
} from '@/lib/debt-plan-utils';

export const dynamic = 'force-dynamic';

const FINANCIAL_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;
const FINANCIAL_WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

const VALID_FREQUENCIES: PlanFrequency[] = ['WEEKLY', 'BI_WEEKLY', 'MONTHLY'];

// Policy bounds (Task 12-d): previously interestRate/lateFee were accepted
// verbatim from the request body — a typo like 120 instead of 12 silently
// doubled the plan total, and there was nothing stopping a 1000000% rate.
const MAX_INTEREST_RATE_PCT = 100; // annual %
const MAX_LATE_FEE_KES = 100_000;
const MAX_NOTES_LENGTH = 2000;
const MAX_INSTALLMENT_COUNT = 60;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ── GET: list plans (paginated) ──────────────────────────────────────────────

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

  // ── Pagination (Task 12-d): the list used to be an unbounded findMany. ──
  const pageParam = parseInt(searchParams.get('page') ?? '1', 10);
  const pageSizeParam = parseInt(searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(pageSizeParam) ? pageSizeParam : DEFAULT_PAGE_SIZE),
  );
  const requestedPage = Math.max(1, Number.isFinite(pageParam) ? pageParam : 1);

  const now = new Date();

  // ── Stale-overdue sweep (Task 12-d) ─────────────────────────────────────
  // `installmentsOverdue` and installment OVERDUE statuses were only refreshed
  // when a plan's detail view / pay / waive ran, so the Overdue chip and
  // filter on this list silently under-reported. One idempotent conditional
  // update per list request keeps statuses honest (counts are recomputed
  // live below; the denormalized column heals on the next detail visit).
  const staleOverdue = await db.debtPlanInstallment.findFirst({
    where: {
      dueDate: { lt: now },
      status: { in: ['SCHEDULED', 'PARTIAL'] },
      plan: { storeId },
    },
    select: { id: true },
  });
  if (staleOverdue) {
    await db.debtPlanInstallment.updateMany({
      where: {
        dueDate: { lt: now },
        status: { in: ['SCHEDULED', 'PARTIAL'] },
        plan: { storeId },
      },
      data: { status: 'OVERDUE' },
    });
  }

  const where: Record<string, unknown> = { storeId };
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;
  if (overdueOnly) {
    // Live predicate (Task 12-d): was `installmentsOverdue: { gt: 0 }`, a
    // denormalized counter that could be stale for plans never re-opened.
    where.installments = {
      some: { dueDate: { lt: now }, status: { in: ['SCHEDULED', 'PARTIAL', 'MISSED'] } },
    };
  }

  const total = await db.debtPaymentPlan.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);

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
      // Task 12-d: next unpaid installment for card display ("Next: 12 Mar").
      // The list previously included only `_count`, so the card's next-due /
      // overdue-date / Payable badge never rendered (always undefined).
      installments: {
        where: { status: { in: ['SCHEDULED', 'PARTIAL', 'OVERDUE', 'MISSED'] } },
        orderBy: { installmentNumber: 'asc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  // ── Live overdue counts for the page (single groupBy) ──────────────────
  const pageIds = plans.map((p) => p.id);
  const overdueGroups = pageIds.length
    ? await db.debtPlanInstallment.groupBy({
        by: ['planId'],
        where: { planId: { in: pageIds }, status: 'OVERDUE' },
        _count: { _all: true },
      })
    : [];
  const overdueByPlan = new Map(
    overdueGroups.map((g) => [g.planId, g._count._all]),
  );

  // Serialize Decimal fields to numbers for the API response; expose the
  // fetched unpaid installment as `nextInstallment` (list rows no longer
  // carry the unused `_count` include).
  const serialized = plans.map((plan) => {
    const row = serializePlanRow(plan) as Record<string, unknown>;
    const installments = row.installments as
      | Array<ReturnType<typeof serializeInstallmentRow>>
      | undefined;
    delete row.installments;
    row.installmentsOverdue = overdueByPlan.get(plan.id) ?? 0;
    row.nextInstallment = installments && installments.length > 0 ? installments[0] : null;
    return row;
  });

  return Response.json({
    success: true,
    data: serialized,
    // Shape matches ApiResponse.pagination ({page, limit, total, totalPages}).
    pagination: {
      page,
      limit: pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
    },
  });
}

// ── POST: create a new plan + scheduled installments ────────────────────────

async function createPlanHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;

  // Task 12-d: malformed JSON previously escaped as a 500 via the error
  // boundary — a client bug is a 400, not a server fault.
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Request body is not valid JSON.' },
      { status: 400 },
    );
  }

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
  } = (body ?? {}) as Record<string, unknown>;

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
  if (!Number.isFinite(count) || count < 1 || count > MAX_INSTALLMENT_COUNT) {
    return Response.json(
      {
        success: false,
        error: `installmentCount must be between 1 and ${MAX_INSTALLMENT_COUNT}.`,
      },
      { status: 400 },
    );
  }

  // Task 12-d: strict frequency validation (invalid values were previously
  // silently coerced to MONTHLY, masking client bugs).
  if (!VALID_FREQUENCIES.includes(frequency as PlanFrequency)) {
    return Response.json(
      {
        success: false,
        error: `frequency must be one of: ${VALID_FREQUENCIES.join(', ')}.`,
      },
      { status: 400 },
    );
  }
  const freq = frequency as PlanFrequency;

  const start = startDate ? new Date(String(startDate)) : new Date();
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

  // Task 12-d: policy bounds on interest and late fee.
  const rate = toNumber(interestRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_INTEREST_RATE_PCT) {
    return Response.json(
      {
        success: false,
        error: `interestRate must be between 0 and ${MAX_INTEREST_RATE_PCT} (annual %).`,
      },
      { status: 400 },
    );
  }
  const fee = toNumber(lateFee);
  if (!Number.isFinite(fee) || fee < 0 || fee > MAX_LATE_FEE_KES) {
    return Response.json(
      {
        success: false,
        error: `lateFee must be between 0 and ${MAX_LATE_FEE_KES} KES.`,
      },
      { status: 400 },
    );
  }
  if (typeof notes === 'string' && notes.length > MAX_NOTES_LENGTH) {
    return Response.json(
      { success: false, error: `notes must be at most ${MAX_NOTES_LENGTH} characters.` },
      { status: 400 },
    );
  }

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
  // Task 12-d: the ledger was store-checked but the customer was not. For
  // regular users Layer-4 tenancy already narrows the customer lookup, but
  // SUPER_ADMIN runs with tenant bypass — this explicit check closes that
  // gap so a plan can never couple a ledger in store A with a customer in
  // store B.
  if (customer.storeId !== storeId) {
    return Response.json(
      { success: false, error: 'Customer does not belong to this store.' },
      { status: 403 },
    );
  }

  // Don't allow a plan larger than the outstanding debt balance. Task 12-d:
  // epsilon tightened from 0.5 to 0.01 — the old slack let a plan exceed the
  // debt by up to half a KES, which then made the ledger's final
  // reconciliation drift.
  const debtBalance = toNumber(debtLedger.balance);
  if (total > debtBalance + 0.01) {
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
  // Task 12-d: `installmentAmount` is now taken FROM the actual schedule
  // (regular installments; the final one absorbs rounding). It previously
  // came from `calculateInstallmentAmount`, which applied interest as a flat
  // one-off and disagreed with the schedule whenever rate > 0 and the plan
  // spanned less than a year.
  const installmentAmount = schedule[0]?.amountDue ?? 0;

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

  return Response.json(
    { success: true, data: fullPlan ? serializePlanRow(fullPlan) : null },
    { status: 201 },
  );
}

export const GET = withErrorBoundary(
  withFinancialAuth(listPlansHandler, FINANCIAL_READ_ROLES),
  'DEBT_PLANS_LIST',
);

export const POST = withErrorBoundary(
  withFinancialAuth(createPlanHandler, FINANCIAL_WRITE_ROLES),
  'DEBT_PLAN_CREATE',
);
