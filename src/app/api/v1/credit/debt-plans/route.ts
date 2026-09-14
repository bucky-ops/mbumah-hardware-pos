import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireAuth, requireRole, assertBranchAccess, assertTargetBranch } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { D, round2 } from "@/lib/format";
import { buildAmortizationSchedule } from "@/lib/credit";
import { recomputeCustomerRisk } from "@/lib/credit-risk";

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/credit/debt-plans — list + create debt (hire-purchase) plans.
//   GET  — any authenticated staff; branch-scoped (non-OWNER forced own branch).
//   POST — MANAGER+ only; HARD credit-limit enforcement inside a $transaction;
//          after the CHARGE ledger row + balance writes, the borrower's credit
//          risk is re-scored in the SAME tx (utilization reflects the new
//          balance) and the fresh riskScore is returned additively.
// ─────────────────────────────────────────────────────────────────────────────

const createPlanSchema = z
  .object({
    customerId: z.string().min(1, "customerId is required"),
    saleId: z.string().max(60).optional(),
    amount: z.number().positive("amount must be > 0").max(10_000_000),
    downPayment: z.number().min(0).max(10_000_000).default(0),
    installmentCount: z.number().int().min(1).max(24),
    frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]),
    interestRate: z.number().min(0).max(100).default(0),
    lateFeeRate: z.number().min(0).max(100).default(0),
    lateFeeFlat: z.number().min(0).max(1_000_000).default(0),
    gracePeriodDays: z.number().int().min(0).max(60).default(3),
    startDate: z.string().min(1), // ISO datetime
    notes: z.string().max(300).optional(),
  })
  .refine((v) => v.downPayment <= v.amount, {
    message: "downPayment cannot exceed the plan amount",
    path: ["downPayment"],
  });

/** GET /api/v1/credit/debt-plans?status=ACTIVE&branchId=… */
export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireAuth(req);
  const sp = req.nextUrl.searchParams;
  const requestedBranch = sp.get("branchId");
  assertTargetBranch(user, requestedBranch);
  // Non-OWNER staff are forced to their own branch (OWNER may pass ?branchId=).
  const branchId = user.role === "OWNER" ? requestedBranch : user.branchId;
  const status = sp.get("status") ?? undefined;

  const plans = await db.debtPlan.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(branchId ? { branchId } : {}),
    },
    include: {
      creditAccount: {
        include: {
          customer: { select: { id: true, name: true, currentBalance: true, riskScore: true } },
        },
      },
      installments: { orderBy: { seq: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 100, // hard page cap
  });

  const now = Date.now();
  const data = plans.map((p) => {
    // balanceRemaining is maintained by the repay route; cross-check against
    // the installment ledger so a stale value never inflates the outstanding.
    const paidTotal = round2(p.installments.reduce((s, i) => s + D(i.amountPaid).toNumber(), 0));
    const fromInstallments = round2(
      p.installments.reduce((s, i) => s + Math.max(0, D(i.amountDue).sub(D(i.amountPaid)).toNumber()), 0)
    );
    const outstanding = Math.min(round2(D(p.balanceRemaining).toNumber()), fromInstallments);
    const unpaid = p.installments.filter((i) => i.status !== "PAID");
    const overdueCount = unpaid.filter((i) => i.status === "OVERDUE" || i.dueDate.getTime() < now).length;
    const nextDueDate = unpaid.length > 0 ? unpaid[0].dueDate.toISOString() : null;
    return {
      id: p.id,
      creditAccountId: p.creditAccountId,
      branchId: p.branchId,
      saleId: p.saleId,
      customer: {
        id: p.creditAccount.customer.id,
        name: p.creditAccount.customer.name,
        currentBalance: String(p.creditAccount.customer.currentBalance),
        riskScore: p.creditAccount.customer.riskScore,
      },
      totalAmount: String(p.totalAmount),
      downPayment: String(p.downPayment),
      balanceRemaining: String(p.balanceRemaining),
      paidTotal: String(paidTotal),
      outstanding: String(Math.max(0, outstanding)),
      installmentCount: p.installments.length,
      installmentFrequency: p.installmentFrequency,
      interestRate: String(p.interestRate),
      lateFeeRate: String(p.lateFeeRate),
      lateFeeFlat: String(p.lateFeeFlat),
      gracePeriodDays: p.gracePeriodDays,
      status: p.status,
      startDate: p.startDate.toISOString(),
      dueDate: p.dueDate.toISOString(),
      nextDueDate,
      overdueCount,
      notes: p.notes,
      installments: p.installments.map((i) => ({
        id: i.id,
        seq: i.seq,
        dueDate: i.dueDate.toISOString(),
        amountDue: String(i.amountDue),
        amountPaid: String(i.amountPaid),
        status: i.status,
        penaltyApplied: String(i.penaltyApplied),
        penalizedAt: i.penalizedAt ? i.penalizedAt.toISOString() : null,
      })),
    };
  });

  return NextResponse.json({ plans: data, count: data.length });
});

/** POST /api/v1/credit/debt-plans — create plan + installments + ledger (MANAGER+). */
export const POST = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");
  const parsed = createPlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid plan payload");
  }
  const body = parsed.data;
  const customerId = body.customerId;
  const startDate = new Date(body.startDate);
  if (Number.isNaN(startDate.getTime())) throw ApiError.badRequest("startDate must be a valid ISO date");

  const created = await db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw ApiError.notFound("Customer not found");

    const account = await tx.creditAccount.findUnique({ where: { customerId } });
    if (!account) throw ApiError.badRequest("Customer has no credit account — open one first");
    assertBranchAccess(user, account.branchId);

    // ── HARD CREDIT LIMIT ────────────────────────────────────────────────
    // projected = customer.currentBalance + (amount − downPayment); the charge
    // is rejected up-front (inside the tx) when it would breach the limit.
    const financed = round2(D(body.amount).sub(D(body.downPayment)));
    const projected = round2(D(customer.currentBalance).add(financed));
    if (D(projected).gt(D(account.creditLimit))) {
      throw ApiError.badRequest(
        `Credit Limit Exceeded: projected KES ${projected.toFixed(2)} > limit KES ${D(account.creditLimit).toFixed(2)}`
      );
    }

    // Schedule: down payment is NOT financed; last installment absorbs rounding.
    const schedule = buildAmortizationSchedule({
      totalAmount: body.amount,
      downPayment: body.downPayment,
      installmentCount: body.installmentCount,
      frequency: body.frequency,
      interestRate: body.interestRate,
      startDate,
    });
    const lastDue = schedule[schedule.length - 1].dueDate;

    const plan = await tx.debtPlan.create({
      data: {
        creditAccountId: account.id,
        saleId: body.saleId ?? null,
        branchId: account.branchId,
        totalAmount: body.amount,
        downPayment: body.downPayment,
        balanceRemaining: financed,
        installmentFrequency: body.frequency,
        interestRate: body.interestRate,
        lateFeeRate: body.lateFeeRate,
        lateFeeFlat: body.lateFeeFlat,
        gracePeriodDays: body.gracePeriodDays,
        status: "ACTIVE",
        startDate,
        dueDate: lastDue,
        notes: body.notes ?? null,
        installments: {
          create: schedule.map((s) => ({
            seq: s.seq,
            dueDate: s.dueDate,
            amountDue: s.amountDue,
          })),
        },
      },
      include: { installments: { orderBy: { seq: "asc" } } },
    });

    // ── SPEC-MEANINGFUL LEDGER: CHARGE the full invoice, then PAYMENT for the
    // down payment — two entries so the ledger tells the whole story. Net
    // balance movement (customer + account) is only amount − downPayment.
    const prevBalance = D(customer.currentBalance);
    await tx.creditLedger.create({
      data: {
        creditAccountId: account.id,
        transactionType: "CHARGE",
        amount: body.amount,
        previousBalance: prevBalance,
        newBalance: prevBalance.add(body.amount),
        referenceId: body.saleId ?? plan.id,
        note: `Debt plan ${body.installmentCount}×${body.frequency}${body.interestRate > 0 ? ` @ ${body.interestRate}%` : ""}`,
        performedBy: user.id,
      },
    });
    if (body.downPayment > 0) {
      await tx.creditLedger.create({
        data: {
          creditAccountId: account.id,
          transactionType: "PAYMENT",
          amount: body.downPayment,
          previousBalance: prevBalance.add(body.amount),
          newBalance: prevBalance.add(financed),
          referenceId: plan.id,
          note: "Down payment",
          performedBy: user.id,
        },
      });
    }

    await tx.customer.update({
      where: { id: customer.id },
      data: { currentBalance: prevBalance.add(financed) },
    });
    await tx.creditAccount.update({
      where: { id: account.id },
      data: { totalDebt: D(account.totalDebt).add(financed) },
    });

    // ── Risk re-score (same tx, AFTER the CHARGE ledger row + balance writes
    // above) so utilization is evaluated on the post-charge balance — the
    // score reacts to every credit event, not only repay/penalty. Failures
    // here throw → the whole plan creation rolls back naturally.
    const risk = await recomputeCustomerRisk(tx, customer.id);

    return { plan, financed, riskScore: risk.score };
  });

  await audit({
    userId: user.id,
    action: "DEBT_PLAN_CREATE",
    entity: "DebtPlan",
    entityId: created.plan.id,
    meta: { customerId, amount: body.amount, downPayment: body.downPayment, financed: created.financed, installmentCount: body.installmentCount, frequency: body.frequency },
  });

  return NextResponse.json(
    {
      plan: {
        id: created.plan.id,
        creditAccountId: created.plan.creditAccountId,
        customerId,
        totalAmount: String(created.plan.totalAmount),
        downPayment: String(created.plan.downPayment),
        balanceRemaining: String(created.plan.balanceRemaining),
        installmentFrequency: created.plan.installmentFrequency,
        status: created.plan.status,
        startDate: created.plan.startDate.toISOString(),
        dueDate: created.plan.dueDate.toISOString(),
        installments: created.plan.installments.map((i) => ({
          id: i.id,
          seq: i.seq,
          dueDate: i.dueDate.toISOString(),
          amountDue: String(i.amountDue),
        })),
      },
      // Post-charge re-scored risk (higher = better payer, 0–100) — additive
      // key so existing consumers of the plan payload are unaffected.
      riskScore: created.riskScore,
    },
    { status: 201 }
  );
});
