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
   * v2.195.0: each entry may also carry the branch's settled COUNT windows
   * (`txWeek`/`txPrior`) — the transactions drill-down's branch rows. Still
   * optional: an older cached answer keeps the count modal's org-wide
   * story, the branch block steps aside with its honest note.
   */
  perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number; txWeek?: number; txPrior?: number }> | null;
  /** Branch names for the drill-down rows, joined by storeId (never row order). */
  stores?: StoreRow[];
}) {
  const [trendOpen, setTrendOpen] = useState(false);
  // v2.195.0: the transactions drill-down — the KPI row's second voice.
  const [txOpen, setTxOpen] = useState(false);
  // v2.187.0: the modal's lens — GROSS is the default and the contract
  // (v2.185.0); net is an explicit analyst turn, never a second meaning.
  const [lens, setLens] = useState<'gross' | 'net'>('gross');
  const k = data.kpis;
  // v2.187.0: the net lens is available only when the payload carried the
  // per-day net buckets — an older cached answer keeps the calm gross modal
  // (no toggle, no broken promises), the same tolerance the ribbon speaks.
  const netReady = Array.isArray(k.revenue.netSpark) && k.revenue.netSpark.length === 7;
  // v2.195.0: the count face's shape — available only when the payload
  // carried the per-day COUNT buckets (a v2.195.0 answer). An older cached
  // answer keeps the legacy text line on the card and the honest note in
  // the modal — no broken spark, no fabricated shape.
  const txSparkReady = Array.isArray(k.transactions.spark) && k.transactions.spark.length === 7;
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

  // v2.195.0: the transactions modal's branch rows — the SAME perStoreTrend
  // payload, now carrying each branch's settled count and its prior (both
  // mapped from the summary route's existing per-store groupBys — zero new
  // queries on either side). Built only when the fields arrived; loudest
  // count first; a quiet branch still speaks (honest zeros).
  const branchTx = perStoreTrend && stores.length > 0 && perStoreTrend.some((t) => t.txWeek != null)
    ? perStoreTrend
        .map((t) => ({
          storeId: t.storeId,
          txWeek: t.txWeek ?? 0,
          txPrior: t.txPrior ?? 0,
          name: stores.find((s) => s.id === t.storeId)?.name ?? 'Branch',
        }))
        .sort((a, b) => b.txWeek - a.txWeek)
    : null;
  // v2.195.0: did a perStoreTrend payload arrive WITHOUT the count fields
  // (a pre-2.195.0 cached answer)? The branch block then speaks its honest
  // step-aside instead of silently vanishing.
  const branchTxStale = perStoreTrend != null && stores.length > 0 && !branchTx;

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

      {/* Transactions — v2.195.0: a VOICE, not a tile. The Revenue card
          told the money's story since v2.173.0 while this card sat mute
          beside it, even though its week was already on the wire. The card
          is now the second button of the row and opens the transactions
          drill-down; it wears the face's blue edge + live dot (the family
          vocabulary the Revenue card speaks in orange) and the settled
          qualifier chip (the v2.185.0 gross-chip's count-face sibling). */}
      <button
        onClick={() => setTxOpen(true)}
        data-testid="transactions-card"
        className="focus-ring group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-blue-500" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <CalendarCheck2 className="h-3.5 w-3.5 text-blue-500" /> Transactions
            {/* v2.195.0: the settled-count qualifier — every number on this
                card and in its modal counts the SAME settled rows the
                Revenue card sums (COMPLETED or PARTIAL SALE rows), so the
                two cards can never be read as different populations. */}
            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700 ring-1 ring-blue-200" title="Settled checkouts — the same rows the Revenue card sums">settled</span>
          </span>
          <span className="h-2 w-2 rounded-full bg-blue-500 anim-pulse-dot" />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <CountUp value={k.transactions.today} className="text-2xl font-bold text-blue-600" />
          <span className={`flex items-center text-xs font-semibold ${k.transactions.variancePct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {k.transactions.variancePct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {k.transactions.variancePct >= 0 ? '+' : ''}{k.transactions.variancePct}%
          </span>
        </div>
        {/* v2.195.0: the card learns its shape — the per-day COUNT spark
            (the settled rows counted one each in the SAME pass as the
            revenue spark) rides under the number, mirroring the Revenue
            card's footer. Tolerant: an older cached answer keeps the
            legacy text line, and the card opens the modal either way. */}
        {txSparkReady ? (
          <div className="mt-2 flex items-end justify-between">
            <Sparkline data={k.transactions.spark ?? []} stroke="#2563eb" />
            <span className="text-[10px] text-slate-500">7d {num(k.transactions.weekTotal)}</span>
          </div>
        ) : (
          <p className="mt-2 text-[10px] text-slate-500">today · 7d {num(k.transactions.weekTotal)} vs prior {num(k.transactions.priorWeekTotal)}</p>
        )}
      </button>

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
          {/* v2.195.0: this panel owns its dark half — same discovery, same
              fix as the transactions modal below. The v2.194.0 dark tokens
              inside were derived over the dialog ground, but the DOM
              composites them against THIS panel, which stayed light;
              dark:bg-slate-900 closes the gap (the lens toggle's dark face
              since v2.187.0 was already slate-900). */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
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
                <span data-testid="revenue-lens-note" className="text-[10px] text-slate-500 dark:text-slate-400">
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
                  <div><span className="text-slate-500 dark:text-slate-400">Today</span><p className="font-bold text-slate-800 dark:text-slate-100">{kes(k.revenue.today)}</p></div>
                  <div><span className="text-slate-500 dark:text-slate-400">7d total</span><p className="font-bold text-slate-800 dark:text-slate-100">{kes(k.revenue.weekTotal)}</p></div>
                  <div><span className="text-slate-500 dark:text-slate-400">Prior 7d</span><p className="font-bold text-slate-800 dark:text-slate-100">{kes(k.revenue.priorWeekTotal)}</p></div>
                  <div><span className="text-slate-500 dark:text-slate-400">Avg / day (7d)</span><p className="font-bold text-slate-800 dark:text-slate-100">{kes(Math.round(k.revenue.weekTotal / 7))}</p></div>
                </>
              ) : (
                // The net grid — every cell the gross face has, minus VAT.
                // The three net fields ship together (v2.187.0 payload); the
                // ?? guards a pathological mixed answer, never a NaN.
                <>
                  <div><span className="text-slate-500 dark:text-slate-400">Today</span><p data-testid="revenue-net-today" className="font-bold text-slate-800 dark:text-slate-100">{kes(k.revenue.netTodayTotal ?? 0)}</p></div>
                  <div><span className="text-slate-500 dark:text-slate-400">7d total</span><p data-testid="revenue-net-week" className="font-bold text-slate-800 dark:text-slate-100">{kes(k.revenue.netWeekTotal ?? k.revenue.weekTotal - (k.revenue.taxWeekTotal ?? 0))}</p></div>
                  <div><span className="text-slate-500 dark:text-slate-400">Prior 7d</span><p data-testid="revenue-net-prior" className="font-bold text-slate-800 dark:text-slate-100">{kes(k.revenue.netPriorWeekTotal ?? 0)}</p></div>
                  <div><span className="text-slate-500 dark:text-slate-400">Avg / day (7d)</span><p data-testid="revenue-net-avg" className="font-bold text-slate-800 dark:text-slate-100">{kes(Math.round((k.revenue.netWeekTotal ?? k.revenue.weekTotal - (k.revenue.taxWeekTotal ?? 0)) / 7))}</p></div>
                </>
              )}
            </div>
            {/* v2.188.0: the net lens wears its own week-over-week verdict —
                the v2.187.0 ribbon chip spoke only the VAT face; the net face
                stayed mute about its own trend even though BOTH windows were
                already on the wire (netWeekTotal since v2.185.0's chip,
                netPriorWeekTotal since v2.187.0). The strip mirrors the VAT
                ribbon structurally — label, week figure, arrowed verdict,
                prior chip — but wears the net face's violet family so the
                two faces stay distinguishable at a glance. The verdict is
                the SAME honesty rule as the VAT chip: up emerald, down red,
                flat calm, and a zero prior renders NO percentage (never an
                invented "0%" or a NaN). Renders only in the net lens and
                only when the prior window arrived (optional field: an older
                cached answer keeps the calm grid, never a broken strip). */}
            {lens === 'net' && k.revenue.netPriorWeekTotal != null && (() => {
              const netPrior = k.revenue.netPriorWeekTotal ?? 0;
              const netWeek = k.revenue.netWeekTotal ?? k.revenue.weekTotal - (k.revenue.taxWeekTotal ?? 0);
              const netDelta = netWeek - netPrior;
              const netPct = netPrior > 0 ? Math.round((netDelta / netPrior) * 1000) / 10 : null;
              return (
                <div data-testid="revenue-net-wow-strip" className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-violet-100 bg-violet-50/70 px-2.5 py-1.5 dark:border-violet-500/30 dark:bg-violet-500/10">
                  {/* v2.194.0: the strip learns its dark half — the light
                      paint (violet-50/70) over the dark dialog ground measured
                      3.3:1 for its smallest text (the 10px label), so the
                      strip now wears the house's proven dark chip pattern
                      (the panels' STATUS_CHIP family: {c}-500/10 ground under
                      a -300 voice, the /30 ring) instead of pretending the
                      light alpha survives the dark dialog. The verdict chip's
                      three states wear the same pattern's dark halves. */}
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-300">net week-over-week</span>
                  <span data-testid="revenue-net-wow-week" className="text-xs font-semibold tabular-nums text-violet-900 dark:text-violet-200">{kes(netWeek)}</span>
                  <span
                    data-testid="revenue-net-wow"
                    title={`Net week-over-week: ${kes(netWeek)} vs prior ${kes(netPrior)}`}
                    className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ${netDelta > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30' : netDelta < 0 ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30' : 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30'}`}
                  >
                    {netDelta > 0 ? '▲' : netDelta < 0 ? '▼' : '—'} {netPct == null ? 'vs prior' : `${netDelta > 0 ? '+' : ''}${netPct}% vs prior`}
                  </span>
                  <span data-testid="revenue-net-wow-prior" className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-violet-700 ring-1 ring-violet-100 dark:bg-violet-500/20 dark:text-violet-300 dark:ring-violet-500/30" title="Prior week net of VAT">prior {kes(netPrior)}</span>
                </div>
              );
            })()}
            {/* v2.185.0: the VAT lens — the analyst's net number did not die
                in the reconciliation; it moved HERE, under its own label.
                Tolerant by type (optional fields): an older cached answer
                renders nothing here, never a NaN, never a crash. */}
            {k.revenue.taxWeekTotal != null && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-emerald-100 bg-emerald-50/70 px-2.5 py-1.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">incl. VAT (7d)</span>
                <span className="text-xs font-semibold tabular-nums text-emerald-900 dark:text-emerald-200">{kes(k.revenue.taxWeekTotal)}</span>
                {/* v2.187.0: the VAT week-over-week — taxPriorWeekTotal's
                    first consumer. Quiet, arrowed, honest about a zero
                    prior (no invented %, the WeekDeltaChip honesty rule).
                    v2.194.0: the three states wear the dark chip pattern's
                    dark halves (the strip's own fix — same recipe). */}
                {k.revenue.taxPriorWeekTotal != null && (() => {
                  const vatDelta = k.revenue.taxWeekTotal - k.revenue.taxPriorWeekTotal;
                  const vatPct = k.revenue.taxPriorWeekTotal > 0 ? Math.round((vatDelta / k.revenue.taxPriorWeekTotal) * 1000) / 10 : null;
                  return (
                    <span
                      data-testid="revenue-vat-wow"
                      title={`VAT week-over-week: ${kes(k.revenue.taxWeekTotal)} vs prior ${kes(k.revenue.taxPriorWeekTotal ?? 0)}`}
                      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ${vatDelta > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30' : vatDelta < 0 ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30' : 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30'}`}
                    >
                      {vatDelta > 0 ? '▲' : vatDelta < 0 ? '▼' : '—'} {vatPct == null ? 'vs prior' : `${vatDelta > 0 ? '+' : ''}${vatPct}% vs prior`}
                    </span>
                  );
                })()}
                <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/30" title="Week revenue net of VAT">net {kes(k.revenue.netWeekTotal ?? k.revenue.weekTotal - k.revenue.taxWeekTotal)}</span>
              </div>
            )}
            {/* v2.194.0: the VAT face gets its spark — the wire's NEW
                taxSpark (the SAME rows' tax bucketed in the SAME pass as
                the gross/net sparks, zero additional reads) renders under
                the VAT strip in the face's own amber (a THIRD hue so the
                modal's three faces never merge: emerald gross, violet
                net, amber VAT). Height 36 under the 80px lens sparks —
                the lens chart stays the lead, this is the strip's quiet
                trend. Tolerant: an older cached answer (no taxSpark)
                renders nothing here, never a NaN; Sparkline itself emits
                nothing for an empty array. The svg is aria-hidden
                decoration (the primitive hard-codes it) — the strip's
                figures above already speak the face. */}
            {k.revenue.taxSpark != null && k.revenue.taxSpark.length > 0 && (
              <div data-testid="revenue-vat-spark" className="mt-1" title="VAT collected per day, last 7 days">
                <Sparkline data={k.revenue.taxSpark} stroke="#d97706" width={380} height={36} />
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

      {/* v2.195.0: the transactions drill-down — the KPI row's second voice.
          The anatomy mirrors the revenue modal's (spark, stat grid,
          week-over-week strip, branch rows) but speaks COUNTS — the same
          settled rows counted one each — and wears the face's blue so the
          two modals never merge at a glance. Every number was already on
          the wire; the drill-down composes, it never invents. */}
      <Dialog open={txOpen} onOpenChange={setTxOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarCheck2 className="h-4 w-4 text-blue-600" /> Transactions trend</DialogTitle>
          </DialogHeader>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            {/* v2.195.0: the panel owns its dark half. THE DISCOVERY: the
                v2.194.0 dark-voice fix gave the modal's interior dark:text
                tokens while this body panel kept its light paint — the DOM
                composites against the NEAREST painted ancestor, so the
                dialog's dark ground never reached the texts. Measured live:
                dark:text-slate-100 values on the unpainted slate-50 panel
                ≈ 1.09:1 (invisible), the -300 strip voices ≈ 1.5:1. The
                panel now paints dark:bg-slate-900 in dark mode — the same
                dark face the lens toggle already wore — and the v2.194
                tokens become true over it (the contrast script re-derives
                every family over the REAL chain: dialog → panel → strip
                → chip). */}
            {txSparkReady ? (
              <div data-testid="transactions-spark" title="Settled checkouts per day, last 7 days">
                <Sparkline data={k.transactions.spark ?? []} stroke="#2563eb" width={380} height={80} />
              </div>
            ) : (
              // The honest absence: an older cached answer carries no
              // per-day counts. The modal says so instead of drawing a
              // fabricated flat line — the counts below still speak.
              <p data-testid="transactions-spark-absent" className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                the per-day shape is not on this cached answer — the counts below still speak. Reload to fetch it.
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-500 dark:text-slate-400">Today</span><p data-testid="transactions-today" className="font-bold text-slate-800 dark:text-slate-100">{num(k.transactions.today)}</p></div>
              <div><span className="text-slate-500 dark:text-slate-400">7d total</span><p data-testid="transactions-week" className="font-bold text-slate-800 dark:text-slate-100">{num(k.transactions.weekTotal)}</p></div>
              <div><span className="text-slate-500 dark:text-slate-400">Prior 7d</span><p data-testid="transactions-prior" className="font-bold text-slate-800 dark:text-slate-100">{num(k.transactions.priorWeekTotal)}</p></div>
              <div><span className="text-slate-500 dark:text-slate-400">Avg / day (7d)</span><p data-testid="transactions-avg" className="font-bold text-slate-800 dark:text-slate-100">{num(Math.round(k.transactions.weekTotal / 7))}</p></div>
            </div>
            {/* The week-over-week strip — the net lens strip's blue sibling
                (same anatomy: label, week figure, arrowed verdict, prior
                chip), speaking the face's blue family. The verdict is the
                SAME honesty rule: up emerald, down red, flat calm, and a
                zero prior renders NO percentage — never an invented "0%",
                never a NaN. Core fields both — the strip always renders. */}
            {(() => {
              const txDelta = k.transactions.weekTotal - k.transactions.priorWeekTotal;
              const txPct = k.transactions.priorWeekTotal > 0 ? Math.round((txDelta / k.transactions.priorWeekTotal) * 1000) / 10 : null;
              return (
                <div data-testid="transactions-wow-strip" className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-blue-100 bg-blue-50/70 px-2.5 py-1.5 dark:border-blue-500/30 dark:bg-blue-500/10">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300">transactions week-over-week</span>
                  <span data-testid="transactions-wow-week" className="text-xs font-semibold tabular-nums text-blue-900 dark:text-blue-200">{num(k.transactions.weekTotal)}</span>
                  <span
                    data-testid="transactions-wow"
                    title={`Transactions week-over-week: ${num(k.transactions.weekTotal)} vs prior ${num(k.transactions.priorWeekTotal)}`}
                    className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ${txDelta > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30' : txDelta < 0 ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30' : 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30'}`}
                  >
                    {txDelta > 0 ? '▲' : txDelta < 0 ? '▼' : '—'} {txPct == null ? 'vs prior' : `${txDelta > 0 ? '+' : ''}${txPct}% vs prior`}
                  </span>
                  <span data-testid="transactions-wow-prior" className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-blue-700 ring-1 ring-blue-100 dark:bg-blue-500/20 dark:text-blue-300 dark:ring-blue-500/30" title="Prior week settled checkouts">prior {num(k.transactions.priorWeekTotal)}</span>
                </div>
              );
            })()}
          </div>
          {/* The week by branch — counts this time. The revenue modal's
              branch block's sibling: same join by storeId, same loudest-
              first order, same verdict chip primitive (it takes numbers,
              counts are numbers), honest zeros stay visible. */}
          {branchTx && branchTx.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">The week by branch</p>
              <p className="mb-2 text-[10px] text-slate-500">the same settled rows the org line counts, branch by branch</p>
              <ul className="space-y-1.5">
                {branchTx.map((b) => (
                  <li key={b.storeId} className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-slate-600 dark:text-slate-400">{b.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <WeekDeltaChip current={b.txWeek} prior={b.txPrior} />
                      <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">{num(b.txWeek)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The honest step-aside: the branch payload arrived but carried
              no count fields (a pre-2.195.0 cached answer). One line, the
              reason, and the way back — never a silent void. */}
          {branchTxStale && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p data-testid="transactions-branch-stale" className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                counts by branch are not on this cached answer — the org story above still speaks. Reload to fetch them.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
