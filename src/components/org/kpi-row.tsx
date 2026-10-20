'use client';

// KPI Command Row - 6 KPI cards with count-up, sparkline and the real
// week-vs-prior-week variance from /api/org/kpi-summary. No fabricated trend
// windows: the drill-down modal shows the actual 7-day gross-revenue sparkline
// and the real week totals. v2.185.0: BOTH org surfaces speak GROSS of tax —
// the headline is the till face, and the VAT lens rides additively under an
// explicitly-labeled ribbon (never mixed into the headline again).
// v2.187.0: the lens deepens — the modal grows an explicit Gross/Net toggle
// backed by the per-day net buckets (`netSpark`, zero extra queries) and the
// ribbon grows the VAT week-over-week. Gross stays the default: the toggle
// is an analyst turn, never a quiet second meaning of the headline.

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
  // v2.187.0: the modal's lens — GROSS is the default and the contract
  // (v2.185.0); net is an explicit analyst turn, never a second meaning.
  const [lens, setLens] = useState<'gross' | 'net'>('gross');
  const k = data.kpis;
  // v2.187.0: the net lens is available only when the payload carried the
  // per-day net buckets — an older cached answer keeps the calm gross modal
  // (no toggle, no broken promises), the same tolerance the ribbon speaks.
  const netReady = Array.isArray(k.revenue.netSpark) && k.revenue.netSpark.length === 7;
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
            {/* v2.187.0: the title follows the lens — the gross till face
                keeps its exact contract name (v2.185.0); the net view is
                the SAME series minus VAT, under its own honest name. */}
            <DialogTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-700" /> {lens === 'gross' ? 'Revenue trend (gross)' : 'Revenue trend (net)'}</DialogTitle>
          </DialogHeader>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            {/* v2.187.0: the lens toggle — an explicit two-face switch, not a
                quiet second meaning. Renders ONLY when the payload carried
                the per-day net buckets (a v2.187.0 answer): an older cached
                answer keeps the calm gross modal exactly as v2.185.0 drew
                it, never a broken toggle. The active face wears its own
                hue (emerald gross / violet net) so the chart below always
                agrees with the control above it. */}
            {netReady && (
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <div role="group" aria-label="Revenue lens" data-testid="revenue-lens-toggle" className="inline-flex rounded-full border border-slate-200 bg-white p-0.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  {(['gross', 'net'] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      aria-pressed={lens === l}
                      onClick={() => setLens(l)}
                      data-testid={`revenue-lens-${l}`}
                      title={l === 'gross' ? 'The till face — includes VAT' : 'VAT removed — the revenue that is actually yours'}
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${lens === l
                        ? l === 'gross'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'bg-violet-600 text-white shadow'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'}`}
                    >
                      {l === 'gross' ? 'Gross' : 'Net'}
                    </button>
                  ))}
                </div>
                <span data-testid="revenue-lens-note" className="text-[10px] text-slate-500">
                  {lens === 'gross' ? 'the till face — includes VAT' : 'one read, two faces'}
                </span>
              </div>
            )}
            {lens === 'gross' ? (
              <Sparkline data={k.revenue.spark} width={380} height={80} />
            ) : (
              // The net line wears violet — a different face wears a
              // different hue, so a glance can never mistake the two.
              <Sparkline data={k.revenue.netSpark ?? []} stroke="#8b5cf6" width={380} height={80} />
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              {lens === 'gross' ? (
                <>
                  <div><span className="text-slate-500">Today</span><p className="font-bold text-slate-800">{kes(k.revenue.today)}</p></div>
                  <div><span className="text-slate-500">7d total</span><p className="font-bold text-slate-800">{kes(k.revenue.weekTotal)}</p></div>
                  <div><span className="text-slate-500">Prior 7d</span><p className="font-bold text-slate-800">{kes(k.revenue.priorWeekTotal)}</p></div>
                  <div><span className="text-slate-500">Avg / day (7d)</span><p className="font-bold text-slate-800">{kes(Math.round(k.revenue.weekTotal / 7))}</p></div>
                </>
              ) : (
                // The net grid — every cell the gross face has, minus VAT.
                // The three net fields ship together (v2.187.0 payload); the
                // ?? guards a pathological mixed answer, never a NaN.
                <>
                  <div><span className="text-slate-500">Today</span><p data-testid="revenue-net-today" className="font-bold text-slate-800">{kes(k.revenue.netTodayTotal ?? 0)}</p></div>
                  <div><span className="text-slate-500">7d total</span><p data-testid="revenue-net-week" className="font-bold text-slate-800">{kes(k.revenue.netWeekTotal ?? k.revenue.weekTotal - (k.revenue.taxWeekTotal ?? 0))}</p></div>
                  <div><span className="text-slate-500">Prior 7d</span><p data-testid="revenue-net-prior" className="font-bold text-slate-800">{kes(k.revenue.netPriorWeekTotal ?? 0)}</p></div>
                  <div><span className="text-slate-500">Avg / day (7d)</span><p data-testid="revenue-net-avg" className="font-bold text-slate-800">{kes(Math.round((k.revenue.netWeekTotal ?? k.revenue.weekTotal - (k.revenue.taxWeekTotal ?? 0)) / 7))}</p></div>
                </>
              )}
            </div>
            {/* v2.185.0: the VAT lens — the analyst's net number did not die
                in the reconciliation; it moved HERE, under its own label.
                Tolerant by type (optional fields): an older cached answer
                renders nothing here, never a NaN, never a crash. */}
            {k.revenue.taxWeekTotal != null && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-emerald-100 bg-emerald-50/70 px-2.5 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">incl. VAT (7d)</span>
                <span className="text-xs font-semibold tabular-nums text-emerald-900">{kes(k.revenue.taxWeekTotal)}</span>
                {/* v2.187.0: the VAT week-over-week — taxPriorWeekTotal's
                    first consumer. Quiet, arrowed, honest about a zero
                    prior (no invented %, the WeekDeltaChip honesty rule). */}
                {k.revenue.taxPriorWeekTotal != null && (() => {
                  const vatDelta = k.revenue.taxWeekTotal - k.revenue.taxPriorWeekTotal;
                  const vatPct = k.revenue.taxPriorWeekTotal > 0 ? Math.round((vatDelta / k.revenue.taxPriorWeekTotal) * 1000) / 10 : null;
                  return (
                    <span
                      data-testid="revenue-vat-wow"
                      title={`VAT week-over-week: ${kes(k.revenue.taxWeekTotal)} vs prior ${kes(k.revenue.taxPriorWeekTotal ?? 0)}`}
                      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ${vatDelta > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : vatDelta < 0 ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-slate-50 text-slate-500 ring-slate-200'}`}
                    >
                      {vatDelta > 0 ? '▲' : vatDelta < 0 ? '▼' : '—'} {vatPct == null ? 'vs prior' : `${vatDelta > 0 ? '+' : ''}${vatPct}% vs prior`}
                    </span>
                  );
                })()}
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
          {branchWeek && branchWeek.length > 0 && lens === 'gross' && (
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
          {/* v2.187.0: in the net lens the branch rows step aside honestly —
              the per-branch week rides /api/org/summary, which carries no
              per-branch tax, so a net-by-branch row would be a fabrication.
              One line, one door back. */}
          {branchWeek && branchWeek.length > 0 && lens === 'net' && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p data-testid="revenue-net-branch-note" className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                the branch rows speak the gross till face — net by branch is not on the wire, so they rest while the net lens is on. Flip back to Gross to compare branches.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
