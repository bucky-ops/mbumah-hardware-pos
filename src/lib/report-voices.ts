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
  growthPct: number;
  revenueFigure?: string;
}[]): string {
  if (rows.length === 0) return `${title} — no products to speak in this range.`;
  const spoken = rows
    .map((r) => {
      const rev = r.revenueFigure ? ` · ${r.revenueFigure}` : '';
      return `${r.name} +${Math.round(r.growthPct || 0)}%${rev}`;
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
