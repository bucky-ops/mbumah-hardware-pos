import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireAuth, assertBranchAccess } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { D, round2 } from "@/lib/format";
import { allocateWaterfall, type WaterfallInstallment } from "@/lib/credit";
import { recomputeCustomerRisk } from "@/lib/credit-risk";
import { initiateStkPush, isMockMode } from "@/lib/mpesa/daraja";

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/credit/repay — settle customer debt.
//   • STK path  : method=MPESA + phone + direct=false → create MpesaTransaction
//                 (purpose DEBT_REPAYMENT) and return the checkoutRequestId
//                 WITHOUT settling — the callback/poll completes it later.
//   • Direct    : $transaction → waterfall allocation over penalties →
//                 OVERDUE → PENDING, ledger PAYMENT, Payment row, risk re-score.
// ─────────────────────────────────────────────────────────────────────────────

const repaySchema = z.object({
  creditAccountId: z.string().min(1, "creditAccountId is required"),
  amount: z.number().positive("amount must be > 0").max(10_000_000),
  method: z.enum(["MPESA", "CASH", "BANK_TRANSFER"]),
  phone: z.string().min(9).max(20).optional(),
  reference: z.string().max(100).optional(),
  direct: z.boolean().default(true),
});

/** 8-char mock checkout id, e.g. WSMOCK_3FA9C2B1. */
function mockCheckoutId(): string {
  return `WSMOCK_${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** Normalize Kenyan MSISDN to 2547XXXXXXXX (Daraja expects this form). */
function normalizeMsisdn(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `254${digits.slice(1)}`;
  else if (digits.startsWith("7") && digits.length === 9) digits = `254${digits}`;
  return digits;
}

export const POST = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireAuth(req);
  const parsed = repaySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid repayment payload");
  }
  const body = parsed.data;

  // `creditAccountId` accepts EITHER a CreditAccount.id OR the owning
  // Customer.id (customerId is @unique) — same forgiving contract as
  // /api/v1/credit/guarantors, so callers can key off either entity.
  const resolved = await db.creditAccount.findUnique({ where: { id: body.creditAccountId } });
  const account = resolved
    ? await db.creditAccount.findUnique({
        where: { id: resolved.id },
        include: { customer: true },
      })
    : await db.creditAccount.findUnique({
        where: { customerId: body.creditAccountId },
        include: { customer: true },
      });
  if (!account) throw ApiError.notFound("Credit account not found");
  assertBranchAccess(user, account.branchId);

  // ── M-Pesa STK push path — initiate only, settlement happens via callback. ──
  if (body.method === "MPESA" && body.phone && body.direct === false) {
    // Mock mode (no Daraja credentials): a WSMOCK_ checkout id is recorded so
    // the sandbox workflow stays demoable end-to-end without live M-Pesa.
    const mock = isMockMode();
    let checkoutRequestId = mockCheckoutId();
    let status = "AWAITING_PIN"; // mock: STK "sent", customer pins in sandbox
    if (!mock) {
      // Real Daraja Lipa-na-M-Pesa push; ref shown on the customer's phone is
      // the credit-account tail (≤12 chars after Daraja-side sanitization).
      const res = await initiateStkPush({
        phone: normalizeMsisdn(body.phone),
        amount: body.amount,
        ref: `DEBT${account.id.slice(-8).toUpperCase()}`,
        purpose: "DEBT_REPAYMENT",
      });
      checkoutRequestId = res.checkoutRequestId;
      status = "INITIATED";
    }

    await db.mpesaTransaction.create({
      data: {
        checkoutRequestId,
        phone: normalizeMsisdn(body.phone),
        amount: body.amount,
        purpose: "DEBT_REPAYMENT",
        status,
      },
    });
    return NextResponse.json({
      checkoutRequestId,
      mock,
      message: mock
        ? "Mock STK push queued — customer to enter PIN (sandbox mode)"
        : "STK push sent — customer to enter M-Pesa PIN",
    });
  }

  // ── Direct settlement path ────────────────────────────────────────────────
  let allocations: Array<{ installmentId: string; seq: number; amount: number; kind: "PENALTY" | "OVERDUE" | "PENDING" }> = [];
  const result = await db.$transaction(async (tx) => {
    const plans = await tx.debtPlan.findMany({
      where: { creditAccountId: account.id },
      include: { installments: { orderBy: { seq: "asc" } } },
      orderBy: { startDate: "asc" },
    });

    // Open installments only, in due order (seq asc within a plan, plans by start).
    const openInstallments = plans
      .flatMap((p) => p.installments)
      .filter((i) => i.status === "PENDING" || i.status === "OVERDUE" || i.status === "PARTIAL")
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.seq - b.seq);

    // Accrued late fees still outstanding per installment → waterfall step 1.
    const penalties: Record<string, number> = {};
    for (const inst of openInstallments) {
      penalties[inst.id] = round2(D(inst.penaltyApplied).toNumber());
    }

    const waterfallInput: WaterfallInstallment[] = openInstallments.map((i) => ({
      id: i.id,
      seq: i.seq,
      dueDate: i.dueDate,
      amountDue: D(i.amountDue).toNumber(),
      amountPaid: D(i.amountPaid).toNumber(),
      status: i.status,
    }));
    const applied = allocateWaterfall(body.amount, waterfallInput, penalties);
    allocations = applied;

    // In-memory state so plan completion can be derived without re-reading.
    const state = new Map<string, { amountPaid: Decimal; status: string }>();
    const planOf = new Map<string, string>(); // installmentId → debtPlanId
    for (const inst of plans.flatMap((p) => p.installments)) {
      state.set(inst.id, { amountPaid: D(inst.amountPaid), status: inst.status });
      planOf.set(inst.id, inst.debtPlanId);
    }

    const principalByPlan = new Map<string, Decimal>(); // plan → principal repaid
    for (const alloc of allocations) {
      const current = state.get(alloc.installmentId);
      if (!current) continue;
      if (alloc.kind === "PENALTY") {
        // Paying a fee reduces the accrued penalty on that installment.
        const inst = openInstallments.find((i) => i.id === alloc.installmentId);
        if (inst) {
          await tx.debtInstallment.update({
            where: { id: inst.id },
            data: { penaltyApplied: D(inst.penaltyApplied).sub(alloc.amount) },
          });
        }
      } else {
        current.amountPaid = current.amountPaid.add(alloc.amount);
        const inst = openInstallments.find((i) => i.id === alloc.installmentId);
        if (!inst) continue;
        // PAID when fully covered, PARTIAL when in between; an OVERDUE row that
        // is still short keeps its OVERDUE flag (arrears state must not vanish).
        if (current.amountPaid.gte(D(inst.amountDue))) current.status = "PAID";
        else current.status = inst.status === "OVERDUE" ? "OVERDUE" : "PARTIAL";
        await tx.debtInstallment.update({
          where: { id: inst.id },
          data: { amountPaid: current.amountPaid, status: current.status },
        });
        const planId = planOf.get(alloc.installmentId);
        if (planId) {
          principalByPlan.set(planId, (principalByPlan.get(planId) ?? new Decimal(0)).add(alloc.amount));
        }
      }
    }

    // Plan statuses: COMPLETED when every installment is PAID (balance → 0),
    // otherwise ACTIVE (a partially repaid DEFAULTED plan is rehabilitated).
    // Untouched plans keep their current status (a DEFAULTED plan is only
    // rehabilitated once repayment actually reaches it).
    for (const plan of plans) {
      const allPaid = plan.installments.length > 0 && plan.installments.every((i) => state.get(i.id)?.status === "PAID");
      const touched = principalByPlan.has(plan.id);
      if (!allPaid && !touched) continue; // untouched → keep current status
      if (allPaid && plan.status === "COMPLETED") continue; // already settled
      const principalRepaid = principalByPlan.get(plan.id) ?? new Decimal(0);
      const remaining = allPaid
        ? new Decimal(0)
        : Decimal.max(0, D(plan.balanceRemaining).sub(principalRepaid));
      await tx.debtPlan.update({
        where: { id: plan.id },
        data: {
          status: allPaid ? "COMPLETED" : "ACTIVE",
          balanceRemaining: remaining,
        },
      });
      plan.status = allPaid ? "COMPLETED" : "ACTIVE";
    }

    // Payment row first so the ledger can reference it (no transaction attached:
    // a debt repayment is not tied to a single sale document).
    const payment = await tx.payment.create({
      data: {
        branchId: account.branchId,
        method: body.method,
        amount: body.amount,
        reference: body.reference ?? null,
        status: "COMPLETED",
      },
    });

    // Ledger PAYMENT entry — previous → new account debt balance.
    const prevDebt = D(account.totalDebt);
    const newDebt = Decimal.max(0, prevDebt.sub(body.amount));
    const ledger = await tx.creditLedger.create({
      data: {
        creditAccountId: account.id,
        transactionType: "PAYMENT",
        amount: body.amount,
        previousBalance: prevDebt,
        newBalance: newDebt,
        referenceId: body.reference ?? payment.id,
        note: `Debt repayment via ${body.method}`,
        performedBy: user.id,
      },
    });

    await tx.creditAccount.update({
      where: { id: account.id },
      data: { totalDebt: newDebt },
    });

    // Customer balance + re-scored risk via the shared DB-backed scorer
    // (onTime = PAID with a clean penalty record, late = penalized/OVERDUE-ever,
    // defaulted = plans still in DEFAULTED status — see src/lib/credit-risk.ts).
    const newCustomerBalance = Decimal.max(0, D(account.customer.currentBalance).sub(body.amount));
    await tx.customer.update({
      where: { id: account.customerId },
      data: { currentBalance: newCustomerBalance },
    });
    const risk = await recomputeCustomerRisk(tx, account.customerId);
    const riskScore = risk.score;

    return {
      ledgerId: ledger.id,
      remainingDebt: newDebt,
      paymentId: payment.id,
      riskScore,
    };
  });

  await audit({
    userId: user.id,
    action: "DEBT_REPAYMENT",
    entity: "CreditAccount",
    entityId: account.id,
    meta: { amount: body.amount, method: body.method, ledgerId: result.ledgerId, paymentId: result.paymentId },
  });

  return NextResponse.json({
    applied: allocations, // [{installmentId, seq, amount, kind}]
    remainingDebt: String(round2(result.remainingDebt)),
    ledgerId: result.ledgerId,
    riskScore: result.riskScore,
  });
});
