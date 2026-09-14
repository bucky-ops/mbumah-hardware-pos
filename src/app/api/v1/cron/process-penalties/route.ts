import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { D, round2 } from "@/lib/format";
import { recomputeCustomerRisk } from "@/lib/credit-risk";

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/cron/process-penalties — serverless cron job (Vercel Cron / any
// scheduler). GET and POST behave identically so the platform choice is free.
//
// PROTECTION: when CRON_SECRET is configured, BOTH verbs require the
// `x-cron-secret` header to match — Vercel Cron attaches the configured secret
// to every invocation. Without the env var (local dev) the endpoint is open.
//
// JOB: flag overdue installments (dueDate + gracePeriodDays < now) as OVERDUE
// and apply the plan's late fee, idempotently per day (20h guard window).
// ─────────────────────────────────────────────────────────────────────────────

const RE_PENALIZE_WINDOW_MS = 20 * 60 * 60 * 1000; // 20h ≈ "once per day" with slack

/** Throws 401 when CRON_SECRET is set and the header does not match. */
function assertCronSecret(req: NextRequest): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) return; // unset → dev/unprotected deployment
  // Vercel Cron sends the configured secret in a custom header per project
  // settings; any scheduler can replicate it.
  if (req.headers.get("x-cron-secret") !== secret) {
    throw ApiError.unauthorized("Invalid or missing x-cron-secret header");
  }
}

interface PenaltyOutcome {
  installmentId: string;
  penalty: number;
}

async function runPenaltyJob(): Promise<{
  processed: number;
  penalties: PenaltyOutcome[];
  skipped: Array<{ installmentId: string; reason: string }>;
}> {
  const now = new Date();

  const candidates = await db.debtInstallment.findMany({
    where: { status: { in: ["PENDING", "PARTIAL"] } },
    include: {
      debtPlan: {
        include: {
          creditAccount: { include: { customer: true } },
        },
      },
    },
  });

  const processed: string[] = [];
  const penalties: PenaltyOutcome[] = [];
  const skipped: Array<{ installmentId: string; reason: string }> = [];

  for (const inst of candidates) {
    const plan = inst.debtPlan;

    // Grace window: the due date + plan.gracePeriodDays must have fully elapsed.
    const deadlineMs = inst.dueDate.getTime() + plan.gracePeriodDays * 86_400_000;
    if (now.getTime() <= deadlineMs) {
      skipped.push({ installmentId: inst.id, reason: "within_grace_period" });
      continue;
    }

    // IDEMPOTENCY per day: if this installment was penalized in the last 20h,
    // leave it alone so repeated cron ticks never double-charge.
    if (inst.penalizedAt && now.getTime() - inst.penalizedAt.getTime() < RE_PENALIZE_WINDOW_MS) {
      skipped.push({ installmentId: inst.id, reason: "penalized_within_20h" });
      continue;
    }

    // Fee = max(flat KES, % of the overdue remainder). Decimal math only.
    const overdueAmount = D(inst.amountDue).sub(D(inst.amountPaid)); // amountDue − amountPaid
    const pctFee = round2(overdueAmount.mul(D(plan.lateFeeRate)).div(100).toNumber());
    const flatFee = round2(D(plan.lateFeeFlat).toNumber());
    const penalty = Math.max(flatFee, pctFee);

    await db.$transaction(async (tx) => {
      // Always transition the status (arrears state is factual even at fee 0);
      // penalizedAt is stamped regardless so the 20h idempotency guard holds.
      await tx.debtInstallment.update({
        where: { id: inst.id },
        data: {
          status: "OVERDUE",
          penalizedAt: now,
          penaltyApplied: D(inst.penaltyApplied).add(penalty),
        },
      });

      if (penalty > 0) {
        // Money movements only when a fee actually applies.
        const account = plan.creditAccount;
        const prevDebt = D(account.totalDebt);
        await tx.creditLedger.create({
          data: {
            creditAccountId: account.id,
            transactionType: "PENALTY",
            amount: penalty,
            previousBalance: prevDebt,
            newBalance: prevDebt.add(penalty),
            referenceId: inst.id,
            note: "Late fee",
          },
        });
        await tx.creditAccount.update({
          where: { id: account.id },
          data: { totalDebt: prevDebt.add(penalty) },
        });
        await tx.customer.update({
          where: { id: account.customerId },
          data: {
            currentBalance: D(account.customer.currentBalance).add(penalty),
          },
        });
      }

      // Plan default: ≥ 50% of its installments now OVERDUE. Re-read inside the
      // transaction so the just-written status participates in the count.
      const planInstallments = await tx.debtInstallment.findMany({
        where: { debtPlanId: plan.id },
        select: { status: true },
      });
      const overdueCount = planInstallments.filter((i) => i.status === "OVERDUE").length;
      if (planInstallments.length > 0 && overdueCount / planInstallments.length >= 0.5 && plan.status !== "DEFAULTED") {
        await tx.debtPlan.update({ where: { id: plan.id }, data: { status: "DEFAULTED" } });
      }

      // Re-score AFTER the status transitions above so the fresh OVERDUE /
      // DEFAULTED states drive the score (replaces the old flat −2 hack —
      // the shared scorer counts durable penalty markers + utilization).
      await recomputeCustomerRisk(tx, plan.creditAccount.customerId);
    });

    penalties.push({ installmentId: inst.id, penalty });
    processed.push(inst.id);
  }

  // Empty set is a perfectly valid outcome — never throws.
  return { processed: processed.length, penalties, skipped };
}

/** GET /api/v1/cron/process-penalties */
export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  assertCronSecret(req);
  return NextResponse.json(await runPenaltyJob());
});

/** POST /api/v1/cron/process-penalties */
export const POST = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  assertCronSecret(req);
  return NextResponse.json(await runPenaltyJob());
});
