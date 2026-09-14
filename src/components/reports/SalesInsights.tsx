"use client";
// src/components/reports/SalesInsights.tsx — "Sales Insights" analytics dashboard
// (revenue trends & product performance) fed by GET /api/v1/reports/sales-insights.
// For the OWNER all-branches view a "Branch comparison" section renders below the
// cashier leaderboard: heatmap-tinted revenue/margin cells + revenue share bars.
// The CSV export carries the same per-branch data — a "Branch comparison" section
// (per-branch revenue / orders / avg basket / margin + totals) is appended whenever
// the API returns perBranch rows (all-branches scope only; absent when scoped).
// Palette discipline: emerald / amber / rose / slate / stone ONLY — no indigo,
// blue or purple anywhere. Recharts charts, shadcn/ui chrome.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CreditCard,
  Download,
  Loader2,
  Receipt,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "next-themes";
import type { SessionUser } from "@/lib/types";
import { D, formatKES, round2 } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirror the API contract — money arrives as strings, counts as numbers)
// ─────────────────────────────────────────────────────────────────────────────

interface InsightDelta {
  change: string | number;
  pct: number | null; // null when the previous window was 0 — pct off zero is noise
}

/** One per-branch comparison row (money arrives as 2dp strings). */
interface BranchComparisonRow {
  branchId: string;
  branchName: string;
  revenue: string; // payments received by this branch
  orders: number; // distinct tickets with items in this branch
  avgBasket: string; // revenue ÷ orders ("0.00" when orders = 0)
  estMargin: string; // Σ qty × (unitCost snapshot || product.buyingPrice)
}

interface SalesInsightsData {
  window: { days: number; start: string; end: string };
  branchId: string | null;
  kpis: {
    revenue: string;
    transactions: number;
    avgBasket: string;
    estMargin: string;
    creditOutstanding: string;
    marginBasis: "snapshot" | "estimate" | "mixed" | "none";
    costCoverage: number;
  };
  comparison: {
    window: { days: number; start: string; end: string };
    kpis: {
      revenue: string;
      transactions: number;
      avgBasket: string;
      estMargin: string;
      creditOutstanding: string;
    };
    deltas: {
      revenue: InsightDelta;
      transactions: InsightDelta;
      avgBasket: InsightDelta;
      estMargin: InsightDelta;
      creditOutstanding: InsightDelta;
    };
  };
  daily: Array<{ date: string; revenue: number; orders: number }>;
  topProducts: Array<{ productId: string | null; name: string; qtySold: number; revenue: string }>;
  methods: Array<{ method: string; total: string; count: number }>;
  hourly: Array<{ hour: number; revenue: number; orders: number }>;
  cashiers: Array<{ userId: string; userName: string; revenue: string; orders: number }>;
  perBranch?: BranchComparisonRow[]; // OWNER all-branches view — absent/[] when one branch is scoped
}

export interface SalesInsightsProps {
  session: SessionUser;
  branches: Array<{ id: string; name: string }>;
}

type DaysOption = 7 | 30 | 90;
const DAYS_OPTIONS: DaysOption[] = [7, 30, 90];
const ALL_BRANCHES = "__all__"; // Radix SelectItem forbids literal empty-string values

// Fixed per-method color mapping (brief) — no indigo/blue/purple.
const METHOD_META: Record<string, { label: string; color: string }> = {
  CASH: { label: "Cash", color: "#059669" },
  MPESA: { label: "M-Pesa", color: "#10b981" },
  BANK_TRANSFER: { label: "Bank transfer", color: "#d97706" },
  CARD: { label: "Card", color: "#78716c" },
  STORE_CREDIT: { label: "Store credit", color: "#e11d48" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Nairobi is UTC+3 fixed → shift and take the UTC date key. */
function toNairobiDateKey(ms: number): string {
  return new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** "2025-04-03" → "3 Apr" (chart tick). */
function dayLabel(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** "2025-04-03" → "3 Apr 2025" (window caption). */
function fullDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** Compact KES axis label: 1.2M / 850k / 40. */
function fmtKesShort(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

/** Truncate long product names for the category axis. */
function trunc(s: string, n = 24): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Heatmap tint for a comparison-table cell, scaled by the value's share of the
 * row-set max: ≤33% → emerald-50, ≤66% → emerald-100, >66% → emerald-200.
 * Pure helper; no max (max ≤ 0) → no tint. Emerald-only palette.
 */
function heatClass(value: number, max: number): string {
  if (max <= 0) return "";
  const share = value / max;
  if (share <= 0.33) return "bg-emerald-50 dark:bg-emerald-950/50";
  if (share <= 0.66) return "bg-emerald-100 dark:bg-emerald-900/40";
  return "bg-emerald-200 dark:bg-emerald-800/40";
}

/**
 * Period-over-period delta chip — ▲/▼ with the pct change vs the preceding
 * equal-length window. `goodWhenUp=false` inverts the colors (a falling value
 * is GOOD for credit outstanding). pct=null (previous window empty) renders a
 * muted "new" chip instead of a meaningless % off zero.
 */
function DeltaChip({
  delta,
  goodWhenUp,
  title,
}: {
  delta: InsightDelta;
  goodWhenUp: boolean;
  title: string;
}) {
  const pct = delta.pct;
  if (pct === null) {
    return (
      <span
        className="inline-flex items-center rounded-full bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400"
        title={title}
      >
        new
      </span>
    );
  }
  const up = pct > 0;
  const flat = pct === 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const tone =
    good === null
      ? "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
      : good
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
        : "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}
      title={title}
    >
      {!flat && <Icon className="size-3" aria-hidden />}
      {flat ? "0%" : `${up ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom tooltips (loosely typed against recharts' payload shape)
// ─────────────────────────────────────────────────────────────────────────────

function RevenueTip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: SalesInsightsData["daily"][number] }> }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs shadow-md dark:border-stone-700 dark:bg-stone-800">
      <p className="font-medium text-stone-800 dark:text-stone-200">{dayLabel(p.date)}</p>
      <p className="font-semibold text-emerald-700 dark:text-emerald-400">{formatKES(p.revenue)}</p>
      <p className="text-stone-500 dark:text-stone-400">{p.orders} order{p.orders === 1 ? "" : "s"}</p>
    </div>
  );
}

function HourlyTip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: SalesInsightsData["hourly"][number] }> }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs shadow-md dark:border-stone-700 dark:bg-stone-800">
      <p className="font-medium text-stone-800 dark:text-stone-200">{p.hour}:00–{p.hour}:59</p>
      <p className="font-semibold text-emerald-700 dark:text-emerald-400">{formatKES(p.revenue)}</p>
      <p className="text-stone-500 dark:text-stone-400">{p.orders} order{p.orders === 1 ? "" : "s"}</p>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {/* KPI strip: icon+label, big value, caption + delta-chip lines */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card">
            <div className="space-y-2 p-6 pb-2">
              <div className="flex items-center gap-1.5">
                <Skeleton className="size-4" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-7 w-24" />
            </div>
            <div className="flex items-center justify-between gap-2 p-6 pt-0">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
          </div>
        ))}
      </div>
      {/* Revenue trend area */}
      <div className="rounded-xl border bg-card">
        <div className="space-y-2 p-6 pb-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="p-6 pt-0">
          <Skeleton className="h-[260px] w-full" />
        </div>
      </div>
      {/* Top products (bar field) + payment methods (donut + legend) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card">
          <div className="space-y-2 p-6 pb-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="space-y-3 p-6 pt-0">
            {[88, 74, 62, 50, 38, 28].map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card">
          <div className="space-y-2 p-6 pb-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
          <div className="flex items-center gap-6 p-6 pt-0">
            <Skeleton className="h-44 w-44 rounded-full" />
            <div className="flex-1 space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="size-2.5 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Hourly bar field */}
      <div className="rounded-xl border bg-card">
        <div className="space-y-2 p-6 pb-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-72" />
        </div>
        <div className="flex h-[200px] items-end gap-1.5 p-6 pt-0">
          {[35, 52, 44, 68, 82, 58, 40, 74, 92, 60, 42, 64, 30, 48, 70, 55, 38, 60, 80, 46, 34, 56, 42, 28].map(
            (h, i) => (
              <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
            )
          )}
        </div>
      </div>
      {/* Cashier leaderboard rows */}
      <div className="rounded-xl border bg-card">
        <div className="space-y-2 p-6 pb-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="grid grid-cols-1 gap-3 p-6 pt-0 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <Skeleton className="size-7 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch comparison (OWNER all-branches view) — heatmap-tinted revenue/margin
// cells plus a revenue share bar per branch. Rendered only when 2+ branches
// had tickets in the window (single row / empty → nothing to compare).
// ─────────────────────────────────────────────────────────────────────────────

function BranchComparisonTable({ rows }: { rows: BranchComparisonRow[] }) {
  const totalRevenue = rows.reduce((sum, r) => sum.add(D(r.revenue)), D(0));
  const maxRevenueNum = rows.reduce((m, r) => (D(r.revenue).gt(m) ? D(r.revenue) : m), D(0)).toNumber();
  const maxMarginNum = rows.reduce((m, r) => (D(r.estMargin).gt(m) ? D(r.estMargin) : m), D(0)).toNumber();

  return (
    <Table aria-label="Branch comparison" className="min-w-[640px]">
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs text-stone-500 dark:text-stone-400">Branch</TableHead>
          <TableHead className="text-right text-xs text-stone-500 dark:text-stone-400">Revenue</TableHead>
          <TableHead className="text-right text-xs text-stone-500 dark:text-stone-400">Orders</TableHead>
          <TableHead className="text-right text-xs text-stone-500 dark:text-stone-400">Avg basket</TableHead>
          <TableHead className="text-right text-xs text-stone-500 dark:text-stone-400">Margin</TableHead>
          <TableHead className="w-[160px] text-xs text-stone-500 dark:text-stone-400">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const sharePct =
            totalRevenue.gt(0)
              ? Math.min(100, D(r.revenue).div(totalRevenue).mul(100).toNumber())
              : 0;
          return (
            <TableRow key={r.branchId} className="transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/60">
              <TableCell className="font-medium text-stone-800 dark:text-stone-200">{r.branchName}</TableCell>
              <TableCell
                className={`text-right tabular-nums text-stone-800 dark:text-stone-200 ${heatClass(D(r.revenue).toNumber(), maxRevenueNum)}`}
              >
                {formatKES(r.revenue)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-stone-700 dark:text-stone-300">
                {r.orders.toLocaleString("en-KE")}
              </TableCell>
              <TableCell className="text-right tabular-nums text-stone-700 dark:text-stone-300">
                {formatKES(r.avgBasket)}
              </TableCell>
              <TableCell
                className={`text-right tabular-nums text-stone-800 dark:text-stone-200 ${heatClass(D(r.estMargin).toNumber(), maxMarginNum)}`}
              >
                {formatKES(r.estMargin)}
              </TableCell>
              <TableCell>
                <div
                  className="h-1 w-full rounded-full bg-stone-100 dark:bg-stone-800"
                  role="img"
                  aria-label={`${r.branchName} revenue share: ${sharePct.toFixed(1)}%`}
                  title={`${sharePct.toFixed(1)}% of revenue received across branches`}
                >
                  <div
                    className="h-1 rounded-full bg-emerald-600"
                    style={{ width: `${sharePct}%` }}
                  />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SalesInsights
// ─────────────────────────────────────────────────────────────────────────────

export function SalesInsights({ session, branches }: SalesInsightsProps) {
  const isOwner = session.role === "OWNER";
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  // Theme-aware recharts SVG tokens: grid/axis/tooltip/donut-slice-stroke colors
  // are inline SVG attributes (not CSS classes), so they can't ride Tailwind's
  // dark: variant — they must follow the resolved theme from next-themes.
  // Series colors (emerald/amber/slate/stone) stay fixed — legible on both.
  const chartSkin = isDark
    ? { grid: "#57534e", axis: "#a8a29e", sliceStroke: "#1c1917", tooltipBg: "#1c1917", tooltipBorder: "#44403c", tooltipText: "#fafaf9", cursor: "#57534e" }
    : { grid: "#e7e5e4", axis: "#78716c", sliceStroke: "#ffffff", tooltipBg: "#ffffff", tooltipBorder: "#e7e5e4", tooltipText: "#1c1917", cursor: "#a8a29e" };
  // Skin for the two DEFAULT recharts tooltips (top products + payment methods)
  // — recharts hardcodes a white panel inline, which blindsides dark mode.
  // RevenueTip/HourlyTip are custom components already dark-paired via CSS.
  const tooltipSkin = {
    contentStyle: {
      background: chartSkin.tooltipBg,
      border: `1px solid ${chartSkin.tooltipBorder}`,
      borderRadius: 8,
      fontSize: 12,
      color: chartSkin.tooltipText,
      boxShadow: isDark ? "0 8px 24px rgba(0,0,0,0.45)" : "0 8px 24px rgba(0,0,0,0.08)",
    },
    itemStyle: { color: chartSkin.tooltipText },
    labelStyle: { color: chartSkin.tooltipText, fontWeight: 600, marginBottom: 4 },
  };
  const [days, setDays] = useState<DaysOption>(30);
  const [branchId, setBranchId] = useState<string>(""); // "" = all branches (no param sent)
  const [data, setData] = useState<SalesInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (isOwner && branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/v1/reports/sales-insights?${params.toString()}`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { error?: string }).error ?? `Failed to load insights (${res.status})`);
      }
      if (!ctrl.signal.aborted) setData(json as SalesInsightsData);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") return; // superseded request / unmount
      if (!ctrl.signal.aborted) {
        setData(null);
        setError(err instanceof Error ? err.message : "Failed to load sales insights");
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [days, branchId, isOwner]);

  // Fetch on mount + refetch on days/branch change; abort on unmount/dep change.
  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  function exportCsv() {
    if (!data) return;
    const branchName = data.branchId
      ? (branches.find((b) => b.id === data.branchId)?.name ?? data.branchId)
      : "All branches";
    // Branch comparison — appended only when the API returned perBranch rows
    // (OWNER all-branches view; []/absent when a single branch is scoped).
    // Per-branch money strings pass through VERBATIM (pre-formatted 2dp by the
    // API); totals use Decimal addition (.toFixed(2)) — never float math on money.
    const perBranch = data.perBranch ?? [];
    const branchSection: string[][] = [];
    if (perBranch.length > 0) {
      const revenueTotal = perBranch.reduce((sum, b) => sum.plus(D(b.revenue)), D(0));
      const marginTotal = perBranch.reduce((sum, b) => sum.plus(D(b.estMargin)), D(0));
      const ordersTotal = perBranch.reduce((s, b) => s + b.orders, 0);
      branchSection.push(
        [],
        ["Branch comparison", "revenue = payments received"],
        ["Branch", "Revenue KES", "Orders", "Avg basket KES", "Margin KES"],
        ...perBranch.map(
          (b) => [b.branchName, b.revenue, String(b.orders), b.avgBasket, b.estMargin],
        ),
        [
          "Total",
          revenueTotal.toFixed(2),
          String(ordersTotal),
          ordersTotal > 0 ? round2(revenueTotal.div(ordersTotal)).toFixed(2) : "0.00",
          marginTotal.toFixed(2),
        ],
      );
    }
    const rows: string[][] = [
      ["Mbumah Hardware — Sales Insights", `${data.window.days}-day window`],
      ["Branch", branchName],
      ["Window start", data.window.start],
      ["Window end", data.window.end],
      [],
      ["Date", "Revenue KES", "Orders"],
      ...data.daily.map((d) => [d.date, String(d.revenue), String(d.orders)]),
      [],
      ["KPI", "Value"],
      ["Revenue KES", data.kpis.revenue],
      ["Orders", String(data.kpis.transactions)],
      ["Average basket KES", data.kpis.avgBasket],
      [`Margin KES (${data.kpis.marginBasis})`, data.kpis.estMargin],
      ["Credit outstanding KES", data.kpis.creditOutstanding],
      [],
      ["Period-over-period", `vs previous ${data.window.days}d`],
      ["Revenue KES (previous window)", data.comparison ? data.comparison.kpis.revenue : "n/a"],
      [
        "Orders (previous window)",
        data.comparison ? String(data.comparison.kpis.transactions) : "n/a",
      ],
      [
        "Average basket KES (previous window)",
        data.comparison ? data.comparison.kpis.avgBasket : "n/a",
      ],
      ["Margin KES (previous window)", data.comparison ? data.comparison.kpis.estMargin : "n/a"],
      [
        "Credit outstanding KES (previous window)",
        data.comparison ? data.comparison.kpis.creditOutstanding : "n/a",
      ],
      [
        "Revenue change %",
        data.comparison
          ? data.comparison.deltas.revenue.pct === null
            ? "new"
            : String(data.comparison.deltas.revenue.pct)
          : "n/a",
      ],
      // Branch comparison rows flow into the same BOM + CRLF + quote-escaping path.
      ...branchSection,
    ];
    // BOM + CRLF so Excel opens it cleanly.
    const csv =
      "\uFEFF" +
      rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mbumah-sales-insights-${data.window.days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const d = data;
  const showSkeleton = loading && !d && !error;

  // ── Derived chart data ─────────────────────────────────────────────────────
  const startKey = d ? toNairobiDateKey(new Date(d.window.start).getTime()) : "";
  const endKey = d ? toNairobiDateKey(new Date(d.window.end).getTime()) : "";
  const branchLabel = d
    ? d.branchId
      ? (branches.find((b) => b.id === d.branchId)?.name ?? "Selected branch")
      : isOwner
        ? "All branches"
        : (session.branchName ?? "Your branch")
    : "";
  const peakHour = d
    ? d.hourly.reduce((best, h) => (h.revenue > best.revenue ? h : best), d.hourly[0] ?? { hour: -1, revenue: 0, orders: 0 }).hour
    : -1;
  const totalReceived = d ? d.methods.reduce((s, m) => s + D(m.total).toNumber(), 0) : 0;
  // Recharts arc math needs NUMBERS — `total` is a 2dp string from the API, so the
  // donut series gets an explicit numeric `valueNum` (this was why the ring
  // previously rendered as an empty SVG with zero <path> sectors).
  const methodPieData = useMemo(
    () =>
      (d?.methods ?? [])
        .filter((m) => D(m.total).gt(0))
        .map((m) => ({ method: m.method, count: m.count, valueNum: D(m.total).toNumber() })),
    [d],
  );
  const isEmpty = !!d && d.kpis.transactions === 0;

  // Margin caption reflects the COGS basis the server actually used.
  const marginCaption = d
    ? d.kpis.marginBasis === "snapshot"
      ? "True margin — sale-time cost"
      : d.kpis.marginBasis === "mixed"
        ? `Mixed basis · ${d.kpis.costCoverage}% cost-snapshot coverage`
        : d.kpis.marginBasis === "estimate"
          ? "Estimate at current cost"
          : "No cost basis available"
    : "";

  const kpiCards = d
    ? [
        {
          icon: Wallet,
          label: "Revenue",
          value: formatKES(d.kpis.revenue),
          caption: "Completed payments received",
          valueClass: "text-emerald-900 dark:text-emerald-300",
          iconClass: "text-emerald-700 dark:text-emerald-400",
          delta: d.comparison?.deltas.revenue,
          goodWhenUp: true,
        },
        {
          icon: ShoppingBag,
          label: "Orders",
          value: d.kpis.transactions.toLocaleString("en-KE"),
          caption: "Completed + credit + partial",
          valueClass: "text-stone-900 dark:text-stone-50",
          iconClass: "text-stone-600 dark:text-stone-400",
          delta: d.comparison?.deltas.transactions,
          goodWhenUp: true,
        },
        {
          icon: Receipt,
          label: "Avg basket",
          value: formatKES(d.kpis.avgBasket),
          caption: "Revenue ÷ orders",
          valueClass: "text-stone-900 dark:text-stone-50",
          iconClass: "text-stone-600 dark:text-stone-400",
          delta: d.comparison?.deltas.avgBasket,
          goodWhenUp: true,
        },
        {
          icon: TrendingUp,
          label: "Margin",
          value: formatKES(d.kpis.estMargin),
          caption: marginCaption,
          valueClass: "text-emerald-900 dark:text-emerald-300",
          iconClass: "text-emerald-700 dark:text-emerald-400",
          delta: d.comparison?.deltas.estMargin,
          goodWhenUp: true,
        },
        {
          icon: CreditCard,
          label: "Credit outstanding",
          value: formatKES(d.kpis.creditOutstanding),
          caption: "CREDIT/PARTIAL balance due",
          valueClass: D(d.kpis.creditOutstanding).gt(0) ? "text-amber-700 dark:text-amber-400" : "text-stone-900 dark:text-stone-50",
          iconClass: D(d.kpis.creditOutstanding).gt(0) ? "text-amber-600 dark:text-amber-400" : "text-stone-600 dark:text-stone-400",
          delta: d.comparison?.deltas.creditOutstanding,
          goodWhenUp: false, // receivables falling is good
        },
      ]
    : [];

  return (
    <div className="animate-fade-in-up space-y-6">
      {/* ── Toolbar: period, branch (OWNER), refresh, export ─────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-stone-500 dark:text-stone-400">Period</Label>
            <div
              className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5 shadow-sm dark:border-stone-800 dark:bg-stone-800"
              role="group"
              aria-label="Reporting window"
            >
              {DAYS_OPTIONS.map((opt) => (
                <Button
                  key={opt}
                  size="sm"
                  variant={days === opt ? "default" : "secondary"}
                  className="h-8 rounded-md px-3"
                  aria-pressed={days === opt}
                  onClick={() => setDays(opt)}
                >
                  {opt}d
                </Button>
              ))}
            </div>
          </div>
          {isOwner &&
            (branches.length > 0 ? (
              <div className="space-y-1.5">
                <Label className="text-xs text-stone-500 dark:text-stone-400">Branch</Label>
                <Select
                  value={branchId === "" ? ALL_BRANCHES : branchId}
                  onValueChange={(v) => setBranchId(v === ALL_BRANCHES ? "" : v)}
                >
                  <SelectTrigger className="w-48" aria-label="Filter by branch">
                    <SelectValue placeholder="Branch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="pb-2 text-xs text-stone-500 dark:text-stone-400">Own-branch data (no branch list provided)</p>
            ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />}
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!d || loading}>
            <Download className="mr-1.5 size-4" /> Export CSV
          </Button>
        </div>
      </div>

      {d && !showSkeleton && (
        <p className="-mt-3 text-xs text-stone-500 dark:text-stone-400">
          {fullDayLabel(startKey)} – {fullDayLabel(endKey)} (Nairobi) · {branchLabel} · completed, credit and
          partial tickets
        </p>
      )}

      {/* ── Error state ──────────────────────────────────────────────────────── */}
      {error && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>Couldn&apos;t load sales insights</AlertTitle>
          <AlertDescription>
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="mr-1.5 size-4" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Loading state ────────────────────────────────────────────────────── */}
      {showSkeleton && <InsightsSkeleton />}

      {!error && d && (
        <>
          {/* ── KPI strip (with period-over-period deltas) ───────────────────── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            {kpiCards.map((k) => (
              <Card
                key={k.label}
                className="border-stone-200 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:border-stone-800"
              >
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5 text-stone-600 dark:text-stone-400">
                    <k.icon className={`size-4 ${k.iconClass}`} aria-hidden /> {k.label}
                  </CardDescription>
                  <CardTitle className={`truncate text-xl tabular-nums ${k.valueClass}`} title={k.value}>
                    {k.value}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-stone-500 dark:text-stone-400" title={k.caption}>
                      {k.caption}
                    </p>
                    {k.delta && (
                      <DeltaChip
                        delta={k.delta}
                        goodWhenUp={k.goodWhenUp}
                        title={`vs previous ${d.window.days}d (${String(k.delta.change)})`}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {isEmpty ? (
            /* ── Empty state ────────────────────────────────────────────────── */
            <Alert className="border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              <ShoppingBag className="size-4 text-emerald-700 dark:text-emerald-400" />
              <AlertTitle>No sales in this window yet</AlertTitle>
              <AlertDescription>
                Make a sale first — insights appear here as soon as transactions land. You can also widen the
                period to 90 days or check another branch.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* ── 1) Revenue trend (full width) ────────────────────────────── */}
              <Card className="border-stone-200 shadow-sm dark:border-stone-800">
                <CardHeader>
                  <CardTitle className="text-base">Revenue trend</CardTitle>
                  <CardDescription>
                    Daily ticket value · {dayLabel(startKey)} – {dayLabel(endKey)} · Nairobi wall-clock days
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer key={isDark ? "dark" : "light"} width="100%" height={260}>
                    <AreaChart data={d.daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="siRevenueFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#059669" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartSkin.grid} vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v: string) => dayLabel(v)}
                        stroke={chartSkin.axis}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={20}
                      />
                      <YAxis
                        stroke={chartSkin.axis}
                        fontSize={11}
                        width={64}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={fmtKesShort}
                      />
                      <Tooltip content={<RevenueTip />} cursor={{ stroke: chartSkin.cursor, strokeDasharray: "3 3" }} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        name="Revenue"
                        stroke="#059669"
                        strokeWidth={2}
                        fill="url(#siRevenueFill)"
                        activeDot={{ r: 4, fill: "#059669" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* ── 2) Top products + 3) Payment methods ─────────────────────── */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-stone-200 shadow-sm dark:border-stone-800">
                  <CardHeader>
                    <CardTitle className="text-base">Top products</CardTitle>
                    <CardDescription>Top 8 by net revenue (line totals)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {d.topProducts.length === 0 ? (
                      <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-12 text-center dark:border-stone-700 dark:bg-stone-900/60">
                        <ShoppingBag className="size-6 text-stone-300 dark:text-stone-600" aria-hidden />
                        <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No product sales in this window</p>
                        <p className="text-xs text-stone-500 dark:text-stone-400">Top movers appear here once transactions land.</p>
                      </div>
                    ) : (
                      <ResponsiveContainer key={isDark ? "dark" : "light"} width="100%" height={260}>
                        <BarChart
                          data={d.topProducts.map((p) => ({ name: p.name, revenue: D(p.revenue).toNumber() }))}
                          layout="vertical"
                          margin={{ top: 4, right: 48, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={chartSkin.grid} horizontal={false} />
                          <XAxis
                            type="number"
                            stroke={chartSkin.axis}
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={fmtKesShort}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={180}
                            stroke={chartSkin.axis}
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: string) => trunc(v)}
                          />
                          <Tooltip
                            cursor={{ fill: "rgba(217, 119, 6, 0.06)" }}
                            {...tooltipSkin}
                            formatter={(value) => formatKES(Number(value))}
                          />
                          <Bar
                            dataKey="revenue"
                            name="Revenue"
                            fill="#d97706"
                            radius={[0, 4, 4, 0]}
                            barSize={14}
                            label={{
                              position: "right",
                              fontSize: 10,
                              fill: "#57534e",
                              formatter: (v: number | string) => fmtKesShort(Number(v)),
                            }}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-stone-200 shadow-sm dark:border-stone-800">
                  <CardHeader>
                    <CardTitle className="text-base">Payment methods</CardTitle>
                    <CardDescription>Completed payments by tender</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {methodPieData.length === 0 ? (
                      <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-12 text-center dark:border-stone-700 dark:bg-stone-900/60">
                        <Wallet className="size-6 text-stone-300 dark:text-stone-600" aria-hidden />
                        <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No completed payments in this window</p>
                        <p className="text-xs text-stone-500 dark:text-stone-400">The tender split appears once payments land.</p>
                      </div>
                    ) : (
                    <div className="flex flex-col items-center gap-4 sm:flex-row">
                      <div className="relative h-[260px] w-full sm:w-1/2">
                        <ResponsiveContainer key={isDark ? "dark" : "light"} width="100%" height={260}>
                          <PieChart>
                            <Pie
                              data={methodPieData}
                              dataKey="valueNum"
                              nameKey="method"
                              innerRadius={55}
                              outerRadius={90}
                              paddingAngle={2}
                              stroke={chartSkin.sliceStroke}
                              strokeWidth={2}
                            >
                              {methodPieData.map((m) => (
                                <Cell key={m.method} fill={METHOD_META[m.method]?.color ?? "#78716c"} />
                              ))}
                            </Pie>
                            <Tooltip
                              {...tooltipSkin}
                              formatter={(value) => formatKES(Number(value))}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <p className="text-[10px] uppercase tracking-wide text-stone-400 dark:text-stone-500">Received</p>
                            <p className="text-sm font-bold tabular-nums text-stone-800 dark:text-stone-200">{fmtKesShort(totalReceived)}</p>
                          </div>
                        </div>
                      </div>
                      <ul className="w-full space-y-1.5 sm:w-1/2">
                        {d.methods.map((m) => {
                          const meta = METHOD_META[m.method] ?? { label: m.method, color: "#78716c" };
                          const zero = D(m.total).lte(0);
                          return (
                            <li key={m.method} className="flex items-center gap-2 text-xs">
                              <span
                                className={`size-2.5 shrink-0 rounded-full ${zero ? "opacity-30" : ""}`}
                                style={{ backgroundColor: meta.color }}
                                aria-hidden
                              />
                              <span className={`truncate ${zero ? "text-stone-400 dark:text-stone-500" : "text-stone-700 dark:text-stone-300"}`}>
                                {meta.label}
                                <span className="text-stone-400 dark:text-stone-500"> · {m.count}</span>
                              </span>
                              <span
                                className={`ml-auto shrink-0 font-medium tabular-nums ${zero ? "text-stone-400 dark:text-stone-500" : "text-stone-800 dark:text-stone-200"}`}
                              >
                                {formatKES(m.total)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* ── 4) Hourly profile (full width, 0h…23h) ───────────────────── */}
              <Card className="border-stone-200 shadow-sm dark:border-stone-800">
                <CardHeader>
                  <CardTitle className="text-base">Hourly profile</CardTitle>
                  <CardDescription>
                    Revenue by hour of day (Nairobi) · peak hour highlighted in emerald
                    {peakHour >= 0 && d.hourly[peakHour]?.revenue > 0 ? ` — ${peakHour}:00` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer key={isDark ? "dark" : "light"} width="100%" height={260}>
                    <BarChart data={d.hourly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartSkin.grid} vertical={false} />
                      <XAxis
                        dataKey="hour"
                        interval={0}
                        tickFormatter={(h: number) => `${h}h`}
                        stroke={chartSkin.axis}
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke={chartSkin.axis}
                        fontSize={11}
                        width={56}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={fmtKesShort}
                      />
                      <Tooltip content={<HourlyTip />} cursor={{ fill: "rgba(5, 150, 105, 0.06)" }} />
                      <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                        {d.hourly.map((h) => (
                          <Cell
                            key={h.hour}
                            fill={h.hour === peakHour && h.revenue > 0 ? "#059669" : "#cbd5e1"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* ── 5) Cashier leaderboard (ranked list, top 5) ───────────────── */}
              <Card className="border-stone-200 shadow-sm dark:border-stone-800">
                <CardHeader>
                  <CardTitle className="text-base">Cashier leaderboard</CardTitle>
                  <CardDescription>Top 5 by ticket revenue in the window</CardDescription>
                </CardHeader>
                <CardContent>
                  {d.cashiers.length === 0 ? (
                    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-center dark:border-stone-700 dark:bg-stone-900/60">
                      <Users className="size-6 text-stone-300 dark:text-stone-600" aria-hidden />
                      <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No cashier activity in this window</p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">Rankings appear once tickets are completed.</p>
                    </div>
                  ) : (
                    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {d.cashiers.map((c, idx) => (
                        <li
                          key={c.userId}
                          className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 transition-colors hover:bg-stone-100/70 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:bg-stone-900"
                        >
                          <span
                            className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              idx === 0
                                ? "bg-emerald-700 text-white"
                                : idx === 1
                                  ? "bg-stone-600 text-white"
                                  : idx === 2
                                    ? "bg-amber-600 text-white"
                                    : "border border-stone-200 bg-white text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400"
                            }`}
                            aria-label={`Rank ${idx + 1}`}
                          >
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                              {c.userName}
                              {c.userId === session.id ? <span className="text-stone-400 dark:text-stone-500"> (you)</span> : null}
                            </p>
                            <p className="text-xs text-stone-500 dark:text-stone-400">
                              {c.orders} order{c.orders === 1 ? "" : "s"}
                            </p>
                          </div>
                          <p className="ml-auto shrink-0 text-sm font-semibold tabular-nums text-stone-800 dark:text-stone-200">
                            {formatKES(c.revenue)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>

              {/* ── 6) Branch comparison (OWNER all-branches view) — only when
                  2+ branches had tickets in the window ─────────────────────── */}
              {d.perBranch && d.perBranch.length > 1 && (
                <Card className="border-stone-200 shadow-sm dark:border-stone-800">
                  <CardHeader>
                    <CardTitle className="text-base">Branch comparison</CardTitle>
                    <CardDescription>Ticket share by branch · revenue = payments received</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <BranchComparisonTable rows={d.perBranch} />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
