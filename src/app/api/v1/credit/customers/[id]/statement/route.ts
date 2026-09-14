// src/app/api/v1/credit/customers/[id]/statement/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireRole } from "@/lib/api/guard";
import { D, round2 } from "@/lib/format";
import { decryptKraPin, decryptPII, maskKraPin, maskPhone } from "@/lib/crypto";

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/credit/customers/[id]/statement — per-customer credit statement.
//   GET (MANAGER+) → customer + credit account + debt plans (+ installments)
//   + CreditLedger timeline (newest first, cap 100) + KPI summary. Powers the
//   StatementDialog (ledger timeline, print, WhatsApp share).
//
//   Query plan (2 batches):
//     1. customer.findUnique — customer + creditAccount + debtPlans(
//        installments) + ledgerEntries(take 100, newest first) in ONE query.
//     2. Promise.all — all-time ledger sums (groupBy transactionType, immune
//        to the 100-entry display cap) + oldest unpaid CREDIT/PARTIAL charge
//        (aging-report parity for oldestDebtDays).
//
//   SECURITY: MANAGER+ (requireRole). Cross-branch access is refused with a
//   404-shaped error — the SAME message as an unknown id — so probing ids from
//   another branch can never confirm the customer exists (BOLA; mirrors
//   /api/v1/sales/[id]). assertBranchAccess semantics, re-shaped 403 → 404.
//
//   PII: `phone` leaves masked only (maskPhone). The additive `phoneDigits`
//   field is the full number normalised for wa.me links — the WhatsApp share
//   feature requires the real number, same trust level as the repay flow's
//   customer phone; it is never logged.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const LEDGER_CAP = 100;

interface LedgerSumRow {
  type: string;
  total: number;
}

/** All-time CreditLedger sums per transactionType — independent of the display cap. */
async function ledgerSums(creditAccountId: string): Promise<LedgerSumRow[]> {
  const rows = await db.creditLedger.groupBy({
    by: ["transactionType"],
    where: { creditAccountId },
    _sum: { amount: true },
  });
  return rows.map((r) => ({ type: r.transactionType, total: round2(D(r._sum.amount ?? 0).toNumber()) }));
}

/** GET /api/v1/credit/customers/[id]/statement */
export const GET = withErrorHandler(async (raw: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const req = raw as NextRequest;
  // MANAGER+ only: statements expose the ledger timeline, repayment plans and
  // contact PII (masked) — same gate as /api/v1/credit/aging and /remind.
  const user = await requireRole(req, "MANAGER");

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      creditAccount: {
        include: {
          debtPlans: {
            orderBy: { createdAt: "asc" },
            include: { installments: { orderBy: { seq: "asc" } } },
          },
          ledgerEntries: {
            orderBy: { createdAt: "desc" },
            take: LEDGER_CAP,
            include: { user: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!customer) throw ApiError.notFound("Customer not found");

  // BOLA fence — OWNER may cross branches; everyone else gets the identical
  // "Customer not found" as an unknown id (no existence leak).
  if (user.role !== "OWNER" && customer.branchId !== user.branchId) {
    throw ApiError.notFound("Customer not found");
  }

  const account = customer.creditAccount;
  const now = new Date();

  const [sums, oldestCharge] = await Promise.all([
    account ? ledgerSums(account.id) : Promise.resolve([] as LedgerSumRow[]),
    db.transaction.findFirst({
      where: { customerId: customer.id, status: { in: ["CREDIT", "PARTIAL"] }, balanceDue: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  const sumBy = new Map(sums.map((s) => [s.type, s.total]));

  const allInstallments = account?.debtPlans.flatMap((p) => p.installments) ?? [];

  // Next due: soonest open (PENDING/PARTIAL/OVERDUE) installment across plans,
  // reported with its unpaid remainder.
  const nextDue =
    allInstallments
      .filter((i) => i.status === "PENDING" || i.status === "PARTIAL" || i.status === "OVERDUE")
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0] ?? null;

  // Overdue count mirrors /api/v1/credit/aging: OVERDUE rows + past-due PENDING.
  const overdueInstallments = allInstallments.filter(
    (i) => i.status === "OVERDUE" || (i.status === "PENDING" && i.dueDate < now)
  ).length;

  // Oldest debt age — same rules as the aging report: oldest unpaid
  // CREDIT/PARTIAL charge, else oldest unpaid installment due date, else 0.
  let oldestDebtDays = 0;
  if (oldestCharge) {
    oldestDebtDays = Math.max(0, Math.floor((now.getTime() - oldestCharge.createdAt.getTime()) / DAY_MS));
  } else {
    const unpaidDues = allInstallments.filter((i) => i.status !== "PAID").map((i) => i.dueDate.getTime());
    if (unpaidDues.length > 0) {
      oldestDebtDays = Math.max(0, Math.floor((now.getTime() - Math.min(...unpaidDues)) / DAY_MS));
    }
  }

  // Masked display phone + wa.me-ready digits (Kenyan local 07XX → 2547XX).
  const rawPhone = decryptPII(customer.phoneEnc);
  const rawDigits = rawPhone ? rawPhone.replace(/\D/g, "") : "";
  const phoneDigits = rawDigits
    ? rawDigits.startsWith("0")
      ? `254${rawDigits.slice(1)}`
      : rawDigits
    : null;

  const balance = D(customer.currentBalance);

  return NextResponse.json({
    customer: {
      id: customer.id,
      name: customer.name,
      phone: maskPhone(rawPhone),
      phoneDigits,
      // Masked: the statement is a customer-facing summary document; verbatim
      // PINs appear only on server-built eTIMS tax invoices (checkout/reprint).
      kraPin: maskKraPin(decryptKraPin(customer.kraPinEnc)),
      creditLimit: String(customer.creditLimit ?? 0),
      currentBalance: String(balance ?? 0),
      riskScore: customer.riskScore,
    },
    account: account
      ? {
          id: account.id,
          status: account.status,
          totalDebt: String(account.totalDebt ?? 0),
          creditLimit: String(account.creditLimit ?? 0),
          createdAt: account.createdAt.toISOString(),
        }
      : null,
    summary: {
      outstanding: String(balance ?? 0),
      ledgerCharges: String(sumBy.get("CHARGE") ?? 0),
      ledgerPayments: String(sumBy.get("PAYMENT") ?? 0),
      ledgerPenalties: String(sumBy.get("PENALTY") ?? 0),
      ledgerRefunds: String(sumBy.get("REFUND") ?? 0),
      nextDueDate: nextDue ? nextDue.dueDate.toISOString() : null,
      nextDueAmount: nextDue
        ? String(round2(Math.max(0, D(nextDue.amountDue).sub(D(nextDue.amountPaid)).toNumber())))
        : null,
      activePlans: (account?.debtPlans ?? []).filter((p) => p.status === "ACTIVE").length,
      overdueInstallments,
      oldestDebtDays,
    },
    plans: (account?.debtPlans ?? []).map((p) => ({
      id: p.id,
      frequency: p.installmentFrequency,
      totalAmount: String(p.totalAmount ?? 0),
      downPayment: String(p.downPayment ?? 0),
      balanceRemaining: String(p.balanceRemaining ?? 0),
      status: p.status,
      startDate: p.startDate.toISOString(),
      installments: p.installments.map((i) => ({
        seq: i.seq,
        amountDue: String(i.amountDue ?? 0),
        amountPaid: String(i.amountPaid ?? 0),
        dueDate: i.dueDate.toISOString(),
        status: i.status,
      })),
    })),
    ledger: (account?.ledgerEntries ?? []).map((l) => ({
      id: l.id,
      type: l.transactionType,
      amount: String(l.amount ?? 0),
      previousBalance: String(l.previousBalance ?? 0),
      newBalance: String(l.newBalance ?? 0),
      referenceId: l.referenceId,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
      performedBy: l.user?.name ?? null, // resolved actor display name; raw cuid never crosses the wire
    })),
  });
});
