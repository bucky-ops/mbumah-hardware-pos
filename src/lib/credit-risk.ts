// src/lib/credit-risk.ts — DB-backed credit-risk recompute.
//
// src/lib/credit.ts holds the PURE scoring formula (computeCreditScore); this
// module is the one place that knows how to GATHER its inputs from the
// database and persist the result. Every credit-lifecycle mutation that can
// change a borrower's track record must re-score through here so the score
// shown in the aging report / customers directory always reflects reality:
//
//   • /api/v1/credit/repay            (waterfall repayment)
//   • /api/v1/cron/process-penalties  (late fees + OVERDUE transitions)
//
// LATENESS SIGNAL: penaltyApplied > 0 is the durable "this installment went
// past its grace window at least once" record (the penalty cron stamps it
// idempotently), and status OVERDUE covers rows penalized at fee 0 (arrears
// are factual even when the fee computes to zero). PAID rows with a clean
// penalty record count as on-time; PAID rows that were once penalized still
// count as late — a forgiven debt is not a forgotten lateness.

import { Prisma, type PrismaClient } from "@prisma/client";
import { computeCreditScore } from "@/lib/credit";

/** Any Prisma client that can execute queries: an interactive tx handle or the singleton. */
export type DbClient = Prisma.TransactionClient | PrismaClient;

export interface RiskBreakdown {
  score: number;
  onTimeInstallments: number;
  lateInstallments: number;
  defaultedPlans: number;
  utilizationPct: number; // 0–100, informational
}

/**
 * Recompute and PERSIST the customer's riskScore from their full installment
 * history. Safe inside a $transaction (reads the tx's uncommitted writes, so
 * statuses updated moments earlier participate in the score).
 *
 * Uses the customer's CURRENT balance — callers should apply their balance
 * change BEFORE calling so utilization is evaluated post-mutation.
 */
export async function recomputeCustomerRisk(
  client: DbClient,
  customerId: string
): Promise<RiskBreakdown> {
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { creditLimit: true, currentBalance: true },
  });
  if (!customer) {
    // Borrower vanished mid-transaction — nothing sane to score.
    throw new Prisma.PrismaClientKnownRequestError("Customer not found during risk recompute", {
      code: "P2025",
      clientVersion: Prisma.prismaVersion.client,
    });
  }

  // All plans across the customer's (single) credit account, with their
  // installment statuses + durable penalty markers.
  const plans = await client.debtPlan.findMany({
    where: { creditAccount: { customerId } },
    select: {
      status: true,
      installments: { select: { status: true, penaltyApplied: true } },
    },
  });

  let onTime = 0;
  let late = 0;
  let defaulted = 0;
  for (const plan of plans) {
    if (plan.status === "DEFAULTED") defaulted += 1;
    for (const inst of plan.installments) {
      const wasPenalized = Number(inst.penaltyApplied) > 0;
      if (inst.status === "OVERDUE" || wasPenalized) {
        late += 1; // currently in arrears OR was ever penalized
      } else if (inst.status === "PAID") {
        onTime += 1; // settled with a clean lateness record
      }
      // PENDING/PARTIAL rows are neither — they are simply unobserved yet.
    }
  }

  const limit = Number(customer.creditLimit);
  const balance = Number(customer.currentBalance);
  const utilizationPct = limit > 0 ? Math.min(100, (balance / limit) * 100) : balance > 0 ? 100 : 0;

  const score = computeCreditScore({
    onTimePayments: onTime,
    latePayments: late,
    defaultedPlans: defaulted,
    creditLimit: limit,
    currentBalance: balance,
  });

  await client.customer.update({ where: { id: customerId }, data: { riskScore: score } });

  return {
    score,
    onTimeInstallments: onTime,
    lateInstallments: late,
    defaultedPlans: defaulted,
    utilizationPct: Math.round(utilizationPct * 100) / 100,
  };
}
