'use client';

/**
 * The branch dashboard's quiet cards speak (v2.201.0) — "the branch's debt
 * book and the day's movers"; the week joins them (v2.203.0) — "the week
 * speaks".
 *
 * The branch KPI row found its three voices in v2.200.0; this round walks
 * the door arc down the page's bottom grid, where TWO cards still rendered
 * their stories in silence even though every figure they could drill into
 * already rode the dashboard wire:
 *
 *   - The DEBT AGING SUMMARY card speaks total + aging buckets + a count,
 *     while `debtCrisis.customers` carries the wire's top-10 NAMED debtors
 *     (name, owes, lifetimeSpend, ratio, highRisk) and `highRiskCount` /
 *     `warning` / `banner` carry the alarm — none of it spoken beyond the
 *     headline. The card becomes a door (the debt family's ROSE face) and
 *     opens **The branch's debt book**: the aging bar at reading size with
 *     honest shares of the book, the named debtors loudest-first with their
 *     share of the book and the risk voice (a high-risk debtor owes more
 *     than twice their lifetime spend — the wire's own rule, spoken, never
 *     re-invented), the high-risk line, the server's own warning banner
 *     when it rides the answer, and the honest window note — the book
 *     names its loudest debtors, the BILL count stays the truth.
 *   - The TOP SELLING PRODUCTS card ranks today's movers five deep, while
 *     the wire names TEN (`topProducts`, capped at 10 by revenue) AND a
 *     category mix the tab has never read (`topSellingCategories`, the
 *     route's full GROUP BY over the day's lines, top 10 by revenue). The
 *     card becomes a door (the VIOLET face — a new hue for products) and
 *     opens **The day's movers**: the full named roster with qty, revenue
 *     and an honest share OF THE NAMED WINDOW (the note says what the
 *     share reads against), and the category mix with the wire's own
 *     colors — where the money came from, category by category.
 *
 * The house laws hold from birth: both panels paint their dark half
 * (`dark:border-slate-700 dark:bg-slate-900` — the branch page's next two
 * mounts of the dark-panel law); a zero total renders NO percentage (never
 * an invented "0%" of nothing) and says so; a zero bucket bar draws nothing
 * while its cell still speaks its 0; the named rosters are windows when
 * they are (the count stays the truth); the risk rule is the WIRE's, not a
 * client re-derivation; null wire rows are filtered by type predicate,
 * never a non-null assertion; and the doors are self-contained focus
 * views — no anchors, no deep links (the honest-door law: the pointer is
 * not a door).
 *
 * Zero new queries: every door composes fields the GET /api/dashboard
 * response already carries. Money is coerced at the boundary (the
 * DECIMAL-STRING AUDIT precedent — never trust wire types for money).
 */

import React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatKES } from '@/lib/api';
import { AlertTriangle, CircleDollarSign, Package, TrendingUp } from 'lucide-react';

// ── The wire slices the two doors read ──────────────────────────────────────
// Structural subsets of the dashboard payload (DashboardData satisfies
// them); numeric coercion happens at the boundary, never trusted from the
// wire types.

export interface BranchDebtWire {
  debtCrisis?: {
    outstandingTotal?: number | string;
    outstandingCount?: number | string;
    debtRatioPercent?: number | string;
    warning?: boolean;
    banner?: string | null;
    highRiskCount?: number | string;
    aging?: {
      current?: number | string;
      d30?: number | string;
      d60?: number | string;
      d90plus?: number | string;
    } | null;
    customers?: Array<{
      customerId: string;
      name: string;
      owes: number | string;
      lifetimeSpend: number | string;
      ratio: number | null;
      highRisk: boolean;
    } | null>;
  } | null;
}

export interface BranchMoversWire {
  topProducts?: Array<{
    productId: string;
    productName: string;
    totalQuantity: number | string;
    totalRevenue: number | string;
  } | null>;
  topSellingCategories?: Array<{
    categoryId: string;
    categoryName: string;
    color: string | null;
    revenue: number | string;
    quantitySold: number | string;
  } | null>;
}

/** Decimal-string safe number coercion - never trust wire types for money. */
function num(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

/**
 * THE ONE SHARE WRITER — an honest percentage of a total, or null when the
 * total is zero (a share of nothing is never spoken; the zero-total rule).
 */
function shareOf(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 100);
}

/** The share's voice: "85% of the book" / "85% of the named window". */
function shareLabel(share: number | null, of: string): string {
  return share == null ? '' : `${share}% of ${of}`;
}

// ── The debt book ────────────────────────────────────────────────────────────

/** The aging buckets' voices — the card's own four colors, reused verbatim.
 *  v2.204.0: the modal rides the page card's re-voiced -600 family (the
 *  modal's bars and dots sit on the same white card ground; emerald-500
 *  measured 2.54 and orange-500 2.80, both under the 3:1 graphics bar).
 *  The dot classes move with their hexes so the dot never out-lies the bar. */
const DEBT_BUCKETS: Array<{ key: 'current' | 'd30' | 'd60' | 'd90plus'; label: string; color: string; dot: string }> = [
  { key: 'current', label: 'Current', color: '#059669', dot: 'bg-emerald-600' },
  { key: 'd30', label: '1-30 days', color: '#64748b', dot: 'bg-slate-500' },
  { key: 'd60', label: '31-60 days', color: '#ea580c', dot: 'bg-orange-600' },
  { key: 'd90plus', label: '90+ days', color: '#ef4444', dot: 'bg-red-500' },
];

/**
 * The named debtors, loudest-first — re-derived client-side from the same
 * rows (the house one-writer sort). Null rows are filtered by predicate.
 */
function debtRows(crisis: NonNullable<BranchDebtWire['debtCrisis']>): Array<{
  customerId: string; name: string; owes: number; lifetimeSpend: number; ratio: number | null; highRisk: boolean;
}> {
  return (crisis.customers ?? [])
    .filter((c): c is NonNullable<typeof c> => !!c && c.customerId != null)
    .map((c) => ({
      customerId: c.customerId,
      name: c.name,
      owes: num(c.owes),
      lifetimeSpend: num(c.lifetimeSpend),
      ratio: c.ratio == null ? null : num(c.ratio),
      highRisk: !!c.highRisk,
    }))
    .sort((a, b) => b.owes - a.owes);
}

/**
 * The RISK VOICE — the wire's own highRisk flag (owes > 2 × lifetime spend,
 * requires lifetimeSpend > 0) spoken in words; the ratio rides the wire too
 * and is never re-derived here.
 */
function riskVoice(row: { lifetimeSpend: number; ratio: number | null; highRisk: boolean }): { chip: string | null; line: string } {
  if (row.highRisk) {
    return { chip: 'high risk', line: `owes more than twice their ${formatKES(row.lifetimeSpend)} lifetime spend` };
  }
  if (row.ratio != null && row.lifetimeSpend > 0) {
    return { chip: null, line: `${formatKES(row.lifetimeSpend)} lifetime spend · ${Math.round(row.ratio * 100)}% of it owed` };
  }
  if (row.lifetimeSpend <= 0) {
    return { chip: null, line: 'no completed purchases on record' };
  }
  return { chip: null, line: `${formatKES(row.lifetimeSpend)} lifetime spend` };
}

/** Shared modal chrome — the branch doors' panel paints its dark half. */
const PANEL_CLS = 'max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl custom-scrollbar dark:border-slate-700 dark:bg-slate-900';

/** Chip voice: the wire's high-risk alarm in the debt family's rose. */
const RISK_CHIP_CLS =
  'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30';

export function DebtBookModal({ crisis, open, onClose }: { crisis: BranchDebtWire['debtCrisis']; open: boolean; onClose: () => void }) {
  const total = num(crisis?.outstandingTotal);
  const count = num(crisis?.outstandingCount);
  const highRiskCount = num(crisis?.highRiskCount);
  const rows = crisis ? debtRows(crisis) : [];
  const aging = crisis?.aging ?? null;
  const buckets = aging
    ? DEBT_BUCKETS.map((b) => ({ ...b, value: num(aging[b.key]) }))
    : [];
  const hasAging = buckets.length > 0;
  const clear = total <= 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className={PANEL_CLS} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <CircleDollarSign className="h-4 w-4 text-rose-700" aria-hidden="true" />
            The branch&rsquo;s debt book — v2.201.0
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Who owes what, how late, and how loud — composed from the answer the card already carries.
          </DialogDescription>
        </DialogHeader>

        {clear ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" data-testid="branch-debt-clear">
            The book is clear — no outstanding debt on this branch today.
          </p>
        ) : (
          <div className="space-y-4">
            {/* The headline — the count the card speaks stays the truth */}
            <div>
              <p className="text-2xl font-bold tabular-nums text-rose-700 dark:text-rose-300" data-testid="branch-debt-count">{formatKES(total)}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid="branch-debt-meta">
                {count} outstanding bill{count === 1 ? '' : 's'} · {rows.length} named debtor{rows.length === 1 ? '' : 's'}
              </p>
            </div>

            {/* The wire's own alarm, verbatim */}
            {crisis?.warning && crisis.banner ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30" data-testid="branch-debt-banner">
                {crisis.banner}
              </p>
            ) : null}

            {/* The aging bar at reading size — honest widths of the book */}
            {hasAging ? (
              <>
                <div
                  className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                  role="img"
                  aria-label={`Debt aging: ${DEBT_BUCKETS.map((b) => `${b.label} ${formatKES(num(aging?.[b.key]))}`).join(', ')} — total ${formatKES(total)}.`}
                  data-testid="branch-debt-bar"
                >
                  {buckets.map((b) => (
                    <div
                      key={b.key}
                      className="h-full transition-all duration-500"
                      style={{ width: `${total > 0 ? (b.value / total) * 100 : 0}%`, backgroundColor: b.color }}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                {/* The four bucket cells — dot + label + amount + honest share */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {buckets.map((b) => {
                    const share = shareOf(b.value, total);
                    return (
                      <div key={b.key} className="rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:ring-slate-500/30" data-testid={`branch-debt-bucket-${b.key}`}>
                        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} aria-hidden="true" />
                          {b.label}
                        </p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatKES(b.value)}</p>
                        {share != null ? (
                          <p className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400" data-testid={`branch-debt-share-${b.key}`}>{share}% of the book</p>
                        ) : (
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">none</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {/* The high-risk line — the wire's own count */}
            {highRiskCount > 0 ? (
              <p className="text-xs font-medium text-rose-700 dark:text-rose-300" data-testid="branch-debt-hot">
                {highRiskCount} debtor{highRiskCount === 1 ? '' : 's'} owe{highRiskCount === 1 ? 's' : ''} more than twice their lifetime spend.
              </p>
            ) : null}

            {/* The named debtors — loudest first, share of the BOOK */}
            {rows.length > 0 ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The named debtors</p>
                <ul className="mt-2 space-y-2">
                  {rows.map((r) => {
                    const share = shareOf(r.owes, total);
                    const risk = riskVoice(r);
                    return (
                      <li key={r.customerId} className="rounded-lg px-2.5 py-2 ring-1 ring-slate-200 dark:ring-slate-700" data-testid="branch-debt-row">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{r.name}</p>
                          <p className="shrink-0 text-sm font-bold tabular-nums text-rose-700 dark:text-rose-300">{formatKES(r.owes)}</p>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                          {share != null ? (
                            <span className="tabular-nums" data-testid="branch-debt-share">{shareLabel(share, 'the book')}</span>
                          ) : null}
                          {risk.chip ? (
                            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-semibold ring-1 ${RISK_CHIP_CLS}`} data-testid="branch-debt-risk-chip">{risk.chip}</span>
                          ) : null}
                          <span data-testid="branch-debt-risk-line">{risk.line}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30" data-testid="branch-debt-unnamed">
                The book&rsquo;s rows ride unnamed on this answer — the total and the aging stay the truth.
              </p>
            )}

            {/* The honest window note — the roster is a top slice, the COUNT is the truth */}
            <p className="border-t border-slate-100 pt-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400" data-testid="branch-debt-window">
              The book names its loudest {rows.length} debtor{rows.length === 1 ? '' : 's'} on this answer — {count} outstanding bill{count === 1 ? '' : 's'} in all; the shares read against the whole book.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── The day's movers ─────────────────────────────────────────────────────────

/**
 * The named movers, loudest-first — re-derived client-side from the same
 * rows the card ranks (the house one-writer sort). Null rows are filtered
 * by predicate, never a non-null assertion.
 */
function moverRows(products: NonNullable<BranchMoversWire['topProducts']>): Array<{
  productId: string; productName: string; qty: number; revenue: number;
}> {
  return products
    .filter((p): p is NonNullable<typeof p> => !!p && p.productId != null)
    .map((p) => ({
      productId: p.productId,
      productName: p.productName,
      qty: num(p.totalQuantity),
      revenue: num(p.totalRevenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function categoryRows(categories: NonNullable<BranchMoversWire['topSellingCategories']>): Array<{
  categoryId: string; categoryName: string; color: string | null; revenue: number;
}> {
  return categories
    .filter((c): c is NonNullable<typeof c> => !!c && c.categoryId != null)
    .map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      color: c.color ?? null,
      revenue: num(c.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function MoversModal({ products, categories, open, onClose }: { products: BranchMoversWire['topProducts']; categories: BranchMoversWire['topSellingCategories']; open: boolean; onClose: () => void }) {
  const rows = products ? moverRows(products) : [];
  const namedTotal = rows.reduce((s, r) => s + r.revenue, 0);
  const namedQty = rows.reduce((s, r) => s + r.qty, 0);
  const top = rows[0] ?? null;
  const cats = categories ? categoryRows(categories) : [];
  const catTotal = cats.reduce((s, c) => s + c.revenue, 0);
  const clear = rows.length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className={PANEL_CLS} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <Package className="h-4 w-4 text-violet-600" aria-hidden="true" />
            The day&rsquo;s movers — v2.201.0
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            What moved today, rank by rank and category by category — composed from the answer the card already carries.
          </DialogDescription>
        </DialogHeader>

        {clear ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30" data-testid="branch-movers-clear">
            No movers yet today — the day&rsquo;s first sale will rank here.
          </p>
        ) : (
          <div className="space-y-4">
            {/* The headline — the named window's own totals */}
            <div>
              <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100" data-testid="branch-movers-count">{rows.length} mover{rows.length === 1 ? '' : 's'}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid="branch-movers-meta">
                {formatKES(namedTotal)} across the named window · {namedQty} unit{namedQty === 1 ? '' : 's'} sold
              </p>
              {top ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" data-testid="branch-movers-top">
                  Loudest: <span className="font-medium text-slate-700 dark:text-slate-200">{top.productName}</span> at {formatKES(top.revenue)}
                </p>
              ) : null}
            </div>

            {/* The full named roster — share OF THE NAMED WINDOW */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The named roster</p>
              <ol className="mt-2 space-y-2">
                {rows.map((r, i) => {
                  const share = shareOf(r.revenue, namedTotal);
                  return (
                    <li key={r.productId} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-2 rounded-lg px-2 py-1.5 ring-1 ring-slate-200 dark:ring-slate-700" data-testid="branch-movers-row">
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{r.productName}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          {r.qty} sold
                          {share != null ? (
                            <span className="tabular-nums" data-testid="branch-movers-share"> · {share}% of the named window</span>
                          ) : null}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatKES(r.revenue)}</p>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* The category mix — the wire's own colors, honest shares */}
            {cats.length > 0 && catTotal > 0 ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The category mix</p>
                <ul className="mt-2 space-y-1.5">
                  {cats.map((c) => {
                    const share = shareOf(c.revenue, catTotal);
                    return (
                      <li key={c.categoryId} className="flex items-center justify-between gap-2 text-xs" data-testid="branch-movers-cat-row">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-slate-300 dark:ring-slate-600" style={{ backgroundColor: c.color ?? '#94a3b8' }} aria-hidden="true" />
                          <span className="truncate text-slate-700 dark:text-slate-200">{c.categoryName}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                          {formatKES(c.revenue)}
                          {share != null ? <span data-testid="branch-movers-cat-share"> · {share}% of the mix</span> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {/* The honest window note — the doors read the named answer */}
            <p className="border-t border-slate-100 pt-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400" data-testid="branch-movers-window">
              The movers read the {rows.length} product{rows.length === 1 ? '' : 's'} named on this answer — the shares read against the named window, the card&rsquo;s headline stays the truth.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── The branch's week (v2.203.0 — the week speaks) ──────────────────────────

export interface BranchWeekWire {
  revenueTrend7d?: {
    days?: Array<{
      date: string;
      label: string;
      revenue: number | string;
      isToday: boolean;
    } | null>;
    forecast?: number | string;
    forecastMethod?: string | null;
    todayIsOutlier?: boolean;
  } | null;
}

/**
 * The named days IN CALENDAR ORDER — a week is a timeline, not a ranking,
 * so the rows speak in the order the days happened; the loudest day earns
 * its own spoken line instead of a reorder. Null rows are filtered by
 * predicate, never a non-null assertion.
 */
function weekDays(days: NonNullable<BranchWeekWire['revenueTrend7d']>['days']): Array<{
  date: string; label: string; revenue: number; isToday: boolean;
}> {
  return (days ?? [])
    .filter((d): d is NonNullable<typeof d> => !!d && d.date != null)
    .map((d) => ({
      date: d.date,
      label: d.label,
      revenue: num(d.revenue),
      isToday: !!d.isToday,
    }));
}

/**
 * The branch's week — the seven named days' revenues, the wire's forecast
 * and its own method, today's honest progress against that forecast, and
 * the wire's own outlier voice. The zero-total rule holds: a share of a
 * zero week is never spoken, a zero day says "no sales" instead of a
 * percentage of nothing.
 */
export function WeekLedgerModal({ trend, open, onClose }: { trend: BranchWeekWire['revenueTrend7d']; open: boolean; onClose: () => void }) {
  const rows = trend ? weekDays(trend.days) : [];
  const weekTotal = rows.reduce((s, r) => s + r.revenue, 0);
  const loudest = rows.reduce<(typeof rows)[number] | null>(
    (best, r) => (best == null || r.revenue > best.revenue ? r : best),
    null,
  );
  const forecast = num(trend?.forecast);
  const method = trend?.forecastMethod ?? '';
  const outlier = trend?.todayIsOutlier === true;
  const today = rows.find((r) => r.isToday) ?? null;
  const todayShare = today && forecast > 0 ? shareOf(today.revenue, forecast) : null;
  const empty = rows.length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className={PANEL_CLS} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <TrendingUp className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            The branch&rsquo;s week — v2.203.0
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Day by day, what the week collected — composed from the answer the chart already draws.
          </DialogDescription>
        </DialogHeader>

        {empty ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30" data-testid="branch-week-empty">
            Not enough history yet — the week speaks after a couple of trading days.
          </p>
        ) : (
          <div className="space-y-4">
            {/* The headline — the named week's own total */}
            <div>
              <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100" data-testid="branch-week-total">{formatKES(weekTotal)}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid="branch-week-meta">
                {rows.length} named day{rows.length === 1 ? '' : 's'} · forecast {formatKES(forecast)}
              </p>
              {loudest ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" data-testid="branch-week-loudest">
                  Loudest: <span className="font-medium text-slate-700 dark:text-slate-200">{loudest.label}</span> at {formatKES(loudest.revenue)}
                </p>
              ) : null}
            </div>

            {/* The named days, in calendar order — zero days speak, never dropped */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The named days</p>
              <ol className="mt-2 space-y-2">
                {rows.map((r) => {
                  const share = shareOf(r.revenue, weekTotal);
                  return (
                    <li key={r.date} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg px-2.5 py-2 ring-1 ring-slate-200 dark:ring-slate-700" data-testid="branch-week-row">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                          <span className="truncate">{r.label}</span>
                          {r.isToday ? (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" data-testid="branch-week-today-chip">today</span>
                          ) : null}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          {r.revenue > 0 && share != null ? (
                            <span className="tabular-nums" data-testid="branch-week-share">{shareLabel(share, 'the week')}</span>
                          ) : (
                            <span data-testid="branch-week-zero">no sales</span>
                          )}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatKES(r.revenue)}</p>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* The forecast block — the wire's method verbatim + today's honest progress */}
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:ring-slate-500/30">
              <p className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300" data-testid="branch-week-forecast">
                <span className="inline-block h-0 w-5 border-t-2 border-dashed border-amber-600" aria-hidden="true" />
                <span>Forecast <span className="font-semibold tabular-nums">{formatKES(forecast)}</span></span>
                {method ? <span className="text-slate-500 dark:text-slate-400"> · {method}</span> : null}
              </p>
              {today && today.revenue > 0 ? (
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300" data-testid="branch-week-delta">
                  Today so far {formatKES(today.revenue)}
                  {todayShare != null ? <span className="tabular-nums"> · {todayShare}% of the forecast</span> : null}
                </p>
              ) : null}
              {outlier ? (
                <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30" data-testid="branch-week-outlier">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Today is a bulk-sale outlier — the forecast rides the median of the previous 6 days.
                </p>
              ) : null}
            </div>

            {/* The honest window note — the doors read the named answer */}
            <p className="border-t border-slate-100 pt-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400" data-testid="branch-week-window">
              The week reads the {rows.length} day{rows.length === 1 ? '' : 's'} named on this answer — the shares read against the named week, the chart stays the picture.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


