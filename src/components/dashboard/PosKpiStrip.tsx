"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  CreditCard,
  Lock,
  Minus,
  PackageSearch,
  ReceiptText,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatKES } from "@/lib/format";
import { roleAtLeast, type SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// PosKpiStrip — live "shift pulse" row for the top of the POS tab.
//
// FETCH STRATEGY (per card, graceful degradation — a failed fetch NEVER breaks
// the strip; the affected card shows "—" with a muted "unavailable" caption):
//   • Low stock + SKUs in catalog : GET /api/products?limit=1&lowStock=1 and
//     /api/products?limit=1 → { items, total } (total = filtered row count, so
//     the lowStock call returns the low-stock count and the plain call the
//     catalog size). Available to every role — server BOLA-fences the branch.
//   • Today's takings + transactions : GET /api/v1/reports/eod →
//     tenders.{CASH|MPESA|BANK_TRANSFER|CARD|STORE_CREDIT}.total (summed) and
//     vat.transactionCount. MANAGER+ only → skipped entirely for CASHIER so
//     the console stays free of 403 noise; the card renders a lock instead.
//     The takings card ALSO pulls GET /api/v1/reports/sales-insights?days=7
//     (MANAGER+) for a 7-day revenue sparkline + vs-yesterday delta chip —
//     decorative trend affordance; a failed fetch simply hides it.
//   • Receivables : GET /api/v1/credit/aging → kpis.totalReceivables.
//     MANAGER+ only → same cashier skip logic.
// The whole strip refetches every 60 s (interval cleared on unmount) and a
// manual refresh button re-runs the same load; a run-id guard keeps stale
// responses from overwriting fresher values.
// ─────────────────────────────────────────────────────────────────────────────

/** undefined = not loaded yet · null = fetch failed (card degrades to "—") */
type Metric = number | null | undefined;

export interface PosKpiStripProps {
  session: SessionUser;
  /**
   * Optional orchestrator-supplied total of today's credit sales (KES), shown
   * as an extra caption on the Receivables card once it has loaded.
   */
  todayCreditTotal?: number | null;
  /**
   * Optional OWNER branch scope (`null` = all branches). When non-null it is
   * appended to the two catalog count fetches so the Low stock / SKUs cards
   * reflect the selected branch. Server BOLA still fences non-OWNER requests.
   */
  branchId?: string | null;
}

interface ProductsResponse {
  total?: number;
  items?: unknown[];
}

interface EodResponse {
  tenders?: Record<string, { total?: number; count?: number } | undefined>;
  vat?: { transactionCount?: number };
}

interface InsightsResponse {
  daily?: Array<{ date: string; revenue: number; orders: number }>;
}

interface AgingResponse {
  kpis?: { totalReceivables?: number };
}

const REFRESH_MS = 60_000;
const LOCKED_CAPTION = "Visible to MANAGER and above";

/** JSON fetch that degrades to null on ANY failure (HTTP, parse, network). */
async function requestJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function numberOr(value: unknown): Metric {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ── Sparkline (pure SVG — no chart lib; ~28px tall, emerald gradient) ────────

function Sparkline({ points, label }: { points: number[]; label: string }) {
  const gradId = useId();
  const W = 120;
  const H = 30;
  const PAD = 2;
  if (points.length < 2) return null;
  const max = Math.max(...points, 1); // 0-only series still renders a flat base
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const stepX = (W - PAD * 2) / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${(W - PAD).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-1.5 h-7 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke="rgb(5 150 105)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="2.25" fill="rgb(5 150 105)" />
    </svg>
  );
}

/** Vs-yesterday delta chip — emerald up / rose down / stone flat. */
function TrendChip({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
        flat
          ? "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
          : up
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
            : "bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400"
      )}
      title="Today vs yesterday (7-day window)"
    >
      <Icon className="size-3" aria-hidden />
      {flat ? "flat" : `${up ? "+" : ""}${pct.toFixed(1)}%`}
    </span>
  );
}

function KpiCard({
  label,
  icon: Icon,
  tileClass,
  accentClass,
  value,
  valueFormat,
  caption,
  locked = false,
  liveDot = false,
  extraCaption,
  sparkline,
  sparklineSlot = false,
  deltaPct,
}: {
  label: string;
  icon: LucideIcon;
  tileClass: string;
  /** Thin semantic top-border accent (scannability) — e.g. "border-t-amber-400 dark:border-t-amber-500". */
  accentClass?: string;
  value: Metric;
  valueFormat: "money" | "count";
  caption: React.ReactNode;
  locked?: boolean;
  liveDot?: boolean;
  extraCaption?: React.ReactNode;
  /** Trailing metric series for the decorative trend line (e.g. 7-day revenue). */
  sparkline?: number[];
  /** True while the sparkline slot is reserved but its series has not landed —
   *  renders a matching skeleton so the card does not reflow on load. */
  sparklineSlot?: boolean;
  /** Today-vs-yesterday percentage (null hides the chip). */
  deltaPct?: number | null;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-t-2 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        accentClass
      )
    }>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", tileClass)} aria-hidden>
          <Icon className="size-4" />
        </span>
        <span className="truncate text-[11px] font-medium tracking-wide uppercase">{label}</span>
        {liveDot && !locked && (
          <span className="relative ml-auto flex size-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {locked ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Lock className="size-3.5" aria-hidden /> Manager view
            </span>
          ) : value === undefined ? (
            <Skeleton className="h-6 w-20" aria-label={`Loading ${label}`} />
          ) : value === null ? (
            <span className="text-xl font-semibold text-muted-foreground/70">—</span>
          ) : (
            <p className="kpi-value animate-in fade-in truncate text-xl font-semibold tabular-nums text-stone-900 dark:text-stone-50 duration-500">
              {valueFormat === "money" ? formatKES(value) : value.toLocaleString("en-KE")}
            </p>
          )}
        </div>
        {deltaPct !== undefined && !locked && value === undefined && (
          <Skeleton className="h-5 w-12 rounded-full" aria-hidden />
        )}
        {deltaPct !== undefined && !locked && value !== undefined && value !== null && (
          <TrendChip pct={deltaPct} />
        )}
      </div>

      {sparklineSlot && !locked && value === undefined && (
        <Skeleton className="mt-1.5 h-7 w-full" aria-hidden />
      )}

      {sparkline && sparkline.length >= 2 && !locked && value != null && (
        <Sparkline points={sparkline} label={`${label} — last ${sparkline.length} days trend`} />
      )}

      <p
        className={cn(
          "mt-0.5 truncate text-[11px]",
          !locked && value === null ? "text-muted-foreground/70 italic" : "text-muted-foreground"
        )}
      >
        {!locked && value === null ? "unavailable" : locked ? LOCKED_CAPTION : caption}
      </p>
      {extraCaption}
    </div>
  );
}

export function PosKpiStrip({ session, todayCreditTotal = null, branchId = null }: PosKpiStripProps) {
  // MANAGER+ gate — cashiers never call the restricted endpoints at all.
  const isManager = roleAtLeast(session.role, "MANAGER");

  const [lowStock, setLowStock] = useState<Metric>(undefined);
  const [catalogTotal, setCatalogTotal] = useState<Metric>(undefined);
  const [takings, setTakings] = useState<Metric>(undefined);
  const [transactions, setTransactions] = useState<Metric>(undefined);
  const [receivables, setReceivables] = useState<Metric>(undefined);
  const [revenueSeries, setRevenueSeries] = useState<number[] | null>(null);
  const [inFlight, setInFlight] = useState(false);

  // Race guard: only the newest run may write metric state.
  const runRef = useRef(0);

  const load = useCallback(async () => {
    const run = ++runRef.current;
    setInFlight(true);
    try {
      // OWNER branch scope: appended ONLY when a branch is selected — the bare
      // requests keep their previous meaning (all branches) when it is null.
      const branchQuery = branchId ? `&branchId=${encodeURIComponent(branchId)}` : "";
      const [lowJson, catalogJson] = await Promise.all([
        requestJson<ProductsResponse>(`/api/products?limit=1&lowStock=1${branchQuery}`),
        requestJson<ProductsResponse>(`/api/products?limit=1${branchQuery}`),
      ]);
      if (runRef.current === run) {
        setLowStock(numberOr(lowJson?.total ?? lowJson?.items?.length ?? null));
        setCatalogTotal(numberOr(catalogJson?.total ?? null));
      }

      if (isManager) {
        const [eodJson, agingJson, insightsJson] = await Promise.all([
          requestJson<EodResponse>("/api/v1/reports/eod"),
          requestJson<AgingResponse>("/api/v1/credit/aging"),
          requestJson<InsightsResponse>("/api/v1/reports/sales-insights?days=7"),
        ]);
        if (runRef.current === run) {
          const tenderSum = eodJson?.tenders
            ? Object.values(eodJson.tenders).reduce(
                (sum, tender) => sum + (typeof tender?.total === "number" ? tender.total : 0),
                0
              )
            : null;
          setTakings(numberOr(tenderSum));
          setTransactions(numberOr(eodJson?.vat?.transactionCount ?? null));
          setReceivables(numberOr(agingJson?.kpis?.totalReceivables ?? null));
          const daily = insightsJson?.daily;
          setRevenueSeries(
            daily && daily.length >= 2 ? daily.map((d) => (typeof d.revenue === "number" && Number.isFinite(d.revenue) ? d.revenue : 0)) : null
          );
        }
      }
    } finally {
      if (runRef.current === run) setInFlight(false);
    }
  }, [isManager, branchId]); // branch scope change → counts refetch (interval re-arms with the new URLs)

  // Initial load + 60 s live refresh (interval cleared on unmount; `load`
  // identity changes only when the role gate flips, which re-arms correctly).
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const showCreditCaption = isManager && typeof todayCreditTotal === "number";

  // Today-vs-yesterday % from the 7-day series (last bucket = today).
  const takingsDeltaPct =
    revenueSeries && revenueSeries.length >= 2
      ? (() => {
          const today = revenueSeries[revenueSeries.length - 1];
          const yesterday = revenueSeries[revenueSeries.length - 2];
          if (!Number.isFinite(today) || !Number.isFinite(yesterday)) return null;
          if (yesterday <= 0) return today > 0 ? null : 0; // no yesterday baseline → hide chip
          return ((today - yesterday) / yesterday) * 100;
        })()
      : null;

  return (
    <section aria-label="Point of sale KPIs" className="pos-kpi-strip space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Shift pulse</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={() => void load()}
          aria-label="Refresh KPIs"
          title="Refresh KPIs (auto-refreshes every minute)"
        >
          <RefreshCw className={cn("size-3.5", inFlight && "animate-spin")} aria-hidden />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Low stock"
          icon={PackageSearch}
          tileClass="bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
          accentClass="border-t-amber-400 dark:border-t-amber-500"
          value={lowStock}
          valueFormat="count"
          caption={
            typeof catalogTotal === "number"
              ? `of ${catalogTotal.toLocaleString("en-KE")} SKUs in catalog`
              : "at or below reorder level"
          }
        />
        <KpiCard
          label="Today's takings"
          icon={Wallet}
          tileClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
          accentClass="border-t-emerald-400 dark:border-t-emerald-500"
          value={isManager ? takings : undefined}
          valueFormat="money"
          caption="since midnight · Nairobi"
          locked={!isManager}
          liveDot
          sparkline={isManager ? (revenueSeries ?? undefined) : undefined}
          sparklineSlot={isManager}
          deltaPct={isManager ? takingsDeltaPct : undefined}
        />
        <KpiCard
          label="Transactions"
          icon={ReceiptText}
          tileClass="bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400"
          accentClass="border-t-stone-400 dark:border-t-stone-500"
          value={isManager ? transactions : undefined}
          valueFormat="count"
          caption="sales recorded today"
          locked={!isManager}
        />
        <KpiCard
          label="Receivables"
          icon={CreditCard}
          tileClass="bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400"
          accentClass="border-t-rose-400 dark:border-t-rose-500"
          value={isManager ? receivables : undefined}
          valueFormat="money"
          caption="open balances"
          locked={!isManager}
          extraCaption={
            showCreditCaption ? (
              <p className="mt-0.5 truncate text-[11px] text-rose-700/80 dark:text-rose-400/80">
                Today&apos;s credit sales {formatKES(todayCreditTotal)}
              </p>
            ) : undefined
          }
        />
      </div>
    </section>
  );
}
