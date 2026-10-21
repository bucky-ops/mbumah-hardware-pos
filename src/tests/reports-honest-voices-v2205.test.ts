/**
 * reports-honest-voices-v2205.test.ts — the v2.205.0 gates.
 *
 * Two arcs, both born from real live-found classes:
 *  A. THE HONESTY PASS — the reports tab used to FABRICATE figures in code
 *     (Math.random "previous periods", hardcoded +12.5% chips, a random
 *     "hourly breakdown"). These tests pin the fabrication BAN at source
 *     level and the real-wire replacement.
 *  B. THE ARIA SWEEP — every silent picture on the tab speaks a composed
 *     aria via src/lib/report-voices.ts (unit-tested here without rendering
 *     the 2,800-line tab).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  composeSeriesVoice,
  composeLoudestVoice,
  composeHourlyVoice,
  composeStockHealthVoice,
  composeProductsVoice,
  composeForecastVoice,
  composeNamedTotalsVoice,
} from '../lib/report-voices';

const TAB = join(__dirname, '../app/(shell)/tabs/reports-tab.tsx');
const VOICES = join(__dirname, '../lib/report-voices.ts');
const tabRaw = readFileSync(TAB, 'utf8');
const voices = readFileSync(VOICES, 'utf8');

/** CODE-ONLY scan (the v2.204 lesson): comments are stripped first so the
 *  fixes' own historical notes can never trip a ban they describe. */
const tab = tabRaw
  .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('v2.205.0 arc A — the honesty pass (fabrication ban)', () => {
  it('the reports tab no longer contains Math.random anywhere', () => {
    expect(tab).not.toMatch(/Math\.random/);
  });

  it('the fabricated salesComparison block is gone', () => {
    expect(tab).not.toMatch(/salesComparison/);
    expect(tab).not.toMatch(/prevRevenue/);
    expect(tab).not.toMatch(/transactionChange/);
  });

  it('the four hardcoded quick-stat change chips are gone', () => {
    expect(tab).not.toMatch(/revenueChange: 12\.5/);
    expect(tab).not.toMatch(/transactionsChange: 8\.3/);
    expect(tab).not.toMatch(/lowStockChange: -5\.0/);
    expect(tab).not.toMatch(/debtChange: 3\.2/);
  });

  it('the changeIndicator/changeColor helpers died with their callers', () => {
    expect(tab).not.toMatch(/const changeIndicator/);
    expect(tab).not.toMatch(/const changeColor/);
  });

  it('the hourly chart reads the REAL dashboard wire (hourlySalesBreakdown)', () => {
    expect(tab).toMatch(/hourlySalesBreakdown/);
    expect(tab).toMatch(/const dailyHourlyData = useMemo/);
    // The envelope-vs-data-slot lesson (live-E2E): the series rides at
    // dashboardData.data.hourlySalesBreakdown, never on the envelope.
    expect(tab).toMatch(/const wire = dashboardData\?\.data as \{ hourlySalesBreakdown\?/);
  });

  it('the quick-stat sub-lines ride real companions, never invented figures', () => {
    expect(tab).toMatch(/quickStatCompanions/);
    expect(tab).toMatch(/Led by \{quickStatCompanions\.loudestMethod\}/);
    expect(tab).toMatch(/per sale/);
  });

  it('THE WIRE-SHAPE FIX: the inventory stats read the REAL summary slot', () => {
    // GET /api/reports/inventory returns { data: products[], summary: {...} }
    // — the client read the stats off the products ARRAY (undefined fields →
    // the gauge's NaN%, a Ksh 0.00 value card, empty charts on every store).
    // The summary is now read where it actually rides.
    expect(tab).toMatch(/const inventorySummary = inventoryData\?\.summary \?\? null/);
    expect(tab).toMatch(/const inventoryProducts = Array\.isArray\(inventoryData\?\.data\)/);
    // The old wrong-name field never rides the summary (its honest name is
    // totalStockValue).
    expect(tab).not.toMatch(/totalInventoryValue/);
    // The stock-health math guards against string-typed wire fields (no NaN
    // can ever ride again).
    expect(tab).toMatch(/Number\(inventorySummary\.totalProducts \?\? 0\)/);
  });

  it('the category breakdown is computed from the same wire (no new queries)', () => {
    expect(tab).toMatch(/const categoryBreakdown = useMemo/);
    expect(tab).toMatch(/p\?\.category\?\.name \|\| 'Uncategorized'/);
    expect(tab).toMatch(/row\.totalValue \+= typeof p\?\.stockValue === 'number' \? p\.stockValue : 0/);
  });

  it('top-selling speaks real quantities (v2.206.0 superseded the empty array — the fast-moving wire landed)', () => {
    // v2.205.0 pinned the honest step-aside: `const topProducts ... = [];`.
    // v2.206.0 built the wire that comment asked for — the array now rides
    // the fast-moving aggregation, so the pin rides with it.
    expect(tab).toMatch(/const topProducts: \{ productId: string; productName: string; quantitySold: number; revenue: number \}\[\] =/);
    expect(tab).not.toMatch(/const topProducts: \{ productId: string; productName: string; quantitySold: number; revenue: number \}\[\] = \[\];/);
    expect(tab).toContain('fastMovers');
  });
});

describe('v2.205.0 arc B — the aria sweep (every picture speaks)', () => {
  it('report-voices is the one writer (the tab imports it, no inline aria composing)', () => {
    expect(tab).toMatch(/from '@\/lib\/report-voices'/);
    // No chart composes an aria string inline with a join on the tab anymore:
    // the v2.204 ConicPieChart composition is the sole allowed inline voice.
    const inlineJoins = tab.match(/aria-label=\{`[^`]*\.join/g) ?? [];
    expect(inlineJoins.length).toBe(0);
  });

  it('SVGBarChart and SVGLineChart mount role=img with a real label', () => {
    expect(tab).toMatch(/role="img"\s*\n\s*aria-label=\{ariaLabel \|\| `Bar chart/);
    expect(tab).toMatch(/role="img"\s*\n\s*aria-label=\{ariaLabel \|\| `Line chart/);
  });

  it('all six SVG call sites pass their composed voice', () => {
    expect(tab).toMatch(/SVGBarChart data=\{valuationData\} height=\{200\} ariaLabel=\{valuationVoice\}/);
    expect(tab).toMatch(/SVGLineChart data=\{valuationData\} height=\{200\} ariaLabel=\{valuationVoice\}/);
    expect(tab).toMatch(/SVGBarChart data=\{dailyHourlyData\} height=\{200\} ariaLabel=\{hourlyVoice\}/);
    expect(tab).toMatch(/SVGLineChart data=\{dailyHourlyData\} height=\{200\} ariaLabel=\{hourlyVoice\}/);
    expect(tab).toMatch(/SVGBarChart data=\{topProductsChartData\} height=\{220\} ariaLabel=\{topProductsVoice\}/);
    expect(tab).toMatch(/SVGLineChart data=\{topProductsChartData\} height=\{220\} ariaLabel=\{topProductsVoice\}/);
  });

  it('the recharts surfaces (growing/declining/forecast/customers/rentals) speak', () => {
    expect(tab).toMatch(/className="h-64" role="img" aria-label=\{growingVoice\}/);
    expect(tab).toMatch(/className="h-56" role="img" aria-label=\{decliningVoice\}/);
    expect(tab).toMatch(/className="h-72" role="img" aria-label=\{forecastVoice\}/);
    expect(tab).toMatch(/className="h-72" role="img" aria-label=\{customerChartVoice\}/);
    expect(tab).toMatch(/className="h-72" role="img" aria-label=\{rentalChartVoice\}/);
  });

  it('the stock-health gauge speaks its real counts', () => {
    expect(tab).toMatch(/role="img" aria-label=\{stockHealthVoice\}/);
  });

  it('the voices stay on the tab currency voice (formatKES/Ksh), never KES', () => {
    // The v2.201.1 one-currency-voice lesson, scoped to the composed arias:
    // no aria mount may hardcode a KES string (the tab's own voice is Ksh);
    // the recharts axis ticks' pre-existing "KES" labels are out of scope
    // (they are a visible-text context, not one of these arias).
    const ariaLines = tabRaw.split('\n').filter((l) => /ariaLabel=\{|aria-label=\{/.test(l));
    expect(ariaLines.length).toBeGreaterThanOrEqual(10);
    // \bKES\b cannot match inside formatKES (one word, no boundary at t|K).
    for (const line of ariaLines) expect(line).not.toMatch(/\bKES\b/);
    // The voices module itself never prints a KES currency voice.
    expect(voices).not.toMatch(/`[^`]*\bKES\b/);
  });
});

describe('v2.205.0 — report-voices composition (unit)', () => {
  const pts = [
    { label: 'Mon', value: 100, figure: 'Ksh 100.00' },
    { label: 'Tue', value: 300, figure: 'Ksh 300.00' },
  ];

  it('composeSeriesVoice: every point in order, honest shares, real total', () => {
    expect(composeSeriesVoice('Week', pts, 'Ksh 400.00')).toBe(
      'Week: Mon Ksh 100.00 (25.0%), Tue Ksh 300.00 (75.0%) — 2 points, Ksh 400.00 total',
    );
  });

  it('composeSeriesVoice: silent total on a zero series (a total of nothing is not a figure)', () => {
    const zeros = [{ label: 'Mon', value: 0, figure: 'Ksh 0.00' }];
    const voice = composeSeriesVoice('Week', zeros, 'Ksh 0.00');
    expect(voice).toBe('Week: Mon Ksh 0.00 (0%) — 1 point');
    expect(voice).not.toContain('total');
  });

  it('composeSeriesVoice: the empty step-aside', () => {
    expect(composeSeriesVoice('Week', [])).toBe('Week — no data in this range.');
  });

  it('composeLoudestVoice: loudest-first split with total', () => {
    expect(composeLoudestVoice('Split', pts, 'Ksh 400.00')).toBe(
      'Split, loudest first: Mon Ksh 100.00 (25.0%); Tue Ksh 300.00 (75.0%) — Ksh 400.00 total',
    );
  });

  it('composeHourlyVoice: quiet hours say no sales, never a percentage of nothing', () => {
    const hours = [
      { label: '8AM', value: 0, figure: 'Ksh 0.00' },
      { label: '9AM', value: 43000, figure: 'Ksh 43,000.00' },
    ];
    const voice = composeHourlyVoice(hours);
    expect(voice).toContain('8AM no sales');
    expect(voice).toContain('9AM Ksh 43,000.00');
    expect(voice).toContain('The loudest hour: 9AM Ksh 43,000.00');
    expect(voice).not.toMatch(/no sales \(/);
  });

  it('composeHourlyVoice: the wire-names-no-hours step-aside', () => {
    expect(composeHourlyVoice([])).toBe("Today's sales by hour — the wire names no hours yet.");
  });

  it('composeHourlyVoice: a fully quiet day has no loudest line', () => {
    const voice = composeHourlyVoice([{ label: '8AM', value: 0, figure: 'Ksh 0.00' }]);
    expect(voice).not.toContain('The loudest hour');
  });

  it('composeStockHealthVoice: the verdict from the real counts', () => {
    expect(composeStockHealthVoice({ healthy: 85, low: 10, outOfStock: 5, total: 100 })).toBe(
      'Stock health 85%, Healthy: 85 of 100 products healthy, 10 low, 5 out of stock.',
    );
    expect(composeStockHealthVoice({ healthy: 50, low: 30, outOfStock: 20, total: 100 })).toContain('Needs attention');
    expect(composeStockHealthVoice({ healthy: 10, low: 20, outOfStock: 70, total: 100 })).toContain('Critical');
  });

  it('composeStockHealthVoice: the empty-shelf step-aside', () => {
    expect(composeStockHealthVoice({ healthy: 0, low: 0, outOfStock: 0, total: 0 })).toBe(
      'Stock health — no products on the shelf yet.',
    );
  });

  it('composeProductsVoice: named rows with growth and the real companion figure', () => {
    expect(composeProductsVoice('Growing', [
      { name: 'Hammer', growthPct: 42.4, revenueFigure: 'Ksh 9,000.00' },
      { name: 'Nails', growthPct: 10 },
    ])).toBe('Growing: Hammer +42% · Ksh 9,000.00, Nails +10%.');
  });

  it('composeProductsVoice: the empty range step-aside', () => {
    expect(composeProductsVoice('Growing', [])).toBe('Growing — no products to speak in this range.');
  });

  it('composeForecastVoice: points in order, bounds named once, silent method', () => {
    const voice = composeForecastVoice('Forecast', [
      { label: 'Thu', predictedFigure: 'Ksh 5,000.00' },
      { label: 'Fri', predictedFigure: 'Ksh 6,200.00' },
    ], { hasBounds: true });
    expect(voice).toContain('Thu Ksh 5,000.00, Fri Ksh 6,200.00');
    expect(voice).toContain('upper and lower bounds');
    expect(voice).not.toContain('Method');
  });

  it('composeNamedTotalsVoice: semicolon rows with shares and total', () => {
    expect(composeNamedTotalsVoice('Rentals', [
      { label: 'ACTIVE', value: 7500, figure: 'Ksh 7,500.00' },
      { label: 'RETURNED', value: 2500, figure: 'Ksh 2,500.00' },
    ], 'Ksh 10,000.00')).toBe(
      'Rentals: ACTIVE Ksh 7,500.00 (75.0%); RETURNED Ksh 2,500.00 (25.0%) — Ksh 10,000.00 total',
    );
  });

  it('NaN values can never poison the shares (the sum ignores non-finite)', () => {
    const poisoned = [
      { label: 'Mon', value: NaN, figure: 'Ksh —' },
      { label: 'Tue', value: 100, figure: 'Ksh 100.00' },
    ];
    const voice = composeNamedTotalsVoice('T', poisoned, 'Ksh 100.00');
    expect(voice).toContain('Mon Ksh — (0%)');
    expect(voice).toContain('Tue Ksh 100.00 (100.0%)');
  });

  it('the module never fetches and never imports an API (pure composition)', () => {
    expect(voices).not.toMatch(/fetch\(/);
    expect(voices).not.toMatch(/from '@\/lib\/api'/);
    expect(voices).not.toMatch(/Math\.random/);
  });
});
