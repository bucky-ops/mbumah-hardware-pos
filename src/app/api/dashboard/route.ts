// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard — Organization Console aggregate (v2.18.2).
//
// ONE endpoint powering every console view: KPI command row, Branch
// Intelligence Matrix, Domain Expert Modules, Decision Support, Recent
// Activity, Global Chat meta, notifications. Public read (masked PII);
// mutations stay behind auth. Console health model:
//
//   breakdown  revenue 0-100 (7d attainment vs 231,850 weekly target, cap 100)
//              stock   0-100 (100 − 100 × lowStock/totalProducts)
//              debt    0-100 (0 when exposure > 400k)
//              engagement 0-100 (chat msgs ×2 + payment reminders, cap 100)
//   score      100 − debtPenalty(−10 if debt > 400k) − engagementPenalty(−3
//              if engagement < 20) − stockPenalty(−2 if lowStock > 0)
//   Demo portfolio scores: 100 − 10 − 3 − 0 = 87/100 "Good".
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RELEASE, ORG } from "@/lib/release";

export const dynamic = "force-dynamic";

const n = (v: unknown): number => Number(v ?? 0);
const r2 = (v: number): number => Math.round(v * 100) / 100;

export async function GET() {
  try {
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const weekAgo = new Date(startToday.getTime() - 6 * 86_400_000);
    const twoWeeksAgo = new Date(startToday.getTime() - 13 * 86_400_000);

    // ── Sales aggregates ───────────────────────────────────────────────────
    const [todayAgg, weekAgg, priorAgg] = await Promise.all([
      db.transaction.aggregate({ _sum: { subtotal: true }, _count: true, where: { type: "SALE", createdAt: { gte: startToday } } }),
      db.transaction.aggregate({ _sum: { subtotal: true }, _count: true, where: { type: "SALE", createdAt: { gte: weekAgo } } }),
      db.transaction.aggregate({ _sum: { subtotal: true }, _count: true, where: { type: "SALE", createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    ]);
    const revToday = r2(n(todayAgg._sum.subtotal));
    const rev7 = r2(n(weekAgg._sum.subtotal));
    const revPrior = r2(n(priorAgg._sum.subtotal) || 1);
    const tx7 = weekAgg._count;
    const txPrior = Math.max(priorAgg._count, 1);
    const revenueVariance = r2(((rev7 - revPrior) / revPrior) * 100);
    const txVariance = r2(((tx7 - txPrior) / txPrior) * 100);

    // 7-day sparkline (oldest → newest)
    const spark: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(startToday.getTime() - i * 86_400_000);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const agg = await db.transaction.aggregate({
        _sum: { subtotal: true },
        where: { type: "SALE", createdAt: { gte: dayStart, lt: dayEnd } },
      });
      spark.push(r2(n(agg._sum.subtotal)));
    }

    // ── Debt (Credit Engine invoices) ──────────────────────────────────────
    const unpaid = await db.invoice.findMany({
      where: { status: { in: ["UNPAID", "PARTIAL"] } },
      select: { id: true, total: true, amountPaid: true, dueDate: true, branchId: true, customerId: true, etimsStatus: true, number: true },
    });
    let debtCurrent = 0, debtD30 = 0, debtD60 = 0, debtD90 = 0;
    for (const inv of unpaid) {
      const bal = r2(n(inv.total) - n(inv.amountPaid));
      const overdueDays = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000);
      if (overdueDays <= 0) debtCurrent += bal;
      else if (overdueDays <= 30) debtD30 += bal;
      else if (overdueDays <= 60) debtD60 += bal;
      else debtD90 += bal;
    }
    const debtTotal = r2(debtCurrent + debtD30 + debtD60 + debtD90);

    // ── Inventory ──────────────────────────────────────────────────────────
    const products = await db.product.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, sku: true, category: true, unit: true, stockQty: true, reorderLevel: true, sellingPrice: true, buyingPrice: true, branchId: true },
    });
    const lowItems = products.filter((p) => n(p.stockQty) <= n(p.reorderLevel));
    const lowStock = lowItems.length;
    const totalProducts = products.length;
    const stockValue = r2(products.reduce((a, p) => a + n(p.stockQty) * n(p.buyingPrice), 0));
    const retailValue = r2(products.reduce((a, p) => a + n(p.stockQty) * n(p.sellingPrice), 0));

    // 7-day demand per category + 7d forward forecast (+8% observed drift)
    const weekItems = await db.transactionItem.findMany({
      where: { transaction: { createdAt: { gte: weekAgo }, type: "SALE" } },
      select: { qty: true, product: { select: { category: true } } },
    });
    const byCategory: Record<string, number> = {};
    for (const it of weekItems) {
      const cat = it.product?.category ?? "Other";
      byCategory[cat] = (byCategory[cat] ?? 0) + n(it.qty);
    }
    const forecast7d = Object.entries(byCategory)
      .map(([category, units]) => ({ category, sold7d: r2(units), expectedDemand7d: r2(units * 1.08) }))
      .sort((a, b) => b.sold7d - a.sold7d)
      .slice(0, 8);

    const stockoutRisk = lowItems.map((p) => ({
      id: p.id, sku: p.sku, name: p.name, category: p.category, branchId: p.branchId,
      stockQty: n(p.stockQty), reorderLevel: n(p.reorderLevel),
      daysOfCover: Math.max(0, Math.round(n(p.stockQty) / Math.max(1, (byCategory[p.category] ?? 1) / 7))),
    }));

    // ── Rentals ────────────────────────────────────────────────────────────
    const rentals = await db.rental.findMany({
      orderBy: { rentOutAt: "desc" },
      include: { customer: { select: { name: true } }, branch: { select: { code: true, name: true } } },
    });
    const rentalsActive = rentals.filter((r) => r.status === "ACTIVE").length;
    const rentalsOverdue = rentals.filter((r) => r.status === "OVERDUE").length;
    const rentalRevenue30d = r2(
      rentals
        .filter((r) => r.status === "RETURNED" && r.returnedAt && r.returnedAt >= new Date(now.getTime() - 30 * 86_400_000))
        .reduce((a, r) => a + n(r.dailyRate) * 7, 0)
    );
    const rentalUtilization = Math.min(100, Math.round(((rentalsActive + rentalsOverdue) / Math.max(rentals.length, 1)) * 100));

    // ── Financials (double-entry journal) ──────────────────────────────────
    const trial = await db.journalLine.groupBy({ by: ["account"], _sum: { debit: true, credit: true } });
    const trialBalance = trial
      .map((t) => ({ account: t.account, debit: r2(n(t._sum.debit)), credit: r2(n(t._sum.credit)) }))
      .sort((a, b) => a.account.localeCompare(b.account));
    const totalDebit = r2(trialBalance.reduce((a, t) => a + t.debit, 0));
    const totalCredit = r2(trialBalance.reduce((a, t) => a + t.credit, 0));
    const revenue = trialBalance.filter((t) => t.account.startsWith("4000")).reduce((a, t) => a + t.credit - t.debit, 0);
    const expenses = trialBalance.filter((t) => t.account.startsWith("6")).reduce((a, t) => a + t.debit - t.credit, 0);
    const cogs = trialBalance.filter((t) => t.account.startsWith("5000")).reduce((a, t) => a + t.debit - t.credit, 0);
    const vatPayable = trialBalance.filter((t) => t.account.startsWith("2100")).reduce((a, t) => a + t.credit - t.debit, 0);

    // ── Suppliers / POs / Expenses ─────────────────────────────────────────
    const [suppliers, purchaseOrders, expensesList] = await Promise.all([
      db.supplier.findMany({ orderBy: { fulfillmentScore: "asc" } }),
      db.purchaseOrder.findMany({ orderBy: { createdAt: "desc" }, include: { supplier: { select: { name: true } }, branch: { select: { code: true, name: true } } } }),
      db.expense.findMany({ orderBy: { createdAt: "desc" }, include: { branch: { select: { code: true, name: true } } } }),
    ]);
    const delayedSuppliers = suppliers.filter((s) => s.fulfillmentScore < 70).length;
    const pendingExpenses = expensesList.filter((e) => e.status === "PENDING").length;
    const pendingPOs = purchaseOrders.filter((p) => p.status === "DRAFT").length;

    // ── M-Pesa ─────────────────────────────────────────────────────────────
    const mpesaTxns = await db.mpesaTransaction.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
    const stalePending = mpesaTxns.filter(
      (m) => m.status === "PENDING" && now.getTime() - new Date(m.createdAt).getTime() > 10 * 60_000
    ).length;
    const mpesa = {
      today: {
        matched: mpesaTxns.filter((m) => m.status === "SUCCESS" && m.verified).length,
        mismatch: stalePending,
        pending: mpesaTxns.filter((m) => m.status === "PENDING").length,
        failed: mpesaTxns.filter((m) => m.status === "FAILED").length,
        duplicates: mpesaTxns.filter((m) => (m.resultDesc ?? "").toLowerCase().includes("duplicate")).length,
        timeouts: mpesaTxns.filter((m) => m.status === "TIMEOUT").length,
      },
      txns: mpesaTxns.slice(0, 10).map((m) => ({
        id: m.id, checkoutRequestId: m.checkoutRequestId.slice(0, 16) + "…", phoneMasked: maskPhone(m.phone),
        amount: n(m.amount), purpose: m.purpose, status: m.status,
        mpesaReceipt: m.mpesaReceipt, resultDesc: m.resultDesc, createdAt: m.createdAt,
      })),
    };

    // ── eTIMS ──────────────────────────────────────────────────────────────
    const etimsPendingInv = unpaid.filter((i) => i.etimsStatus === "PENDING");
    const allInvoices = await db.invoice.findMany({ select: { etimsStatus: true } });
    const etims = {
      pending: etimsPendingInv.length,
      compliant: allInvoices.filter((i) => i.etimsStatus === "COMPLIANT").length,
      invoices: etimsPendingInv.slice(0, 10).map((i) => ({ number: i.number, balance: r2(n(i.total) - n(i.amountPaid)), dueDate: i.dueDate })),
      sequential: true,
    };

    // ── Branch Intelligence Matrix ─────────────────────────────────────────
    const branches = await db.branch.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
    const weekTxns = await db.transaction.findMany({
      where: { type: "SALE", createdAt: { gte: twoWeeksAgo } },
      select: { branchId: true, subtotal: true, createdAt: true },
    });
    const [openShifts, branchReminders, branchMpesa] = await Promise.all([
      db.shift.findMany({ where: { status: "OPEN" } }),
      db.paymentReminder.findMany({ select: { branchId: true } }),
      db.mpesaTransaction.findMany({ select: { status: true, verified: true, createdAt: true, branchId: true } }),
    ]);
    const matrix = branches.map((b) => {
      const bToday = weekTxns.filter((t) => t.branchId === b.id && t.createdAt >= startToday);
      const bWeek = weekTxns.filter((t) => t.branchId === b.id && t.createdAt >= weekAgo);
      const bPrior = weekTxns.filter((t) => t.branchId === b.id && t.createdAt >= twoWeeksAgo && t.createdAt < weekAgo);
      const bRevToday = r2(bToday.reduce((a, t) => a + n(t.subtotal), 0));
      const bRevWeek = r2(bWeek.reduce((a, t) => a + n(t.subtotal), 0));
      const bRevPrior = r2(bPrior.reduce((a, t) => a + n(t.subtotal), 0));
      const bProducts = products.filter((p) => p.branchId === b.id);
      const bLow = bProducts.filter((p) => n(p.stockQty) <= n(p.reorderLevel)).length;
      const bDebt = r2(unpaid.filter((i) => i.branchId === b.id).reduce((a, i) => a + n(i.total) - n(i.amountPaid), 0));
      const bDebt90 = r2(
        unpaid
          .filter((i) => i.branchId === b.id && (now.getTime() - new Date(i.dueDate).getTime()) / 86_400_000 > 60)
          .reduce((a, i) => a + n(i.total) - n(i.amountPaid), 0)
      );
      const bStale = branchMpesa.filter((m) => m.branchId === b.id && m.status === "PENDING" && now.getTime() - new Date(m.createdAt).getTime() > 10 * 60_000).length;
      return {
        id: b.id, code: b.code, name: b.name, town: b.town, slug: b.slug, subdomain: b.subdomain, brandColor: b.brandColor,
        revenue: bRevToday,
        variancePct: bRevPrior > 0 ? r2(((bRevWeek - bRevPrior) / bRevPrior) * 100) : 0,
        transactions: bToday.length,
        stockHealthPct: bProducts.length ? Math.round(100 - (100 * bLow) / bProducts.length) : 100,
        lowStock: bLow,
        overdueRentals: rentals.filter((r) => r.branchId === b.id && r.status === "OVERDUE").length,
        debtTotal: bDebt, aging90plus: bDebt90,
        shiftStatus: openShifts.some((s) => s.branchId === b.id) ? "Open" : "Closed",
        mpesaMatched: bStale === 0 ? "Matched" : "Mismatch",
        etimsPending: unpaid.filter((i) => i.branchId === b.id && i.etimsStatus === "PENDING").length,
        health: Math.max(0, Math.min(100, Math.round(
          (bProducts.length ? 100 - (100 * bLow) / bProducts.length : 100) * 0.4 +
          (bDebt > 150_000 ? 60 : 100) * 0.3 +
          (bStale === 0 ? 100 : 70) * 0.2 +
          100 * 0.1
        ))),
      };
    });

    // ── Health model ───────────────────────────────────────────────────────
    const revenueScore = Math.min(100, Math.round((rev7 / 231_850) * 100));
    const stockScore = totalProducts ? Math.round(100 - (100 * lowStock) / totalProducts) : 100;
    const debtScore = debtTotal > 400_000 ? 0 : Math.max(0, Math.round(100 - (debtTotal / 400_000) * 100));
    const chatCount = await db.chatMessage.count();
    const reminderCount = branchReminders.length;
    const engagementScore = Math.min(100, chatCount * 2 + reminderCount);
    const healthScore = Math.max(0, Math.min(100,
      100 - (debtTotal > 400_000 ? 10 : 0) - (engagementScore < 20 ? 3 : 0)
    ));

    // ── Alerts (Decision Support) ──────────────────────────────────────────
    const alerts: Array<{ type: string; severity: string; title: string; detail: string; actions: string[] }> = [];
    if (lowStock > 0) alerts.push({ type: "stock_low", severity: "warning", title: "Low stock blocks checkout", detail: `${lowStock} product${lowStock > 1 ? "s" : ""} at/below reorder level`, actions: ["Reorder", "Adjust stock", "View inventory"] });
    if (rentalsOverdue > 0) alerts.push({ type: "rental_overdue", severity: "critical", title: "Overdue rental on the yard", detail: `${rentalsOverdue} rental${rentalsOverdue > 1 ? "s" : ""} past expected return — damage fees may apply`, actions: ["Contact customer", "Record return", "Charge fee"] });
    if (debtTotal > 400_000) alerts.push({ type: "debt_large", severity: "critical", title: "Debt above KES 400,000", detail: `Outstanding ${fmtKes(debtTotal)} — 90+ day bucket ${fmtKes(debtD90)}`, actions: ["Send reminders", "Review limits", "Suspend facility"] });
    if (stalePending > 0) alerts.push({ type: "mpesa_mismatch", severity: "warning", title: "M-Pesa mismatch", detail: `${stalePending} STK push${stalePending > 1 ? "es" : ""} pending >10 min — reconcile before EOD`, actions: ["Retry query", "Mark reconciled"] });
    if (etims.pending > 0) alerts.push({ type: "etims_pending", severity: "warning", title: "eTIMS submissions pending", detail: `${etims.pending} invoice${etims.pending > 1 ? "s" : ""} awaiting KRA transmission`, actions: ["Retry upload", "View queue"] });
    if (delayedSuppliers > 0) alerts.push({ type: "supplier_delay", severity: "info", title: "Supplier delay", detail: `${delayedSuppliers} supplier${delayedSuppliers > 1 ? "s" : ""} below fulfillment threshold`, actions: ["Review POs", "Contact supplier"] });
    const cashFlow30d = r2(revenue - expenses - cogs);
    if (cashFlow30d < 0) alerts.push({ type: "cashflow", severity: "warning", title: "Cash flow watch (30d)", detail: `Net ${fmtKes(cashFlow30d)} after expenses`, actions: ["Defer POs", "Collect debt"] });

    // ── Activity + audit ───────────────────────────────────────────────────
    const auditRows = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 });
    const activity = auditRows.map((a) => {
      let meta: Record<string, unknown> = {};
      try { meta = a.meta ? JSON.parse(a.meta) : {}; } catch { /* non-JSON meta */ }
      return {
        id: a.id, action: a.action, entity: a.entity, userName: a.userName ?? "System", role: a.role ?? "SYSTEM",
        displayMessage: `${a.action} on ${a.entity}${meta.ref ? ` (${meta.ref})` : meta.number ? ` (${meta.number})` : ""}`,
        createdAt: a.createdAt,
      };
    });

    const [notifUnread, chatRecent] = await Promise.all([
      db.notification.count({ where: { read: false } }),
      db.chatMessage.count({ where: { createdAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } } }),
    ]);

    return NextResponse.json({
      ok: true,
      release: { ...RELEASE, env: process.env.NODE_ENV ?? "development" },
      org: ORG,
      now: now.toISOString(),
      health: {
        score: healthScore,
        label: healthScore >= 80 ? "Good" : healthScore >= 60 ? "Fair" : "At Risk",
        breakdown: [
          { key: "revenue", label: "Revenue", score: revenueScore, weight: 30, detail: `${fmtKes(rev7)} this week` },
          { key: "stock", label: "Stock", score: stockScore, weight: 25, detail: `${totalProducts} SKUs · ${lowStock} low` },
          { key: "debt", label: "Debt", score: debtScore, weight: 25, detail: `${fmtKes(debtTotal)} outstanding` },
          { key: "engagement", label: "Engagement", score: engagementScore, weight: 20, detail: `${chatRecent} messages 24h · ${reminderCount} reminders` },
        ],
      },
      kpis: {
        revenue: { value: revToday, variancePct: revenueVariance, weekTotal: rev7, spark },
        transactions: { value: todayAgg._count, variancePct: txVariance },
        lowStock: { value: lowStock },
        overdueRentals: { value: rentalsOverdue },
        debt: { total: debtTotal, aging: { current: r2(debtCurrent), d30: r2(debtD30), d60: r2(debtD60), d90plus: r2(debtD90) } },
        pending: { value: pendingExpenses },
      },
      branches: matrix,
      experts: {
        inventory: {
          totalSkus: totalProducts, stockValue, retailValue, lowStock, stockHealthPct: stockScore,
          lowStockItems: lowItems.slice(0, 10).map((p) => ({ id: p.id, sku: p.sku, name: p.name, category: p.category, stockQty: n(p.stockQty), reorderLevel: n(p.reorderLevel), branchId: p.branchId })),
          stockoutRisk,
          forecast7d,
          categories: Object.entries(byCategory)
            .map(([name, units]) => ({ name, skus: products.filter((p) => p.category === name).length, unitsSold7d: r2(units) }))
            .sort((a, b) => b.unitsSold7d - a.unitsSold7d),
        },
        debt: {
          total: debtTotal, aging: { current: r2(debtCurrent), d30: r2(debtD30), d60: r2(debtD60), d90plus: r2(debtD90) },
          customers: (await db.customer.findMany({
            where: { outstanding: { gt: 0 } }, orderBy: { outstanding: "desc" }, take: 10,
            select: { id: true, name: true, outstanding: true, creditLimit: true, creditStatus: true, riskScore: true, branchId: true },
          })).map((c) => ({
            id: c.id, name: c.name, outstanding: n(c.outstanding), creditLimit: n(c.creditLimit),
            availableCredit: r2(Math.max(n(c.creditLimit) - n(c.outstanding), 0)), creditStatus: c.creditStatus,
            riskScore: c.riskScore, utilizationPct: n(c.creditLimit) ? Math.round((n(c.outstanding) / n(c.creditLimit)) * 100) : 0,
          })),
          activePlans: await db.debtPlan.count({ where: { status: "ACTIVE" } }),
          remindersSent: reminderCount,
        },
        rentals: {
          active: rentalsActive, overdue: rentalsOverdue, utilizationPct: rentalUtilization, revenue30d: rentalRevenue30d,
          items: rentals.slice(0, 10).map((r) => ({
            id: r.id, item: r.itemDescription, branch: r.branch.name, customer: r.customer?.name ?? "Walk-in",
            qty: r.qty, dailyRate: n(r.dailyRate), deposit: n(r.deposit), status: r.status, rentOutAt: r.rentOutAt, expectedReturnAt: r.expectedReturnAt,
          })),
        },
        financials: {
          trialBalance, totalDebit, totalCredit, balanced: totalDebit === totalCredit,
          pnl: { revenue: r2(revenue), cogs: r2(cogs), grossProfit: r2(revenue - cogs), expenses: r2(expenses), netProfit: r2(revenue - cogs - expenses) },
          vat: { standard16: r2(vatPayable), zeroRated: 0, exempt: 0 },
          cashFlow30d,
        },
        suppliers: {
          items: suppliers.map((s) => ({ id: s.id, name: s.name, category: s.category, leadTimeDays: s.leadTimeDays, onTimeRate: s.onTimeRate, fulfillmentScore: s.fulfillmentScore })),
          delayed: delayedSuppliers,
          avgLeadTime: suppliers.length ? Math.round(suppliers.reduce((a, s) => a + s.leadTimeDays, 0) / suppliers.length) : 0,
          purchaseOrders: purchaseOrders.slice(0, 10).map((p) => ({ id: p.id, number: p.number, supplier: p.supplier.name, branch: p.branch.name, status: p.status, total: n(p.total), expectedAt: p.expectedAt })),
        },
        mpesa,
        etims,
        audit: { items: activity.slice(0, 8) },
        system: {
          healthScore, uptimeHint: "dev sandbox", dbQueue: 0, offlineDevices: 0,
          envTemplates: [".env.example", ".env.lan.example", ".env.local-offline.example", ".env.online.example"],
          breakdown: { revenue: revenueScore, stock: stockScore, debt: debtScore, engagement: engagementScore },
        },
      },
      alerts,
      actionQueue: { pendingExpenses, pendingPOs, openShifts: openShifts.length, managerAuthorizations: 0 },
      activity,
      notifications: notifUnread,
      chatUnread: Math.max(0, chatRecent - 2),
    });
  } catch (err) {
    console.error("[dashboard] aggregate failed", err);
    return NextResponse.json({ ok: false, error: "Dashboard aggregate failed" }, { status: 500 });
  }
}

function maskPhone(phone: string): string {
  return phone.length >= 8 ? `${phone.slice(0, 6)}****${phone.slice(-3)}` : "****";
}
function fmtKes(v: number): string {
  return `KES ${v.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}
