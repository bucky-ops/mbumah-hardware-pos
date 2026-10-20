'use client';

// KPI Command Row - 6 KPI cards with count-up, sparkline and the real
// week-vs-prior-week variance from /api/org/kpi-summary. No fabricated trend
// windows: the drill-down modal shows the actual 7-day gross-revenue sparkline
// and the real week totals. v2.185.0: BOTH org surfaces speak GROSS of tax —
// the headline is the till face, and the VAT lens rides additively under an
// explicitly-labeled ribbon (never mixed into the headline again).

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowDownRight, ArrowUpRight, Banknote, CalendarCheck2, Clock3, HandCoins, PackageOpen, ShoppingCart, TrendingUp } from 'lucide-react';
import { CountUp, Sparkline, WeekDeltaChip, kes, num, type KpiSummaryData, type StoreRow } from './primitives';

/** Compact KES for tight chips: 437k / 1.2m / 97.5k. */
const kShort = (v: number): string =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}m` : v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v);

export function KpiRow({ data, perStoreTrend, stores = [] }: {
  data: KpiSummaryData;
  /**
   * v2.176.0: the per-branch week — the SAME additive block /api/org/summary
   * has ridden since v2.175.0, passed in by the console page from the
   * response it already polls (no second fetch). TOLERANT — optional +
   * nullable: a branch manager without matrix access (or an older cached
   * answer) keeps the modal's org-wide story only, never a crash or a
   * fabricated shape.
   */
  perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number }> | null;
  /** Branch names for the drill-down rows, joined by storeId (never row order). */
  stores?: StoreRow[];
}) {
  const [trendOpen, setTrendOpen] = useState(false);
  const k = data.kpis;
  const debtHot = k.debt.total > 400_000;
  const pendingTotal = k.pending.purchaseOrders + k.pending.openShifts + k.pending.expenses;

  // v2.176.0: the drill-down's branch rows — joined by storeId (never row
  // order), loudest week first; a quiet branch still speaks (honest zeros,
  // a flat line). Only built when BOTH halves arrived: the trend block AND
  // the branch names (a branch manager's denied summary leaves both null).
  // v2.177.0: the rows carry the prior week through (still the same payload
  // entries — no new fetch) so each row can speak its own verdict chip.
  const branchWeek = perStoreTrend && stores.length > 0
    ? perStoreTrend
        .map((t) => ({
          storeId: t.storeId,
          spark: t.spark,
          weekTotal: t.weekTotal,
          priorWeekTotal: t.priorWeekTotal,
          name: stores.find((s) => s.id === t.storeId)?.name ?? 'Branch',
        }))
        .sort((a, b) => b.weekTotal - a.weekTotal)
    : null;

  return (
    <section aria-label="KPI command row" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {/* Revenue */}
      <button
        onClick={() => setTrendOpen(true)}
        className="focus-ring group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-orange-500" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Banknote className="h-3.5 w-3.5 text-emerald-700" /> Revenue
            {/* v2.185.0: the till-face qualifier — one word where the
                divergence used to live, styled quiet so the number leads. */}
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200" title="Gross of VAT — the same till face the owner dashboard speaks">gross</span>
          </span>
          <span className="h-2 w-2 rounded-full bg-orange-500 anim-pulse-dot" />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <CountUp value={k.revenue.today} format={(v) => num(v)} className="anim-count-glow text-2xl font-bold text-emerald-700" />
          <span className={`flex items-center text-xs font-semibold ${k.revenue.variancePct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {k.revenue.variancePct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {k.revenue.variancePct >= 0 ? '+' : ''}{k.revenue.variancePct}%
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <Sparkline data={k.revenue.spark} />
          <span className="text-[10px] text-slate-500">{kes(k.revenue.weekTotal)} · 7d</span>
        </div>
      </button>

      {/* Transactions */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><CalendarCheck2 className="h-3.5 w-3.5 text-blue-500" /> Transactions</div>
        <div className="mt-1 flex items-baseline gap-2">
          <CountUp value={k.transactions.today} className="text-2xl font-bold text-blue-600" />
          <span className={`flex items-center text-xs font-semibold ${k.transactions.variancePct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {k.transactions.variancePct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {k.transactions.variancePct >= 0 ? '+' : ''}{k.transactions.variancePct}%
          </span>
        </div>
        <p className="mt-2 text-[10px] text-slate-500">today · 7d {num(k.transactions.weekTotal)} vs prior {num(k.transactions.priorWeekTotal)}</p>
      </div>

      {/* Low stock */}
      <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${k.lowStock.count > 0 ? 'ring-1 ring-orange-200' : ''}`}>
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><PackageOpen className="h-3.5 w-3.5 text-orange-500" /> Low stock</div>
        <div className="mt-1 flex items-center gap-2">
          <CountUp value={k.lowStock.count} className={`text-2xl font-bold ${k.lowStock.count > 0 ? 'text-orange-500' : 'text-slate-700'}`} />
          {k.lowStock.count > 0 && <span className="h-2 w-2 rounded-full bg-orange-500 anim-pulse-dot" />}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">at/below reorder level · org-wide</p>
      </div>

      {/* Overdue rentals */}
      <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${k.overdueRentals.count > 0 ? 'ring-1 ring-red-200' : ''}`}>
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Clock3 className="h-3.5 w-3.5 text-red-500" /> Overdue</div>
        <div className="mt-1 flex items-center gap-2">
          <CountUp value={k.overdueRentals.count} className={`text-2xl font-bold ${k.overdueRentals.count > 0 ? 'text-red-500' : 'text-slate-700'}`} />
          {k.overdueRentals.count > 0 && <span className="h-2 w-2 rounded-full bg-red-500 anim-pulse-dot" />}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">rentals past return</p>
      </div>

      {/* Debt */}
      <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${debtHot ? 'ring-1 ring-red-300' : ''}`}>
        <div className={`flex items-center gap-1.5 text-xs font-medium text-slate-500 ${debtHot ? 'anim-shake' : ''}`}><HandCoins className="h-3.5 w-3.5 text-red-500" /> Debt {debtHot ? '· shake alert' : ''}</div>
        <div className="mt-1">
          <CountUp value={k.debt.total} format={kes} className="text-xl font-bold text-red-500" />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1 text-[9px]">
          <Badge variant="outline" className="px-1 py-0 text-slate-500">C {kShort(k.debt.aging.current)}</Badge>
          <Badge variant="outline" className="px-1 py-0 text-amber-700">30d {kShort(k.debt.aging.d30)}</Badge>
          <Badge variant="outline" className="px-1 py-0 text-orange-800">60d {kShort(k.debt.aging.d60)}</Badge>
          <Badge variant="outline" className="px-1 py-0 text-red-600">90d+ {kShort(k.debt.aging.d90plus)}</Badge>
        </div>
      </div>

      {/* Pending actions */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><ShoppingCart className="h-3.5 w-3.5 text-slate-500" /> Pending</div>
        <div className="mt-1"><CountUp value={pendingTotal} className="text-2xl font-bold text-slate-600 dark:text-slate-400" /></div>
        <p className="mt-2 text-[10px] text-slate-500">POs {k.pending.purchaseOrders} · shifts {k.pending.openShifts} · expenses {k.pending.expenses}</p>
      </div>

      {/* Revenue trend drill-down modal (real 7d series only) */}
      <Dialog open={trendOpen} onOpenChange={setTrendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-700" /> Revenue trend (gross)</DialogTitle>
          </DialogHeader>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <Sparkline data={k.revenue.spark} width={380} height={80} />
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-500">Today</span><p className="font-bold text-slate-800">{kes(k.revenue.today)}</p></div>
              <div><span className="text-slate-500">7d total</span><p className="font-bold text-slate-800">{kes(k.revenue.weekTotal)}</p></div>
              <div><span className="text-slate-500">Prior 7d</span><p className="font-bold text-slate-800">{kes(k.revenue.priorWeekTotal)}</p></div>
              <div><span className="text-slate-500">Avg / day (7d)</span><p className="font-bold text-slate-800">{kes(Math.round(k.revenue.weekTotal / 7))}</p></div>
            </div>
            {/* v2.185.0: the VAT lens — the analyst's net number did not die
                in the reconciliation; it moved HERE, under its own label.
                Tolerant by type (optional fields): an older cached answer
                renders nothing here, never a NaN, never a crash. */}
            {k.revenue.taxWeekTotal != null && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-100 bg-emerald-50/70 px-2.5 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">incl. VAT (7d)</span>
                <span className="text-xs font-semibold tabular-nums text-emerald-900">{kes(k.revenue.taxWeekTotal)}</span>
                <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-emerald-700 ring-1 ring-emerald-100" title="Week revenue net of VAT">net {kes(k.revenue.netWeekTotal ?? k.revenue.weekTotal - k.revenue.taxWeekTotal)}</span>
              </div>
            )}
          </div>
          {/* v2.176.0: the week by branch — the org line above stays the lead;
              the branches speak underneath, loudest week first. v2.185.0:
              the org spark is GROSS too — every shape in this modal speaks
              the SAME till face, so the qualifier note retires. Names are
              text (self-speaking); the spark is aria-hidden decoration. An
              absent block (branch manager or an older cached answer)
              renders nothing here — honest absence. */}
          {branchWeek && branchWeek.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">The week by branch</p>
              <p className="mb-2 text-[10px] text-slate-500">branch shapes and the org line above speak the same gross till face</p>
              <ul className="space-y-1.5">
                {branchWeek.map((b) => (
                  <li key={b.storeId} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <Sparkline data={b.spark} stroke="#64748b" width={72} height={20} />
                      <span className="truncate text-xs text-slate-600 dark:text-slate-400">{b.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {/* v2.177.0: the row's own verdict — the SAME chip the
                          table and the strip draw (one week, one vocabulary);
                          no prior week renders nothing, never a guess. */}
                      <WeekDeltaChip current={b.weekTotal} prior={b.priorWeekTotal ?? 0} />
                      <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">{kes(b.weekTotal)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
