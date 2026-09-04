// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Analytics utility helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// Pure, framework-agnostic helpers used by both the analytics API routes
// (server-side aggregation) and the analytics dashboard components
// (client-side chart shaping). Keeping these pure makes them trivial to test
// and lets the same code run in both runtimes.
//
// All functions are defensive: they never throw on bad input — they return
// empty arrays / zero values so the UI can render "No data" placeholders
// instead of crashing on a cold store with no transactions.

import type { SalesTransaction } from '@prisma/client';
// FINANCIAL MATH AUDIT (Task 12-b): Prisma Decimal valueOf() returns a STRING —
// all bucket accumulation flows through toDec() and emits 2dp HALF_UP numbers
// via round2() at the bucket boundary. Revenue basis is NET of VAT
// (totalAmount − taxAmount) per the uniform revenue policy.
import { toDec, round2 } from '@/lib/utils/financialMath';

// ── Types ────────────────────────────────────────────────────────────────────

export type AnalyticsPeriod = 'today' | 'week' | 'month' | 'year';

export interface TransactionSlice {
  id: string;
  createdAt: Date | string;
  /** Tax-INCLUSIVE gross total (as stored). */
  totalAmount: number;
  /** VAT component of totalAmount. Optional for legacy callers (defaults 0 → gross == net). */
  taxAmount?: number;
  paymentMethod: string;
  paymentStatus: string;
  transactionType: string;
}

export interface AggregatedBucket {
  /** Sortable ISO key (e.g. "2026-05-26" or "2026-05-26T08" for hourly). */
  key: string;
  /** Human-readable label for the chart axis. */
  label: string;
  /** Total NET (VAT-exclusive) revenue in the bucket (sum of totalAmount − taxAmount). */
  revenue: number;
  /** Number of completed/partial transactions in the bucket. */
  transactions: number;
  /** Average order value = revenue / transactions (0 when no transactions). */
  avgOrderValue: number;
  /** Sum of all sale-item quantities in the bucket (if provided). */
  itemsSold: number;
  /** Raw Date for the bucket start (used for sorting). */
  date: Date;
}

export interface KPIDelta {
  current: number;
  previous: number;
  /** Percentage change vs previous period. `null` when previous is 0 and current is 0. */
  changePercent: number | null;
  /** Direction indicator derived from changePercent. */
  direction: 'up' | 'down' | 'neutral';
}

export interface KPIResult {
  todayRevenue: KPIDelta;
  transactions: KPIDelta;
  averageOrderValue: KPIDelta;
  newCustomers: KPIDelta;
  lowStockCount: KPIDelta;
  pendingOrders: KPIDelta;
}

export interface HeatmapCell {
  day: number; // 0 = Sunday ... 6 = Saturday
  hour: number; // 0..23
  /** NET (VAT-exclusive) revenue for the cell. */
  revenue: number;
  transactions: number;
}

export interface HeatmapMatrix {
  /** 7 rows × 24 cols. Access as matrix[day][hour]. */
  cells: HeatmapCell[][];
  /** Maximum revenue value across all cells (used for color intensity scaling). */
  maxValue: number;
  /** Total NET (VAT-exclusive) revenue across all cells. */
  totalRevenue: number;
}

export interface PeakHour {
  day: number;
  hour: number;
  revenue: number;
  transactions: number;
}

export interface ChartPoint {
  label: string;
  value: number;
  [key: string]: string | number;
}

// ── Period helpers ───────────────────────────────────────────────────────────

interface PeriodWindow {
  start: Date;
  end: Date;
  /** Bucket size: 'hour' for today, 'day' otherwise. */
  bucket: 'hour' | 'day';
  /** Number of buckets to emit (used to fill empty buckets with zeros). */
  bucketCount: number;
  /** Function to produce a sortable ISO key + label from a Date. */
  keyOf: (d: Date) => { key: string; label: string };
  /** Step function — advance a Date by one bucket. */
  step: (d: Date) => Date;
}

/**
 * Compute the [start, end] window for an analytics period. The "today" period
 * uses hourly buckets; week/month/year use daily buckets.
 */
export function getPeriodWindow(period: AnalyticsPeriod, now: Date = new Date()): PeriodWindow {
  const end = new Date(now);
  end.setMilliseconds(0);

  switch (period) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return {
        start,
        end,
        bucket: 'hour',
        bucketCount: 24,
        keyOf: (d) => ({
          key: `h${String(d.getHours()).padStart(2, '0')}`,
          label: `${String(d.getHours()).padStart(2, '0')}:00`,
        }),
        step: (d) => new Date(d.getTime() + 60 * 60 * 1000),
      };
    }
    case 'week': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 6); // last 7 days including today
      return {
        start,
        end,
        bucket: 'day',
        bucketCount: 7,
        keyOf: (d) => ({
          key: d.toISOString().slice(0, 10),
          label: d.toLocaleDateString('en-KE', { weekday: 'short' }),
        }),
        step: (d) => new Date(d.getTime() + 24 * 60 * 60 * 1000),
      };
    }
    case 'month': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 29); // last 30 days
      return {
        start,
        end,
        bucket: 'day',
        bucketCount: 30,
        keyOf: (d) => ({
          key: d.toISOString().slice(0, 10),
          label: d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }),
        }),
        step: (d) => new Date(d.getTime() + 24 * 60 * 60 * 1000),
      };
    }
    case 'year':
    default: {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setMonth(start.getMonth() - 11); // last 12 months
      start.setDate(1);
      return {
        start,
        end,
        bucket: 'day',
        bucketCount: 12,
        keyOf: (d) => ({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label: d.toLocaleDateString('en-KE', { month: 'short', year: '2-digit' }),
        }),
        step: (d) => {
          const n = new Date(d);
          n.setMonth(n.getMonth() + 1);
          return n;
        },
      };
    }
  }
}

/**
 * Returns the equivalent previous window for a period — used to compute
 * comparison deltas (e.g. "this week vs last week").
 */
export function getPreviousPeriodWindow(period: AnalyticsPeriod, now: Date = new Date()): PeriodWindow {
  const current = getPeriodWindow(period, now);
  const durationMs = current.end.getTime() - current.start.getTime();
  const prevEnd = new Date(current.start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { ...current, start: prevStart, end: prevEnd };
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Group a list of transactions into time buckets for the requested period.
 *
 * - For "today" → 24 hourly buckets (00:00 .. 23:00)
 * - For "week"/"month" → daily buckets
 * - For "year" → 12 monthly buckets
 *
 * Empty buckets are filled with zeros so the chart shows continuous time.
 */
export function aggregateSalesByPeriod(
  transactions: TransactionSlice[],
  period: AnalyticsPeriod,
  now: Date = new Date(),
): AggregatedBucket[] {
  if (!Array.isArray(transactions)) return [];

  const window = getPeriodWindow(period, now);

  // Seed all buckets with zeros so empty periods still render.
  const buckets = new Map<string, AggregatedBucket>();
  // Task 12-b: revenue accumulated in Decimal per bucket (net of VAT),
  // rounded to 2dp HALF_UP only at emit.
  const revenueByBucket = new Map<string, ReturnType<typeof toDec>>();
  let cursor = new Date(window.start);
  for (let i = 0; i < window.bucketCount; i++) {
    const { key, label } = window.keyOf(cursor);
    buckets.set(key, {
      key,
      label,
      revenue: 0,
      transactions: 0,
      avgOrderValue: 0,
      itemsSold: 0,
      date: new Date(cursor),
    });
    revenueByBucket.set(key, toDec(0));
    cursor = window.step(cursor);
    if (cursor.getTime() > window.end.getTime() + 1) break;
  }

  // Fold each transaction into its bucket.
  for (const tx of transactions) {
    const d = new Date(tx.createdAt);
    if (d < window.start || d > window.end) continue;
    const { key } = window.keyOf(d);
    const b = buckets.get(key);
    if (!b) continue;
    // NET revenue = totalAmount − taxAmount (VAT belongs to KRA, not revenue).
    const net = toDec(tx.totalAmount).minus(toDec(tx.taxAmount));
    revenueByBucket.set(key, (revenueByBucket.get(key) || toDec(0)).plus(net));
    b.transactions += 1;
  }

  // Emit rounded revenue + AOV per bucket (2dp HALF_UP).
  for (const [key, b] of buckets) {
    const rev = revenueByBucket.get(key) || toDec(0);
    b.revenue = round2(rev);
    b.avgOrderValue = b.transactions > 0 ? round2(rev.div(b.transactions)) : 0;
  }

  return Array.from(buckets.values());
}

// ── KPI calculation ──────────────────────────────────────────────────────────

/**
 * Compute percentage delta between two values.
 * - Returns `null` when both values are 0 (no meaningful change).
 * - Returns `100` when previous is 0 and current > 0 (treat as infinite growth capped at 100%).
 */
export function computeDelta(current: number, previous: number): KPIDelta {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  let changePercent: number | null;
  if (p === 0) {
    changePercent = c > 0 ? 100 : 0;
  } else {
    changePercent = ((c - p) / p) * 100;
  }
  let direction: KPIDelta['direction'] = 'neutral';
  if (changePercent === null) {
    direction = 'neutral';
  } else if (changePercent > 0.5) {
    direction = 'up';
  } else if (changePercent < -0.5) {
    direction = 'down';
  }
  return { current: c, previous: p, changePercent, direction };
}

export interface KPIInput {
  todayRevenue: number;
  yesterdayRevenue: number;
  transactions: number;
  prevTransactions: number;
  averageOrderValue: number;
  prevAverageOrderValue: number;
  newCustomers: number;
  prevNewCustomers: number;
  lowStockCount: number;
  prevLowStockCount: number;
  pendingOrders: number;
  prevPendingOrders: number;
}

/**
 * Calculate the 6 dashboard KPIs with deltas vs the comparison period.
 */
export function calculateKPIs(input: KPIInput): KPIResult {
  return {
    todayRevenue: computeDelta(input.todayRevenue, input.yesterdayRevenue),
    transactions: computeDelta(input.transactions, input.prevTransactions),
    averageOrderValue: computeDelta(input.averageOrderValue, input.prevAverageOrderValue),
    newCustomers: computeDelta(input.newCustomers, input.prevNewCustomers),
    lowStockCount: computeDelta(input.lowStockCount, input.prevLowStockCount),
    pendingOrders: computeDelta(input.pendingOrders, input.prevPendingOrders),
  };
}

// ── Chart shaping ────────────────────────────────────────────────────────────

export type ChartFormat = 'area' | 'bar' | 'donut' | 'sparkline';

/**
 * Transform raw aggregation buckets / records into the shape Recharts expects.
 *
 * - 'area' / 'bar' → [{ label, value, ...series }]
 * - 'donut'        → [{ label, value }]
 * - 'sparkline'    → number[] (just the values, in order)
 */
export function formatChartData(
  rawData: Array<{ label?: string; name?: string; value?: number; revenue?: number; [k: string]: unknown }>,
  format: ChartFormat,
): ChartPoint[] | number[] {
  if (!Array.isArray(rawData)) return format === 'sparkline' ? [] : [];

  if (format === 'sparkline') {
    return rawData.map((d) => Number(d.value ?? d.revenue ?? 0));
  }

  return rawData.map((d) => {
    const label = String(d.label ?? d.name ?? '');
    const value = Number(d.value ?? d.revenue ?? 0);
    const point: ChartPoint = { label, value };
    // Pass through any extra series keys (e.g. transactions, avgOrderValue)
    for (const k of Object.keys(d)) {
      if (k === 'label' || k === 'name' || k === 'value' || k === 'revenue') continue;
      const v = d[k];
      if (typeof v === 'number' || typeof v === 'string') {
        point[k] = v;
      }
    }
    return point;
  });
}

/**
 * Build a 7×24 heatmap matrix from raw transactions.
 * Each cell holds the total revenue and transaction count for that
 * (day-of-week, hour-of-day) combination.
 */
export function buildHourlyHeatmap(transactions: TransactionSlice[]): HeatmapMatrix {
  const cells: HeatmapCell[][] = Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => ({
      day,
      hour,
      revenue: 0,
      transactions: 0,
    })),
  );

  // Task 12-b: Decimal accumulators per cell + total; emit 2dp HALF_UP numbers.
  const revenueByCell = new Map<string, ReturnType<typeof toDec>>();
  let totalRevenueDec = toDec(0);

  if (Array.isArray(transactions)) {
    for (const tx of transactions) {
      const d = new Date(tx.createdAt);
      const day = d.getDay();
      const hour = d.getHours();
      // NET revenue = totalAmount − taxAmount (VAT-exclusive basis).
      const net = toDec(tx.totalAmount).minus(toDec(tx.taxAmount));
      const cellKey = `${day}:${hour}`;
      revenueByCell.set(cellKey, (revenueByCell.get(cellKey) || toDec(0)).plus(net));
      cells[day][hour].transactions += 1;
      // Decimal is immutable — plus() returns a NEW instance, so reassign.
      totalRevenueDec = totalRevenueDec.plus(net);
    }
  }

  for (const [cellKey, dec] of revenueByCell) {
    const [day, hour] = cellKey.split(':').map(Number);
    cells[day][hour].revenue = round2(dec);
  }

  let maxValue = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (cells[d][h].revenue > maxValue) maxValue = cells[d][h].revenue;
    }
  }

  return { cells, maxValue, totalRevenue: round2(totalRevenueDec) };
}

/**
 * Identify the top 3 peak (day, hour) combinations by revenue.
 * Used to highlight the busiest times on the heatmap.
 */
export function getPeakHours(heatmap: HeatmapMatrix, topN = 3): PeakHour[] {
  if (!heatmap || !Array.isArray(heatmap.cells)) return [];
  const flat: PeakHour[] = [];
  for (let d = 0; d < heatmap.cells.length; d++) {
    for (let h = 0; h < heatmap.cells[d].length; h++) {
      const c = heatmap.cells[d][h];
      if (c.revenue > 0) {
        flat.push({ day: d, hour: h, revenue: c.revenue, transactions: c.transactions });
      }
    }
  }
  return flat.sort((a, b) => b.revenue - a.revenue).slice(0, topN);
}

// ── Misc utilities ───────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dayName(day: number, full = false): string {
  const i = ((day % 7) + 7) % 7;
  return full ? DAY_NAMES_FULL[i] : DAY_NAMES[i];
}

export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}

/**
 * Convert Prisma SalesTransaction rows to the lighter TransactionSlice shape
 * used by the aggregation helpers. Avoids pulling unneeded fields through the
 * pipeline.
 */
export function toTransactionSlice(tx: SalesTransaction | TransactionSlice): TransactionSlice {
  return {
    id: tx.id,
    createdAt: tx.createdAt,
    totalAmount: toDec(tx.totalAmount).toNumber(),
    // SalesTransaction.taxAmount is Decimal; TransactionSlice.taxAmount is
    // optional number — both land in toDec's Numeric union.
    taxAmount: toDec(tx.taxAmount).toNumber(),
    paymentMethod: tx.paymentMethod,
    paymentStatus: tx.paymentStatus,
    transactionType: tx.transactionType,
  };
}

/**
 * Payment-method color palette used across all analytics charts so the donut,
 * bar, and heatmap legends stay visually consistent.
 */
export const PAYMENT_METHOD_COLORS: Record<string, string> = {
  CASH: '#10b981',
  MPESA: '#f59e0b',
  CARD: '#3b82f6',
  DEBT: '#ef4444',
  SPLIT: '#8b5cf6',
  GIFT_CARD: '#06b6d4',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MPESA: 'M-Pesa',
  CARD: 'Card',
  DEBT: 'Debt',
  SPLIT: 'Split',
  GIFT_CARD: 'Gift Card',
};

/**
 * Returns the color for a payment method, falling back to a chart palette
 * for unknown methods so the UI never renders a transparent slice.
 */
export function paymentMethodColor(method: string, fallbackIndex = 0): string {
  if (PAYMENT_METHOD_COLORS[method]) return PAYMENT_METHOD_COLORS[method];
  const palette = ['#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  return palette[fallbackIndex % palette.length];
}

/**
 * Returns the display label for a payment method, falling back to title-cased
 * raw value so unknown methods still render readably.
 */
export function paymentMethodLabel(method: string): string {
  if (PAYMENT_METHOD_LABELS[method]) return PAYMENT_METHOD_LABELS[method];
  if (!method) return 'Unknown';
  return method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
}

/**
 * Returns a color intensity class (0–4) for a heatmap cell based on its value
 * relative to the max. 0 = empty (lightest), 4 = peak (darkest).
 */
export function heatIntensity(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (max <= 0 || value <= 0) return 0;
  const ratio = value / max;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public task-spec helpers
//
// The functions below are the public API named in the analytics dashboard task
// spec. They wrap the lower-level internal helpers so that existing callers
// (which use the internal names like `getPeriodWindow` / `computeDelta` /
// `formatChartData`) keep working unchanged, while new code can use the
// spec-named versions for clarity.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate the percentage change between a current and previous value.
 *
 * Returns `null` when both values are zero (no meaningful change), `100`
 * when the previous value is zero and current is positive (treated as
 * infinite growth capped at +100%), and the signed percentage otherwise.
 *
 *   calculatePercentageChange(150, 100) → 50
 *   calculatePercentageChange(50, 100)  → -50
 *   calculatePercentageChange(0, 0)     → null
 *   calculatePercentageChange(100, 0)   → 100
 */
export function calculatePercentageChange(
  current: number,
  previous: number,
): number | null {
  return computeDelta(current, previous).changePercent;
}

/**
 * Return the { start, end } Date range for a given analytics period.
 *
 * - today → midnight today .. now
 * - week  → 7 days ago .. now
 * - month → 30 days ago .. now
 * - year  → 12 months ago .. now
 *
 * Thin wrapper around getPeriodWindow so callers that only need the date
 * bounds (and not the bucketing metadata) get a clean two-field return.
 */
export function getPeriodDateRange(
  period: AnalyticsPeriod,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const w = getPeriodWindow(period, now);
  return { start: w.start, end: w.end };
}

/**
 * Prepare raw aggregation rows for Recharts.
 *
 * Accepts an array of objects with `label`/`name` and `value`/`revenue`
 * (plus optional extra numeric series) and returns a normalized array of
 * `{ label, value, ...series }` points ready to feed into a Recharts
 * AreaChart / BarChart / PieChart.
 *
 *   formatTrendData([{ label: 'Mon', revenue: 1000, transactions: 5 }])
 *     → [{ label: 'Mon', value: 1000, transactions: 5 }]
 *
 * Always returns an array (possibly empty) — never throws on bad input.
 */
export function formatTrendData<
  T extends { label?: string; name?: string; value?: number; revenue?: number; [k: string]: unknown },
>(data: T[] | null | undefined): ChartPoint[] {
  if (!Array.isArray(data)) return [];
  return formatChartData(data, 'area') as ChartPoint[];
}
