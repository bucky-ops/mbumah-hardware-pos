import { NextRequest, NextResponse } from "next/server";
import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { withErrorHandler } from "@/lib/api-error-handler";
import { requireRole, assertTargetBranch } from "@/lib/api/guard";
import { D, round2 } from "@/lib/format";
import { decryptPII, maskPhone } from "@/lib/crypto";

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/credit/aging — AR aging buckets, KPIs and the watchlist of debtors.
//   Buckets are computed per credit-account customer with currentBalance > 0,
//   aged by the OLDEST unpaid charge: the oldest transaction in CREDIT/PARTIAL
//   status with balanceDue > 0; when none exists (e.g. manually-raised plans)
//   the oldest unpaid installment's dueDate is used instead.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

type BucketKey = "current" | "past_due" | "delinquent" | "severe";

const BUCKETS: Array<{ key: BucketKey; label: string; min: number; max: number }> = [
  { key: "current", label: "Current (0–30)", min: 0, max: 30 },
  { key: "past_due", label: "Past Due (31–60)", min: 31, max: 60 },
  { key: "delinquent", label: "Delinquent (61–90)", min: 61, max: 90 },
  { key: "severe", label: "Severe Default (90+)", min: 91, max: Number.MAX_SAFE_INTEGER },
];

function bucketKeyFor(days: number): BucketKey {
  if (days <= 30) return "current";
  if (days <= 60) return "past_due";
  if (days <= 90) return "delinquent";
  return "severe";
}

export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  // MANAGER+ only: the aging report exposes portfolio-wide receivables and the
  // debtor watchlist — tellers check individual balances via /api/customers.
  const user = await requireRole(req, "MANAGER");
  const requestedBranch = req.nextUrl.searchParams.get("branchId");
  assertTargetBranch(user, requestedBranch);
  // Non-OWNER staff are forced to their own branch (OWNER may pass ?branchId=).
  const branchId = user.role === "OWNER" ? requestedBranch : user.branchId;

  const now = new Date();
  const accounts = await db.creditAccount.findMany({
    where: branchId ? { branchId } : undefined,
    include: {
      customer: {
        select: { id: true, name: true, phoneEnc: true, creditLimit: true, currentBalance: true, riskScore: true },
      },
      debtPlans: { include: { installments: { orderBy: { seq: "asc" } } } },
    },
  });

  // Oldest unpaid CREDIT/PARTIAL charge per customer (single grouped query).
  const oldestChargeRows = await db.transaction.groupBy({
    by: ["customerId"],
    where: { status: { in: ["CREDIT", "PARTIAL"] }, balanceDue: { gt: 0 }, customerId: { not: null } },
    _min: { createdAt: true },
  });
  const oldestChargeByCustomer = new Map<string, Date>();
  for (const row of oldestChargeRows) {
    if (row.customerId && row._min.createdAt) oldestChargeByCustomer.set(row.customerId, row._min.createdAt);
  }

  const buckets = new Map<BucketKey, { amount: number; count: number }>(
    BUCKETS.map((b) => [b.key, { amount: 0, count: 0 }])
  );

  let totalReceivables = new Decimal(0);
  let overdueAmount = new Decimal(0);
  let activePlans = 0;
  let defaultedPlans = 0;
  let totalPlanValue = new Decimal(0);
  let totalDebt = new Decimal(0);

  interface DebtorRow {
    id: string;
    name: string;
    currentBalance: string;
    creditLimit: string;
    utilization: number;
    riskScore: number;
    phoneMasked: string | null;
    oldestDebtDays: number;
  }
  const debtors: DebtorRow[] = [];

  for (const account of accounts) {
    const customer = account.customer;
    const balance = D(customer.currentBalance);

    // KPI inputs aggregate across every account.
    totalDebt = totalDebt.add(D(account.totalDebt));
    for (const plan of account.debtPlans) {
      totalPlanValue = totalPlanValue.add(D(plan.totalAmount));
      if (plan.status === "ACTIVE") activePlans += 1;
      if (plan.status === "DEFAULTED") defaultedPlans += 1;
    }
    for (const inst of account.debtPlans.flatMap((p) => p.installments)) {
      // Overdue = OVERDUE rows, or PENDING rows past their due date
      // ("past-due PENDING") — always capped at the unpaid remainder.
      const isPastDue = inst.status === "OVERDUE" || (inst.status === "PENDING" && inst.dueDate < now);
      if (isPastDue) {
        overdueAmount = overdueAmount.add(D(inst.amountDue).sub(D(inst.amountPaid)));
      }
    }

    if (balance.lte(0)) continue; // buckets/watchlist only carry open debt

    // ── Age: oldest unpaid charge (transaction), else oldest unpaid installment.
    let oldestDebtDays = 0;
    const chargeDate = oldestChargeByCustomer.get(customer.id);
    if (chargeDate) {
      oldestDebtDays = Math.max(0, Math.floor((now.getTime() - chargeDate.getTime()) / DAY_MS));
    } else {
      const unpaidDues = account.debtPlans
        .flatMap((p) => p.installments)
        .filter((i) => i.status !== "PAID")
        .map((i) => i.dueDate.getTime());
      if (unpaidDues.length > 0) {
        oldestDebtDays = Math.max(0, Math.floor((now.getTime() - Math.min(...unpaidDues)) / DAY_MS));
      }
    }

    const bucket = buckets.get(bucketKeyFor(oldestDebtDays))!;
    bucket.amount = round2(bucket.amount + balance.toNumber());
    bucket.count += 1;

    totalReceivables = totalReceivables.add(balance);

    const limit = D(customer.creditLimit);
    const utilization = limit.gt(0)
      ? round2(balance.div(limit).mul(100).toNumber())
      : balance.gt(0)
        ? 100 // open debt with zero limit → fully utilised by definition
        : 0;

    debtors.push({
      id: customer.id,
      name: customer.name,
      currentBalance: String(balance),
      creditLimit: String(limit),
      utilization,
      riskScore: customer.riskScore,
      phoneMasked: maskPhone(decryptPII(customer.phoneEnc)),
      oldestDebtDays,
    });
  }

  debtors.sort((a, b) => D(b.currentBalance).minus(D(a.currentBalance)).toNumber());

  // Collection rate = 1 − ΣtotalDebt / Σplan totals; guard divide-by-zero → 100%
  // when no plans exist at all (nothing to collect against).
  const collectionRate = totalPlanValue.gt(0)
    ? Math.max(0, Math.min(100, round2(new Decimal(1).sub(totalDebt.div(totalPlanValue)).mul(100).toNumber())))
    : 100;

  return NextResponse.json({
    generatedAt: now.toISOString(),
    buckets: BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      minDays: b.min,
      amount: buckets.get(b.key)!.amount,
      count: buckets.get(b.key)!.count,
    })),
    kpis: {
      totalReceivables: round2(totalReceivables.toNumber()),
      overdueAmount: round2(Math.max(0, overdueAmount.toNumber())),
      activePlans,
      defaultedPlans,
      collectionRate,
    },
    customers: debtors.slice(0, 20),
  });
});
