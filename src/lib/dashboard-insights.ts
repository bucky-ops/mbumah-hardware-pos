// ════════════════════════════════════════════════════════════════════════════
// src/lib/dashboard-insights.ts
// ════════════════════════════════════════════════════════════════════════════
//
// v2.12.0 DASHBOARD LOGIC REBUILD (Task DASH-BE) — server-only insight
// builders behind GET /api/dashboard.
//
// DESIGN CONTRACTS
//   • SERVER-ONLY: imports @/lib/db (Prisma) — never bundle this into a
//     client component.
//   • NEVER THROW: every exported builder is fault-isolated — a failing
//     query degrades that block to a safe default (null/empty/0) and logs a
//     [DASHBOARD-INSIGHTS] breadcrumb; the dashboard response still renders
//     with every other block intact.
//   • DECIMAL-SAFE: Prisma Decimal.valueOf() returns a STRING (`number +
//     decimal` silently concatenates). Every accumulation flows through
//     toDec(); plain numbers are emitted only at the JSON boundary via
//     round2() / toNumber().
//   • TENANT-SCOPED: every query filters by storeId.
//
// Blocks implemented (response field → builder):
//   shift          → buildShiftSnapshot        (active-shift cash position)
//   debtCrisis     → buildDebtCrisis           (aging + ratio + risk customers)
//   alerts         → buildDashboardInsights    (deduplicated, actionable)
//   storeHealth    → buildStoreHealth          (transparent weighted score)
//   revenueTrend7d → buildRevenueTrend         (7-day net revenue + forecast)
//   stock counts   → buildLowStockCounts       (out-of-stock vs low split)
//   recentActivities → sanitizeActivity        (PII/id leak sanitization)
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
// FINANCIAL MATH AUDIT (Task 12-b): Prisma Decimal valueOf() returns a STRING —
// `number + decimal` concatenates. All accumulation below flows through
// toDec()/round2() and emits plain numbers only at the JSON boundary.
import { toDec, round2 } from '@/lib/utils/financialMath';

// ── Shared constants ─────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Outstanding (unpaid or partly paid) debt statuses — matches the dashboard
 *  aggregate and debt-helpers identifyOverdueCustomers exactly. */
const OUTSTANDING_DEBT_STATUSES = ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] as const;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Ksh shorthand formatter for human-readable alert/peak strings. */
const fmtKsh = (n: number): string => `Ksh ${Math.round(n).toLocaleString('en-KE')}`;

/** '14' → '2 PM' (dashboard hour bucket keys are zero-padded 24h strings). */
const hourLabel = (hour: string): string => {
  const h = parseInt(hour, 10);
  if (!Number.isFinite(h) || h < 0 || h > 23) return hour;
  const suffix = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
};

/** Local-midnight start of the day containing `d`. */
const startOfLocalDay = (d: Date): Date => {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

/**
 * Fault-isolation wrapper: run `fn`; on failure log one breadcrumb and return
 * the pre-built `fallback` so the dashboard NEVER throws.
 */
async function safeInvoke<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[DASHBOARD-INSIGHTS] ${label} failed (degraded output kept):`, {
      error: err instanceof Error ? err.message : err,
    });
    return fallback;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. ACTIVE SHIFT SNAPSHOT  (response field: `shift`)
// ════════════════════════════════════════════════════════════════════════════
//
// Fixes the "Shift Sales 0.00 / Txns 0 / Expected 156,270" impossibility: the
// old UI stitched the shift row's own (never-updated) totalSales counters onto
// X-read drawer figures. This snapshot derives EVERYTHING from the source of
// truth — SalesTransaction rows inside the shift window — and applies the
// user's expected-cash formula exactly:
//
//   expectedCash = startingCash + cashSales − expenses
//
// (CashDrawerLog-based expected cash remains available via the X-read
// endpoint; this formula is the shop-floor one the owner asked for.)

export interface ShiftSnapshot {
  id: string;
  startedAt: string;
  endedAt: null;
  startedBy: string | null;
  startingCash: number;
  cashSales: number;
  debtSales: number;
  otherSales: number;
  totalSales: number;
  txnsCash: number;
  txnsDebt: number;
  txnsOther: number;
  txnsTotal: number;
  expenses: number;
  expectedCash: number;
  formula: string;
  elapsedMinutes: number;
}

/**
 * Snapshot of the currently OPEN shift for a store, or null when no shift is
 * active. Schema note: the Shift.status domain is 'ACTIVE' | 'ENDED' (see
 * prisma/schema.prisma and the shifts routes) — the store-facing concept is
 * "open", persisted as ACTIVE.
 */
export async function buildShiftSnapshot(
  storeId: string,
  now: Date = new Date(),
): Promise<ShiftSnapshot | null> {
  return safeInvoke<ShiftSnapshot | null>('shift snapshot', null, async () => {
    const shift = await db.shift.findFirst({
      where: { storeId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        startedAt: true,
        startingCash: true,
        user: { select: { name: true } },
      },
    });
    if (!shift) return null;

    // All counted sales inside the shift window. VAT is excluded (net
    // revenue basis — VAT is owed to KRA, never revenue).
    const txs = await db.salesTransaction.findMany({
      where: {
        storeId,
        createdAt: { gte: shift.startedAt },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      select: { totalAmount: true, taxAmount: true, paymentMethod: true },
    });

    let cashAcc = toDec(0);
    let debtAcc = toDec(0);
    let otherAcc = toDec(0);
    let txnsCash = 0;
    let txnsDebt = 0;
    let txnsOther = 0;

    for (const tx of txs) {
      const net = toDec(tx.totalAmount).minus(toDec(tx.taxAmount));
      if (tx.paymentMethod === 'CASH') {
        cashAcc = cashAcc.plus(net);
        txnsCash += 1;
      } else if (tx.paymentMethod === 'DEBT') {
        debtAcc = debtAcc.plus(net);
        txnsDebt += 1;
      } else {
        // MPESA / SPLIT / GIFT_CARD — everything the drawer formula ignores.
        otherAcc = otherAcc.plus(net);
        txnsOther += 1;
      }
    }

    // Expenses in the window. Status ACTIVE excludes VOIDED rows — counting
    // a voided expense would overstate the drawer shortfall.
    const expenseAgg = await db.expense.aggregate({
      where: { storeId, status: 'ACTIVE', createdAt: { gte: shift.startedAt } },
      _sum: { amount: true },
    });

    const startingCashDec = toDec(shift.startingCash);
    const expensesDec = toDec(expenseAgg._sum.amount);
    const cashSales = round2(cashAcc);

    return {
      id: shift.id,
      startedAt: shift.startedAt.toISOString(),
      endedAt: null,
      startedBy: shift.user?.name ?? null,
      startingCash: round2(startingCashDec),
      cashSales,
      debtSales: round2(debtAcc),
      otherSales: round2(otherAcc),
      totalSales: round2(cashAcc.plus(debtAcc).plus(otherAcc)),
      txnsCash,
      txnsDebt,
      txnsOther,
      txnsTotal: txs.length,
      expenses: round2(expensesDec),
      // THE USER'S FORMULA — exact. Example: 70,000 + 95,520 = 165,520.
      expectedCash: round2(startingCashDec.plus(cashAcc).minus(expensesDec)),
      formula: 'Starting + Cash Sales − Expenses',
      elapsedMinutes: Math.max(0, Math.floor((now.getTime() - shift.startedAt.getTime()) / 60000)),
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 2. DEBT CRISIS  (response field: `debtCrisis`)
// ════════════════════════════════════════════════════════════════════════════

export interface DebtAgingBuckets {
  /** Days overdue = 0 (not yet due). */
  current: number;
  /** 1–30 days overdue. */
  d30: number;
  /** 31–60 days overdue. */
  d60: number;
  /** > 90 days overdue. */
  d90plus: number;
}

export interface DebtRiskCustomer {
  customerId: string;
  name: string;
  owes: number;
  lifetimeSpend: number;
  /** owes / lifetimeSpend — null when lifetimeSpend is 0. */
  ratio: number | null;
  /** owes > 2 × lifetimeSpend (requires lifetimeSpend > 0). */
  highRisk: boolean;
}

export interface DebtCrisisSummary {
  outstandingTotal: number;
  outstandingCount: number;
  aging: DebtAgingBuckets;
  debtRatioPercent: number;
  warning: boolean;
  banner: string | null;
  highRiskCount: number;
  customers: DebtRiskCustomer[];
}

export interface DebtCore {
  summary: DebtCrisisSummary;
  /** FULL ranked per-customer list (not just top 10) — shared with the alert
   *  builder so "large debt" alerts never miss a customer outside the top 10. */
  riskCustomers: DebtRiskCustomer[];
}

const EMPTY_DEBT_CRISIS: DebtCrisisSummary = {
  outstandingTotal: 0,
  outstandingCount: 0,
  aging: { current: 0, d30: 0, d60: 0, d90plus: 0 },
  debtRatioPercent: 0,
  warning: false,
  banner: null,
  highRiskCount: 0,
  customers: [],
};

/** One fetch of every outstanding DebtLedger row — feeds total, aging buckets
 *  and the per-customer risk list so the bucket sums add up EXACTLY to
 *  outstandingTotal (single source, Decimal accumulation, rounding only at
 *  the JSON boundary). */
async function fetchOutstandingDebt(storeId: string) {
  return db.debtLedger.findMany({
    where: { storeId, status: { in: [...OUTSTANDING_DEBT_STATUSES] } },
    select: {
      balance: true,
      dueDate: true,
      customerId: true,
      customer: { select: { name: true } },
    },
  });
}

type OutstandingDebtRow = Awaited<ReturnType<typeof fetchOutstandingDebt>>[number];

/** Lifetime NET spend per customer (all-time completed/partial sales). */
async function fetchLifetimeSpend(storeId: string) {
  return db.salesTransaction.groupBy({
    by: ['customerId'],
    where: {
      storeId,
      transactionType: 'SALE',
      paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      customerId: { not: null },
    },
    _sum: { totalAmount: true, taxAmount: true },
  });
}

/**
 * Debt-crisis analytics for the dashboard.
 *
 * @param storeId            tenant scope
 * @param todayDebtSales     today's NET debt-tender revenue (from the route)
 * @param todayTotalRevenue  today's NET revenue across all methods (from the route)
 */
export async function buildDebtCrisis(
  storeId: string,
  todayDebtSales: number,
  todayTotalRevenue: number,
): Promise<DebtCore> {
  const fallback: DebtCore = { summary: EMPTY_DEBT_CRISIS, riskCustomers: [] };
  return safeInvoke<DebtCore>('debt crisis', fallback, async () => {
    // ── ONE fetch drives total + buckets + per-customer list ──
    let rows: OutstandingDebtRow[] = [];
    try {
      rows = await fetchOutstandingDebt(storeId);
    } catch (err) {
      console.error('[DASHBOARD-INSIGHTS] outstanding-debt fetch failed:', {
        error: err instanceof Error ? err.message : err,
      });
    }

    const now = Date.now();
    const bucketAcc = {
      current: toDec(0),
      d30: toDec(0),
      d60: toDec(0),
      d90plus: toDec(0),
    };
    const perCustomer = new Map<string, { name: string; owes: ReturnType<typeof toDec> }>();

    for (const row of rows) {
      const balance = toDec(row.balance);
      const daysOverdue = Math.max(0, Math.floor((now - row.dueDate.getTime()) / DAY_MS));
      if (daysOverdue === 0) bucketAcc.current = bucketAcc.current.plus(balance);
      else if (daysOverdue <= 30) bucketAcc.d30 = bucketAcc.d30.plus(balance);
      else if (daysOverdue <= 60) bucketAcc.d60 = bucketAcc.d60.plus(balance);
      else bucketAcc.d90plus = bucketAcc.d90plus.plus(balance);

      const entry = perCustomer.get(row.customerId);
      if (entry) entry.owes = entry.owes.plus(balance);
      else perCustomer.set(row.customerId, { name: row.customer.name, owes: balance });
    }

    // Bucket sums add up EXACTLY to outstandingTotal: same rows, Decimal
    // accumulation, one round at the boundary.
    const outstandingTotal = round2(
      bucketAcc.current.plus(bucketAcc.d30).plus(bucketAcc.d60).plus(bucketAcc.d90plus),
    );

    // ── Lifetime spend (fault-isolated sub-query: failure → no risk flags,
    //    the rest of the block still renders) ──
    let spendRows: Awaited<ReturnType<typeof fetchLifetimeSpend>> = [];
    try {
      spendRows = await fetchLifetimeSpend(storeId);
    } catch (err) {
      console.error('[DASHBOARD-INSIGHTS] lifetime-spend fetch failed:', {
        error: err instanceof Error ? err.message : err,
      });
    }
    const lifetimeByCustomer = new Map<string, ReturnType<typeof toDec>>();
    for (const row of spendRows) {
      if (!row.customerId) continue;
      lifetimeByCustomer.set(
        row.customerId,
        toDec(row._sum.totalAmount).minus(toDec(row._sum.taxAmount)),
      );
    }

    const riskCustomers: DebtRiskCustomer[] = Array.from(perCustomer.entries())
      .map(([customerId, entry]) => {
        const owes = round2(entry.owes);
        const spend = round2(lifetimeByCustomer.get(customerId) ?? toDec(0));
        const highRisk = spend > 0 && owes > 2 * spend;
        return {
          customerId,
          name: entry.name,
          owes,
          lifetimeSpend: spend,
          ratio: spend > 0 ? round2(owes / spend) : null,
          highRisk,
        };
      })
      .sort((a, b) => b.owes - a.owes);

    const debtRatioPercent =
      todayTotalRevenue > 0 ? round2((todayDebtSales / todayTotalRevenue) * 100) : 0;
    const warning = debtRatioPercent > 50;

    const summary: DebtCrisisSummary = {
      outstandingTotal,
      outstandingCount: rows.length,
      aging: {
        current: round2(bucketAcc.current),
        d30: round2(bucketAcc.d30),
        d60: round2(bucketAcc.d60),
        d90plus: round2(bucketAcc.d90plus),
      },
      debtRatioPercent,
      warning,
      banner: warning ? 'High debt exposure' : null,
      highRiskCount: riskCustomers.filter((c) => c.highRisk).length,
      customers: riskCustomers.slice(0, 10),
    };

    return { summary, riskCustomers };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 3. ALERTS  (response fields: `alerts`, `alertsCount`)
// ════════════════════════════════════════════════════════════════════════════
//
// DEDUPLICATED + ACTIONABLE: every alert carries a stable dedupeKey (the UI
// can key React rows and collapse duplicates) and a machine-readable `actions`
// list. Per-customer debt alerts replace the old per-row spam ("Large
// Outstanding Debt" x N and "Overdue Rental" x N collapses to one per
// customer / one per rental).

export type DashboardAlertType = 'rental_overdue' | 'debt_overdue' | 'debt_large' | 'stock_low';
export type DashboardAlertSeverity = 'critical' | 'warning' | 'info';

export interface DashboardAlert {
  type: DashboardAlertType;
  severity: DashboardAlertSeverity;
  /** Stable identity: 'rental:<id>' | 'debt:<customerId>' | 'large-debt:<customerId>' | 'stock:low'. */
  dedupeKey: string;
  title: string;
  detail: string;
  /** rental_overdue only: days overdue × ratePerDay. */
  fine?: number;
  /** e.g. ['view','call'] | ['collect','view','call'] — UI renders buttons. */
  actions: string[];
}

interface AlertStockCounts {
  outOfStockCount: number;
  lowStockCount: number;
}

interface AlertCustomerRow {
  customerId: string;
  name: string;
  owes: number;
  lifetimeSpend: number;
  highRisk: boolean;
}

async function fetchOverdueRentals(storeId: string, now: Date) {
  return db.equipmentRental.findMany({
    where: {
      storeId,
      OR: [{ status: 'OVERDUE' }, { status: 'ACTIVE', expectedReturnDate: { lt: now } }],
    },
    select: {
      id: true,
      expectedReturnDate: true,
      ratePerDay: true,
      product: { select: { name: true } },
      customer: { select: { name: true } },
    },
    orderBy: { expectedReturnDate: 'asc' },
    take: 5,
  });
}

/** DebtLedger rows 30+ days past due, grouped PER CUSTOMER (one alert each). */
async function fetchOldDebtByCustomer(storeId: string, now: Date) {
  const rows = await db.debtLedger.findMany({
    where: {
      storeId,
      dueDate: { lt: new Date(now.getTime() - 30 * DAY_MS) },
      status: { in: [...OUTSTANDING_DEBT_STATUSES] },
      balance: { gt: 0 },
    },
    select: {
      balance: true,
      customerId: true,
      customer: { select: { name: true } },
    },
  });

  const byCustomer = new Map<string, { name: string; count: number; total: ReturnType<typeof toDec> }>();
  for (const row of rows) {
    const entry = byCustomer.get(row.customerId);
    if (entry) {
      entry.count += 1;
      entry.total = entry.total.plus(toDec(row.balance));
    } else {
      byCustomer.set(row.customerId, {
        name: row.customer.name,
        count: 1,
        total: toDec(row.balance),
      });
    }
  }
  return Array.from(byCustomer.entries())
    .map(([customerId, e]) => ({ customerId, name: e.name, count: e.count, total: round2(e.total) }))
    .sort((a, b) => b.total - a.total);
}

const SEVERITY_ORDER: Record<DashboardAlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const ALERT_CAP = 12;
const LARGE_DEBT_THRESHOLD = 100_000;

/**
 * Build the deduplicated alert feed. Input blocks are pre-fetched/shared:
 * `riskCustomers` comes from buildDebtCrisis (no second debt scan),
 * `stockCounts` from buildLowStockCounts. The two bespoke queries (rentals,
 * old debts) are each fault-isolated — a failure drops only that slice.
 */
export async function buildAlerts(
  storeId: string,
  riskCustomers: AlertCustomerRow[],
  stockCounts: AlertStockCounts,
  now: Date = new Date(),
): Promise<DashboardAlert[]> {
  const alerts: DashboardAlert[] = [];

  // (a) Overdue rentals — top 5 by days overdue, one alert per rental.
  await safeInvoke('overdue rentals', null, async () => {
    const rentals = await fetchOverdueRentals(storeId, now);
    for (const rental of rentals) {
      const days = Math.max(0, Math.floor((now.getTime() - rental.expectedReturnDate.getTime()) / DAY_MS));
      alerts.push({
        type: 'rental_overdue',
        severity: 'warning',
        dedupeKey: `rental:${rental.id}`,
        title: `Overdue rental: ${rental.product.name} — ${rental.customer.name}`,
        detail: `${days} days overdue`,
        fine: round2(toDec(days).mul(toDec(rental.ratePerDay))),
        actions: ['view', 'call'],
      });
    }
    return null;
  });

  // (b) Debt payments 30+ days overdue — ONE alert per customer.
  await safeInvoke('overdue debts', null, async () => {
    const oldDebts = await fetchOldDebtByCustomer(storeId, now);
    for (const debt of oldDebts) {
      alerts.push({
        type: 'debt_overdue',
        severity: 'critical',
        dedupeKey: `debt:${debt.customerId}`,
        title: `Debt 30+ days overdue: ${debt.name}`,
        detail: `${debt.count} unpaid bill${debt.count === 1 ? '' : 's'} · ${fmtKsh(debt.total)}`,
        actions: ['collect', 'view', 'call'],
      });
    }
    return null;
  });

  // (c) Large outstanding debt — one per customer above the threshold.
  for (const customer of riskCustomers) {
    if (customer.owes <= LARGE_DEBT_THRESHOLD) continue;
    alerts.push({
      type: 'debt_large',
      severity: customer.highRisk ? 'critical' : 'warning',
      dedupeKey: `large-debt:${customer.customerId}`,
      title: `Large outstanding debt: ${customer.name}`,
      detail: `Owes ${fmtKsh(customer.owes)}${customer.lifetimeSpend > 0 ? ` · lifetime spend ${fmtKsh(customer.lifetimeSpend)}` : ''}`,
      actions: ['collect', 'view', 'call'],
    });
  }

  // (d) Low stock — ONE grouped summary alert.
  if (stockCounts.outOfStockCount + stockCounts.lowStockCount > 0) {
    alerts.push({
      type: 'stock_low',
      severity: stockCounts.outOfStockCount > 0 ? 'warning' : 'info',
      dedupeKey: 'stock:low',
      title: 'Stock levels need attention',
      detail: `${stockCounts.outOfStockCount} out of stock, ${stockCounts.lowStockCount} low`,
      actions: ['view'],
    });
  }

  return alerts
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, ALERT_CAP);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. STORE HEALTH  (response field: `storeHealth`)
// ════════════════════════════════════════════════════════════════════════════
//
// Transparent weighted score — the UI can show the formula because every
// sub-score and its weight are returned:
//   overall = 0.30×revenue + 0.25×stock + 0.25×debt + 0.20×engagement
//
// Engagement is ATV-AWARE (client-corrected): 6 sales @ Ksh 86,115 ATV scores
// ~80, not 12 — a hardware store lives on few-but-large tickets.

export interface StoreHealthBreakdownItem {
  key: 'revenue' | 'stock' | 'debt' | 'engagement';
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface StoreHealthSummary {
  overall: number;
  label: 'Good' | 'Fair' | 'At Risk';
  weights: { revenue: number; stock: number; debt: number; engagement: number };
  breakdown: StoreHealthBreakdownItem[];
}

export interface StoreHealthContext {
  todayRevenue: number;
  todayTransactions: number;
  averageTransactionValue: number;
  stockHealthy: number;
  stockTotal: number;
}

async function fetchNetRevenueAggregate(storeId: string, since: Date, until?: Date) {
  const agg = await db.salesTransaction.aggregate({
    where: {
      storeId,
      createdAt: until ? { gte: since, lt: until } : { gte: since },
      transactionType: 'SALE',
      paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
    },
    _sum: { totalAmount: true, taxAmount: true },
  });
  return toDec(agg._sum.totalAmount).minus(toDec(agg._sum.taxAmount));
}

export async function buildStoreHealth(
  storeId: string,
  ctx: StoreHealthContext,
  outstandingTotal: number,
  now: Date = new Date(),
): Promise<StoreHealthSummary> {
  const fallback: StoreHealthSummary = {
    overall: 0,
    label: 'At Risk',
    weights: { revenue: 30, stock: 25, debt: 25, engagement: 20 },
    breakdown: [],
  };
  return safeInvoke<StoreHealthSummary>('store health', fallback, async () => {
    const todayStart = startOfLocalDay(now);
    const prior30Start = new Date(todayStart.getTime() - 30 * DAY_MS);

    // 30-day baseline EXCLUDING today (revenue score denominator) and the
    // rolling 30-day window INCLUDING today (debt score denominator).
    const [prior30Net, last30Net] = await Promise.all([
      fetchNetRevenueAggregate(storeId, prior30Start, todayStart),
      fetchNetRevenueAggregate(storeId, prior30Start),
    ]);

    const avg30d = prior30Net.div(30).toNumber();
    const revenueScore =
      avg30d > 0 ? Math.min(100, Math.round((ctx.todayRevenue / avg30d) * 100)) : 0;

    const stockTotal = ctx.stockTotal;
    const stockScore =
      stockTotal > 0 ? Math.round((ctx.stockHealthy / stockTotal) * 100) : 0;

    const last30Revenue = round2(last30Net);
    const debtScore = Math.max(
      0,
      100 - Math.round((outstandingTotal / Math.max(last30Revenue, 1)) * 100),
    );

    // ATV-aware engagement: half the score from ticket count (target 10/day),
    // half from average ticket value (target Ksh 20,000).
    const txnsComponent = Math.min(1, ctx.todayTransactions / 10);
    const atvComponent = Math.min(1, ctx.averageTransactionValue / 20_000);
    const engagementScore = Math.round(50 * txnsComponent + 50 * atvComponent);

    const overall = Math.round(
      0.30 * revenueScore + 0.25 * stockScore + 0.25 * debtScore + 0.20 * engagementScore,
    );

    const breakdown: StoreHealthBreakdownItem[] = [
      {
        key: 'revenue',
        label: 'Revenue vs 30-day average',
        score: revenueScore,
        weight: 30,
        detail: `Today ${fmtKsh(ctx.todayRevenue)} vs 30-day avg ${fmtKsh(avg30d)}/day`,
      },
      {
        key: 'stock',
        label: 'Stock health',
        score: stockScore,
        weight: 25,
        detail: `${ctx.stockHealthy} of ${stockTotal} products above reorder level`,
      },
      {
        key: 'debt',
        label: 'Debt burden',
        score: debtScore,
        weight: 25,
        detail: `Outstanding ${fmtKsh(outstandingTotal)} vs 30-day revenue ${fmtKsh(last30Revenue)}`,
      },
      {
        key: 'engagement',
        label: 'Counter engagement',
        score: engagementScore,
        weight: 20,
        detail: `${ctx.todayTransactions} txns · ${fmtKsh(ctx.averageTransactionValue)} avg sale`,
      },
    ];

    return {
      overall,
      label: overall >= 80 ? 'Good' : overall >= 60 ? 'Fair' : 'At Risk',
      weights: { revenue: 30, stock: 25, debt: 25, engagement: 20 },
      breakdown,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 7-DAY REVENUE TREND  (response field: `revenueTrend7d`)
// ════════════════════════════════════════════════════════════════════════════

export interface RevenueTrendDay {
  /** ISO date (local midnight) — e.g. '2026-10-01T00:00:00.000Z' semantics preserved via toISOString of local midnight. */
  date: string;
  /** Human label, e.g. 'Wed 1'. */
  label: string;
  /** NET (VAT-exclusive) revenue for the day. */
  revenue: number;
  isToday: boolean;
}

export interface RevenueTrend7d {
  days: RevenueTrendDay[];
  /** Median of the PRIOR 6 days (today excluded). */
  forecast: number;
  forecastMethod: string;
  todayIsOutlier: boolean;
  peakHour: { hour: string; amount: number } | null;
  /** e.g. 'Bulk sale — Ksh 341,862 at 2 PM' (only when the peak hour carries > 50% of today's revenue). */
  peakNote: string | null;
}

const EMPTY_TREND: RevenueTrend7d = {
  days: [],
  forecast: 0,
  forecastMethod: 'median of previous 6 days',
  todayIsOutlier: false,
  peakHour: null,
  peakNote: null,
};

/** Local calendar-day key, e.g. '2026-10-07'. */
const localDateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function buildRevenueTrend(
  storeId: string,
  todayRevenue: number,
  hourly: Array<{ hour: string; amount: number }>,
  now: Date = new Date(),
): Promise<RevenueTrend7d> {
  return safeInvoke<RevenueTrend7d>('revenue trend', EMPTY_TREND, async () => {
    const todayStart = startOfLocalDay(now);
    const trendStart = new Date(todayStart.getTime() - 6 * DAY_MS);

    const txs = await db.salesTransaction.findMany({
      where: {
        storeId,
        createdAt: { gte: trendStart },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      select: { createdAt: true, totalAmount: true, taxAmount: true },
    });

    const byDay = new Map<string, ReturnType<typeof toDec>>();
    for (const tx of txs) {
      const key = localDateKey(new Date(tx.createdAt));
      const net = toDec(tx.totalAmount).minus(toDec(tx.taxAmount));
      const entry = byDay.get(key);
      if (entry) byDay.set(key, entry.plus(net));
      else byDay.set(key, net);
    }

    const todayKey = localDateKey(now);
    const days: RevenueTrendDay[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(todayStart.getTime() - i * DAY_MS);
      const key = localDateKey(dayStart);
      days.push({
        date: dayStart.toISOString(),
        label: `${WEEKDAY_SHORT[dayStart.getDay()]} ${dayStart.getDate()}`,
        revenue: round2(byDay.get(key) ?? toDec(0)),
        isToday: key === todayKey,
      });
    }

    // Forecast: median of the PRIOR 6 days (today excluded). 6 values → mean
    // of the 3rd and 4th sorted values.
    const prior = days.filter((d) => !d.isToday).map((d) => d.revenue).sort((a, b) => a - b);
    const mid = prior.length / 2;
    const forecast = round2((prior[mid - 1] + prior[mid]) / 2);
    const todayIsOutlier = todayRevenue > 3 * forecast;

    // Peak hour from the existing 24-bucket hourly series.
    const peak = hourly.reduce<{ hour: string; amount: number } | null>(
      (best, cur) => (best === null || cur.amount > best.amount ? cur : best),
      null,
    );
    const peakHour =
      peak && peak.amount > 0 ? { hour: peak.hour, amount: round2(peak.amount) } : null;
    const peakNote =
      peakHour && todayRevenue > 0 && peakHour.amount > 0.5 * todayRevenue
        ? `Bulk sale — ${fmtKsh(peakHour.amount)} at ${hourLabel(peakHour.hour)}`
        : null;

    return {
      days,
      forecast,
      forecastMethod: 'median of previous 6 days',
      todayIsOutlier,
      peakHour,
      peakNote,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 6. LOW-STOCK PRECISE COUNTS  (response fields: outOfStockCount, lowStockCount)
// ════════════════════════════════════════════════════════════════════════════

export interface LowStockCounts {
  outOfStockCount: number;
  lowStockCount: number;
}

const EMPTY_STOCK_COUNTS: LowStockCounts = { outOfStockCount: 0, lowStockCount: 0 };

/**
 * Two PRECISE counts (replaces the capped findMany-length that froze at 20):
 *   outOfStock: quantityInStock ≤ 0
 *   lowStock:   0 < quantityInStock ≤ reorderLevel  (per-product field ref)
 */
export async function buildLowStockCounts(storeId: string): Promise<LowStockCounts> {
  return safeInvoke<LowStockCounts>('low stock counts', EMPTY_STOCK_COUNTS, async () => {
    const [outOfStockCount, lowStockCount] = await Promise.all([
      db.product.count({
        where: { storeId, isActive: true, quantityInStock: { lte: 0 } },
      }),
      db.product.count({
        where: {
          storeId,
          isActive: true,
          quantityInStock: { gt: 0, lte: db.product.fields.reorderLevel },
        },
      }),
    ]);
    return { outOfStockCount, lowStockCount };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 7. ACTIVITY SANITIZER  (response field: `recentActivities`)
// ════════════════════════════════════════════════════════════════════════════
//
// Fixes data leakage: raw ids ('cmuybs1mo000yyg0cgn02uwmn') and internal
// action strings ('CREATE SalesTransaction/cmuy...') never reach the client.
// Every emitted message passes stripSensitiveTokens; metadata is returned
// only when it contains NO id-shaped value; the actor's user id is dropped.

export interface SanitizedActivity {
  id: string;
  action: string;
  component: string;
  severity: string;
  /** Sanitized legacy message (id tokens stripped). */
  message: string;
  /** Parsed metadata — null when any value is id-shaped. */
  metadata: Record<string, unknown> | null;
  /** Human-readable, leak-free line for the UI. */
  displayMessage: string;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
  /** Legacy nested user — id DROPPED (was a leaking cuid). */
  user: { name: string; role: string } | null;
}

interface ActivityRow {
  id: string;
  action: string;
  component: string;
  severity: string;
  message: string;
  metadata: string | null;
  createdAt: Date;
  user: { name: string; role: string } | null;
}

/** Whole-value id shapes (cuid / cuid2 / uuid) for metadata gating. */
const ID_VALUE_SHAPE = /^[a-z0-9]{20,}$/i;
const UUID_VALUE_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Substring id shapes for message stripping. */
const UUID_SUBSTR = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CUID_SUBSTR = /[a-z0-9]{20,}/gi;

/** Remove every uuid / 20+-char alphanumeric (cuid-shaped) token. */
function stripSensitiveTokens(input: string): string {
  if (!input) return '';
  return input
    .replace(UUID_SUBSTR, ' ')
    .replace(CUID_SUBSTR, ' ')
    // Separators left behind by 'Entity/<id>' patterns ('SalesTransaction/ ').
    .replace(/[/|]+(?=\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hasIdShapedValue(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return ID_VALUE_SHAPE.test(trimmed) || UUID_VALUE_SHAPE.test(trimmed);
  }
  if (Array.isArray(value)) return value.some((v) => hasIdShapedValue(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((v) => hasIdShapedValue(v, depth + 1));
  }
  return false;
}

function parseMetadataSafe(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (hasIdShapedValue(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Raw parse (NO id gating) — used ONLY to read display fields
 *  (receiptNumber/amount/paymentMethod) for buildDisplayMessage. Id-bearing
 *  metadata is never RETURNED; parseMetadataSafe gates the response copy. */
function parseMetadataRaw(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MPESA: 'M-Pesa',
  DEBT: 'Debt',
  SPLIT: 'Split',
  GIFT_CARD: 'Gift card',
};

const displayPaymentMethod = (method: string): string =>
  PAYMENT_METHOD_LABELS[method] ?? method;

/** Entity detection order matters: specific multi-word patterns first. */
const ENTITY_LOOKUPS: Array<[RegExp, string]> = [
  [/sales?transaction|transaction|receipt|checkout/i, 'Sale'],
  [/product/i, 'Product'],
  [/customer/i, 'Customer'],
  [/expense/i, 'Expense'],
  [/invoice/i, 'Invoice'],
  [/quotation/i, 'Quotation'],
  [/proforma/i, 'Proforma'],
  [/credit.?note/i, 'Credit note'],
  [/debit.?note/i, 'Debit note'],
  [/delivery.?note/i, 'Delivery note'],
  [/purchase.?order/i, 'Purchase order'],
  [/rental/i, 'Rental'],
  [/shift/i, 'Shift'],
  [/stock|inventory/i, 'Stock'],
  [/transfer/i, 'Transfer'],
  [/debt/i, 'Debt'],
  [/voucher/i, 'Voucher'],
  [/gift.?card/i, 'Gift card'],
  [/payment|mpesa/i, 'Payment'],
  [/login|logout|session|user/i, 'User'],
  [/backup|restore|snapshot/i, 'Backup'],
  [/reminder/i, 'Debt reminder'],
  [/etims/i, 'eTIMS invoice'],
  [/report|export/i, 'Report'],
  [/store|branch/i, 'Store'],
];

const COMPONENT_ENTITY: Record<string, string> = {
  POS: 'Sale',
  INVENTORY: 'Product',
  FINANCIAL: 'Financial record',
  AUTH: 'User',
  PAYMENT: 'Payment',
  RENTAL: 'Rental',
  SYSTEM: 'System setting',
  API: 'API resource',
  AUDIT: 'Audit entry',
};

const VERB_LOOKUPS: Array<[RegExp, string]> = [
  [/\bCREATE\b|\bNEW\b/i, 'created'],
  [/\bUPDATE\b|\bEDIT\b/i, 'updated'],
  [/\bDELETE\b|\bREMOVE\b|\bVOID\b/i, 'deleted'],
  [/\bEXPORT\b|\bDOWNLOAD\b/i, 'exported'],
  [/\bIMPORT\b/i, 'imported'],
  [/\bOVERRIDE\b|\bAPPROVE\b/i, 'override approved'],
  [/\bDENIED\b|\bREJECTED\b|\bBLOCKED\b|\bEXCEEDED\b/i, 'blocked'],
];

const ACTION_OVERRIDES: Array<[RegExp, string]> = [
  [/^LOGIN$|USER_LOGIN|LOGIN_SUCCESS/i, 'User logged in'],
  [/LOGOUT/i, 'User logged out'],
  [/DEBT_OVERRIDE/i, 'Debt block override approved'],
];

/** Humanize 'DEBT_REMINDERS_SCHEDULED' → 'Debt reminders scheduled'. */
function humanizeTokens(action: string): string {
  const words = action
    .split(/[_\s]+/)
    .flatMap((w) => w.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/))
    .filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
}

function detectEntity(action: string, component: string): string {
  for (const [pattern, entity] of ENTITY_LOOKUPS) {
    if (pattern.test(action)) return entity;
  }
  // Exact component match beats the pattern scan ('INVENTORY' → 'Product').
  const componentEntity = COMPONENT_ENTITY[component.toUpperCase()];
  if (componentEntity) return componentEntity;
  for (const [pattern, entity] of ENTITY_LOOKUPS) {
    if (pattern.test(component)) return entity;
  }
  return 'Record';
}

function humanizeAction(action: string, component: string): string {
  for (const [pattern, label] of ACTION_OVERRIDES) {
    if (pattern.test(action)) return label;
  }

  const entity = detectEntity(action, component);

  if (/LOGOUT/i.test(action)) return 'User logged out';
  if (/LOGIN/i.test(action)) return 'User logged in';

  for (const [pattern, verb] of VERB_LOOKUPS) {
    if (pattern.test(action)) return `${entity} ${verb}`;
  }

  // Date/range/report-style actions read better token-humanized.
  const tokenized = humanizeTokens(action);
  return tokenized || `${entity} activity`;
}

/** A raw log message may be shown as-is when it reads like prose — never
 *  when it is an internal 'CREATE SalesTransaction/<id>' style dump. */
function looksLikeProse(sanitized: string): boolean {
  if (!sanitized) return false;
  const words = sanitized.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  if (/^(CREATE|UPDATE|DELETE|REMOVE|UPSERT|GET|POST)\b/i.test(sanitized)) return false;
  return /[a-z]/.test(sanitized);
}

function buildDisplayMessage(row: ActivityRow, sanitizedMessage: string): string {
  // 1. Metadata first — receipt-bearing rows become sale lines
  //    ('Sale MBM-9D042 created · Ksh 86,270 · Cash'). Raw parse: the
  //    display fields are safe even when other metadata values are ids.
  const meta = parseMetadataRaw(row.metadata);
  const receipt = meta?.receiptNumber;
  if (typeof receipt === 'string' && receipt.trim()) {
    const parts = [`Sale ${receipt.trim()} created`];
    const amount = meta?.amount;
    if (amount !== undefined && amount !== null && Number.isFinite(Number(amount))) {
      parts.push(`Ksh ${Number(amount).toLocaleString('en-KE')}`);
    }
    const method = meta?.paymentMethod;
    if (typeof method === 'string' && method) parts.push(displayPaymentMethod(method));
    return stripSensitiveTokens(parts.join(' · '));
  }

  // 2. Raw message when it reads like human prose.
  if (looksLikeProse(sanitizedMessage)) return sanitizedMessage;

  // 3. Humanized action + component lookup ('Sale created', 'User logged in').
  return stripSensitiveTokens(humanizeAction(row.action, row.component));
}

/**
 * Map a SystemLog row to a leak-free dashboard activity. The legacy fields
 * (action/component/severity/message/metadata/user) are preserved for the
 * current widgets — message stripped, metadata gated, user id dropped.
 */
export function sanitizeActivity(row: ActivityRow): SanitizedActivity {
  const sanitizedMessage = stripSensitiveTokens(row.message ?? '');
  const meta = parseMetadataSafe(row.metadata);
  return {
    id: row.id,
    action: row.action,
    component: row.component,
    severity: row.severity,
    message: sanitizedMessage,
    metadata: meta,
    displayMessage: buildDisplayMessage(row, sanitizedMessage),
    actorName: row.user?.name ?? null,
    actorRole: row.user?.role ?? null,
    createdAt: row.createdAt.toISOString(),
    user: row.user ? { name: row.user.name, role: row.user.role } : null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ════════════════════════════════════════════════════════════════════════════

export interface DashboardInsightsContext extends StoreHealthContext {
  /** Today's NET debt-tender revenue (route computes once, shared). */
  todayDebtSales: number;
  /** The route's 24-bucket hourly series (shared for the peak-hour note). */
  hourly: Array<{ hour: string; amount: number }>;
}

export interface DashboardInsights {
  shift: ShiftSnapshot | null;
  debtCrisis: DebtCrisisSummary;
  alerts: DashboardAlert[];
  alertsCount: number;
  storeHealth: StoreHealthSummary;
  revenueTrend7d: RevenueTrend7d;
  outOfStockCount: number;
  lowStockCount: number;
}

/**
 * Build every v2.12.0 dashboard insight block in parallel. Each block is
 * fault-isolated: a failure degrades that block only — the orchestrator
 * (and therefore GET /api/dashboard) never throws.
 */
export async function buildDashboardInsights(
  storeId: string,
  ctx: DashboardInsightsContext,
  now: Date = new Date(),
): Promise<DashboardInsights> {
  const [shift, debt, stockCounts, trend] = await Promise.all([
    buildShiftSnapshot(storeId, now),
    buildDebtCrisis(storeId, ctx.todayDebtSales, ctx.todayRevenue),
    buildLowStockCounts(storeId),
    buildRevenueTrend(storeId, ctx.todayRevenue, ctx.hourly, now),
  ]);

  const [alerts, storeHealth] = await Promise.all([
    buildAlerts(storeId, debt.riskCustomers, stockCounts, now),
    buildStoreHealth(storeId, ctx, debt.summary.outstandingTotal, now),
  ]);

  return {
    shift,
    debtCrisis: debt.summary,
    alerts,
    alertsCount: alerts.length,
    storeHealth,
    revenueTrend7d: trend,
    outOfStockCount: stockCounts.outOfStockCount,
    lowStockCount: stockCounts.lowStockCount,
  };
}
