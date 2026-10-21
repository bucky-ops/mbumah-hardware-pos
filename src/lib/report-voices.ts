/**
 * report-voices.ts (v2.205.0) — the reports tab's composed arias.
 *
 * Every function here composes ONE spoken line from data the caller ALREADY
 * holds. Zero queries, zero fetches, zero fabrication: a voice that would
 * need a number the wire doesn't carry stays silent instead of inventing one
 * (the honest-figure law, now applied to the reports tab's pictures).
 *
 * Why a module: the reports tab is a 2,700-line client component; pure
 * functions here are unit-testable without rendering it, and the one-writer
 * rule lives here — no chart composes its own aria string inline.
 *
 * Currency voice: the reports tab's visible figures ride formatKES ("Ksh");
 * these arias speak the SAME voice so the tab keeps one currency sound
 * (the v2.201.1 lesson — the org console's KES voice is scoped to /console).
 */

export interface VoiceEntry {
  label: string;
  /** The raw value, for shares and loudest-picking. */
  value: number;
  /** The pre-formatted figure ("Ksh 1,234.00") in the tab's own voice. */
  figure: string;
}

/** Sum helper that ignores non-finite values (a NaN must not poison totals). */
function sum(values: number[]): number {
  return values.reduce((acc, v) => (Number.isFinite(v) ? acc + v : acc), 0);
}

/** Percent of total, honest to one decimal. A zero total or a non-finite
 *  value speaks "0%" (a NaN must never ride into an aria). */
function shareOf(value: number, total: number): string {
  if (!total || !Number.isFinite(value) || value <= 0) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * The SVGBarChart / SVGLineChart voice: every named point IN ORDER with its
 * figure and honest share of the whole. A week/hour/day is a timeline, not a
 * ranking — order stays the caller's (same law as the week door). The total
 * speaks only when it is real (non-zero); a total of nothing is not a figure.
 */
export function composeSeriesVoice(title: string, entries: VoiceEntry[], totalFigure?: string): string {
  if (entries.length === 0) return `${title} — no data in this range.`;
  const total = sum(entries.map((e) => e.value));
  const rows = entries.map((e) => `${e.label} ${e.figure} (${shareOf(e.value, total)})`);
  const noun = entries.length === 1 ? 'point' : 'points';
  const totalPart = total > 0 && totalFigure ? `, ${totalFigure} total` : '';
  return `${title}: ${rows.join(', ')} — ${entries.length} ${noun}${totalPart}`;
}

/** Loudest-first composition for pies/valuations where order is by value. */
export function composeLoudestVoice(title: string, entries: VoiceEntry[], totalFigure: string): string {
  if (entries.length === 0) return `${title} — nothing to speak yet.`;
  const total = sum(entries.map((e) => e.value));
  const rows = entries.map((e) => `${e.label} ${e.figure} (${shareOf(e.value, total)})`);
  return `${title}, loudest first: ${rows.join('; ')} — ${totalFigure} total`;
}

/**
 * The hourly chart's voice. REAL wire only: the caller passes the day's
 * recorded hours; quiet hours say "no sales" instead of a percentage of
 * nothing (the zero-day law from the week door).
 */
export function composeHourlyVoice(entries: VoiceEntry[]): string {
  if (entries.length === 0) {
    return "Today's sales by hour — the wire names no hours yet.";
  }
  const spoken = entries.map((e) =>
    e.value > 0 ? `${e.label} ${e.figure}` : `${e.label} no sales`,
  );
  const loudest = entries.reduce((best, e) => (e.value > best.value ? e : best), entries[0]);
  const loudestPart = loudest.value > 0 ? ` The loudest hour: ${loudest.label} ${loudest.figure}.` : '';
  return `Today's sales by hour, in order: ${spoken.join(', ')}.${loudestPart}`;
}

/** The stock-health gauge voice: the arc, the number, the real counts. */
export function composeStockHealthVoice(opts: {
  healthy: number;
  low: number;
  outOfStock: number;
  total: number;
}): string {
  const { healthy, low, outOfStock, total } = opts;
  if (!total) return 'Stock health — no products on the shelf yet.';
  const pct = Math.round((healthy / total) * 100);
  const verdict = pct >= 70 ? 'Healthy' : pct >= 40 ? 'Needs attention' : 'Critical';
  return `Stock health ${pct}%, ${verdict}: ${healthy} of ${total} products healthy, ${low} low, ${outOfStock} out of stock.`;
}

/**
 * The growing/declining products voice: the named rows with their real
 * growth figures. Direction comes from the title the caller speaks; the
 * revenue figure rides only when the wire carries it.
 */
export function composeProductsVoice(title: string, rows: {
  name: string;
  /** null = NEW: the product sold this period with no previous-period
   *  baseline — a growth % of nothing is never spoken (v2.206.0). */
  growthPct: number | null;
  revenueFigure?: string;
}[]): string {
  if (rows.length === 0) return `${title} — no products to speak in this range.`;
  const spoken = rows
    .map((r) => {
      const rev = r.revenueFigure ? ` · ${r.revenueFigure}` : '';
      const pct = r.growthPct == null
        ? 'new this period'
        : `+${Math.round(r.growthPct || 0)}%`;
      return `${r.name} ${pct}${rev}`;
    })
    .join(', ');
  return `${title}: ${spoken}.`;
}

/**
 * The forecast voice: predicted points in order, the bounds named ONCE, and
 * the wire's own method line passes through untouched (never re-computed
 * here — the tab already speaks it on the card).
 */
export function composeForecastVoice(title: string, points: {
  label: string;
  predictedFigure: string;
}[], opts: { hasBounds: boolean; method?: string | null } = { hasBounds: false }): string {
  if (points.length === 0) return `${title} — no forecast data available.`;
  const spoken = points.map((p) => `${p.label} ${p.predictedFigure}`).join(', ');
  const bounds = opts.hasBounds ? ' A dashed band rides the line: the upper and lower bounds.' : '';
  const method = opts.method ? ` Method: ${opts.method}.` : '';
  return `${title}, in order: ${spoken}.${bounds}${method}`;
}

/** The top-customers / rental-status chart voice. */
export function composeNamedTotalsVoice(title: string, entries: VoiceEntry[], totalFigure: string): string {
  if (entries.length === 0) return `${title} — no data in this range.`;
  const total = sum(entries.map((e) => e.value));
  const rows = entries.map((e) => `${e.label} ${e.figure} (${shareOf(e.value, total)})`);
  return `${title}: ${rows.join('; ')} — ${totalFigure} total`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * v2.207.0 — the quiet minis speak.
 *
 * The admin desk's latency sparkline, the transactions tab's daily trend,
 * the analytics sales trend and the two score rings all rode silent
 * pictures. These composers give each an honest aria from data the caller
 * ALREADY holds — same one-writer law, same pre-formatted-figure contract,
 * same zero-day law (a nothing never speaks).
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The API-latency sparkline's voice. Samples ride in CALLER ORDER (oldest
 * first — a check history is a timeline, not a ranking). The extremes are
 * named from the same samples; a single sample has no extremes to compare.
 * Figures are pre-formatted ("120ms") so the caller keeps one unit voice.
 */
export function composeLatencyVoice(
  title: string,
  samples: { label: string; value: number; figure: string }[],
): string {
  if (samples.length === 0) return `${title} — no completed checks yet.`;
  const spoken = samples.map((s) => s.figure).join(', ');
  if (samples.length === 1) return `${title}, one check so far: ${spoken}.`;
  const finite = samples.filter((s) => Number.isFinite(s.value));
  if (finite.length < 2) return `${title}, in order: ${spoken}.`;
  const slowest = finite.reduce((a, b) => (b.value > a.value ? b : a), finite[0]);
  const fastest = finite.reduce((a, b) => (b.value < a.value ? b : a), finite[0]);
  return `${title} across ${samples.length} checks, oldest first: ${spoken} — slowest ${slowest.figure}, fastest ${fastest.figure}.`;
}

/**
 * The daily-revenue trend's voice. Days ride in CALLER ORDER (oldest first —
 * calendar order, the week-door law). A day with nothing recorded says "no
 * sales" (the zero-day law); the loudest day is named only when something
 * was recorded at all.
 */
export function composeDailyRevenueVoice(title: string, entries: VoiceEntry[]): string {
  if (entries.length === 0) return `${title} — no days on record in this range.`;
  const spoken = entries
    .map((e) => (e.value > 0 ? `${e.label} ${e.figure}` : `${e.label} no sales`))
    .join(', ');
  const loudest = entries.reduce((best, e) => (e.value > best.value ? e : best), entries[0]);
  const loudestPart = loudest.value > 0 ? ` — the loudest day: ${loudest.label} ${loudest.figure}` : '';
  return `${title} across ${entries.length} ${entries.length === 1 ? 'day' : 'days'}, oldest first: ${spoken}${loudestPart}.`;
}

/**
 * The sales-trend area chart's voice: every bucket in order with its revenue
 * and its real transaction count, the period totals once, and the dashed
 * previous-period line named once. `hasPrevSeries` is the caller's honest
 * answer to "does the wire carry a previous period?" — a chart that draws
 * the dash speaks it; one that doesn't, doesn't.
 */
export function composeTrendVoice(
  title: string,
  points: { label: string; value: number; figure: string; transactions: number }[],
  opts: { totalFigure: string; totalTransactions: number; hasPrevSeries: boolean },
): string {
  if (points.length === 0) return `${title} — no data in this period.`;
  const spoken = points
    .map((p) => {
      const tx = p.transactions > 0 ? ` (${p.transactions} tx)` : ' (no transactions)';
      return `${p.label} ${p.figure}${tx}`;
    })
    .join(', ');
  const totalTx = opts.totalTransactions > 0 ? ` across ${opts.totalTransactions} transactions` : '';
  const prev = opts.hasPrevSeries ? ' The dashed line draws the previous period for comparison.' : '';
  return `${title}, in order: ${spoken} — ${opts.totalFigure} total${totalTx}.${prev}`;
}

/**
 * The score-ring voice: the ring's fill IS the score, so the aria names the
 * score, its ceiling and the verdict the caller already computed. A missing
 * score speaks the honest absence instead of a percentage of nothing.
 */
export function composeScoreVoice(title: string, score: number | null, max: number, verdict: string): string {
  if (score == null || !Number.isFinite(score)) return `${title} — not measured yet.`;
  return `${title} ${score} of ${max} — ${verdict}.`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * v2.209.0 — the dead-letter queue's composition speaks.
 *
 * The /api/health/dlq wire has carried `byOperationType`, `byTargetService`
 * and `oldestPendingAt` since Phase 8; the desk fetched them and rendered
 * nothing. This composer is the one writer for the in-flight composition's
 * aria. The counts count the work IN FLIGHT (pending + retrying) — the
 * wire's own groupBy scope — never the queue's history (completed and
 * cancelled items are the past, not composition). Zero-count and non-finite
 * entries speak nothing (the zero law); the oldest age is named only when
 * the wire carries one, pre-formatted by the caller.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function composeDlqCompositionVoice(
  byOperationType: Record<string, number> | null | undefined,
  byTargetService: Record<string, number> | null | undefined,
  oldestPendingFigure: string | null,
): string {
  const ops = Object.entries(byOperationType ?? {}).filter(
    ([, n]) => Number.isFinite(n) && n > 0,
  );
  const svcs = Object.entries(byTargetService ?? {}).filter(
    ([, n]) => Number.isFinite(n) && n > 0,
  );
  const inFlight = ops.reduce((sum, [, n]) => sum + (n as number), 0);
  if (inFlight === 0) return 'The in-flight queue is empty — nothing is waiting or retrying.';
  const opPart = ops.map(([k, n]) => `${k} ${n}`).join(', ');
  const svcPart = svcs.length > 0 ? ` By service: ${svcs.map(([k, n]) => `${k} ${n}`).join(', ')}.` : '';
  const oldPart = oldestPendingFigure ? ` The oldest item has waited ${oldestPendingFigure}.` : '';
  return `In flight: ${inFlight} ${inFlight === 1 ? 'item' : 'items'} — ${opPart}.${svcPart}${oldPart}`;
}
