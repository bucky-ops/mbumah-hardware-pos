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
// v2.196.0: the debt card finds its ledger — the row's THIRD voice. The
// aging buckets the card has badge-summed since v2.176.0 now draw their
// composition bar, and the drill-down speaks the named accounts the
// payload already carried (debtExpert.topDebtors — the Debt Expert
// panel's wire since the Expert panel shipped). Zero new queries; the
// drill-down composes, it never invents.
// v2.197.0: the stock tile opens the watchlist — the row's FOURTH voice,
// and the door arc's fourth door (revenue v2.173, transactions v2.195,
// debt v2.196). The SKU count the card has shown since v2.176.0 now
// draws its SEVERITY bar (at level → below → critical → out — the same
// hue scale the debt buckets speak, deepening with heat), and the
// drill-down speaks the named watchlist the payload already carried
// (inventory.lowStockItems — the Stock Expert panel's wire since the
// Expert panel shipped): each shelf its own coverage figure, the units-
// short face summed into its own amber strip, the items loudest-deficit-
// first, the watchlist grouped by the branch that holds it. Zero new
// queries; the drill-down composes, it never invents. AND the round's
// honest find: the card's hot number and icon rode text-orange-500
// (2.81:1 over white) — below even the 3:1 large-text/non-text bar —
// since the card shipped; the face re-hues to amber-600 (3.20:1), the
// discovery pinned in reverse in the round's contrast script.
// v2.198.0: the overdue tile opens the yard — the row's FIFTH voice, and
// the door arc's LAST tile (every warning card on the row now speaks).
// The count the card has shown since v2.176.0 now draws its BREACH-AGE
// bar (≤7d → 8-30d → 31-60d → 60d+ — amber → orange → rose → red), and
// the drill-down speaks the rental roster the payload already carried
// (rentals.items — the Expert panel's ledger wire): each breach its own
// days-past figure (calendar-day math, local midnight to local midnight),
// the per-day exposure summed into its own rose strip, the overdue
// loudest-breach-first, the active rows as the yard's calm half, the
// roster grouped by the branch that holds it. Zero new queries; the
// drill-down composes, it never invents. AND the round's honest find:
// the Expert ledger's OVERDUE badge rode text-red-600 on red-50
// (4.40:1 — under the 4.5 bar its 10px text must meet); the badge
// re-voices to red-700 and the discovery is pinned in reverse.

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
  // v2.196.0: the debt drill-down — the KPI row's third voice.
  const [debtOpen, setDebtOpen] = useState(false);
  // v2.197.0: the reorder-watchlist drill-down — the KPI row's fourth voice.
  const [stockOpen, setStockOpen] = useState(false);
  // v2.198.0: the rental-yard drill-down — the KPI row's fifth voice.
  const [yardOpen, setYardOpen] = useState(false);
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

  // ── v2.196.0: the debt ledger's derivations ─────────────────────────────
  // Every figure below composes the SAME payload the card already spoke
  // (zero new queries). The named ledger rides debtExpert (typed since the
  // Expert panel shipped); a runtime answer may lack it (an older cached
  // answer) — the honest step-aside speaks, the aging above never breaks.
  const ledgerReady = Array.isArray(data.debtExpert?.topDebtors);
  // Did the answer arrive WITHOUT the named ledger (an older cached
  // answer)? The modal then speaks its honest step-aside — the aging
  // story above still carries, never a silent void.
  const ledgerStale = !ledgerReady;
  // Loudest balance first — the Expert panel's table order, re-derived here
  // so the modal never depends on the route's ordering choice.
  const debtors = ledgerReady ? [...data.debtExpert.topDebtors].sort((a, b) => b.outstanding - a.outstanding) : null;
  // The buckets, one array so the card's bar and the modal's bar + grid
  // speak the same four figures in the same order (no invented merges:
  // each bucket its own cell). Hue deepens with age: slate → amber →
  // orange → red — the hotter the colour, the older the money.
  const agingBuckets: Array<{ key: string; label: string; value: number; hue: string }> = [
    { key: 'current', label: 'Current', value: k.debt.aging.current, hue: 'bg-slate-400' },
    { key: 'd30', label: '1-30d', value: k.debt.aging.d30, hue: 'bg-amber-400' },
    { key: 'd60', label: '31-60d', value: k.debt.aging.d60, hue: 'bg-orange-500' },
    { key: 'd90plus', label: '90d+', value: k.debt.aging.d90plus, hue: 'bg-red-500' },
  ];
  // Share of the ledger — the honesty rule the wow-strips speak: a zero
  // total renders NO percentage (never an invented "0%" of nothing).
  const debtShare = (v: number): number | null => (k.debt.total > 0 ? Math.round((v / k.debt.total) * 1000) / 10 : null);
  // The overdue face: every bucket past due date, summed — the strip's
  // figure. Composed from the SAME buckets the bar draws, never re-queried.
  const overdueSum = k.debt.aging.d30 + k.debt.aging.d60 + k.debt.aging.d90plus;
  const overduePct = debtShare(overdueSum);
  // The ledger by branch — the named debtors grouped by the branch that
  // holds them (the route resolves the store name server-side; an unnamed
  // account rests under "Unassigned" — still spoken, never dropped).
  // Derived client-side from the SAME rows — zero new queries.
  const branchDebt = debtors && debtors.length > 0
    ? Object.entries(
        debtors.reduce<Record<string, { total: number; count: number }>>((acc, d) => {
          const name = d.store ?? 'Unassigned';
          acc[name] = acc[name] ?? { total: 0, count: 0 };
          acc[name].total += d.outstanding;
          acc[name].count += 1;
          return acc;
        }, {}),
      )
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.total - a.total)
    : null;
  // The debtor's status voice — the three known states wear their
  // families; any future state stays calm slate (never a broken chip).
  const debtorStatusChip = (status: string): string =>
    status === 'PARTIAL'
      ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30'
      : status === 'OVERDUE'
        ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'
        : 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30';
  // The bucket label as the card's badges speak it — a future bucket value
  // falls back to its own lowercase (never a blank chip).
  const debtorBucketLabel = (bucket: string): string =>
    bucket === 'CURRENT' ? 'current' : bucket === 'DAYS_30' ? '1-30d' : bucket === 'DAYS_60' ? '31-60d' : bucket === 'DAYS_90_PLUS' ? '90d+' : bucket.toLowerCase();

  // ── v2.197.0: the reorder watchlist's derivations ───────────────────────
  // Every figure below composes the SAME payload the card already spoke
  // (data.inventory.lowStockItems — the Stock Expert panel's watchlist
  // wire since the Expert panel shipped; zero new queries). A runtime
  // answer may lack it (an older cached answer) — the honest step-aside
  // speaks, the count story above never breaks.
  const watchlistReady = Array.isArray(data.inventory?.lowStockItems);
  // Did the answer arrive WITHOUT the named watchlist? The modal then
  // speaks its honest step-aside — the count above still carries.
  const watchlistStale = !watchlistReady;
  // The route sorts most-critical-first and CAPS at 12; the modal
  // re-derives its own order so it never depends on the route's choice:
  // loudest DEFICIT first (units short = level − stock, floored at 0 —
  // an at-level item is zero short, never negative).
  const watchlist = watchlistReady
    ? [...data.inventory.lowStockItems]
        .map((p) => ({ ...p, deficit: Math.max(0, p.reorderLevel - p.stockQty) }))
        .sort((a, b) => b.deficit - a.deficit)
    : null;
  // Coverage — the shelf against the reorder line, 0..1 on this payload
  // (the route only ships items at/below level). A zero level cannot
  // speak a percentage (0/0 is not 100%) — null, and the chip falls
  // back to the out/level voices. The honesty rule the debt shares speak.
  const stockCoverage = (p: { stockQty: number; reorderLevel: number }): number | null =>
    p.reorderLevel > 0 ? p.stockQty / p.reorderLevel : null;
  // The severity buckets — the four states at/below the level, ONE array
  // so the card's mini bar and the modal's bar + grid speak the same
  // four figures in the same order (the one-writer rule the debt buckets
  // established). Hue deepens with severity: slate → amber → orange →
  // red — the hotter the colour, the emptier the shelf (the SAME scale
  // the debt aging speaks, read as urgency instead of age).
  const stockBuckets: Array<{ key: string; label: string; hue: string; in: (p: { stockQty: number; coverage: number | null }) => boolean }> = [
    { key: 'out', label: 'Out of stock', hue: 'bg-red-500', in: (p) => p.stockQty <= 0 },
    { key: 'critical', label: 'Critical', hue: 'bg-orange-500', in: (p) => p.stockQty > 0 && p.coverage != null && p.coverage <= 0.5 },
    { key: 'below', label: 'Below level', hue: 'bg-amber-400', in: (p) => p.coverage != null && p.coverage > 0.5 && p.coverage < 1 },
    { key: 'at', label: 'At level', hue: 'bg-slate-400', in: (p) => p.coverage != null && p.coverage >= 1 },
  ];
  // Each bucket's count over the NAMED watchlist (the meta discloses the
  // cap when the org list runs past the route's 12 — the named population
  // is what the modal speaks, never a projected whole). ONE derivation
  // carries the rows AND their counts, so every consumer reads the same
  // shape without a bare assertion (the lint-baseline law).
  const stockRows = watchlist?.map((p) => ({ ...p, coverage: stockCoverage(p) })) ?? null;
  const levelSum = stockRows?.reduce((acc, p) => acc + p.reorderLevel, 0) ?? 0;
  const shelfCoverage = stockRows && levelSum > 0 ? Math.round((stockRows.reduce((acc, p) => acc + p.stockQty, 0) / levelSum) * 1000) / 10 : null;
  const severity = stockRows && stockRows.length > 0
    ? {
        rows: stockRows,
        counts: stockBuckets.map((b) => ({ ...b, value: stockRows.filter((p) => b.in(p)).length })),
      }
    : null;
  // Share of the named watchlist — the zero-total honesty rule: an empty
  // watchlist renders NO percentage (never an invented "0%" of nothing).
  const stockShare = (v: number): number | null =>
    stockRows != null && stockRows.length > 0 ? Math.round((v / stockRows.length) * 1000) / 10 : null;
  // The reorder face: every unit the shelves are short, summed — the
  // strip's figure. Composed from the SAME rows the bar draws, never
  // re-queried. An all-at-level watchlist sums to zero and renders no
  // strip (honest absence, never an empty box).
  const shortSum = stockRows?.reduce((acc, p) => acc + p.deficit, 0) ?? 0;
  // The watchlist by branch — the same named items grouped by the branch
  // that holds them (the route resolves the store name server-side; an
  // unnamed item rests under "Unassigned" — still spoken, never dropped).
  // Derived client-side from the SAME rows — zero new queries. The figure
  // is the branch's units short (the actionable number a reorder run
  // needs), the chip the item count.
  const branchStock = stockRows && stockRows.length > 0
    ? Object.entries(
        stockRows.reduce<Record<string, { short: number; count: number }>>((acc, p) => {
          const name = p.store ?? 'Unassigned';
          acc[name] = acc[name] ?? { short: 0, count: 0 };
          acc[name].short += p.deficit;
          acc[name].count += 1;
          return acc;
        }, {}),
      )
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.short - a.short)
    : null;
  // The coverage chip's voice — the four severity states wear the
  // families; a null coverage (zero reorder level) stays calm slate
  // (never a broken chip).
  const coverageChip = (p: { stockQty: number; coverage: number | null }): { text: string; cls: string } => {
    if (p.stockQty <= 0) return { text: 'out', cls: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30' };
    if (p.coverage == null) return { text: 'level 0', cls: 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30' };
    const pct = Math.round(p.coverage * 100);
    if (pct <= 50) return { text: `${pct}%`, cls: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30' };
    if (pct < 100) return { text: `${pct}%`, cls: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30' };
    return { text: `${pct}%`, cls: 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30' };
  };

  // ── v2.198.0: the rental yard's derivations ─────────────────────────────
  // Every figure below composes the SAME payload the card already spoke
  // (data.rentals.items — the Expert panel's ledger wire since the Expert
  // panel shipped; zero new queries). A runtime answer may lack it (an
  // older cached answer) — the honest step-aside speaks, the count above
  // never breaks.
  const yardReady = Array.isArray(data.rentals?.items);
  // Did the answer arrive WITHOUT the roster? The modal then speaks its
  // honest step-aside — the count story above still carries.
  const yardStale = !yardReady;
  // Calendar-day math — the dates are ISO strings; the day diff runs
  // LOCAL midnight to LOCAL midnight so a rental due yesterday speaks
  // "1d past", never 0.8 of a day. (The modal renders only when open —
  // a client interaction — so the clock never hydrates two answers.)
  const startOfLocalDay = (iso: string): number => {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const todayStart = startOfLocalDay(new Date().toISOString());
  const DAY_MS = 86_400_000;
  // Days PAST return — floored at 0 (a future date is not negative
  // overdue); the status field governs the count, this figure the voice.
  const daysPast = (iso: string): number => Math.max(0, Math.floor((todayStart - startOfLocalDay(iso)) / DAY_MS));
  // Days UNTIL return (signed) — the active rows' due voice.
  const daysUntil = (iso: string): number => Math.ceil((startOfLocalDay(iso) - todayStart) / DAY_MS);
  // The overdue roster — loudest breach first (most days past, then the
  // costlier daily rate), re-derived client-side so the modal never
  // depends on the route's ordering choice.
  const overdueRows = yardReady
    ? data.rentals.items
        .filter((r) => r.status === 'OVERDUE')
        .map((r) => ({ ...r, days: daysPast(r.expectedReturnDate) }))
        .sort((a, b) => b.days - a.days || b.ratePerDay - a.ratePerDay)
    : null;
  // The still-out rows — soonest return first. An ACTIVE row whose date
  // passed keeps its status (the route counts by status) and its due
  // voice speaks the honest "past return" — never a negative "due in -1d".
  const activeRows = yardReady
    ? data.rentals.items
        .filter((r) => r.status !== 'OVERDUE')
        .map((r) => ({ ...r, due: daysUntil(r.expectedReturnDate) }))
        .sort((a, b) => a.due - b.due)
    : null;
  // The breach buckets — the age of the breach, ONE array so the card's
  // mini bar and the modal's bar + grid speak the same four figures in
  // the same order (the one-writer rule). Hue deepens with age: amber
  // ≤7d → orange 8-30d → rose 31-60d → red 60d+ — the face's rose
  // deepens into the house's hottest (the same scale the debt aging and
  // the stock severity speak).
  const yardBuckets: Array<{ key: string; label: string; hue: string; in: (d: number) => boolean }> = [
    { key: 'd7', label: '≤7d', hue: 'bg-amber-400', in: (d) => d <= 7 },
    { key: 'd30', label: '8-30d', hue: 'bg-orange-500', in: (d) => d >= 8 && d <= 30 },
    { key: 'd60', label: '31-60d', hue: 'bg-rose-500', in: (d) => d >= 31 && d <= 60 },
    { key: 'd60plus', label: '60d+', hue: 'bg-red-500', in: (d) => d > 60 },
  ];
  // Each bucket's count over the NAMED overdue roster — ONE derivation
  // carries the rows AND their counts (the lint-baseline law the stock
  // face wrote: no bare assertions).
  const yardSev = overdueRows && overdueRows.length > 0
    ? {
        rows: overdueRows,
        counts: yardBuckets.map((b) => ({ ...b, value: overdueRows.filter((r) => b.in(r.days)).length })),
      }
    : null;
  // Share of the overdue roster — the zero-total honesty rule: an empty
  // roster renders NO percentage (never an invented "0%" of nothing).
  const yardShare = (v: number): number | null =>
    overdueRows != null && overdueRows.length > 0 ? Math.round((v / overdueRows.length) * 1000) / 10 : null;
  // The exposure face: the daily rates on the overdue rentals, summed —
  // what the breach costs per day while it sits. Composed from the SAME
  // rows the bar draws, never re-queried; an empty roster renders no
  // strip (honest absence, never an empty box).
  const exposurePerDay = overdueRows?.reduce((acc, r) => acc + r.ratePerDay, 0) ?? 0;
  // The yard by branch — the same overdue rows grouped by the branch that
  // holds them, loudest exposure first; an unnamed rental rests under
  // "Unassigned" — still spoken, never dropped. Derived from the SAME
  // rows — zero new queries.
  const branchYard = overdueRows && overdueRows.length > 0
    ? Object.entries(
        overdueRows.reduce<Record<string, { perDay: number; count: number }>>((acc, r) => {
          const name = r.store ?? 'Unassigned';
          acc[name] = acc[name] ?? { perDay: 0, count: 0 };
          acc[name].perDay += r.ratePerDay;
          acc[name].count += 1;
          return acc;
        }, {}),
      )
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.perDay - a.perDay)
    : null;
  // The status chip's voices — overdue red, active emerald (the Expert
  // ledger's own active voice), anything else calm slate.
  const rentalStatusChip = (status: string): string =>
    status === 'OVERDUE'
      ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'
      : status === 'ACTIVE'
        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'
        : 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30';
  // The days chip's voice — an overdue row speaks its breach age; an
  // active row speaks its due date (or the honest "past return" when the
  // date passed while the status stayed ACTIVE).
  const yardDaysChip = (r: { status: string; days?: number; due?: number }): { text: string; cls: string } => {
    if (r.status === 'OVERDUE') {
      const d = r.days ?? 0;
      return { text: d > 0 ? `${d}d past` : 'past return', cls: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30' };
    }
    const d = r.due ?? 0;
    return { text: d > 0 ? `due in ${d}d` : d === 0 ? 'due today' : 'past return', cls: 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30' };
  };

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

      {/* Low stock — v2.197.0: a VOICE, not a tile. The Revenue card told
          the money's story since v2.173.0, the count face found its voice
          in v2.195.0 and the ledger in v2.196.0 while this card showed a
          bare count in silence — even though the named watchlist was
          already on the wire. The card is now the row's FOURTH button and
          opens the reorder watchlist; it wears the face's amber edge +
          live dot (the family vocabulary: orange revenue, blue
          transactions, red debt, amber stock) and the watchlist qualifier
          chip (the gross/settled/ledger chips' stock-face sibling). The
          hot number and icon re-hue orange-500 → amber-600: the round's
          contrast find (2.81:1 over white, under the 3:1 bars — pinned in
          reverse in the round's script), fixed where it lived. */}
      <button
        onClick={() => setStockOpen(true)}
        data-testid="lowstock-card"
        className={`focus-ring group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${k.lowStock.count > 0 ? 'ring-1 ring-amber-300' : ''}`}
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-amber-600" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <PackageOpen className="h-3.5 w-3.5 text-amber-600" /> Low stock
            {/* v2.197.0: the watchlist qualifier — every item this card
                and its modal speak is the SAME named population the Stock
                Expert panel's reorder watchlist reads, so the count can
                never be read as a different book. */}
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200" title="The named watchlist — the same items the Stock Expert panel speaks">watchlist</span>
          </span>
          {k.lowStock.count > 0 && <span className="h-2 w-2 rounded-full bg-amber-600 anim-pulse-dot" />}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <CountUp value={k.lowStock.count} className={`text-2xl font-bold ${k.lowStock.count > 0 ? 'text-amber-600' : 'text-slate-700'}`} />
        </div>
        {/* v2.197.0: the card learns its shape — the severity mini bar,
            the four buckets drawn as one stacked strip (slate at level →
            amber below → orange critical → red out: the deeper the
            shortage, the hotter the hue — the debt bar's scale read as
            urgency). Widths are the buckets' honest shares of the NAMED
            watchlist; a zero bucket draws nothing and an empty watchlist
            draws the calm empty track — never a fabricated segment.
            Tolerant: an older cached answer without the named items keeps
            the calm card (no bar), the modal's step-aside speaks there. */}
        {severity && k.lowStock.count > 0 && (
          <div
            className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100"
            role="img"
            aria-label={`Severity: ${severity.counts.map((b) => `${b.label.toLowerCase()} ${b.value}`).join(', ')}`}
          >
            {severity.counts.map((b) =>
              b.value > 0 && severity.rows.length > 0 ? (
                <span key={b.key} className={b.hue} style={{ width: `${(b.value / severity.rows.length) * 100}%` }} />
              ) : null,
            )}
          </div>
        )}
        <p className="mt-2 text-[10px] text-slate-500">at/below reorder level · org-wide</p>
      </button>

      {/* Overdue rentals — v2.198.0: a VOICE, not a tile. The Revenue card
          told the money's story since v2.173.0, the count face found its
          week in v2.195.0, the ledger opened in v2.196.0 and the shelf in
          v2.197.0 while this card showed a bare count in silence — even
          though the rental roster was already on the wire. The card is now
          the row's FIFTH button and opens the rental yard; it wears the
          face's rose edge + live dot (the family vocabulary: orange
          revenue, blue transactions, red debt, amber stock, rose rentals)
          and the roster qualifier chip. The breach-age mini bar draws the
          same honest segments the other voices speak. */}
      <button
        onClick={() => setYardOpen(true)}
        data-testid="overdue-card"
        className={`focus-ring group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${k.overdueRentals.count > 0 ? 'ring-1 ring-rose-300' : ''}`}
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-rose-600" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Clock3 className="h-3.5 w-3.5 text-rose-600" /> Overdue
            {/* v2.198.0: the roster qualifier — every rental this card and
                its modal speak is the SAME named roster the Expert panel's
                rental ledger reads, so the count can never be read as a
                different book. */}
            <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700 ring-1 ring-rose-200" title="The named roster — the same rentals the Expert panel's ledger speaks">roster</span>
          </span>
          {k.overdueRentals.count > 0 && <span className="h-2 w-2 rounded-full bg-rose-600 anim-pulse-dot" />}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <CountUp value={k.overdueRentals.count} className={`text-2xl font-bold ${k.overdueRentals.count > 0 ? 'text-rose-600' : 'text-slate-700'}`} />
        </div>
        {/* v2.198.0: the card learns its shape — the breach-age mini bar,
            the four buckets drawn as one stacked strip (amber ≤7d →
            orange 8-30d → rose 31-60d → red 60d+: the deeper the breach,
            the hotter the hue). Widths are the buckets' honest shares of
            the NAMED overdue roster; a zero bucket draws nothing and an
            empty roster draws the calm empty track — never a fabricated
            segment. Tolerant: an older cached answer without the roster
            keeps the calm card (no bar), the modal's step-aside speaks. */}
        {yardSev && k.overdueRentals.count > 0 && (
          <div
            className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100"
            role="img"
            aria-label={`Breach ages: ${yardSev.counts.map((b) => `${b.label} ${b.value}`).join(', ')}`}
          >
            {yardSev.counts.map((b) =>
              b.value > 0 && yardSev.rows.length > 0 ? (
                <span key={b.key} className={b.hue} style={{ width: `${(b.value / yardSev.rows.length) * 100}%` }} />
              ) : null,
            )}
          </div>
        )}
        <p className="mt-2 text-[10px] text-slate-500">rentals past return</p>
      </button>

      {/* Debt — v2.196.0: a VOICE, not a tile. The Revenue card told the
          money's story since v2.173.0 and the count face found its voice in
          v2.195.0 while this card badge-summed its aging in silence — even
          though the named ledger was already on the wire. The card is now
          the row's THIRD button and opens the debt ledger; it wears the
          face's red edge + live dot (the family vocabulary: orange
          revenue, blue transactions, red debt) and the ledger qualifier
          chip (the gross/settled chips' ledger-face sibling). */}
      <button
        onClick={() => setDebtOpen(true)}
        data-testid="debt-card"
        className={`focus-ring group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${debtHot ? 'ring-1 ring-red-300' : ''}`}
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-red-500" />
        <div className={`flex items-center justify-between ${debtHot ? 'anim-shake' : ''}`}>
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <HandCoins className="h-3.5 w-3.5 text-red-500" /> Debt
            {/* v2.196.0: the ledger qualifier — every account this card
                and its modal speak is the SAME named population the Debt
                Expert panel reads, so the headline can never be read as
                a different book. */}
            <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-700 ring-1 ring-red-200" title="The named ledger — the same accounts the Debt Expert panel speaks">ledger</span>
          </span>
          {k.debt.total > 0 && <span className="h-2 w-2 rounded-full bg-red-500 anim-pulse-dot" />}
        </div>
        <div className="mt-1">
          <CountUp value={k.debt.total} format={kes} className="text-xl font-bold text-red-500" />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1 text-[9px]">
          <Badge variant="outline" className="px-1 py-0 text-slate-500">C {kShort(k.debt.aging.current)}</Badge>
          <Badge variant="outline" className="px-1 py-0 text-amber-700">30d {kShort(k.debt.aging.d30)}</Badge>
          <Badge variant="outline" className="px-1 py-0 text-orange-800">60d {kShort(k.debt.aging.d60)}</Badge>
          <Badge variant="outline" className="px-1 py-0 text-red-600">90d+ {kShort(k.debt.aging.d90plus)}</Badge>
        </div>
        {/* v2.196.0: the card learns its shape — the aging composition
            bar, the four buckets drawn as one stacked strip (slate →
            amber → orange → red: the deeper the age, the hotter the
            hue). Widths are the buckets' honest shares of the total; a
            zero bucket draws nothing and an empty ledger draws a calm
            empty track — never a fabricated segment. */}
        <div
          className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100"
          role="img"
          aria-label={`Aging composition: current ${kes(k.debt.aging.current)}, 30d ${kes(k.debt.aging.d30)}, 60d ${kes(k.debt.aging.d60)}, 90d+ ${kes(k.debt.aging.d90plus)}`}
        >
          {agingBuckets.map((b) =>
            b.value > 0 && k.debt.total > 0 ? (
              <span key={b.key} className={b.hue} style={{ width: `${(b.value / k.debt.total) * 100}%` }} />
            ) : null,
          )}
        </div>
      </button>

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
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The week by branch</p>
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">branch shapes and the org line above speak the same gross till face</p>
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
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The week by branch</p>
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">the same settled rows the org line counts, branch by branch</p>
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

      {/* v2.196.0: the debt drill-down — the KPI row's third voice. The
          anatomy mirrors the two modals above (panel, bar, grid, strip,
          rows) but speaks the LEDGER: the aging buckets drawn as one
          composition bar, each bucket its own honest share, the overdue
          face summed into its own strip, and the named accounts the
          payload already carried. Wears the face's red so the three
          modals never merge at a glance. Every figure composes the SAME
          payload — the drill-down composes, it never invents. */}
      <Dialog open={debtOpen} onOpenChange={setDebtOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><HandCoins className="h-4 w-4 text-red-600" /> Debt ledger</DialogTitle>
          </DialogHeader>
          {/* The panel owns its dark half from birth — the v2.195.0
              discovery (the DOM composites against the NEAREST painted
              ancestor) is house law now: every new modal panel paints
              dark:bg-slate-900 on day one, never a repeat of the
              invisible-token bug. */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">outstanding org-wide</span>
              <span data-testid="debt-ledger-total" className="text-2xl font-bold text-red-600 dark:text-red-400">{kes(k.debt.total)}</span>
            </div>
            <p data-testid="debt-ledger-meta" className="text-[10px] text-slate-500 dark:text-slate-400">
              {num(k.debt.count)} accounts{debtors ? ` · ${debtors.length} named on this answer` : ' · named ledger not on this cached answer'}
            </p>
            {/* The aging composition bar — the card's mini bar at reading
                size: one stacked strip, the grid below spells each
                bucket's amount and its honest share. No stroke, no trend
                window — debt has no 7-day story on this payload, so the
                bar speaks composition where the sibling modals draw
                sparks (a different face wears a different shape). */}
            <div data-testid="debt-aging-bar" className="mt-2">
              <div
                className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                role="img"
                aria-label={`Aging composition: current ${kes(k.debt.aging.current)}, 30d ${kes(k.debt.aging.d30)}, 60d ${kes(k.debt.aging.d60)}, 90d+ ${kes(k.debt.aging.d90plus)}`}
              >
                {agingBuckets.map((b) =>
                  b.value > 0 && k.debt.total > 0 ? (
                    <span key={b.key} className={b.hue} style={{ width: `${(b.value / k.debt.total) * 100}%` }} />
                  ) : null,
                )}
              </div>
              {/* The four buckets, each its own cell (no invented merges)
                  with the bucket's dot so the bar and the grid read as one
                  shape. The share speaks only when the total does — the
                  zero-total honesty rule. */}
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                {agingBuckets.map((b) => (
                  <div key={b.key} data-testid={`debt-bucket-${b.key}`}>
                    <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${b.hue}`} />
                      {b.label}
                    </span>
                    <p className="font-bold text-slate-800 dark:text-slate-100">{kes(b.value)}</p>
                    {debtShare(b.value) != null && <p className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">{debtShare(b.value)}% of ledger</p>}
                  </div>
                ))}
              </div>
            </div>
            {/* The overdue face — every bucket past due, summed into its
                own rose strip (the wow-strips' ledger sibling: label,
                figure, share chip). A settled ledger renders nothing here
                — honest absence, never an empty box. The share speaks
                only when the total does (the strip cannot exist without
                an overdue bucket, and an overdue bucket implies a total —
                the null branch is the pathological-payload guard). */}
            {overdueSum > 0 && (
              <div data-testid="debt-overdue-strip" className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-rose-100 bg-rose-50/70 px-2.5 py-1.5 dark:border-rose-500/30 dark:bg-rose-500/10">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-800 dark:text-rose-300">overdue buckets</span>
                <span data-testid="debt-overdue-amount" className="text-xs font-semibold tabular-nums text-rose-900 dark:text-rose-200">{kes(overdueSum)}</span>
                <span
                  data-testid="debt-overdue-share"
                  title="30d + 60d + 90d+ over the ledger total"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:ring-rose-500/30"
                >
                  {overduePct == null ? 'of the ledger' : `${overduePct}% of the ledger`}
                </span>
              </div>
            )}
          </div>
          {/* The named ledger — the accounts the Debt Expert panel reads,
              loudest balance first (re-derived here so the modal never
              depends on the route's ordering choice). Each row: the
              customer, the branch that holds the account, the status
              chip (partial amber / overdue red / anything else calm
              slate), the aging bucket chip, the balance in the face's
              red. */}
          {debtors && debtors.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The named ledger</p>
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">loudest balance first — the same accounts the Debt Expert panel speaks</p>
              <ul className="space-y-1.5">
                {debtors.map((d) => (
                  <li key={d.id} data-testid="debt-debtor-row" className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-slate-700 dark:text-slate-200">{d.customer}</span>
                      {d.store && <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">{d.store}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ${debtorStatusChip(d.status)}`}
                        title={`Account status: ${d.status.toLowerCase()}`}
                      >
                        {d.status.toLowerCase()}
                      </span>
                      <span className="inline-flex items-center rounded bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30">{debtorBucketLabel(d.bucket)}</span>
                      <span className="text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">{kes(d.outstanding)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The ledger by branch — the same named accounts grouped by the
              branch that holds them, loudest balance first, with each
              branch's account count as its quiet chip. Derived from the
              SAME rows (zero new queries); an unnamed account rests under
              "Unassigned" — still spoken, never dropped. */}
          {branchDebt && branchDebt.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The ledger by branch</p>
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">the same named accounts, grouped by the branch that holds them</p>
              <ul className="space-y-1.5">
                {branchDebt.map((b) => (
                  <li key={b.name} data-testid="debt-branch-row" className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-slate-600 dark:text-slate-400">{b.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30"
                        title="Named accounts at this branch"
                      >
                        {b.count} {b.count === 1 ? 'account' : 'accounts'}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">{kes(b.total)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The honest absences: a fully settled ledger says so (the
              Expert panel's line); an older cached answer without the
              named ledger speaks its step-aside — the aging story above
              still carries, never a silent void. */}
          {debtors && debtors.length === 0 && (
            <p data-testid="debt-ledger-empty" className="mt-3 border-t border-slate-100 pt-3 text-[10px] text-slate-500 dark:text-slate-400">
              No outstanding balances — every account is settled.
            </p>
          )}
          {ledgerStale && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p data-testid="debt-ledger-stale" className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                the named ledger is not on this cached answer — the aging story above still speaks. Reload to fetch it.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* v2.197.0: the reorder-watchlist drill-down — the KPI row's fourth
          voice, the door arc's fourth door. The anatomy mirrors the three
          modals above (panel, bar, grid, strip, rows, branch face) but
          speaks the SHELF: the severity buckets drawn as one composition
          bar (at level → below → critical → out — the hue deepens with
          urgency), each bucket its own honest share of the named
          watchlist, the units-short face summed into its own amber strip,
          and the named items the payload already carried
          (inventory.lowStockItems — the Stock Expert panel's wire).
          Wears the face's amber so the four modals never merge at a
          glance. Every figure composes the SAME payload — the drill-down
          composes, it never invents. */}
      <Dialog open={stockOpen} onOpenChange={setStockOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PackageOpen className="h-4 w-4 text-amber-600" /> Reorder watchlist</DialogTitle>
          </DialogHeader>
          {/* The panel owns its dark half from birth — the v2.195.0
              discovery (the DOM composites against the NEAREST painted
              ancestor) is house law now: every new modal panel paints
              dark:bg-slate-900 on day one, never a repeat of the
              invisible-token bug. FOUR panels now paint it. */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">SKUs at/below reorder level</span>
              <span data-testid="lowstock-watchlist-count" className="text-2xl font-bold text-amber-700 dark:text-amber-400">{num(k.lowStock.count)}</span>
            </div>
            <p data-testid="lowstock-watchlist-meta" className="text-[10px] text-slate-500 dark:text-slate-400">
              of {num(data.inventory?.totalSkus ?? 0)} SKUs org-wide
              {stockRows ? ` · ${stockRows.length} named on this answer` : ' · named watchlist not on this cached answer'}
              {shelfCoverage != null && stockRows && stockRows.length > 0 ? ` · shelves hold ${shelfCoverage}% of the reorder line` : ''}
            </p>
            {/* The severity composition bar — the card's mini bar at
                reading size: one stacked strip, the grid below spells each
                bucket's count and its honest share. No stroke, no trend
                window — stock has no 7-day story on this payload, so the
                bar speaks severity where the sibling modals draw sparks
                (a different face wears a different shape). Renders only
                when the named watchlist arrived AND holds items — an
                empty watchlist renders the honest empty state below
                instead of a bar of zeros. */}
            {severity && (
              <div data-testid="lowstock-severity-bar" className="mt-2">
                <div
                  className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                  role="img"
                  aria-label={`Severity: ${severity.counts.map((b) => `${b.label.toLowerCase()} ${b.value}`).join(', ')}`}
                >
                  {severity.counts.map((b) =>
                    b.value > 0 ? (
                      <span key={b.key} className={b.hue} style={{ width: `${(b.value / severity.rows.length) * 100}%` }} />
                    ) : null,
                  )}
                </div>
                {/* The four buckets, each its own cell (no invented merges)
                    with the bucket's dot so the bar and the grid read as one
                    shape. The share speaks only when the watchlist does —
                    the zero-total honesty rule. */}
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  {severity.counts.map((b) => (
                    <div key={b.key} data-testid={`lowstock-bucket-${b.key}`}>
                      <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${b.hue}`} />
                        {b.label}
                      </span>
                      <p className="font-bold text-slate-800 dark:text-slate-100">{num(b.value)}</p>
                      {stockShare(b.value) != null && <p className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">{stockShare(b.value)}% of watchlist</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* The reorder face — every unit the shelves are short, summed
                into its own amber strip (the wow-strips' stock sibling:
                label, figure, item-count chip). An all-at-level watchlist
                sums to zero and renders nothing here — honest absence,
                never an empty box. */}
            {stockRows && stockRows.length > 0 && shortSum > 0 && (
              <div data-testid="lowstock-short-strip" className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-amber-100 bg-amber-50/70 px-2.5 py-1.5 dark:border-amber-500/30 dark:bg-amber-500/10">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">units short</span>
                <span data-testid="lowstock-short-amount" className="text-xs font-semibold tabular-nums text-amber-900 dark:text-amber-200">{num(shortSum)}</span>
                <span
                  data-testid="lowstock-short-items"
                  title="Named items below their level (at-level items are zero short)"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:ring-amber-500/30"
                >
                  {stockRows.filter((p) => p.deficit > 0).length} of {stockRows.length} items
                </span>
              </div>
            )}
          </div>
          {/* The named watchlist — the items the Stock Expert panel reads,
              loudest deficit first (re-derived here so the modal never
              depends on the route's ordering choice). Each row: the
              product, the sku beneath it, the branch + category line, the
              coverage chip (out red / critical orange / below amber / at
              level calm slate), and the qty/reorder pair the Expert
              table's column speaks, in the face's amber. */}
          {stockRows && stockRows.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The named watchlist</p>
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">deepest shortage first — the same items the Stock Expert panel speaks</p>
              <ul className="space-y-1.5">
                {stockRows.map((p) => (
                  <li key={p.id} data-testid="lowstock-item-row" className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-slate-700 dark:text-slate-200">{p.name}</span>
                      <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">{p.sku}{p.store ? ` · ${p.store}` : ''}{p.category ? ` · ${p.category}` : ''}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tabular-nums tracking-wide ring-1 ${coverageChip(p).cls}`}
                        title={p.coverage != null ? `Coverage: ${num(p.stockQty)} of ${num(p.reorderLevel)} units (${Math.round(p.coverage * 100)}% of the level)` : 'No reorder level set'}
                      >
                        {coverageChip(p).text}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-400">{num(p.stockQty)} / {num(p.reorderLevel)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The watchlist by branch — the same named items grouped by the
              branch that holds them, loudest shortage first, with each
              branch's item count as its quiet chip. Derived from the SAME
              rows (zero new queries); an unnamed item rests under
              "Unassigned" — still spoken, never dropped. The figure is the
              branch's units short — the number a reorder run needs. */}
          {branchStock && branchStock.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The watchlist by branch</p>
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">the same named items, grouped by the branch that holds them</p>
              <ul className="space-y-1.5">
                {branchStock.map((b) => (
                  <li key={b.name} data-testid="lowstock-branch-row" className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-slate-600 dark:text-slate-400">{b.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30"
                        title="Named items at this branch"
                      >
                        {b.count} {b.count === 1 ? 'item' : 'items'}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-400">{num(b.short)} short</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The honest absences: a fully stocked floor says so (the
              Expert panel's line); an older cached answer without the
              named watchlist speaks its step-aside — the count story
              above still carries, never a silent void. */}
          {watchlistReady && stockRows && stockRows.length === 0 && (
            <p data-testid="lowstock-watchlist-empty" className="mt-3 border-t border-slate-100 pt-3 text-[10px] text-slate-500 dark:text-slate-400">
              Everything is above its reorder level.
            </p>
          )}
          {watchlistStale && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p data-testid="lowstock-watchlist-stale" className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                the named watchlist is not on this cached answer — the count story above still speaks. Reload to fetch it.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* v2.198.0: the rental-yard drill-down — the KPI row's fifth voice,
          the door arc's LAST tile. The anatomy mirrors the four modals
          above (panel, bar, grid, strip, rows, branch face) but speaks the
          YARD: the breach buckets drawn as one composition bar (≤7d →
          8-30d → 31-60d → 60d+ — the hue deepens with the breach's age),
          each bucket its own honest share of the overdue roster, the
          per-day exposure summed into its own rose strip, the overdue
          rentals loudest-breach-first with status/days chips and the
          Expert ledger's rate voice, the active rentals as the yard's
          calm half, and the roster grouped by the branch that holds it.
          Wears the face's rose so the five modals never merge at a
          glance. Every figure composes the SAME payload — the drill-down
          composes, it never invents. */}
      <Dialog open={yardOpen} onOpenChange={setYardOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-rose-600" /> The rental yard</DialogTitle>
          </DialogHeader>
          {/* The panel owns its dark half from birth — the v2.195.0
              discovery (the DOM composites against the NEAREST painted
              ancestor) is house law now: every new modal panel paints
              dark:bg-slate-900 on day one, never a repeat of the
              invisible-token bug. FIVE panels now paint it. */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">rentals past return</span>
              <span data-testid="rental-yard-count" className="text-2xl font-bold text-rose-700 dark:text-rose-400">{num(k.overdueRentals.count)}</span>
            </div>
            <p data-testid="rental-yard-meta" className="text-[10px] text-slate-500 dark:text-slate-400">
              {num(data.rentals?.active ?? 0)} active also on the yard
              {overdueRows ? ` · ${overdueRows.length} named on this answer` : ' · roster not on this cached answer'}
            </p>
            {/* The breach-age composition bar — the card's mini bar at
                reading size: one stacked strip, the grid below spells each
                bucket's count and its honest share. No stroke, no trend
                window — a breach has no 7-day story on this payload, so
                the bar speaks age where the sibling modals draw sparks (a
                different face wears a different shape). Renders only when
                the named roster arrived AND holds overdue rows — a clean
                yard renders the honest clear note below instead of a bar
                of zeros. */}
            {yardSev && (
              <div data-testid="rental-days-bar" className="mt-2">
                <div
                  className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                  role="img"
                  aria-label={`Breach ages: ${yardSev.counts.map((b) => `${b.label} ${b.value}`).join(', ')}`}
                >
                  {yardSev.counts.map((b) =>
                    b.value > 0 ? (
                      <span key={b.key} className={b.hue} style={{ width: `${(b.value / yardSev.rows.length) * 100}%` }} />
                    ) : null,
                  )}
                </div>
                {/* The four buckets, each its own cell (no invented merges)
                    with the bucket's dot so the bar and the grid read as one
                    shape. The share speaks only when the roster does —
                    the zero-total honesty rule. */}
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  {yardSev.counts.map((b) => (
                    <div key={b.key} data-testid={`rental-bucket-${b.key}`}>
                      <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${b.hue}`} />
                        {b.label}
                      </span>
                      <p className="font-bold text-slate-800 dark:text-slate-100">{num(b.value)}</p>
                      {yardShare(b.value) != null && <p className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">{yardShare(b.value)}% of overdue</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* The exposure face — the daily rates on the overdue rentals,
                summed into its own rose strip (the wow-strips' yard
                sibling: label, figure, rental-count chip). A clean yard
                renders nothing here — honest absence, never an empty box. */}
            {overdueRows && overdueRows.length > 0 && exposurePerDay > 0 && (
              <div data-testid="rental-exposure-strip" className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-rose-100 bg-rose-50/70 px-2.5 py-1.5 dark:border-rose-500/30 dark:bg-rose-500/10">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-800 dark:text-rose-300">per-day exposure</span>
                <span data-testid="rental-exposure-amount" className="text-xs font-semibold tabular-nums text-rose-900 dark:text-rose-200">{kes(exposurePerDay)}/day</span>
                <span
                  data-testid="rental-exposure-rentals"
                  title="Sum of the daily rates on the overdue rentals"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:ring-rose-500/30"
                >
                  across {overdueRows.length} {overdueRows.length === 1 ? 'rental' : 'rentals'}
                </span>
              </div>
            )}
          </div>
          {/* The named overdue roster — the rentals the Expert panel's
              ledger reads, loudest breach first (re-derived here so the
              modal never depends on the route's ordering choice). Each
              row: the customer, the item beneath it, the branch line, the
              status chip (overdue red / active emerald / else calm slate —
              the Expert ledger's own voices), the days chip in the face's
              rose, and the rate/day the Expert table speaks. */}
          {overdueRows && overdueRows.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The named roster</p>
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">deepest breach first — the same rentals the Expert ledger speaks</p>
              <ul className="space-y-1.5">
                {overdueRows.map((r) => (
                  <li key={r.id} data-testid="rental-overdue-row" className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-slate-700 dark:text-slate-200">{r.customer}</span>
                      <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">{r.item}{r.store ? ` · ${r.store}` : ''}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ${rentalStatusChip(r.status)}`}
                        title={`Rental status: ${r.status.toLowerCase()}`}
                      >
                        {r.status.toLowerCase()}
                      </span>
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tabular-nums tracking-wide ring-1 ${yardDaysChip(r).cls}`}
                        title={r.days > 0 ? `${r.days} day${r.days === 1 ? '' : 's'} past the expected return of ${r.expectedReturnDate.slice(0, 10)}` : 'Past its expected return'}
                      >
                        {yardDaysChip(r).text}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-rose-700 dark:text-rose-400">{kes(r.ratePerDay)}/d</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The yard's calm half — the still-out rentals the SAME payload
              carries, soonest return first. The status field governs the
              count above; these rows wear the Expert ledger's active
              voice (emerald) and the due chip speaks the honest date
              ("due in Nd" / "due today" / "past return" when the date
              passed while the status stayed ACTIVE). A yard with nothing
              active renders nothing here — honest absence. */}
          {activeRows && activeRows.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Also on the yard</p>
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">soonest return first — still out, not yet past return</p>
              <ul className="space-y-1.5">
                {activeRows.map((r) => (
                  <li key={r.id} data-testid="rental-active-row" className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-slate-700 dark:text-slate-200">{r.customer}</span>
                      <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">{r.item}{r.store ? ` · ${r.store}` : ''}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ${rentalStatusChip(r.status)}`}
                        title={`Rental status: ${r.status.toLowerCase()}`}
                      >
                        {r.status.toLowerCase()}
                      </span>
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tabular-nums tracking-wide ring-1 ${yardDaysChip(r).cls}`}
                        title={r.due > 0 ? `Expected return ${r.expectedReturnDate.slice(0, 10)}` : r.due === 0 ? 'Expected return is today' : 'Past its expected return — the status still reads active'}
                      >
                        {yardDaysChip(r).text}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">{kes(r.ratePerDay)}/d</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The yard by branch — the same overdue rows grouped by the
              branch that holds them, loudest exposure first, with each
              branch's rental count as its quiet chip. Derived from the
              SAME rows (zero new queries); an unnamed rental rests under
              "Unassigned" — still spoken, never dropped. The figure is
              the branch's per-day exposure — the number a follow-up call
              needs. */}
          {branchYard && branchYard.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The yard by branch</p>
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">the same overdue rentals, grouped by the branch that holds them</p>
              <ul className="space-y-1.5">
                {branchYard.map((b) => (
                  <li key={b.name} data-testid="rental-branch-row" className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-slate-600 dark:text-slate-400">{b.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30"
                        title="Overdue rentals at this branch"
                      >
                        {b.count} {b.count === 1 ? 'rental' : 'rentals'}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-rose-700 dark:text-rose-400">{kes(b.perDay)}/d</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The honest absences: a clean yard says so; an older cached
              answer without the roster speaks its step-aside — the count
              story above still carries, never a silent void. */}
          {yardReady && overdueRows && overdueRows.length === 0 && (
            <p data-testid="rental-yard-clear" className="mt-3 border-t border-slate-100 pt-3 text-[10px] text-slate-500 dark:text-slate-400">
              Nothing is past return — the yard is clean.
            </p>
          )}
          {yardStale && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p data-testid="rental-yard-stale" className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                the rental roster is not on this cached answer — the count story above still speaks. Reload to fetch it.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
