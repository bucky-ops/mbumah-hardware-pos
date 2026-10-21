'use client';

/**
 * The org desk's quiet row speaks (v2.202.0) — "the org's quiet row".
 *
 * The /console KPI command row finished its door arc in v2.199.0 (six
 * voices) and the branch workspaces' own row + bottom grid followed
 * (v2.200.0, v2.201.0) — while the ORG CONSOLE's "Combined organization
 * metrics" section still rendered its SIX tiles as silent divs: Revenue
 * today, Transactions today, Low stock items, Overdue rentals, Debt
 * outstanding and Pending M-Pesa, even though the summary wire
 * (`GET /api/org/summary`) has carried the per-branch slices all along —
 * `stores[]` with each branch's todayRevenue, todayTransactions,
 * lowStockCount, overdueRentals, debtOutstanding + debtCount and
 * pendingMpesa. This release gives the six tiles the door vocabulary
 * (the /console KPI row's own face inventory: orange revenue, blue
 * transactions, amber stock, rose rentals, red debt, indigo pending) and
 * opens **the branch slice** for each: ONE parametrized modal speaking the
 * named branch rows loudest-first with each branch's honest share of the
 * org total, the count sub-line where the wire carries one (transactions
 * ride the revenue rows; the debt book's bill count rides the debt rows),
 * the quiet branches speaking their 0, the zero-total rule (no percentage
 * of nothing), and the honest window note — the slice reads the branches
 * named on this answer.
 *
 * The house laws hold from birth: the panel paints its dark half
 * (`dark:border-slate-700 dark:bg-slate-900` — the org desk's mount of
 * the dark-panel law); the door is a self-contained focus view with NO
 * anchors (the honest-door law — the branches table two scrolls down
 * already carries the workspace doors, spoken in words, not linked);
 * null/absent wire rows are filtered by predicate, never a non-null
 * assertion; money is coerced at the boundary (the DECIMAL-STRING AUDIT
 * precedent); and the RBAC is the summary's own — the doors compose the
 * slices the viewer already receives, nothing more.
 *
 * Zero new queries: the doors compose fields the summary response already
 * carries. One currency voice only (the v2.201.1 lesson — formatKES
 * speaks "Ksh"; never prefix it again).
 */

import React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatKES } from '@/lib/api';
import { Building2 } from 'lucide-react';

// ── The wire slice the doors read ───────────────────────────────────────────
// A structural subset of the org summary payload (OrgSummary satisfies it).

export interface OrgDeskWire {
  totals?: {
    revenue?: number;
    transactions?: number;
    lowStock?: number;
    overdueRentals?: number;
    debtOutstanding?: number;
    pendingMpesa?: number;
  } | null;
  stores?: Array<{
    storeId?: string;
    name?: string;
    todayRevenue?: number;
    todayTransactions?: number;
    lowStockCount?: number;
    overdueRentals?: number;
    debtOutstanding?: number;
    debtCount?: number;
    pendingMpesa?: number;
  } | null>;
}

/** Decimal-string safe number coercion - never trust wire types for money. */
function num(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

/** THE one share writer — null when the total is zero (never "0% of nothing"). */
function shareOf(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 100);
}

// ── The six metrics ─────────────────────────────────────────────────────────

export type OrgDeskMetricId =
  | 'revenue'
  | 'transactions'
  | 'lowStock'
  | 'overdueRentals'
  | 'debt'
  | 'pendingMpesa';

export interface OrgDeskMetric {
  id: OrgDeskMetricId;
  /** The modal's title voice, e.g. "The org's revenue by branch". */
  title: string;
  /** The family hue — the /console KPI row's own face inventory. */
  hue: 'orange' | 'blue' | 'amber' | 'rose' | 'red' | 'indigo';
  /** Money reads formatKES; counts read as plain numbers. */
  unit: 'money' | 'count';
  /** The branch's slice of this metric. */
  slice: (s: NonNullable<OrgDeskWire['stores']>[number]) => number;
  /** An optional second figure the wire carries for each branch. */
  countLine?: (s: NonNullable<OrgDeskWire['stores']>[number]) => string | null;
  /** The org total the shares read against. */
  total: (w: OrgDeskWire) => number;
  /** The wire's name for the metric (used in the window note). */
  noun: string;
}

/** The light/dark voice pairs per hue, measured by the round's probe. */
const HUE_VOICE: Record<OrgDeskMetric['hue'], { accentLight: string; accentDark: string; edge: string; dot: string; chip: string }> = {
  orange: { accentLight: 'text-orange-700', accentDark: 'dark:text-orange-300', edge: 'bg-orange-600', dot: 'bg-orange-600', chip: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30' },
  blue: { accentLight: 'text-blue-700', accentDark: 'dark:text-blue-300', edge: 'bg-blue-600', dot: 'bg-blue-600', chip: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30' },
  amber: { accentLight: 'text-amber-700', accentDark: 'dark:text-amber-300', edge: 'bg-amber-600', dot: 'bg-amber-600', chip: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30' },
  rose: { accentLight: 'text-rose-700', accentDark: 'dark:text-rose-300', edge: 'bg-rose-600', dot: 'bg-rose-600', chip: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30' },
  red: { accentLight: 'text-red-700', accentDark: 'dark:text-red-300', edge: 'bg-red-600', dot: 'bg-red-600', chip: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30' },
  indigo: { accentLight: 'text-indigo-700', accentDark: 'dark:text-indigo-300', edge: 'bg-indigo-600', dot: 'bg-indigo-600', chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30' },
};

export const ORG_DESK_METRICS: Record<OrgDeskMetricId, OrgDeskMetric> = {
  revenue: {
    id: 'revenue',
    title: "The org's revenue by branch",
    hue: 'orange',
    unit: 'money',
    slice: (s) => num(s.todayRevenue),
    countLine: (s) => {
      const t = num(s.todayTransactions);
      return t > 0 ? `${t} transaction${t === 1 ? '' : 's'} today` : null;
    },
    total: (w) => num(w.totals?.revenue),
    noun: 'revenue',
  },
  transactions: {
    id: 'transactions',
    title: "The org's transactions by branch",
    hue: 'blue',
    unit: 'count',
    slice: (s) => num(s.todayTransactions),
    total: (w) => num(w.totals?.transactions),
    noun: 'transactions',
  },
  lowStock: {
    id: 'lowStock',
    title: "The org's low stock by branch",
    hue: 'amber',
    unit: 'count',
    slice: (s) => num(s.lowStockCount),
    total: (w) => num(w.totals?.lowStock),
    noun: 'low-stock items',
  },
  overdueRentals: {
    id: 'overdueRentals',
    title: "The org's overdue rentals by branch",
    hue: 'rose',
    unit: 'count',
    slice: (s) => num(s.overdueRentals),
    total: (w) => num(w.totals?.overdueRentals),
    noun: 'overdue rentals',
  },
  debt: {
    id: 'debt',
    title: "The org's debt by branch",
    hue: 'red',
    unit: 'money',
    slice: (s) => num(s.debtOutstanding),
    countLine: (s) => {
      const c = num(s.debtCount);
      return c > 0 ? `${c} outstanding bill${c === 1 ? '' : 's'}` : null;
    },
    total: (w) => num(w.totals?.debtOutstanding),
    noun: 'debt',
  },
  pendingMpesa: {
    id: 'pendingMpesa',
    title: "The org's pending M-Pesa by branch",
    hue: 'indigo',
    unit: 'count',
    slice: (s) => num(s.pendingMpesa),
    total: (w) => num(w.totals?.pendingMpesa),
    noun: 'pending M-Pesa transactions',
  },
};

/** The named branch rows, loudest-first — re-derived client-side from the
 * same rows the totals sum (the house one-writer sort). */
function deskRows(metric: OrgDeskMetric, stores: NonNullable<OrgDeskWire['stores']>): Array<{
  storeId: string; name: string; value: number; countText: string | null;
}> {
  return stores
    .filter((s): s is NonNullable<typeof s> => !!s && s.storeId != null)
    .map((s) => ({
      storeId: s.storeId as string,
      name: s.name ?? 'Unnamed branch',
      value: metric.slice(s),
      countText: metric.countLine ? metric.countLine(s) : null,
    }))
    .sort((a, b) => b.value - a.value);
}

function formatValue(metric: OrgDeskMetric, v: number): string {
  return metric.unit === 'money' ? formatKES(v) : String(v);
}

/** The door voice for one metric: the edge-bar/dot classes for the tile
 * (measured by the round's probe — all 36 checks pass). */
export function deskDoorVoice(metricId: OrgDeskMetricId): { edge: string; dot: string } {
  const v = HUE_VOICE[ORG_DESK_METRICS[metricId].hue];
  return { edge: v.edge, dot: v.dot };
}

// ── The one modal ───────────────────────────────────────────────────────────

const PANEL_CLS =
  'max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl custom-scrollbar dark:border-slate-700 dark:bg-slate-900';

export function BranchSliceModal({
  metric,
  wire,
  open,
  onClose,
}: {
  metric: OrgDeskMetric;
  wire: OrgDeskWire;
  open: boolean;
  onClose: () => void;
}) {
  const voice = HUE_VOICE[metric.hue];
  const total = metric.total(wire);
  const stores = wire.stores ?? [];
  const rows = stores.length > 0 ? deskRows(metric, stores) : [];
  const namedTotal = rows.reduce((s, r) => s + r.value, 0);
  const loud = rows.filter((r) => r.value > 0);
  const quiet = rows.filter((r) => r.value === 0);
  const clear = rows.length > 0 && namedTotal === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className={PANEL_CLS} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <Building2 className={`h-4 w-4 ${voice.accentLight} ${voice.accentDark}`} aria-hidden="true" />
            {metric.title} — v2.202.0
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Every branch&apos;s slice of the org&apos;s {metric.noun}, loudest first — composed from the answer the row already carries.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30" data-testid="org-desk-empty">
            The summary names no branches yet — the row&apos;s totals stay the truth.
          </p>
        ) : (
          <div className="space-y-4">
            {/* The headline — the tile's own figure stays the truth */}
            <div>
              <p className={`text-2xl font-bold tabular-nums ${voice.accentLight} ${voice.accentDark}`} data-testid={`org-desk-total-${metric.id}`}>
                {formatValue(metric, total)}
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid={`org-desk-meta-${metric.id}`}>
                across {rows.length} branch{rows.length === 1 ? '' : 'es'} · {loud.length} with a {metric.noun} slice
              </p>
            </div>

            {clear ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" data-testid={`org-desk-clear-${metric.id}`}>
                Every branch sits at zero on this answer — nothing to rank.
              </p>
            ) : (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The named branches</p>
                <ul className="mt-2 space-y-2">
                  {loud.map((r) => {
                    const share = shareOf(r.value, total);
                    return (
                      <li key={r.storeId} className="rounded-lg px-2.5 py-2 ring-1 ring-slate-200 dark:ring-slate-700" data-testid={`org-desk-row-${metric.id}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{r.name}</p>
                          <p className={`shrink-0 text-sm font-bold tabular-nums ${voice.accentLight} ${voice.accentDark}`}>{formatValue(metric, r.value)}</p>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500 dark:text-slate-400">
                          {share != null ? (
                            <span className="tabular-nums" data-testid={`org-desk-share-${metric.id}`}>{share}% of the org</span>
                          ) : null}
                          {r.countText ? <span>{r.countText}</span> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {/* The quiet branches speak their 0 — never dropped */}
                {quiet.length > 0 ? (
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400" data-testid={`org-desk-quiet-${metric.id}`}>
                    At zero: {quiet.map((r) => r.name).join(', ')}.
                  </p>
                ) : null}
              </div>
            )}

            {/* The honest window note — the slice reads the named answer */}
            <p className="border-t border-slate-100 pt-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400" data-testid="org-desk-window">
              The slice reads the {rows.length} branch{rows.length === 1 ? '' : 'es'} named on this summary; the shares read against the org total, the tile&apos;s figure stays the truth. The branches table carries each workspace&apos;s door.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
