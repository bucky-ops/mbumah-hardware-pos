'use client';

/**
 * The branch KPI row's doors (v2.200.0) — "the branch row speaks".
 *
 * The org console's KPI row finished its door arc in v2.199.0 (six voices:
 * revenue v2.173, transactions v2.195, debt v2.196, stock v2.197, rentals
 * v2.198, pending v2.199) — and the assessment that picked this round found
 * the branch workspaces' own row still had THREE quiet tiles: Today's
 * Revenue, Transactions and Avg Transaction rendered divs (no affordance)
 * even though every story they could tell already rode the dashboard wire:
 * `hourlySalesBreakdown` (the full day, hour by hour), `paymentMethodBreakdown`
 * (a full GROUP BY — the complete tender mix, not a window), and
 * `recentTransactions` (the API's named 10-row window on the day).
 *
 * The three doors compose those fields and never invent:
 *   - The day's ledger (revenue): the hourly bars with the peak chip, the
 *     tender mix with honest shares, the receipts mini-roster.
 *   - The day's receipts (transactions): the named roster newest-first with
 *     method + status voices, the hour strip, the honest window note when
 *     the count outruns the wire's 10-row window.
 *   - The basket ladder (ATV): the composition line and the size buckets
 *     over the NAMED roster — the ladder reads the window and says so.
 *
 * The house laws hold from birth: every panel paints its dark half
 * (dark:border-slate-700 dark:bg-slate-900 — the branch row's three mounts
 * of the dark-panel law); a zero day renders NO percentage (never an
 * invented "0%" of nothing) and says so; a zero bucket bar draws nothing;
 * the named rows are a window when they are (the count stays the truth);
 * and the doors are self-contained focus views — no anchors, no deep links
 * (the full sections already live on the page below the row; the door is
 * the story, not a shortcut).
 *
 * RBAC: these doors render only inside the full KPI row (the server already
 * refuses the revenue payload for limitedView roles, and the limited row is
 * a different component). They compose the SAME answer the cards show —
 * zero new queries, zero new auth surface.
 */

import React, { useMemo } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatKES } from '@/lib/api';
import { Banknote, Receipt, Scale } from 'lucide-react';

// ── The wire slice the three doors read ─────────────────────────────────────
// Structural subset of the dashboard payload (DashboardData satisfies it);
// numeric coercion happens at the boundary the same way the row reads it
// (the DECIMAL-STRING AUDIT precedent — never trust wire types for money).

export interface BranchKpiWire {
  todayRevenue?: number;
  todayTransactions?: number;
  averageTransactionValue?: number;
  hourlySalesBreakdown?: Array<{ hour: string | number; amount: number | string; transactionCount: number | string } | null>;
  paymentMethodBreakdown?: Array<{ method: string | null; amount: number | string; count: number | string } | null>;
  recentTransactions?: Array<{
    id: string;
    receiptNumber: string;
    totalAmount: number | string;
    paymentMethod: string;
    paymentStatus: string;
    createdAt: string;
    customer: { name: string } | null;
    cashier: { name: string } | null;
  } | null>;
}

/** Decimal-string safe number coercion - never trust wire types for money. */
function num(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

/** The tender label map — same voices the page's payment-methods card speaks. */
const PAYMENT_META: Record<string, { label: string; color: string }> = {
  CASH: { label: 'Cash', color: '#10b981' },
  MPESA: { label: 'M-Pesa', color: '#f59e0b' },
  DEBT: { label: 'Debt', color: '#f43f5e' },
  SPLIT: { label: 'Split', color: '#64748b' },
  GIFT_CARD: { label: 'Gift card', color: '#94a3b8' },
};

/** "CASH" → "Cash", unknown → the raw code (never blank). */
function methodLabel(method: string | null | undefined): string {
  const key = String(method ?? '').toUpperCase();
  return PAYMENT_META[key]?.label ?? (key || 'Other');
}

/** 24h hour number → "6 AM" / "2 PM" label (same voice as the page's chart). */
function formatHour(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${suffix}`;
}

/** ISO timestamp → "14:32" — a stable clock voice (no locale drift). */
function clockTime(iso: string | null | undefined): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Receipt "MBM-9D042" → "…9D042" (last-5 emphasis, per redesign spec). */
function receiptTail(receipt: string | null | undefined): string {
  const r = (receipt ?? '').trim();
  return r.length <= 5 ? r : `…${r.slice(-5)}`;
}

/** The business-hours window the page's chart speaks: 6 AM - 9 PM, 16 slots. */
const BUSINESS_HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

/** Shared modal chrome — the branch doors' panel paints its dark half. */
const PANEL_CLS = 'max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl custom-scrollbar dark:border-slate-700 dark:bg-slate-900';

/** Status chip voice: PAID speaks emerald, every other state speaks slate calm. */
function statusChipClass(status: string | null | undefined): string {
  const s = String(status ?? '').toUpperCase();
  return s === 'PAID' || s === 'COMPLETED'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'
    : 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30';
}

/** Method chip voice per door hue family (emerald ledger / teal receipts). */
function methodChipClass(hue: 'emerald' | 'teal'): string {
  return hue === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'
    : 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/30';
}

// ── Door 1: The day's ledger (the revenue tile) ─────────────────────────────

export function DayLedgerModal({ data, open, onClose }: { data: BranchKpiWire | null; open: boolean; onClose: () => void }) {
  const revenue = num(data?.todayRevenue);
  const txns = num(data?.todayTransactions);

  const hours = useMemo(() => {
    const raw = Array.isArray(data?.hourlySalesBreakdown) ? data?.hourlySalesBreakdown ?? [] : [];
    const byHour = new Map<number, number>();
    raw.forEach((h) => {
      const k = parseInt(String(h?.hour ?? ''), 10);
      if (Number.isNaN(k)) return;
      byHour.set(k, num(h?.amount));
    });
    return BUSINESS_HOURS.map((hour) => ({ hour, amount: byHour.get(hour) ?? 0 }));
  }, [data]);

  const methods = useMemo(() => {
    const raw = Array.isArray(data?.paymentMethodBreakdown) ? data?.paymentMethodBreakdown ?? [] : [];
    return raw
      .map((pm) => ({ method: String(pm?.method ?? ''), label: methodLabel(pm?.method), amount: num(pm?.amount), count: num(pm?.count) }))
      .filter((r) => r.amount > 0 || r.count > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [data]);

  const receipts = useMemo(() => {
    const raw = Array.isArray(data?.recentTransactions) ? data?.recentTransactions ?? [] : [];
    return raw
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime())
      .slice(0, 5);
  }, [data]);

  const maxHour = hours.reduce((best, h) => (h.amount > best.amount ? h : best), { hour: 6, amount: 0 });
  const methodTotal = methods.reduce((s, r) => s + r.amount, 0);
  const rosterShort = txns > 5 && receipts.length < txns;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={PANEL_CLS} data-testid="day-ledger-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <Banknote className="h-4 w-4 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
            The day&rsquo;s ledger — v2.200.0
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Where today&rsquo;s money came from, hour by hour and tender by tender — composed from the answer the row already carries.
          </DialogDescription>
        </DialogHeader>

        <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100" data-testid="day-ledger-amount">
          {formatKES(revenue)}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid="day-ledger-meta">
          net of VAT · {txns} receipt{txns === 1 ? '' : 's'} on the clock
        </p>

        {revenue === 0 && txns === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400" data-testid="day-ledger-clear">
            No sales yet today — the ledger fills as the till rings.
          </p>
        ) : (
          <>
            <section aria-label="Revenue by hour" data-testid="day-ledger-hours" className="mt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The day by hour</p>
              <div className="mt-2 flex h-24 items-end gap-1" role="img" aria-label={`Revenue by hour, 6 AM to 9 PM. Peak ${formatHour(maxHour.hour)} at ${formatKES(maxHour.amount)}.`}>
                {hours.map((h) => {
                  const width = maxHour.amount > 0 ? (h.amount / maxHour.amount) * 100 : 0;
                  return (
                    <div
                      key={h.hour}
                      data-testid={`day-ledger-hour-${h.hour}`}
                      title={`${formatHour(h.hour)} — ${formatKES(h.amount)}`}
                      className="flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5"
                    >
                      {h.amount > 0 ? (
                        <div
                          className="w-full rounded-t-sm bg-emerald-500/80 dark:bg-emerald-400/70"
                          style={{ height: `${Math.max(6, width * 0.9)}px` }}
                        />
                      ) : (
                        <div className="h-0.5 w-full rounded-full bg-slate-200 dark:bg-slate-700" />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span>6 AM</span>
                <span>1 PM</span>
                <span>9 PM</span>
              </div>
              {maxHour.amount > 0 && (
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300" data-testid="day-ledger-peak">
                  Peak hour <span className="font-semibold text-emerald-700 dark:text-emerald-300">{formatHour(maxHour.hour)}</span> — {formatKES(maxHour.amount)} taken
                </p>
              )}
            </section>

            <section aria-label="Tender mix" data-testid="day-ledger-methods" className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">How it was paid</p>
              {methods.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="day-ledger-methods-clear">No payments recorded yet today.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {methods.map((m) => (
                    <li key={m.method} data-testid={`day-ledger-method-${m.method.toLowerCase()}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{m.label}</span>
                      <span className="flex items-center gap-2 tabular-nums text-slate-500 dark:text-slate-400">
                        <span>{m.count} × </span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{formatKES(m.amount)}</span>
                        {methodTotal > 0 && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-500/10 dark:text-slate-400">
                            {Math.round((m.amount / methodTotal) * 100)}% of the day
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Latest receipts" data-testid="day-ledger-receipts" className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The latest receipts</p>
              {rosterShort && (
                <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400" data-testid="day-ledger-window">
                  The wire names a 10-receipt window on the day — the count above stays the truth.
                </p>
              )}
              {receipts.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No receipts named on this answer yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                  {receipts.map((r) => (
                    <li key={r.id} data-testid="day-ledger-receipt-row" className="flex items-center justify-between gap-2 py-1.5 text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{receiptTail(r.receiptNumber)}</span>
                        <span className="text-slate-500 dark:text-slate-400">{clockTime(r.createdAt)}</span>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${methodChipClass('emerald')}`}>
                          {methodLabel(r.paymentMethod)}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatKES(num(r.totalAmount))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Door 2: The day's receipts (the transactions tile) ──────────────────────

export function DayReceiptsModal({ data, open, onClose }: { data: BranchKpiWire | null; open: boolean; onClose: () => void }) {
  const revenue = num(data?.todayRevenue);
  const txns = num(data?.todayTransactions);
  const atv = num(data?.averageTransactionValue);

  const receipts = useMemo(() => {
    const raw = Array.isArray(data?.recentTransactions) ? data?.recentTransactions ?? [] : [];
    return raw
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
  }, [data]);

  const hourCounts = useMemo(() => {
    const raw = Array.isArray(data?.hourlySalesBreakdown) ? data?.hourlySalesBreakdown ?? [] : [];
    const byHour = new Map<number, number>();
    raw.forEach((h) => {
      const k = parseInt(String(h?.hour ?? ''), 10);
      if (Number.isNaN(k)) return;
      byHour.set(k, num(h?.transactionCount));
    });
    return BUSINESS_HOURS.map((hour) => ({ hour, count: byHour.get(hour) ?? 0 }));
  }, [data]);

  const maxCount = hourCounts.reduce((m, h) => Math.max(m, h.count), 0);
  const rosterShort = txns > receipts.length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={PANEL_CLS} data-testid="day-receipts-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <Receipt className="h-4 w-4 text-teal-700 dark:text-teal-300" aria-hidden="true" />
            The day&rsquo;s receipts — v2.200.0
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Every receipt the wire names, newest first — the till&rsquo;s day told receipt by receipt.
          </DialogDescription>
        </DialogHeader>

        <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100" data-testid="day-receipts-count">
          {txns}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid="day-receipts-meta">
          receipts · {formatKES(revenue)} taken · {formatKES(atv)} a basket
        </p>

        {txns === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400" data-testid="day-receipts-clear">
            No receipts yet today — the first sale of the day starts the story.
          </p>
        ) : (
          <>
            <section aria-label="Receipts by hour" data-testid="day-receipts-hours" className="mt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The day by receipts</p>
              <div className="mt-2 flex h-14 items-end gap-1" role="img" aria-label={`Receipts per hour, 6 AM to 9 PM. Busiest hour ${maxCount > 0 ? formatHour(hourCounts.find((h) => h.count === maxCount)?.hour ?? 6) : '-'} with ${maxCount} ${maxCount === 1 ? 'receipt' : 'receipts'}.`}>
                {hourCounts.map((h) => (
                  <div
                    key={h.hour}
                    data-testid={`day-receipts-hour-${h.hour}`}
                    title={`${formatHour(h.hour)} — ${h.count} receipt${h.count === 1 ? '' : 's'}`}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end"
                  >
                    {h.count > 0 ? (
                      <div
                        className="w-full rounded-t-sm bg-teal-500/80 dark:bg-teal-400/70"
                        style={{ height: `${Math.max(6, (h.count / maxCount) * 42)}px` }}
                      />
                    ) : (
                      <div className="h-0.5 w-full rounded-full bg-slate-200 dark:bg-slate-700" />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span>6 AM</span>
                <span>1 PM</span>
                <span>9 PM</span>
              </div>
              {maxCount > 0 && (
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300" data-testid="day-receipts-busiest">
                  Busiest hour <span className="font-semibold text-teal-700 dark:text-teal-300">{formatHour(hourCounts.find((h) => h.count === maxCount)?.hour ?? 6)}</span> — {maxCount} receipt{maxCount === 1 ? '' : 's'} taken
                </p>
              )}
            </section>

            <section aria-label="The named receipts" data-testid="day-receipts-roster" className="mt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">The named receipts</p>
                {rosterShort && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400" data-testid="day-receipts-window">
                    the wire&rsquo;s 10-receipt window — {txns - receipts.length} more on the day
                  </p>
                )}
              </div>
              <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                {receipts.map((r) => (
                  <li key={r.id} data-testid="day-receipts-row" className="py-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{receiptTail(r.receiptNumber)}</span>
                        <span className="text-slate-500 dark:text-slate-400">{clockTime(r.createdAt)}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatKES(num(r.totalAmount))}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-semibold ring-1 ${methodChipClass('teal')}`}>
                        {methodLabel(r.paymentMethod)}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-semibold ring-1 ${statusChipClass(r.paymentStatus)}`} data-testid="day-receipts-status">
                        {String(r.paymentStatus ?? '').toLowerCase() || 'unknown'}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {r.customer?.name ? r.customer.name : 'Walk-in'}
                      </span>
                      {r.cashier?.name && (
                        <span className="text-slate-500 dark:text-slate-400">· served by {r.cashier.name}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Door 3: The basket ladder (the ATV tile) ────────────────────────────────

const LADDER_BUCKETS: Array<{ key: string; label: string; lo: number; hi: number }> = [
  { key: 'sub1k', label: 'Under KES 1,000', lo: 0, hi: 1_000 },
  { key: '1to5k', label: 'KES 1,000 - 5,000', lo: 1_000.01, hi: 5_000 },
  { key: '5to20k', label: 'KES 5,000 - 20,000', lo: 5_000.01, hi: 20_000 },
  { key: 'over20k', label: 'Over KES 20,000', lo: 20_000.01, hi: Number.POSITIVE_INFINITY },
];

export function BasketLadderModal({ data, open, onClose }: { data: BranchKpiWire | null; open: boolean; onClose: () => void }) {
  const revenue = num(data?.todayRevenue);
  const txns = num(data?.todayTransactions);
  const atv = num(data?.averageTransactionValue);

  const receipts = useMemo(() => {
    const raw = Array.isArray(data?.recentTransactions) ? data?.recentTransactions ?? [] : [];
    return raw.filter((r): r is NonNullable<typeof r> => Boolean(r)).map((r) => num(r.totalAmount));
  }, [data]);

  const buckets = useMemo(
    () =>
      LADDER_BUCKETS.map((b) => {
        const count = receipts.filter((v) => v >= b.lo && v <= b.hi).length;
        return { ...b, count };
      }),
    [receipts],
  );
  const ladderMax = buckets.reduce((m, b) => Math.max(m, b.count), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={PANEL_CLS} data-testid="basket-ladder-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <Scale className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            The basket ladder — v2.200.0
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            How big a typical basket runs, and where today&rsquo;s named receipts climb the ladder.
          </DialogDescription>
        </DialogHeader>

        <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100" data-testid="basket-ladder-value">
          {formatKES(atv)}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid="basket-ladder-meta">
          the average basket · {formatKES(revenue)} across {txns} receipt{txns === 1 ? '' : 's'}
        </p>

        {txns === 0 || receipts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400" data-testid="basket-ladder-clear">
            No receipts on this answer yet — the ladder climbs with the first sale.
          </p>
        ) : (
          <>
            <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400" data-testid="basket-ladder-window">
              The ladder reads the {receipts.length} receipt{receipts.length === 1 ? '' : 's'} named on this answer — the count the row speaks stays the truth.
            </p>
            <section aria-label="Basket size ladder" data-testid="basket-ladder-rungs" className="mt-3 space-y-2.5">
              {buckets.map((b) => (
                <div key={b.key} data-testid={`basket-ladder-bucket-${b.key}`}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{b.label}</span>
                    <span className="tabular-nums text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{b.count}</span>
                      {' · '}
                      {Math.round((b.count / receipts.length) * 100)}% of the named
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    {b.count > 0 && (
                      <div
                        className="h-full rounded-full bg-amber-500/80 dark:bg-amber-400/70"
                        style={{ width: `${(b.count / ladderMax) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
