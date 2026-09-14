import { NextRequest, NextResponse } from "next/server";
import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireRole, assertTargetBranch } from "@/lib/api/guard";
import { D, round2 } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/reports/eod — End-of-Day reconciliation (MANAGER+ per spec; cashiers
// are restricted from reports).
//
// THE CORE FIX — STRICT MULTI-TENDER SPLIT: every tender is aggregated from the
// Payment rows, never inferred from drawer movements. Digital tenders (M-Pesa,
// bank transfer, card) NEVER count toward drawer cash — only CASH does.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const METHODS = ["CASH", "MPESA", "BANK_TRANSFER", "CARD", "STORE_CREDIT"] as const;
type Method = (typeof METHODS)[number];

/** Today's date (YYYY-MM-DD) on the Nairobi wall clock. Nairobi is UTC+3 fixed
 *  (no DST) → shift by +3h and take the UTC date. */
function todayNairobi(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");
  const sp = req.nextUrl.searchParams;

  const date = sp.get("date") ?? todayNairobi();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw ApiError.badRequest("date must be YYYY-MM-DD");

  const requestedBranch = sp.get("branchId");
  assertTargetBranch(user, requestedBranch); // OWNER cross-branch; others no-op/pass
  const branchId = user.role === "OWNER" ? requestedBranch : user.branchId;

  // Nairobi TZ = UTC+3 fixed → a business day is exactly [00:00+03:00, +24h).
  const start = new Date(`${date}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 3_600_000);

  const branchScope = branchId ? { branchId } : {};
  const paymentWhere = {
    ...branchScope,
    receivedAt: { gte: start, lt: end },
    status: "COMPLETED",
  };

  // ── 1) STRICT tender split — groupBy over Payment rows. ──────────────────
  // Digital tenders NEVER count toward drawer cash; only CASH below does.
  const tenderGroups = await db.payment.groupBy({
    by: ["method"],
    where: paymentWhere,
    _sum: { amount: true },
    _count: true,
  });
  const tenders: Record<Method, { total: number; count: number }> = {
    CASH: { total: 0, count: 0 },
    MPESA: { total: 0, count: 0 },
    BANK_TRANSFER: { total: 0, count: 0 },
    CARD: { total: 0, count: 0 },
    STORE_CREDIT: { total: 0, count: 0 },
  };
  for (const g of tenderGroups) {
    const row = tenders[g.method as Method];
    if (!row) continue; // unknown method — ignore rather than corrupt the split
    row.total = round2(D(g._sum.amount).toNumber());
    row.count = g._count;
  }

  // ── 2) Drawer reconciliation (CASH only). ────────────────────────────────
  const sessions = await db.cashDrawerSession.findMany({
    where: {
      ...branchScope,
      openedAt: { lt: end },
      OR: [{ closedAt: null }, { closedAt: { gte: start } }],
    },
    include: { movements: true },
    orderBy: { openedAt: "asc" },
  });
  const openingFloat = sessions.reduce((s, x) => s + D(x.openingFloat).toNumber(), 0);
  // Extra float in = FLOAT_IN movements BEYOND the declared opening float.
  const extraFloatIn = sessions
    .flatMap((s) => s.movements)
    .filter((m) => m.type === "FLOAT_IN")
    .reduce((s, m) => s + D(m.amount).toNumber(), 0);
  const payouts = sessions
    .flatMap((s) => s.movements)
    .filter((m) => m.type === "PAYOUT")
    .reduce((s, m) => s + D(m.amount).toNumber(), 0);
  const countedAmount = sessions
    .filter((s) => s.status === "CLOSED")
    .reduce((s, x) => s + D(x.countedAmount ?? 0).toNumber(), 0);
  const allClosed = sessions.length > 0 && sessions.every((s) => s.status === "CLOSED");
  // expectedDrawer = opening + extra float + CASH tender − payouts.
  // M-Pesa & bank transfers are settled straight to the bank — NOT in the drawer.
  const expectedDrawer = round2(openingFloat + extraFloatIn + tenders.CASH.total - payouts);
  const variance = allClosed ? round2(countedAmount - expectedDrawer) : null;

  // ── 3) VAT summary (transactions in bounds, COMPLETED/PARTIAL). ──────────
  const txns = await db.transaction.findMany({
    where: {
      ...branchScope,
      createdAt: { gte: start, lt: end },
      status: { in: ["COMPLETED", "PARTIAL"] },
    },
    select: {
      id: true,
      vatAmount: true,
      totalAmount: true,
      vatInclusive: true,
      items: {
        select: {
          productId: true,
          description: true,
          qty: true,
          lineNet: true,
          product: { select: { name: true } },
        },
      },
    },
  });
  let gross = new Decimal(0);
  let vat = new Decimal(0);
  let vatInclusiveCount = 0;
  let vatExclusiveCount = 0;
  for (const t of txns) {
    gross = gross.add(D(t.totalAmount));
    vat = vat.add(D(t.vatAmount));
    if (t.vatInclusive) vatInclusiveCount += 1;
    else vatExclusiveCount += 1;
  }
  const netExcl = gross.sub(vat); // basis note below explains the mixed-basis caveat
  // Credit sales outstanding: CREDIT docs (fully unpaid) + PARTIAL docs'
  // remaining balance — both leave the day with money still owed.
  const creditAgg = await db.transaction.aggregate({
    where: { ...branchScope, createdAt: { gte: start, lt: end }, status: { in: ["CREDIT", "PARTIAL"] } },
    _sum: { balanceDue: true },
  });
  const creditOutstanding = round2(D(creditAgg._sum.balanceDue).toNumber());
  const basisNote =
    vatExclusiveCount === 0
      ? "VAT-inclusive basis (retail): VAT = net − net/1.16"
      : vatInclusiveCount === 0
        ? "VAT-exclusive basis: VAT = net × 16%"
        : `Mixed basis: ${vatInclusiveCount} inclusive / ${vatExclusiveCount} exclusive transactions`;

  // ── 4) Hourly revenue series 08:00–19:59 (Nairobi wall clock). ───────────
  const payments = await db.payment.findMany({
    where: paymentWhere,
    select: { method: true, amount: true, receivedAt: true },
  });
  const hourly = Array.from({ length: 12 }, (_, i) => ({
    hour: 8 + i,
    cash: 0,
    mpesa: 0,
    bank: 0, // BANK_TRANSFER + CARD (card terminals settle with the bank batch)
    credit: 0,
  }));
  for (const p of payments) {
    // Nairobi hour = UTC hour + 3 (fixed offset, no DST → mod 24 wraps midnight).
    const hour = (p.receivedAt.getUTCHours() + 3) % 24;
    const slot = hourly.find((h) => h.hour === hour);
    if (!slot) continue; // outside the 08:00–19:59 reporting window
    const amount = D(p.amount).toNumber();
    switch (p.method) {
      case "CASH":
        slot.cash += amount;
        break;
      case "MPESA":
        slot.mpesa += amount;
        break;
      case "BANK_TRANSFER":
      case "CARD":
        slot.bank += amount;
        break;
      case "STORE_CREDIT":
        slot.credit += amount;
        break;
    }
  }
  for (const h of hourly) {
    h.cash = round2(h.cash);
    h.mpesa = round2(h.mpesa);
    h.bank = round2(h.bank);
    h.credit = round2(h.credit);
  }

  // ── 5) Top products (JS aggregation over the day's transaction items). ───
  const byProduct = new Map<string, { name: string; qty: Decimal; lineNet: Decimal }>();
  for (const t of txns) {
    for (const item of t.items) {
      const key = item.productId ?? `desc:${item.description}`;
      const entry = byProduct.get(key) ?? {
        name: item.product?.name ?? item.description,
        qty: new Decimal(0),
        lineNet: new Decimal(0),
      };
      entry.qty = entry.qty.add(D(item.qty));
      entry.lineNet = entry.lineNet.add(D(item.lineNet));
      byProduct.set(key, entry);
    }
  }
  const topProducts = [...byProduct.values()]
    .sort((a, b) => b.lineNet.minus(a.lineNet).toNumber())
    .slice(0, 5)
    .map((p) => ({ name: p.name, qty: round2(p.qty.toNumber()), lineNet: round2(p.lineNet.toNumber()) }));

  return NextResponse.json({
    date,
    branchId: branchId ?? null,
    generatedAt: new Date().toISOString(),
    tenders,
    drawer: {
      openingFloat: round2(openingFloat),
      extraFloatIn: round2(extraFloatIn),
      cashSales: tenders.CASH.total,
      payouts: round2(payouts),
      expectedDrawer,
      countedAmount: round2(countedAmount),
      variance,
      sessionsCount: sessions.length,
      allClosed,
    },
    vat: {
      gross: round2(gross.toNumber()),
      vatCollected: round2(vat.toNumber()),
      netExcl: round2(netExcl.toNumber()),
      creditOutstanding,
      vatInclusiveCount,
      vatExclusiveCount,
      basisNote,
      transactionCount: txns.length,
    },
    hourly,
    topProducts,
  });
});
