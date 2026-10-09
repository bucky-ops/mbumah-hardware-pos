'use client';

/**
 * MBUMAH HARDWARE POS — Dashboard (v2.12.0 premium rebuild, Task DASH-UI)
 *
 * Single data source: GET /api/dashboard via dashboardApi.getStats() and
 * TanStack Query (queryKey ['dashboard', storeId], 30s refetch) — the
 * response shape is documented by Task DASH-BE in worklog.md. Every figure
 * on this page is LIVE data; nothing is hardcoded and no chart library is
 * used (pure CSS/SVG only).
 *
 * Section → data map:
 *   1. Hero            — useAuthStore user + STORE_LIST + live clock
 *   2. Debt banner     — data.debtCrisis.warning / banner / debtRatioPercent
 *   3. Active shift    — data.shift (snapshot + live elapsed + End-Shift
 *                        dialog reusing the existing shiftsApi.end flow)
 *   4. KPI row         — todayRevenue / todayTransactions /
 *                        averageTransactionValue / outOfStockCount +
 *                        lowStockCount / debtCrisis.outstandingTotal
 *                        (sparklines from revenueTrend7d.days and the
 *                        hourly series — never fabricated)
 *   5. Middle row      — hourlySalesBreakdown (6 AM–9 PM bars) +
 *                        paymentMethodBreakdown (conic-gradient donut)
 *   6. Quick actions   — tab navigation + existing /api/cash-drawer dialog
 *   7. Bottom grid     — recentTransactions + recentActivities (sanitized),
 *                        storeHealth, hourlySalesBreakdown heatmap
 *   8. Top customers   — debtCrisis.customers sorted by lifetimeSpend
 *   9. Top products    — topProducts with revenue share bars
 *  10. Sales trend     — revenueTrend7d days + forecast + outlier note
 *  11. Debt aging      — debtCrisis.aging buckets (sum verified)
 *  12. Alerts          — data.alerts + alertsCount + severity actions
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, ArrowUpRight, Banknote, BarChart3,
  Bell, Calculator, CheckCircle, CircleDollarSign, Clock, Eye, HandCoins,
  Info, Lock, LogOut, Minus, Package, Phone, Play, Plus, Receipt,
  ShieldCheck, ShoppingCart, Sparkles, Square, Timer, TrendingDown,
  TrendingUp, Users, Wallet, Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAppStore, useAuthStore, type AppTab } from '@/lib/stores';
import {
  dashboardApi, shiftsApi, formatKES,
  type ShiftXRead,
} from '@/lib/api';
import type {
  DashboardStats, TopProduct, ShiftSnapshot, DebtCrisisSummary,
  DashboardAlert, StoreHealthSummary, RevenueTrend7d,
} from '@/lib/types';
import { hasFeaturePermission } from '@/lib/permissions';
import { STORE_LIST } from '@/lib/store-info';
import { timeAgo } from '@/lib/time-ago';
import { LockedCard } from '@/components/rbac/locked-card';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The API serializes Prisma Decimals for the LEGACY list fields, so the UI
 * coerces with Number() at the boundary (DECIMAL-STRING AUDIT precedent —
 * same approach the extracted widgets already use).
 */
interface RecentTxn {
  id: string;
  receiptNumber: string;
  totalAmount: number | string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  customer: { name: string } | null;
  cashier: { name: string } | null;
}

interface HourlyPoint {
  hour: string;
  amount: number;
  transactionCount: number;
}

/** One row of the limited dashboard's "My Sales" feed (server shape). */
interface MySaleRow {
  id: string;
  receiptNumber: string;
  paymentMethod: string;
  paymentStatus: string;
  totalAmount: number | string;
  createdAt: string;
}

type DashboardData = DashboardStats & {
  /** Legacy fields the API returns but the shared interface predates. */
  averageTransactionValue?: number;
  revenueChangePercent?: number;
  outstandingDebtCount?: number;
  recentTransactions?: RecentTxn[];
  hourlySalesBreakdown?: HourlyPoint[];
  // ── v2.12.5 RBAC limited payload (roles without dashboard.view.revenue) ──
  limitedView?: boolean;
  transactions?: { count: number };
  lowStock?: { count: number; low: number; outOfStock: number };
  mySales?: MySaleRow[];
};

// ── Small helpers ────────────────────────────────────────────────────────────

/** Decimal-string safe number coercion — never trust wire types for money. */
function num(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

/** Compact axis money label, e.g. 342000 → "342k", 1_500_000 → "1.5M". */
function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${Math.round(v / 1_000)}k`;
  return `${Math.round(v)}`;
}

/** 24h hour number → "6 AM" / "2 PM" label. */
function formatHour(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${suffix}`;
}

/** Receipt "MBM-9D042" → "…9D042" (last-5 emphasis, per redesign spec). */
function receiptTail(receipt: string | null | undefined): string {
  const r = (receipt ?? '').trim();
  if (!r) return '—';
  return r.length <= 5 ? r : `…${r.slice(-5)}`;
}

const MOTIVATIONAL_QUOTE = 'Consistency beats intensity. Show up and deliver.';

// ── Sparkline (pure inline SVG — NO chart libraries) ────────────────────────

function Sparkline({ points, className }: { points: number[]; className?: string }) {
  const coords = useMemo(() => {
    if (!Array.isArray(points) || points.length < 2) return null;
    const w = 40;
    const h = 24;
    const max = Math.max(...points);
    const min = Math.min(...points);
    const range = max - min || 1;
    return points.map((p, i) => ({
      x: (i / (points.length - 1)) * w,
      y: h - 2 - ((p - min) / range) * (h - 4),
    }));
  }, [points]);

  if (!coords) return null;

  return (
    <svg
      viewBox="0 0 40 24"
      width={40}
      height={24}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Trend badge ──────────────────────────────────────────────────────────────

function TrendBadge({ pct }: { pct: number }) {
  const up = pct > 0.05;
  const down = pct < -0.05;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        up
          ? 'bg-emerald-50 text-emerald-700'
          : down
            ? 'bg-red-50 text-red-600'
            : 'bg-slate-100 text-slate-500'
      }`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── 1. HERO ──────────────────────────────────────────────────────────────────

function DashboardHero({ onTab, limited }: { onTab: (tab: AppTab) => void; limited?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const nowMs = useNowMs();
  // v2.12.5 RBAC: the limited (cashier) view keeps the greeting but drops
  // quick actions the role cannot open (catalog/reports); "New Sale" only
  // when the role holds pos.sell.
  const canSell = hasFeaturePermission(user?.role, 'pos.sell');
  const clock = useMemo(() => {
    if (nowMs <= 0) return null;
    const now = new Date(nowMs);
    return {
      time: now.toLocaleTimeString('en-KE', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      }),
      date: now.toLocaleDateString('en-KE', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
    };
  }, [nowMs]);

  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] || '';
  const storeName = STORE_LIST.find((s) => s.id === currentStoreId)?.shortName ?? 'your branch';

  return (
    <section
      aria-label="Welcome"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#059669] to-[#10b981] text-white shadow-md"
    >
      {/* Subtle texture overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '22px 22px' }}
        aria-hidden="true"
      />
      <CardContent className="relative p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              {firstName ? `Karibu, ${firstName}` : 'Karibu'} <span aria-hidden="true">👋</span>
            </h1>
            <p className="mt-1 text-xs text-emerald-50/95 sm:text-sm">
              Here&rsquo;s what&rsquo;s happening at <span className="font-semibold">{storeName}</span> today
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-emerald-50/90 sm:text-xs">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/* Live ticking clock — filled client-side to avoid SSR mismatch */}
                <span className="font-mono tabular-nums">{clock?.time ?? '--:--:--'}</span>
              </span>
              <span className="hidden text-emerald-200/60 sm:inline" aria-hidden="true">·</span>
              <span>{clock?.date ?? ''}</span>
            </div>
            <p className="mt-2 max-w-md text-[11px] italic leading-relaxed text-emerald-100/80">
              {`“${MOTIVATIONAL_QUOTE}”`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canSell && (
              <Button
                size="sm"
                className="gap-1.5 bg-white font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 hover:text-emerald-800"
                onClick={() => onTab('pos')}
              >
                <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                New Sale (F2)
              </Button>
            )}
            {!limited && (
              <Button
                size="sm"
                className="gap-1.5 bg-white font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 hover:text-emerald-800"
                onClick={() => onTab('catalog')}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Product
              </Button>
            )}
            {!limited && (
              <Button
                size="sm"
                className="gap-1.5 bg-white font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 hover:text-emerald-800"
                onClick={() => onTab('reports')}
              >
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                View Reports
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </section>
  );
}

// ── 2. DEBT CRISIS BANNER ────────────────────────────────────────────────────

function DebtCrisisBanner({ crisis, onTab }: { crisis: DebtCrisisSummary; onTab: (tab: AppTab) => void }) {
  return (
    <section
      role="alert"
      aria-label="Debt warning"
      className="flex flex-col gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100">
          <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-700">
            {crisis.banner || 'High debt exposure'}
          </p>
          <p className="mt-0.5 text-xs text-red-600">
            — {num(crisis.debtRatioPercent).toFixed(1)}% of today&rsquo;s sales are on debt
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 gap-1.5 border-red-300 bg-white text-red-700 hover:bg-red-100 hover:text-red-800"
        onClick={() => onTab('debt-management')}
      >
        View debtors
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </section>
  );
}

// ── 3. ACTIVE SHIFT CARD ─────────────────────────────────────────────────────

/**
 * Shared 1-second tick for live clocks. Returns 0 until the client mounts
 * (the SSR/hydration render shows placeholders) — setState fires only inside
 * the interval callback, never synchronously within the effect body.
 */
function useNowMs(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Live mm:ss / hh:mm elapsed label for the open shift. */
function useElapsedLabel(startedAt: string | null | undefined): string {
  const now = useNowMs();
  if (!startedAt || now <= 0) return '--:--';
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '--:--';
  const diff = Math.max(0, now - start);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return h > 0 ? `${pad2(h)}:${pad2(m)}` : `${pad2(m)}:${pad2(s)}`;
}

function ShiftStatBox({ label, value, sub, emphasized }: {
  label: string;
  value: string;
  sub?: string | null;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-3 ${
        emphasized
          ? 'bg-emerald-50 ring-1 ring-emerald-200'
          : 'border border-slate-200 bg-slate-50/60'
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${emphasized ? 'text-emerald-700' : 'text-slate-900'}`}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function ActiveShiftCard({ shift }: { shift: ShiftSnapshot }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const elapsed = useElapsedLabel(shift.startedAt);

  // ── End-shift flow (existing client pattern: shiftsApi.end + blind xread) ──
  const role = user?.role;
  const isOwnerRole = role === 'SUPER_ADMIN' || role === 'STORE_OWNER';
  const blindCount = !isOwnerRole;

  const [endOpen, setEndOpen] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [endingCash, setEndingCash] = useState('');
  const [endNotes, setEndNotes] = useState('');
  const [isEnding, setIsEnding] = useState(false);
  const [endResult, setEndResult] = useState<{ countedCash: number; cashDifference: number } | null>(null);

  // v2.6.0 pattern: the AUTHORITATIVE expected-cash figure for closing comes
  // from the server X-read (blind=1 withholds it from non-owner roles). The
  // card's "Expected Cash" stat above is the DASH-BE snapshot formula and is
  // labelled as such; the closeout dialog uses the ledger truth.
  const { data: xread, refetch: refetchXread } = useQuery({
    queryKey: ['shift-xread', shift.id, blindCount],
    queryFn: async (): Promise<ShiftXRead | null> => {
      const res = await shiftsApi.xread(shift.id, { blind: blindCount });
      return res.data ?? null;
    },
    enabled: endOpen,
  });
  const expectedCash: number | null = isOwnerRole ? (xread?.expectedCash ?? null) : null;

  const handleEndShift = async () => {
    const counted = parseFloat(countedCash);
    const ending = parseFloat(endingCash);
    if (Number.isNaN(counted) || counted < 0) {
      toast.error('Please enter the counted cash amount.');
      return;
    }
    if (Number.isNaN(ending) || ending < 0) {
      toast.error('Please enter the ending cash amount.');
      return;
    }

    setIsEnding(true);
    try {
      const res = await shiftsApi.end(shift.id, {
        endingCash: ending,
        countedCash: counted,
        notes: endNotes || undefined,
      });
      if (res.success) {
        const diff = res.data?.cashDifference ?? 0;
        if (Math.abs(diff) > 0.01) {
          toast.warning(
            diff > 0
              ? `Shift ended. Cash over by ${formatKES(diff)}`
              : `Shift ended. Cash short by ${formatKES(Math.abs(diff))}`,
          );
        } else {
          toast.success('Shift ended. Cash balance is correct!');
        }
        setEndResult({ countedCash: res.data?.countedCash ?? counted, cashDifference: diff });
        setCountedCash('');
        setEndingCash('');
        setEndNotes('');
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      } else {
        toast.error(res.error || 'Failed to end shift.');
      }
    } catch {
      toast.error('Failed to end shift. Please try again.');
    } finally {
      setIsEnding(false);
    }
  };

  const closeEndDialog = (open: boolean) => {
    setEndOpen(open);
    if (!open) setEndResult(null);
    else void refetchXread();
  };

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Timer className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Active shift
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
              LIVE
            </span>
          </CardTitle>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-slate-500">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {elapsed}
          </span>
        </div>
        <CardDescription className="text-xs">
          Shift started {timeAgo(shift.startedAt)} by {shift.startedBy || 'you'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <ShiftStatBox label="Starting Cash" value={formatKES(num(shift.startingCash))} />
          <ShiftStatBox
            label="Cash Sales"
            value={formatKES(num(shift.cashSales))}
            sub={Number.isFinite(shift.txnsCash) ? `+${num(shift.txnsCash)} txns` : null}
          />
          <ShiftStatBox
            label="Debt Sales"
            value={formatKES(num(shift.debtSales))}
            sub={Number.isFinite(shift.txnsDebt) ? `+${num(shift.txnsDebt)} txns` : null}
          />
          <ShiftStatBox
            label="Total Revenue"
            value={formatKES(num(shift.totalSales))}
            sub={Number.isFinite(shift.txnsTotal) ? `+${num(shift.txnsTotal)} txns` : null}
          />
          <ShiftStatBox label="Expenses" value={formatKES(num(shift.expenses))} />
          <ShiftStatBox
            label="Expected Cash"
            value={formatKES(num(shift.expectedCash))}
            emphasized
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            Expected = {shift.formula || 'Starting + Cash Sales − Expenses'}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            onClick={() => closeEndDialog(true)}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            End Shift
          </Button>
        </div>
      </CardContent>

      {/* End Shift dialog — preserves the v2.6.0 blind-closeout flow */}
      <Dialog open={endOpen} onOpenChange={closeEndDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-5 w-5 text-amber-600" aria-hidden="true" />
              Count Cash Drawer
            </DialogTitle>
            <DialogDescription>
              Count the cash in the drawer and record the amounts to close your shift.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {endResult ? (
              <div className="space-y-3">
                <div
                  role="status"
                  className={`space-y-2 rounded-xl border p-4 ${
                    Math.abs(endResult.cashDifference) < 1
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-amber-300 bg-amber-50'
                  }`}
                >
                  <p className={`flex items-center gap-2 text-sm font-semibold ${Math.abs(endResult.cashDifference) < 1 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    Shift closed — cash variance
                  </p>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-slate-500">Counted</span>
                    <span className="font-mono font-bold">{formatKES(endResult.countedCash)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-slate-500">
                      {Math.abs(endResult.cashDifference) < 1 ? 'Balanced' : endResult.cashDifference > 0 ? 'Over' : 'Short'}
                    </span>
                    <span className={`font-mono text-base font-extrabold ${Math.abs(endResult.cashDifference) < 1 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {Math.abs(endResult.cashDifference) < 1
                        ? 'KES 0.00'
                        : `${endResult.cashDifference > 0 ? '+' : '−'}${formatKES(Math.abs(endResult.cashDifference))}`}
                    </span>
                  </div>
                </div>
                <Button className="h-10 w-full" onClick={() => closeEndDialog(false)}>
                  Done
                </Button>
              </div>
            ) : (
              <>
                {blindCount ? (
                  <div className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-3" role="note">
                    <p className="flex items-start gap-2 text-xs font-semibold text-amber-800">
                      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      Blind count enforced
                    </p>
                    <p className="text-xs text-amber-800/90">
                      Count the physical cash in the drawer and enter it below. Do not check system totals.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Starting Cash</span>
                      <span className="font-medium">{formatKES(num(shift.startingCash))}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">+ Cash Sales</span>
                      <span className="font-medium text-emerald-600">{formatKES(num(shift.cashSales))}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">Expected Cash (ledger)</span>
                      <span className="font-bold text-emerald-600">
                        {expectedCash === null ? '…' : formatKES(expectedCash)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="counted-cash" className="text-xs font-medium">
                      Counted Cash in Drawer (KES){blindCount ? ' *' : ''}
                    </Label>
                    <Input
                      id="counted-cash"
                      type="number"
                      min="0"
                      step="100"
                      placeholder="Count all cash in the drawer"
                      value={countedCash}
                      onChange={(e) => setCountedCash(e.target.value)}
                      className="h-9"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ending-cash" className="text-xs font-medium">
                      Ending Cash to Leave in Drawer (KES)
                    </Label>
                    <Input
                      id="ending-cash"
                      type="number"
                      min="0"
                      step="100"
                      placeholder="Cash to leave for next shift"
                      value={endingCash}
                      onChange={(e) => setEndingCash(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="end-notes" className="text-xs font-medium">
                      Notes (optional)
                    </Label>
                    <Input
                      id="end-notes"
                      placeholder="Any notes about this shift"
                      value={endNotes}
                      onChange={(e) => setEndNotes(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>

                {!blindCount && countedCash !== '' && expectedCash !== null && (
                  <div className="space-y-1.5 rounded-xl border border-slate-200 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Cash summary</p>
                    <div className="flex justify-between text-xs">
                      <span>Expected</span>
                      <span className="font-mono">{formatKES(expectedCash)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Counted</span>
                      <span className="font-mono">{formatKES(parseFloat(countedCash) || 0)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm font-bold">
                      <span>Difference</span>
                      {(() => {
                        const diff = (parseFloat(countedCash) || 0) - expectedCash;
                        if (Math.abs(diff) < 0.01) return <span className="text-emerald-600">Balanced</span>;
                        return diff > 0
                          ? <span className="text-amber-600">+{formatKES(diff)} over</span>
                          : <span className="text-red-600">{formatKES(diff)} short</span>;
                      })()}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {!endResult && (
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => closeEndDialog(false)} className="h-9">
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleEndShift}
                disabled={isEnding || !countedCash || !endingCash}
                className="h-9 gap-1.5"
              >
                {isEnding
                  ? <Activity className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Square className="h-4 w-4" aria-hidden="true" />}
                {isEnding ? 'Ending…' : 'End Shift'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── 4. KPI ROW ───────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, iconClass, sub, badge, onClick, sparkline, sparklineClass, valueClass }: {
  label: string;
  value: string;
  icon: React.ElementType;
  iconClass: string;
  sub?: React.ReactNode;
  badge?: React.ReactNode;
  onClick?: () => void;
  sparkline?: number[] | null;
  sparklineClass?: string;
  valueClass?: string;
}) {
  const interactive = typeof onClick === 'function';
  return (
    <div
      {...(interactive
        ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } }
        : {})}
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow ${
        interactive ? 'cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40' : ''
      }`}
      aria-label={interactive ? `${label} — open details` : label}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        {badge}
      </div>
      <p className="mt-2.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-bold tabular-nums ${valueClass ?? 'text-slate-900'}`} title={value}>
        {value}
      </p>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div> : null}
      {sparkline && sparkline.length >= 2 ? (
        <div className={`mt-2 ${sparklineClass ?? 'text-emerald-500'}`}>
          <Sparkline points={sparkline} />
        </div>
      ) : null}
    </div>
  );
}

function KpiRow({ data, onTab }: { data: DashboardData | null; onTab: (tab: AppTab) => void }) {
  if (!data) return null;

  const todayRevenue = num(data.todayRevenue);
  const txns = num(data.todayTransactions);
  const atv = num(data.averageTransactionValue);
  const outOfStock = num(data.outOfStockCount);
  const lowStock = num(data.lowStockCount);
  const stockTotal = outOfStock + lowStock || num(data.lowStockProducts);
  const debtTotal = num(data.debtCrisis?.outstandingTotal ?? data.outstandingDebt);

  const changeRaw = data.revenueChangePercent;
  const revenueChange = typeof changeRaw === 'number' && Number.isFinite(changeRaw) ? changeRaw : 0;
  const showTrendBadge = revenueChange !== 0 || todayRevenue > 0;

  // v2.13.3 (spec PART 2 — KPI fixes for a NEW branch): with zero sales today
  // the trend badge must read GRAY (never green/red — there is nothing to
  // celebrate or alarm about at 0) and the card must coach the cashier with
  // "No sales yet today — start selling!" instead of a bare 0.00.
  const noSalesToday = todayRevenue === 0 && txns === 0;
  const zeroSalesTrendBadge = noSalesToday ? (
    <span
      title="No sales yet today — start selling!"
      aria-label="No sales yet today — start selling!"
      className="inline-flex cursor-help items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400"
    >
      <Minus className="h-3 w-3" aria-hidden="true" />
      {`${Math.abs(revenueChange).toFixed(1)}%`}
    </span>
  ) : null;

  // Real series only — never fabricate a sparkline.
  const revenueSpark = (data.revenueTrend7d?.days ?? [])
    .map((day) => num(day?.revenue))
    .filter((v) => Number.isFinite(v));
  const hourly = Array.isArray(data.hourlySalesBreakdown) ? data.hourlySalesBreakdown : [];
  const txnSpark = hourly.map((h) => num(h?.transactionCount));
  // ATV sparkline only over hours that actually had sales (zero-sale hours
  // have no average — plotting 0 would fabricate a dip).
  const atvSpark = hourly
    .map((h) => {
      const c = num(h?.transactionCount);
      return c > 0 ? num(h?.amount) / c : 0;
    })
    .filter((v) => v > 0);

  return (
    <section aria-label="Today's key metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-5">
      <KpiCard
        label="Today's Revenue"
        value={formatKES(todayRevenue)}
        icon={Banknote}
        iconClass="bg-emerald-100 text-emerald-600"
        badge={noSalesToday ? zeroSalesTrendBadge : showTrendBadge ? <TrendBadge pct={revenueChange} /> : undefined}
        sub={<span>{noSalesToday ? 'No sales yet today — start selling!' : 'net of VAT · today'}</span>}
        sparkline={revenueSpark.length >= 2 ? revenueSpark : null}
        sparklineClass="text-emerald-500"
      />
      <KpiCard
        label="Transactions"
        value={String(txns)}
        icon={ShoppingCart}
        iconClass="bg-green-100 text-green-700"
        sub={<span>ATV {formatKES(atv)}</span>}
        sparkline={txnSpark.some((v) => v > 0) ? txnSpark : null}
        sparklineClass="text-green-600"
      />
      <KpiCard
        label="Avg Transaction"
        value={formatKES(atv)}
        icon={Calculator}
        iconClass="bg-amber-100 text-amber-600"
        sub={<span>per sale today</span>}
        sparkline={atvSpark.some((v) => v > 0) ? atvSpark : null}
        sparklineClass="text-amber-500"
      />
      <KpiCard
        label="Stock Alerts"
        value={String(stockTotal)}
        icon={Package}
        iconClass={outOfStock > 0 ? 'bg-red-100 text-red-600' : stockTotal > 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}
        valueClass={outOfStock > 0 ? 'text-red-600' : stockTotal > 0 ? 'text-amber-600' : 'text-slate-900'}
        sub={
          stockTotal > 0 ? (
            <span>
              <span className={outOfStock > 0 ? 'font-semibold text-red-600' : ''}>{outOfStock} out</span>
              {' · '}
              <span className={lowStock > 0 ? 'font-semibold text-amber-600' : ''}>{lowStock} low</span>
            </span>
          ) : (
            <span className="text-emerald-600">All stock healthy</span>
          )
        }
        onClick={() => onTab('inventory')}
      />
      <KpiCard
        label="Outstanding Debt"
        value={formatKES(debtTotal)}
        icon={HandCoins}
        iconClass="bg-rose-100 text-rose-600"
        valueClass={debtTotal > 0 ? 'text-rose-600' : 'text-slate-900'}
        sub={
          <button
            type="button"
            className="font-medium text-rose-600 underline-offset-2 hover:underline"
            onClick={() => onTab('debt-management')}
          >
            Tap to view debtors
          </button>
        }
      />
    </section>
  );
}

// ── 4b. LIMITED DASHBOARD (v2.12.5 RBAC — cashier / revenue-denied roles) ────
// Rendered INSTEAD of the full 12-section dashboard when the API payload says
// limitedView:true (server already refused to compute revenue/debt/analytics
// for these roles). 4 KPIs + own sales + info banner + LockedCards.

function paymentMethodBadgeClass(method: string): string {
  switch ((method || '').toUpperCase()) {
    case 'CASH': return 'bg-emerald-50 text-emerald-700';
    case 'MPESA': return 'bg-teal-50 text-teal-700';
    case 'DEBT': return 'bg-rose-50 text-rose-700';
    case 'SPLIT': return 'bg-purple-50 text-purple-700';
    case 'GIFT_CARD': return 'bg-amber-50 text-amber-700';
    default: return 'bg-slate-100 text-slate-600';
  }
}

function LimitedDashboard({ data }: { data: DashboardData | null }) {
  if (!data) return null;

  const todaySales = num(data.todaySales);
  const txns = num(data.transactions?.count ?? data.todaySales);
  const atv = num(data.averageTransactionValue);
  const low = num(data.lowStock?.low);
  const outOfStock = num(data.lowStock?.outOfStock);
  const stockTotal = num(data.lowStock?.count) || low + outOfStock;
  const mySales = Array.isArray(data.mySales) ? data.mySales : [];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 4 KPI cards only — every number comes from the API's limited payload */}
      <section aria-label="Today's key metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Today's Sales"
          value={formatKES(todaySales)}
          icon={Banknote}
          iconClass="bg-emerald-100 text-emerald-600"
          sub={<span>net of VAT · your sales</span>}
        />
        <KpiCard
          label="Transactions"
          value={String(txns)}
          icon={ShoppingCart}
          iconClass="bg-green-100 text-green-700"
          sub={<span>your sales today</span>}
        />
        <KpiCard
          label="Avg Order"
          value={formatKES(atv)}
          icon={Calculator}
          iconClass="bg-amber-100 text-amber-600"
          sub={<span>your average sale</span>}
        />
        <KpiCard
          label="Low Stock"
          value={String(stockTotal)}
          icon={Package}
          iconClass={outOfStock > 0 ? 'bg-red-100 text-red-600' : stockTotal > 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}
          valueClass={outOfStock > 0 ? 'text-red-600' : stockTotal > 0 ? 'text-amber-600' : 'text-slate-900'}
          sub={
            stockTotal > 0 ? (
              <span>
                <span className={outOfStock > 0 ? 'font-semibold text-red-600' : ''}>{outOfStock} out</span>
                {' · '}
                <span className={low > 0 ? 'font-semibold text-amber-600' : ''}>{low} low</span>
              </span>
            ) : (
              <span className="text-emerald-600">All stock healthy</span>
            )
          }
        />
      </section>

      {/* Info banner */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100">
          <Info className="h-4 w-4 text-slate-500" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            You&rsquo;re viewing a limited dashboard.
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Revenue, debt and analytics are hidden for your role.
          </p>
        </div>
      </div>

      {/* My Sales — the caller's own last sales only (receipt tail, method,
          amount, time-ago). Empty state kept friendly for new cashiers. */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            My Sales
          </CardTitle>
          <CardDescription>Your latest transactions at this branch</CardDescription>
        </CardHeader>
        <CardContent>
          {mySales.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              No sales recorded yet — your completed sales will appear here.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto custom-scrollbar" aria-label="My recent sales">
              {mySales.slice(0, 10).map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-700" title={sale.receiptNumber}>
                      {receiptTail(sale.receiptNumber)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${paymentMethodBadgeClass(sale.paymentMethod)}`}>
                      {sale.paymentMethod}
                    </span>
                    {sale.paymentStatus && sale.paymentStatus !== 'COMPLETED' ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        {sale.paymentStatus}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-bold tabular-nums text-slate-900">
                      {formatKES(num(sale.totalAmount))}
                    </span>
                    <span className="w-16 text-right text-[11px] text-slate-400" title={new Date(sale.createdAt).toLocaleString()}>
                      {timeAgo(new Date(sale.createdAt))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Locked sections — 2-col grid of LockedCards with Request Access */}
      <section aria-label="Locked dashboards" className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
        <LockedCard permission="dashboard.view.revenue" title="Revenue Trend" />
        <LockedCard permission="dashboard.view.debt_aging" title="Debt Aging" />
        <LockedCard permission="dashboard.view.profit_margin" title="Store Health" />
        <LockedCard permission="financial.view" title="Financial Reports" />
      </section>
    </div>
  );
}

// ── 5a. REVENUE TREND BY HOUR (pure CSS bars) ────────────────────────────────

function HourlyRevenueChart({ data }: { data: DashboardData | null }) {
  const hours = useMemo<HourlyPoint[]>(() => {
    const breakdown = Array.isArray(data?.hourlySalesBreakdown) ? data?.hourlySalesBreakdown ?? [] : [];
    const byHour = new Map<number, HourlyPoint>();
    breakdown.forEach((h) => {
      const k = parseInt(String(h?.hour ?? ''), 10);
      if (Number.isNaN(k)) return;
      byHour.set(k, { hour: String(k), amount: num(h?.amount), transactionCount: num(h?.transactionCount) });
    });
    // Business hours 6 AM – 9 PM only, for readability.
    return Array.from({ length: 16 }, (_, i) => {
      const hour = i + 6;
      return byHour.get(hour) ?? { hour: String(hour), amount: 0, transactionCount: 0 };
    });
  }, [data]);

  const peak = data?.revenueTrend7d?.peakHour ?? null;
  const max = Math.max(...hours.map((h) => h.amount), 0);
  const topIdx = hours.reduce((best, h, i) => (h.amount > (hours[best]?.amount ?? 0) ? i : best), 0);
  const secondIdx = hours.reduce((best, h, i) => {
    if (i === topIdx) return best;
    if (best === topIdx) return i;
    return h.amount > (hours[best]?.amount ?? 0) ? i : best;
  }, topIdx);

  const labelEvery = new Set([6, 9, 12, 15, 18, 21]);
  const yTicks = max > 0 ? [max, (max * 2) / 3, max / 3, 0] : [0, 0, 0, 0];

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <BarChart3 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Revenue trend · today by hour
        </CardTitle>
        <CardDescription className="text-xs">Sales between 6 AM and 9 PM</CardDescription>
      </CardHeader>
      <CardContent>
        {max <= 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <BarChart3 className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">No sales recorded yet today</p>
            <p className="text-xs text-slate-400">Bars appear as soon as the first sale lands</p>
          </div>
        ) : (
          <div className="flex gap-2">
            {/* Y axis — compact K labels */}
            <div className="flex h-40 w-10 shrink-0 flex-col justify-between pb-0 text-right text-[9px] tabular-nums text-slate-400">
              {yTicks.map((t, i) => (
                <span key={`${t}-${i}`}>{formatCompact(t)}</span>
              ))}
            </div>
            <div className="relative flex-1">
              {/* gridlines */}
              <div className="absolute inset-0 flex h-40 flex-col justify-between" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="border-t border-dashed border-slate-100" />
                ))}
                <div className="border-t border-slate-200" />
              </div>
              <div className="flex h-40 items-end gap-1 sm:gap-1.5">
                {hours.map((h, i) => {
                  const pct = max > 0 ? (h.amount / max) * 100 : 0;
                  const isTop = i === topIdx;
                  const isSecond = i === secondIdx && secondIdx !== topIdx;
                  return (
                    <div key={h.hour} className="relative flex h-full flex-1 items-end">
                      {isTop && peak && num(peak.amount) > 0 ? (
                        <span
                          className="pointer-events-none absolute left-1/2 z-10 max-w-[150px] -translate-x-1/2 truncate rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-medium text-white shadow-sm"
                          style={{ bottom: `min(${pct}%, calc(100% - 1.5rem))`, marginBottom: 4 }}
                          title={`Bulk sale · ${formatKES(num(peak.amount))}`}
                        >
                          Bulk sale · {formatKES(num(peak.amount))}
                        </span>
                      ) : null}
                      <div
                        className={`w-full rounded-t-md transition-all ${
                          isTop
                            ? 'bg-emerald-600'
                            : isSecond
                              ? 'bg-amber-500'
                              : 'bg-slate-300'
                        }`}
                        style={{ height: `${Math.max(pct, h.amount > 0 ? 3 : 0)}%` }}
                        title={`${formatHour(parseInt(h.hour, 10))} · ${formatKES(h.amount)}`}
                        role="img"
                        aria-label={`${formatHour(parseInt(h.hour, 10))}: ${formatKES(h.amount)}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {/* X labels */}
        <div className="mt-1.5 flex gap-1 pl-12 sm:gap-1.5">
          {hours.map((h) => (
            <span key={h.hour} className="flex-1 text-center text-[9px] text-slate-400">
              {labelEvery.has(parseInt(h.hour, 10)) ? formatHour(parseInt(h.hour, 10)).replace(' ', '') : ''}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── 5b. PAYMENT METHODS (conic-gradient donut) ───────────────────────────────

const PAYMENT_META: Record<string, { label: string; color: string }> = {
  CASH: { label: 'Cash', color: '#10b981' },
  MPESA: { label: 'M-Pesa', color: '#f59e0b' },
  DEBT: { label: 'Debt', color: '#f43f5e' },
  SPLIT: { label: 'Split', color: '#64748b' },
  GIFT_CARD: { label: 'Gift card', color: '#94a3b8' },
};

function PaymentMethodsCard({ data }: { data: DashboardData | null }) {
  const rows = useMemo(() => {
    const breakdown = Array.isArray(data?.paymentMethodBreakdown) ? data?.paymentMethodBreakdown ?? [] : [];
    return breakdown
      .map((pm) => ({
        method: String(pm?.method ?? ''),
        label: PAYMENT_META[String(pm?.method ?? '')]?.label ?? String(pm?.method ?? 'Other'),
        color: PAYMENT_META[String(pm?.method ?? '')]?.color ?? '#94a3b8',
        amount: num(pm?.amount),
        count: num(pm?.count),
      }))
      .filter((r) => r.amount > 0 || r.count > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [data]);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const gradient = useMemo(() => {
    if (total <= 0) return undefined;
    let acc = 0;
    const stops = rows.map((r) => {
      const from = acc;
      acc += (r.amount / total) * 100;
      return `${r.color} ${from.toFixed(2)}% ${acc.toFixed(2)}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [rows, total]);

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Wallet className="h-4 w-4 text-amber-600" aria-hidden="true" />
          Payment methods
        </CardTitle>
        <CardDescription className="text-xs">Share of today&rsquo;s collected payments</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 || total <= 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <Wallet className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">No payments recorded yet today</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <div className="relative h-36 w-36 shrink-0" role="img" aria-label="Payment methods distribution">
              <div className="h-full w-full rounded-full" style={{ background: gradient }} />
              <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-white text-center">
                <span className="max-w-full truncate px-1 text-[11px] font-bold tabular-nums text-slate-900" title={formatKES(total)}>
                  {formatCompact(total)}
                </span>
                <span className="text-[9px] uppercase tracking-wide text-slate-400">today</span>
              </div>
            </div>
            <ul className="w-full flex-1 space-y-2.5">
              {rows.map((r) => {
                const pct = (r.amount / total) * 100;
                return (
                  <li key={r.method}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden="true" />
                        <span className="truncate font-medium text-slate-700">{r.label}</span>
                        <span className="shrink-0 text-[10px] text-slate-400">({r.count})</span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-semibold text-slate-700">{pct.toFixed(1)}%</span>
                        <span className="ml-1.5 text-slate-400">{formatKES(r.amount)}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: r.color }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 6. QUICK ACTIONS ─────────────────────────────────────────────────────────

interface CashDrawerSummary {
  currentBalance: number;
  totalCashIn: number;
  totalCashOut: number;
}

async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}

function QuickActionsRow({ onTab }: { onTab: (tab: AppTab) => void }) {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerData, setDrawerData] = useState<CashDrawerSummary | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const openCashDrawer = async () => {
    setDrawerOpen(true);
    setDrawerLoading(true);
    try {
      const res = await authedFetch(`/api/cash-drawer?storeId=${encodeURIComponent(currentStoreId)}`);
      const json = await res.json();
      setDrawerData(json?.success && json?.summary ? json.summary : null);
    } catch {
      setDrawerData(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const actions: Array<{
    label: string;
    icon: React.ElementType;
    className: string;
    onClick: () => void;
  }> = [
    {
      label: 'New Sale',
      icon: ShoppingCart,
      className: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
      onClick: () => onTab('pos'),
    },
    {
      label: 'Add Product',
      icon: Plus,
      className: 'bg-green-50 text-green-700 hover:bg-green-100',
      onClick: () => onTab('catalog'),
    },
    {
      // No dedicated expenses tab — the Financial tab owns expense recording.
      label: 'Record Expense',
      icon: Receipt,
      className: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
      onClick: () => onTab('financial'),
    },
    {
      label: 'View Reports',
      icon: BarChart3,
      className: 'bg-purple-50 text-purple-700 hover:bg-purple-100',
      onClick: () => onTab('reports'),
    },
    {
      label: 'Cash Drawer',
      icon: Wallet,
      className: 'bg-teal-50 text-teal-700 hover:bg-teal-100',
      onClick: () => void openCashDrawer(),
    },
  ];

  return (
    <>
      <section aria-label="Quick actions" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-transparent px-3 py-3 text-xs font-semibold shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 sm:flex-col sm:gap-2 ${action.className}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {action.label}
            </button>
          );
        })}
      </section>

      {/* Cash Drawer dialog — existing /api/cash-drawer pattern */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-5 w-5 text-teal-600" aria-hidden="true" />
              Cash Drawer
            </DialogTitle>
            <DialogDescription>Live cash position for the current drawer.</DialogDescription>
          </DialogHeader>
          {drawerLoading ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : drawerData ? (
            <div className="space-y-2 py-2">
              <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
                <span className="text-xs font-medium text-emerald-700">Current balance</span>
                <span className="text-sm font-bold tabular-nums text-emerald-700">{formatKES(num(drawerData.currentBalance))}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <span className="text-xs text-slate-500">Total cash in</span>
                <span className="text-sm font-semibold tabular-nums text-emerald-600">+{formatKES(num(drawerData.totalCashIn))}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <span className="text-xs text-slate-500">Total cash out</span>
                <span className="text-sm font-semibold tabular-nums text-red-600">−{formatKES(num(drawerData.totalCashOut))}</span>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-slate-500">
              Drawer summary is unavailable right now.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── 7a. RECENT ACTIVITY (Recent Sales / System Activity) ─────────────────────

const PM_BADGE: Record<string, string> = {
  CASH: 'bg-emerald-100 text-emerald-700',
  MPESA: 'bg-amber-100 text-amber-700',
  DEBT: 'bg-rose-100 text-rose-600',
  SPLIT: 'bg-slate-200 text-slate-600',
  GIFT_CARD: 'bg-slate-100 text-slate-500',
};

function severityTone(severity: string | null | undefined): string {
  const s = String(severity ?? '').toUpperCase();
  if (s.includes('ERR') || s.includes('CRIT')) return 'bg-red-500';
  if (s.includes('WARN')) return 'bg-amber-500';
  return 'bg-slate-400';
}

function RecentActivityCard({ data }: { data: DashboardData | null }) {
  const [view, setView] = useState<'sales' | 'system'>('sales');
  const sales = Array.isArray(data?.recentTransactions) ? data?.recentTransactions ?? [] : [];
  const activities = Array.isArray(data?.recentActivities) ? data?.recentActivities ?? [] : [];

  return (
    <Card className="flex flex-col rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold text-slate-900">Recent activity</CardTitle>
          <div className="flex rounded-full bg-slate-100 p-0.5" role="tablist" aria-label="Activity view">
            {(['sales', 'system'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                  view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {v === 'sales' ? 'Recent sales' : 'System'}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {view === 'sales' ? (
          sales.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <Receipt className="h-8 w-8 text-slate-300" aria-hidden="true" />
              <p className="text-sm text-slate-500">No sales yet</p>
              <p className="text-xs text-slate-400">Your latest receipts will appear here</p>
            </div>
          ) : (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1 custom-scrollbar">
              {sales.map((tx, i) => {
                const method = String(tx?.paymentMethod ?? '');
                return (
                  <li key={String(tx?.id ?? i)} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm">
                        <span className="font-mono font-semibold text-slate-900">{receiptTail(tx?.receiptNumber)}</span>
                        <Badge variant="secondary" className={`h-4 px-1.5 text-[9px] font-semibold ${PM_BADGE[method] ?? 'bg-slate-100 text-slate-500'}`}>
                          {PAYMENT_META[method]?.label ?? method}
                        </Badge>
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {tx?.customer?.name || 'Walk-in'} · {timeAgo(tx?.createdAt)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatKES(num(tx?.totalAmount))}</p>
                  </li>
                );
              })}
            </ul>
          )
        ) : activities.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <Activity className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">No system activity yet</p>
            <p className="text-xs text-slate-400">Actions like logins and product updates show up here</p>
          </div>
        ) : (
          <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1 custom-scrollbar">
            {activities.map((a, i) => (
              <li key={String(a?.id ?? i)} className="flex items-start gap-2.5 border-b border-slate-100 py-2.5 last:border-0">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityTone(a?.severity)}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-800" title={a?.displayMessage ?? ''}>
                    {a?.displayMessage || a?.action || 'System event'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {a?.actorName || a?.user?.name || 'System'} · {timeAgo(a?.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── 7b. STORE HEALTH (SVG circular gauge) ────────────────────────────────────

function healthColor(score: number, key?: string): string {
  if (key === 'debt' && score < 30) return '#ef4444';
  if (key === 'engagement' && score < 50) return '#f97316';
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function StoreHealthCard({ data }: { data: DashboardData | null }) {
  const health: StoreHealthSummary | null | undefined = data?.storeHealth;
  const overall = Math.max(0, Math.min(100, num(health?.overall)));
  const hasHealth = !!health && health.breakdown != null;
  const C = 2 * Math.PI * 34;
  const strokeColor = healthColor(overall);

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Zap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Store health
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasHealth ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <Activity className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">Health score unavailable</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`Store health ${overall} of 100`}>
                <circle cx="44" cy="44" r="34" fill="none" stroke="#e2e8f0" strokeWidth="8" />
                <circle
                  cx="44"
                  cy="44"
                  r="34"
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(overall / 100) * C} ${C}`}
                  transform="rotate(-90 44 44)"
                />
                <text x="44" y="43" textAnchor="middle" fontSize="19" fontWeight="700" fill="#0f172a">
                  {overall}
                </text>
                <text x="44" y="57" textAnchor="middle" fontSize="9" fill="#64748b">
                  {health?.label ?? '—'}
                </text>
              </svg>
              <div className="min-w-0 text-xs text-slate-500">
                <p className="font-medium text-slate-700">
                  {overall >= 80 ? 'Trading well today' : overall >= 60 ? 'Room to push today' : 'Needs attention'}
                </p>
                <p className="mt-1 leading-relaxed">
                  Weighted from revenue, stock, debt and customer engagement.
                </p>
              </div>
            </div>

            <ul className="mt-4 space-y-3">
              {(health?.breakdown ?? []).map((item) => {
                const score = Math.max(0, Math.min(100, num(item?.score)));
                const weight = num(item?.weight);
                const color = healthColor(score, item?.key);
                return (
                  <li key={item?.key ?? item?.label}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-700">
                        {item?.label ?? '—'}
                        <span className="ml-1.5 text-[10px] text-slate-400">{weight}% weight</span>
                      </span>
                      <span className="font-semibold tabular-nums" style={{ color }}>
                        {score}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${score}%`, backgroundColor: color }}
                      />
                    </div>
                    {item?.detail ? <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{item.detail}</p> : null}
                  </li>
                );
              })}
            </ul>

            <p className="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
              {`Weighted: Revenue ${num(health?.weights?.revenue)}% + Stock ${num(health?.weights?.stock)}% + Debt ${num(health?.weights?.debt)}% + Engagement ${num(health?.weights?.engagement)}%`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── 7c. HOURLY SALES HEATMAP ─────────────────────────────────────────────────

function HourlyHeatmapCard({ data }: { data: DashboardData | null }) {
  const hours = useMemo(() => {
    const breakdown = Array.isArray(data?.hourlySalesBreakdown) ? data?.hourlySalesBreakdown ?? [] : [];
    const byHour = new Map<number, number>();
    breakdown.forEach((h) => {
      const k = parseInt(String(h?.hour ?? ''), 10);
      if (!Number.isNaN(k)) byHour.set(k, num(h?.amount));
    });
    // 6 AM – 9 PM window, matching the bar chart above.
    return Array.from({ length: 16 }, (_, i) => {
      const hour = i + 6;
      return { hour, amount: byHour.get(hour) ?? 0 };
    });
  }, [data]);

  const max = Math.max(...hours.map((h) => h.amount), 0);
  const total = hours.reduce((s, h) => s + h.amount, 0);
  const peak = hours.reduce((best, h) => (h.amount > best.amount ? h : best), hours[0] ?? { hour: 6, amount: 0 });
  const quiet = hours.reduce((best, h) => (h.amount < best.amount ? h : best), hours[0] ?? { hour: 6, amount: 0 });

  const cellColor = (amount: number): string => {
    if (max <= 0 || amount <= 0) return '#f1f5f9';
    const t = Math.min(1, amount / max);
    return `rgba(5, 150, 105, ${(0.12 + 0.88 * t).toFixed(3)})`;
  };

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Clock className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Hourly sales heatmap
        </CardTitle>
        <CardDescription className="text-xs">6 AM – 9 PM · darker means busier</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {max <= 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
            <Clock className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">No sales recorded yet today</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1" role="img" aria-label="Hourly sales intensity from 6 AM to 9 PM">
              {hours.map((h) => (
                <div
                  key={h.hour}
                  className="aspect-square rounded-[4px] transition-colors"
                  style={{ backgroundColor: cellColor(h.amount) }}
                  title={`${formatHour(h.hour)} · ${formatKES(h.amount)}`}
                />
              ))}
            </div>
            <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1">
              {hours.map((h) => (
                <span key={h.hour} className="text-center text-[8px] leading-tight text-slate-400">
                  {h.hour % 2 === 0 ? (h.hour < 12 ? `${h.hour}a` : h.hour === 12 ? '12p' : `${h.hour - 12}p`) : ''}
                </span>
              ))}
            </div>
            <dl className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-400">Peak hour</dt>
                <dd className="mt-0.5 text-xs font-bold text-emerald-700">{formatHour(peak.hour)}</dd>
                <dd className="text-[10px] tabular-nums text-slate-500">{formatKES(peak.amount)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-400">Quietest</dt>
                <dd className="mt-0.5 text-xs font-bold text-slate-600">{formatHour(quiet.hour)}</dd>
                <dd className="text-[10px] tabular-nums text-slate-500">{formatKES(quiet.amount)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-400">Total today</dt>
                <dd className="mt-0.5 text-xs font-bold text-slate-900">{formatCompact(total)}</dd>
                <dd className="text-[10px] tabular-nums text-slate-500">Ksh collected</dd>
              </div>
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── 8. TOP CUSTOMERS (by lifetime spend) ─────────────────────────────────────

function tierFor(spend: number): { label: 'GOLD' | 'SILVER' | 'BRONZE'; className: string } {
  if (spend >= 300_000) return { label: 'GOLD', className: 'bg-yellow-100 text-yellow-700' };
  if (spend >= 100_000) return { label: 'SILVER', className: 'bg-slate-200 text-slate-600' };
  return { label: 'BRONZE', className: 'bg-amber-100 text-amber-700' };
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function TopCustomersCard({ data, onTab }: { data: DashboardData | null; onTab: (tab: AppTab) => void }) {
  const customers = useMemo(() => {
    const list = Array.isArray(data?.debtCrisis?.customers) ? [...data.debtCrisis.customers] : [];
    return list
      .sort((a, b) => num(b?.lifetimeSpend) - num(a?.lifetimeSpend))
      .slice(0, 5);
  }, [data]);

  const maxSpend = Math.max(...customers.map((c) => num(c?.lifetimeSpend)), 1);
  const maxOwes = Math.max(...customers.map((c) => num(c?.owes)), 1);

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Users className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Top customers · All time
          </CardTitle>
          <button
            type="button"
            onClick={() => onTab('customers')}
            className="text-xs font-medium text-emerald-600 underline-offset-2 hover:underline"
          >
            All
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {customers.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <Users className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">No customers yet</p>
            <p className="text-xs text-slate-400">Customer spend rankings appear after your first sales</p>
          </div>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
            {customers.map((c, i) => {
              const spend = num(c?.lifetimeSpend);
              const owes = num(c?.owes);
              const tier = tierFor(spend);
              const highRisk = c?.highRisk === true;
              return (
                <li
                  key={String(c?.customerId ?? i)}
                  className={`rounded-xl border p-2.5 ${highRisk ? 'border-red-300 bg-red-50' : 'border-slate-100 bg-white'}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-5 shrink-0 text-center text-xs font-bold text-slate-400">#{i + 1}</span>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${highRisk ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>
                      {initialsOf(String(c?.name ?? ''))}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-900">
                        <span className="max-w-[9rem] truncate sm:max-w-[10rem]" title={String(c?.name ?? '')}>
                          {c?.name ?? 'Unknown'}
                        </span>
                        <Badge variant="secondary" className={`h-4 px-1.5 text-[9px] font-bold ${tier.className}`}>
                          {tier.label}
                        </Badge>
                        {highRisk && (
                          <Badge className="h-4 bg-red-600 px-1.5 text-[9px] font-bold text-white hover:bg-red-600">
                            HIGH RISK
                          </Badge>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                        Spent <span className="font-semibold text-slate-700">{formatKES(spend)}</span>
                        {owes > 0 && (
                          <> · <span className="font-medium text-red-600">Owes {formatKES(owes)}</span></>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-red-400 to-rose-500"
                      style={{ width: `${Math.min(100, (owes / maxOwes) * 100)}%` }}
                    />
                  </div>
                  {/* spend context bar — share of top spender */}
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-50">
                    <div className="h-full rounded-full bg-emerald-200" style={{ width: `${Math.min(100, (spend / maxSpend) * 100)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── 9. TOP SELLING PRODUCTS ──────────────────────────────────────────────────

function TopProductsCard({ data }: { data: DashboardData | null }) {
  const products: TopProduct[] = useMemo(() => {
    const list = Array.isArray(data?.topProducts) ? data.topProducts : [];
    return list.slice(0, 5);
  }, [data]);

  const maxRevenue = Math.max(...products.map((p) => num(p?.totalRevenue)), 1);

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Package className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Top selling products
        </CardTitle>
        <CardDescription className="text-xs">Today&rsquo;s movers by revenue</CardDescription>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <Package className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">No sales yet today</p>
            <p className="text-xs text-slate-400">Your best sellers will rank here</p>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {products.map((p, i) => {
              const revenue = num(p?.totalRevenue);
              const qty = num(p?.totalQuantity);
              const share = Math.min(100, (revenue / maxRevenue) * 100);
              return (
                <li key={String(p?.productId ?? i)} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-2">
                  <span className="text-xs font-bold text-slate-400">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900" title={String(p?.productName ?? '')}>
                      {p?.productName ?? 'Unknown product'}
                    </p>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${share}%` }} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">{formatKES(revenue)}</p>
                    <p className="text-[10px] text-slate-400">{qty} sold</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// ── 10. SALES TREND (7 DAYS) + FORECAST ──────────────────────────────────────

function SalesTrendForecastCard({ data }: { data: DashboardData | null }) {
  const trend: RevenueTrend7d | null | undefined = data?.revenueTrend7d;
  const days = useMemo(
    () => (Array.isArray(trend?.days) ? trend.days : []),
    [trend],
  );
  const forecast = num(trend?.forecast);
  const canChart = days.length >= 2;

  const W = 320;
  const H = 130;
  const PAD = 8;

  const geometry = useMemo(() => {
    if (!canChart) return null;
    const values = days.map((d) => num(d?.revenue));
    const max = Math.max(...values, forecast, 1);
    const x = (i: number) => PAD + (i / (days.length - 1)) * (W - PAD * 2);
    const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
    const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
    const linePoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = `M ${pts[0].x.toFixed(1)} ${H - PAD} L ${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')} L ${pts[pts.length - 1].x.toFixed(1)} ${H - PAD} Z`;
    return { pts, linePoints, areaPath, forecastY: y(forecast), max };
  }, [canChart, days, forecast]);

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Sales trend · 7 days
        </CardTitle>
        <CardDescription className="text-xs">Net revenue with forecast</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!canChart || !geometry ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <TrendingUp className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">Not enough history yet</p>
            <p className="text-xs text-slate-400">The 7-day trend appears after a couple of trading days</p>
          </div>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Revenue trend for the last 7 days with forecast line">
              <defs>
                <linearGradient id="dashRevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {/* forecast dashed line */}
              <line
                x1={PAD}
                x2={W - PAD}
                y1={geometry.forecastY}
                y2={geometry.forecastY}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="5 4"
              />
              {/* area + line */}
              <path d={geometry.areaPath} fill="url(#dashRevGrad)" />
              <polyline
                points={geometry.linePoints}
                fill="none"
                stroke="#059669"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {geometry.pts.map((p, i) => {
                const isToday = days[i]?.isToday === true;
                return (
                  <circle
                    key={days[i]?.date ?? i}
                    cx={p.x}
                    cy={p.y}
                    r={isToday ? 4.5 : 2.5}
                    fill={isToday ? '#059669' : '#ffffff'}
                    stroke="#059669"
                    strokeWidth={isToday ? 2 : 1.5}
                  />
                );
              })}
            </svg>
            <div className="flex justify-between px-0.5 text-[9px] text-slate-400">
              {days.map((d, i) => (
                <span key={d?.date ?? i} className={d?.isToday ? 'font-semibold text-emerald-600' : ''}>
                  {d?.label ?? ''}
                </span>
              ))}
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="inline-block h-0 w-5 border-t-2 border-dashed border-amber-500" aria-hidden="true" />
              Forecast {formatKES(forecast)} · {trend?.forecastMethod || 'median of prior 6 days'}
            </p>
            {trend?.todayIsOutlier === true && (
              <p className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Today is a bulk-sale outlier — forecast uses the median of the previous 6 days.
              </p>
            )}
          </>
        )}

        {/* Growing products — the backend does not provide this series yet;
            honest empty state, never fabricated. */}
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <Sparkles className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
            Top 3 growing products
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            Not enough history yet — check back after a few more days of sales.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 11. DEBT AGING SUMMARY ───────────────────────────────────────────────────

function DebtAgingCard({ data }: { data: DashboardData | null }) {
  const crisis: DebtCrisisSummary | null | undefined = data?.debtCrisis;
  const total = num(crisis?.outstandingTotal ?? data?.outstandingDebt);
  const aging = crisis?.aging;
  const buckets = aging
    ? {
        current: num(aging.current),
        d30: num(aging.d30),
        d60: num(aging.d60),
        d90plus: num(aging.d90plus),
      }
    : null;
  const bucketSum = buckets ? buckets.current + buckets.d30 + buckets.d60 + buckets.d90plus : 0;
  const sumsReconcile = buckets != null && Math.abs(bucketSum - total) < 0.05;
  const count = num(crisis?.outstandingCount ?? data?.outstandingDebtCount);

  const segments = buckets
    ? [
        { key: 'current', label: 'Current', value: buckets.current, color: '#10b981' },
        { key: 'd30', label: '30 days', value: buckets.d30, color: '#64748b' },
        { key: 'd60', label: '60 days', value: buckets.d60, color: '#f97316' },
        { key: 'd90plus', label: '90+ days', value: buckets.d90plus, color: '#ef4444' },
      ]
    : [];

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CircleDollarSign className="h-4 w-4 text-rose-500" aria-hidden="true" />
          Debt aging summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {total <= 0 ? (
          <div className="flex h-28 flex-col items-center justify-center gap-2 text-center">
            <CheckCircle className="h-8 w-8 text-emerald-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">No outstanding debt — all clear</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Total outstanding</p>
              <p className="text-lg font-bold tabular-nums text-rose-600">{formatKES(total)}</p>
            </div>
            {count > 0 && <p className="-mt-2 text-[11px] text-slate-400">{count} outstanding bill{count === 1 ? '' : 's'}</p>}

            {buckets && (
              <>
                {/* Segmented aging bar — shares of the total */}
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Debt aging distribution">
                  {segments.map((seg) => (
                    <div
                      key={seg.key}
                      className="h-full transition-all duration-500"
                      style={{ width: `${total > 0 ? (seg.value / total) * 100 : 0}%`, backgroundColor: seg.color }}
                      title={`${seg.label}: ${formatKES(seg.value)}`}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {segments.map((seg) => (
                    <div key={seg.key} className="rounded-xl border border-slate-200 p-2.5">
                      <p className="flex items-center gap-1 text-[10px] font-medium text-slate-500">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: seg.color }} aria-hidden="true" />
                        {seg.label}
                      </p>
                      <p className="mt-0.5 text-xs font-bold tabular-nums text-slate-900">{formatKES(seg.value)}</p>
                    </div>
                  ))}
                </div>

                {sumsReconcile && (
                  <p className="flex items-center gap-1 text-[10px] text-slate-400">
                    <CheckCircle className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                    Ages sum to the total outstanding
                  </p>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── 12. ALERTS & NOTIFICATIONS ───────────────────────────────────────────────

function alertSeverityStyle(severity: string): { icon: React.ElementType; circle: string; text: string } {
  if (severity === 'critical') return { icon: AlertTriangle, circle: 'bg-red-100 text-red-600', text: 'text-red-600' };
  if (severity === 'warning') return { icon: AlertTriangle, circle: 'bg-amber-100 text-amber-600', text: 'text-amber-600' };
  return { icon: Info, circle: 'bg-slate-100 text-slate-500', text: 'text-slate-500' };
}

function alertActionTab(alert: DashboardAlert, action: string): AppTab | null {
  if (action === 'collect') return 'debt-management';
  if (action === 'call') return 'messaging';
  if (action === 'view') {
    if (alert?.type === 'rental_overdue') return 'rentals';
    if (alert?.type === 'stock_low') return 'inventory';
    return 'transactions';
  }
  return null;
}

function alertActionIcon(action: string): React.ElementType {
  if (action === 'collect') return HandCoins;
  if (action === 'call') return Phone;
  if (action === 'view') return Eye;
  return ArrowUpRight;
}

function alertActionLabel(action: string): string {
  if (action === 'collect') return 'Collect';
  if (action === 'call') return 'Call';
  if (action === 'view') return 'View';
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function AlertsCard({ data, onTab }: { data: DashboardData | null; onTab: (tab: AppTab) => void }) {
  const alerts: DashboardAlert[] = Array.isArray(data?.alerts) ? data.alerts : [];
  // Backend guarantees alertsCount === returned list length; derive from the
  // list so the badge can never disagree with what is rendered.
  const alertsCount = alerts.length;

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Bell className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Alerts
            {alertsCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                {alertsCount > 99 ? '99+' : alertsCount}
              </span>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
        {alerts.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <CheckCircle className="h-8 w-8 text-emerald-400" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-700">All clear</p>
            <p className="text-xs text-slate-400">No overdue rentals, debts or stock emergencies</p>
          </div>
        ) : (
          <ul className="max-h-80 space-y-0.5 overflow-y-auto pr-1 custom-scrollbar">
            {alerts.map((alert, i) => {
              const style = alertSeverityStyle(String(alert?.severity ?? 'info'));
              const Icon = style.icon;
              const actions = Array.isArray(alert?.actions) ? alert.actions : [];
              return (
                <li key={String(alert?.dedupeKey ?? i)} className="flex flex-wrap items-start gap-3 border-b border-slate-100 py-2.5 last:border-0 sm:flex-nowrap">
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.circle}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900" title={alert?.title ?? ''}>
                      {alert?.title ?? 'Alert'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{alert?.detail ?? ''}</p>
                  </div>
                  {actions.length > 0 && (
                    <div className="flex w-full shrink-0 gap-1.5 sm:w-auto">
                      {actions.slice(0, 3).map((action) => {
                        const target = alertActionTab(alert, String(action));
                        const ActionIcon = alertActionIcon(String(action));
                        if (!target) return null;
                        return (
                          <Button
                            key={String(action)}
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-50"
                            onClick={() => onTab(target)}
                          >
                            <ActionIcon className="h-3 w-3" aria-hidden="true" />
                            {alertActionLabel(String(action))}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5 text-[10px] text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          <span>System healthy</span>
          <span aria-hidden="true">·</span>
          <span>Last sync just now</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        <Skeleton className="h-64 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-64 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-64 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl lg:col-span-2" />
      </div>
    </div>
  );
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export default function DashboardTab() {
  const { currentStoreId, setActiveTab } = useAppStore();
  const user = useAuthStore((s) => s.user);

  const onTab = useCallback(
    (tab: AppTab) => {
      setActiveTab(tab);
    },
    [setActiveTab],
  );

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['dashboard', currentStoreId],
    queryFn: async (): Promise<DashboardData | null> => {
      const res = await dashboardApi.getStats(currentStoreId);
      const raw = res.data as DashboardData | null;
      if (!raw || typeof raw !== 'object') return null;
      // Defensive: coerce every list the UI renders (Decimal-string audit
      // precedent — never trust wire shapes).
      return {
        ...raw,
        salesByHour: Array.isArray(raw.salesByHour) ? raw.salesByHour : [],
        paymentMethodBreakdown: Array.isArray(raw.paymentMethodBreakdown) ? raw.paymentMethodBreakdown : [],
        recentTransactions: Array.isArray(raw.recentTransactions) ? raw.recentTransactions : [],
        topProducts: Array.isArray(raw.topProducts) ? raw.topProducts : [],
        hourlySalesBreakdown: Array.isArray(raw.hourlySalesBreakdown) ? raw.hourlySalesBreakdown : [],
        lowStockItems: Array.isArray(raw.lowStockItems) ? raw.lowStockItems : [],
        recentActivities: Array.isArray(raw.recentActivities) ? raw.recentActivities : [],
        alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
      } as DashboardData;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const shift = data?.shift ?? null;
  const crisis = data?.debtCrisis ?? null;
  const view = data ?? null;
  const lastSyncLabel = dataUpdatedAt ? timeAgo(new Date(dataUpdatedAt)) : 'just now';

  if (isLoading && !data) {
    return (
      <div className="-m-4 min-h-full bg-slate-50 p-4 sm:p-5">
        <DashboardSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="-m-4 min-h-full bg-slate-50 p-4 sm:p-5">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-900">Dashboard could not load</p>
            <p className="max-w-sm text-xs text-slate-500">
              We couldn&rsquo;t reach the dashboard service. Check your connection and try again.
            </p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void refetch()}>
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── v2.12.5 RBAC: LIMITED DASHBOARD (cashier / revenue-denied roles) ──
  // The API early-returns a minimal payload (limitedView:true) for roles
  // without 'dashboard.view.revenue'; render the dedicated compact layout
  // instead of the full 12-section dashboard.
  if (view?.limitedView) {
    return (
      <div className="-m-4 min-h-full space-y-4 bg-slate-50 p-4 sm:space-y-6 sm:p-5">
        <DashboardHero onTab={onTab} limited />
        <LimitedDashboard data={view} />
        <p className="pb-1 text-center text-[10px] text-slate-400">
          Live data · auto-refreshes every 30s{user?.name ? ` · signed in as ${user.name}` : ''} · last sync {lastSyncLabel}
        </p>
      </div>
    );
  }

  return (
    <div className="-m-4 min-h-full space-y-4 bg-slate-50 p-4 sm:space-y-6 sm:p-5">
      {/* 1. HERO */}
      <DashboardHero onTab={onTab} />

      {/* 2. DEBT CRISIS BANNER (conditional) */}
      {crisis?.warning === true && <DebtCrisisBanner crisis={crisis} onTab={onTab} />}

      {/* 3. ACTIVE SHIFT (only while a shift is open) */}
      {shift && <ActiveShiftCard shift={shift} />}

      {/* 4. KPI ROW */}
      <KpiRow data={view} onTab={onTab} />

      {/* 5. MIDDLE ROW — hourly bars (2/3) + payment donut (1/3) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        <div className="lg:col-span-2">
          <HourlyRevenueChart data={view} />
        </div>
        <PaymentMethodsCard data={view} />
      </div>

      {/* 6. QUICK ACTIONS */}
      <QuickActionsRow onTab={onTab} />

      {/* 7. BOTTOM GRID — activity / health / heatmap */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        <RecentActivityCard data={view} />
        <StoreHealthCard data={view} />
        <HourlyHeatmapCard data={view} />
      </div>

      {/* 8–10. Customers / products / 7-day trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        <TopCustomersCard data={view} onTab={onTab} />
        <TopProductsCard data={view} />
        <SalesTrendForecastCard data={view} />
      </div>

      {/* 11–12. Debt aging + alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        <DebtAgingCard data={view} />
        <AlertsCard data={view} onTab={onTab} />
      </div>

      {/* Footer meta — live data confirmation */}
      <p className="pb-1 text-center text-[10px] text-slate-400">
        Live data · auto-refreshes every 30s{user?.name ? ` · signed in as ${user.name}` : ''} · last sync {lastSyncLabel}
      </p>
    </div>
  );
}
