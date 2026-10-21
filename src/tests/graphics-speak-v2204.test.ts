import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pkg from '../../package.json';

/**
 * v2.204.0 — the pictures learn to speak (the graphics-bar audit).
 *
 * The v2.203.0 round caught ONE sub-3:1 line and this round measured the
 * WHOLE app's meaning-bearing graphics against the same WCAG non-text 3:1
 * bar — and found the -500 family failing everywhere it painted a mark on
 * the white card ground (donut segments 2.15–2.54, sparkline strokes 2.54,
 * analytics accents 2.15–2.80, health gauges, the Kenya map's dots, the
 * category palettes, the security fills). Worse: two places painted TEXT
 * with the GRAPHIC color (the health score numbers, the analytics donut's
 * percentage cells) — text needs 4.5:1, so the -600 mark voice was never
 * enough there. And five chart species never spoke their data at all: the
 * org Sparkline was aria-hidden while its seven per-day values were spoken
 * NOWHERE, the Kenya map's titles only answered a hover, and the donut /
 * aging bar / week chart / reports pie carried generic names.
 *
 * The round's shape: every mark re-voices to the -600 family (measured),
 * every text voice splits out to the -700 family (measured), and every
 * picture composes an honest aria from the data it already has — zero new
 * queries, the door law applied to pictures. `scripts/probe-graphics-v2204.mjs`
 * (102/102) measures every voice at source; this suite pins the laws.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const dash = read('src/app/(shell)/tabs/dashboard-tab.tsx');
const prim = read('src/components/org/primitives.tsx');
const kpiRow = read('src/components/org/kpi-row.tsx');
const matrix = read('src/components/org/store-matrix.tsx');
const doors = read('src/components/dashboard/kpi-doors.tsx');
const branchDoors = read('src/components/dashboard/branch-doors.tsx');
const analyticsUtil = read('src/lib/analytics-utils.ts');
const donut = read('src/components/analytics/payment-donut.tsx');
const grid = read('src/components/analytics/kpi-grid.tsx');
const trendChart = read('src/components/analytics/sales-trend-chart.tsx');
const products = read('src/components/analytics/top-products-chart.tsx');
const fin = read('src/app/(shell)/tabs/financial-tab.tsx');
const rep = read('src/app/(shell)/tabs/reports-tab.tsx');
const healthWidget = read('src/app/(shell)/tabs/dashboard/StoreHealthWidget.tsx');
const sysHealth = read('src/app/(shell)/tabs/system-health-tab.tsx');
const sec = read('src/app/(shell)/tabs/security-tab.tsx');
const probe = read('scripts/probe-graphics-v2204.mjs');

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe('v2.204.0 — the pictures learn to speak: the Sparkline voice', () => {
  it('the primitive accepts spokenLabel and defaults its stroke to emerald-600', () => {
    expect(prim).toContain("stroke = '#059669'");
    expect(prim).toContain('spokenLabel?: string');
  });

  it('a labeled spark is role=img with every value spoken in day order', () => {
    expect(prim).toContain("'aria-label': spoken");
    // the composition: label + the seven values joined by the spoken separator
    expect(prim).toContain("`${spokenLabel}: ${data.map((v) => SPARK_FMT.format(v)).join(' · ')}`");
  });

  it('an unlabeled spark stays aria-hidden decoration (the old contract)', () => {
    expect(prim).toContain("{...(spoken ? { role: 'img' as const, 'aria-label': spoken } : { 'aria-hidden': true as const })}");
  });

  it('the org KPI row gives every spark a voice — face, strip and modal alike', () => {
    expect(count(kpiRow, 'spokenLabel=')).toBe(7);
    expect(kpiRow).toContain('spokenLabel="Seven-day gross revenue, KES per day"');
    expect(kpiRow).toContain('spokenLabel="Settled transactions per day, last seven days"');
    expect(kpiRow).toContain('spokenLabel="Gross revenue per day, KES"');
    expect(kpiRow).toContain('spokenLabel="Net revenue per day, KES"');
    expect(kpiRow).toContain('spokenLabel="VAT collected per day, KES"');
  });

  it('the week-by-branch strip names the branch in its spark voice', () => {
    expect(kpiRow).toContain('spokenLabel={`${b.name}, seven-day gross revenue per day, KES`}');
  });

  it('the org console keeps ONE currency voice — its sparks speak KES, never Ksh', () => {
    // The v2.201.1 lesson applied to the new voices: the org console's own
    // vocabulary is kes() ("KES X") — the branches table, the strip, the map.
    // The spark labels ride it; a Ksh literal here would mix the currency
    // voice inside one surface (found by the pre-merge E2E, not the unit pins).
    expect(kpiRow).not.toMatch(/spokenLabel=[^>]*Ksh/);
    expect(matrix).not.toMatch(/spokenLabel=[^>]*Ksh/);
  });

  it('the store matrix speaks both spark surfaces (cell + workspace dialog)', () => {
    expect(count(matrix, 'spokenLabel=')).toBe(2);
    expect(matrix).toContain('spokenLabel="Seven-day revenue per day, KES"');
  });

  it('a spark with no data still renders nothing (the empty guard predates the voice)', () => {
    expect(prim).toContain('if (!data.length) return null;');
  });
});

describe('v2.204.0 — the Kenya map speaks its ranks', () => {
  it('the map composes loudest-first with the quiet branches never dropped', () => {
    expect(prim).toContain('const ranked = [...stores].sort((a, b) => b.todayRevenue - a.todayRevenue);');
    expect(prim).toContain('loudest first');
    expect(prim).toContain('quiet: ${quiet.join(\', \')}');
  });

  it('a fully quiet org says so in words instead of ranking nothing', () => {
    expect(prim).toContain('every branch quiet so far');
  });

  it('the dots re-voice to the -600 family on the slate-100 land fill', () => {
    expect(prim).toContain("heat > 0.5 ? '#ea580c' : heat > 0 ? '#059669' : '#64748b'");
    expect(prim).not.toContain("'#FF8C00'");
    expect(prim).not.toContain("'#94a3b8'");
  });
});

describe('v2.204.0 — the payment donut speaks its split (branch dashboard)', () => {
  it('the aria composes loudest-first with shares, amounts and the total', () => {
    expect(dash).toContain('Payment methods today, loudest first:');
    expect(dash).toContain('aria-label={donutSpoken}');
    expect(dash).toContain("— ${formatKES(total)} collected`");
  });

  it('the empty card keeps the old generic voice (no split to speak)', () => {
    expect(dash).toContain(": 'Payment methods distribution';");
  });

  it('the segment colors ride the -600 family; DEBT rose-500 already cleared 3:1', () => {
    expect(dash).toContain("CASH: { label: 'Cash', color: '#059669' }");
    expect(dash).toContain("MPESA: { label: 'M-Pesa', color: '#d97706' }");
    expect(dash).toContain("DEBT: { label: 'Debt', color: '#f43f5e' }");
    expect(dash).toContain("SPLIT: { label: 'Split', color: '#64748b' }");
    expect(dash).toContain("GIFT_CARD: { label: 'Gift card', color: '#7c3aed' }");
  });

  it('no two methods share a voice (GIFT_CARD moved to violet-600, distinct from SPLIT)', () => {
    const meta = dash.match(/const PAYMENT_META[^=]*= \{[\s\S]*?\n\};/)?.[0] ?? '';
    const colors = [...meta.matchAll(/color: '(#\w{6})'/g)].map((m) => m[1]);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('the day-ledger doors stay in sync with the page card (one vocabulary)', () => {
    expect(doors).toContain("CASH: { label: 'Cash', color: '#059669' }");
    expect(doors).toContain("MPESA: { label: 'M-Pesa', color: '#d97706' }");
    expect(doors).toContain("GIFT_CARD: { label: 'Gift card', color: '#7c3aed' }");
  });
});

describe('v2.204.0 — the debt aging bar speaks its buckets (branch dashboard)', () => {
  it('the face bar composes the four buckets and the total', () => {
    expect(dash).toContain('Debt aging: ${segments.map((seg) => `${seg.label} ${formatKES(seg.value)}`).join(\' · \')} — ${formatKES(total)} outstanding`');
    expect(dash).toContain('aria-label={agingSpoken}');
  });

  it('the segments re-voice: current + 60d to the -600 family, 30d/90d stay', () => {
    expect(dash).toContain("{ key: 'current', label: 'Current', value: buckets.current, color: '#059669' }");
    expect(dash).toContain("{ key: 'd60', label: '60 days', value: buckets.d60, color: '#ea580c' }");
    expect(dash).toContain("{ key: 'd90plus', label: '90+ days', value: buckets.d90plus, color: '#ef4444' }");
  });

  it('the debt book modal rides the same re-voiced family, dots included', () => {
    expect(branchDoors).toContain("{ key: 'current', label: 'Current', color: '#059669', dot: 'bg-emerald-600' }");
    expect(branchDoors).toContain("{ key: 'd60', label: '31-60 days', color: '#ea580c', dot: 'bg-orange-600' }");
  });
});

describe('v2.204.0 — health speaks its score honestly: the graphic/text voice split', () => {
  it('healthColor is the GRAPHIC voice (3:1 bar, -600 family)', () => {
    expect(dash).toContain("if (score >= 70) return '#059669';");
    expect(dash).toContain("if (score >= 40) return '#d97706';");
    expect(dash).toContain("if (key === 'engagement' && score < 50) return '#ea580c';");
  });

  it('healthTextColor is the TEXT voice (4.5:1 bar, -700 family) and paints the breakdown numbers', () => {
    expect(dash).toContain('function healthTextColor(score: number, key?: string): string {');
    expect(dash).toContain("if (score >= 70) return '#047857';");
    expect(dash).toContain("if (score >= 40) return '#b45309';");
    expect(dash).toContain("if (key === 'engagement' && score < 50) return '#c2410c';");
    expect(dash).toContain("style={{ color: healthTextColor(score, item?.key) }}");
  });

  it('the org HealthGauge splits the same way (stroke -600, number -700)', () => {
    expect(prim).toContain("const textColor = score >= 80 ? '#047857' : score >= 60 ? '#b45309' : '#b91c1c';");
    expect(prim).toContain("style={{ color: textColor }}");
    expect(prim).toContain("const stroke = score >= 80 ? '#059669' : score >= 60 ? '#d97706' : '#ef4444';");
  });

  it('the store health widget and system-health gauges re-voice their arcs', () => {
    expect(healthWidget).toContain("stroke: '#059669'");
    expect(healthWidget).toContain("stroke: '#d97706'");
    expect(healthWidget).toContain("stroke: '#e11d48'");
    expect(sysHealth).toContain("overallScore >= 90 ? '#059669' : status.compliance.overallScore >= 70 ? '#d97706' : '#ef4444'");
  });
});

describe('v2.204.0 — the week chart + hourly heatmap speak (branch dashboard)', () => {
  it('the week chart aria carries the seven named days in calendar order + the forecast line', () => {
    expect(dash).toContain('Revenue trend, last 7 days, Ksh:');
    expect(dash).toContain("days.map((d) => `${d?.label ?? ''} ${INT_FMT.format(num(d?.revenue))}`).join(' · ')");
    expect(dash).toContain("` — forecast line at ${formatKES(forecast)}`");
  });

  it('the area gradient rides the -600 family with its line', () => {
    expect(dash).toContain('stopColor="#059669"');
    expect(dash).not.toContain('stopColor="#10b981"');
  });

  it('the heatmap aria names the peak hour and its take', () => {
    expect(dash).toContain('Hourly sales intensity from 6 AM to 9 PM');
    expect(dash).toContain("`, peak ${formatHour(peak.hour)} at ${formatKES(peak.amount)}`");
  });
});

describe('v2.204.0 — the analytics family', () => {
  it('PAYMENT_METHOD_COLORS re-voices the marks; CARD/DEBT/SPLIT already passed', () => {
    expect(analyticsUtil).toContain("CASH: '#059669'");
    expect(analyticsUtil).toContain("MPESA: '#d97706'");
    expect(analyticsUtil).toContain("GIFT_CARD: '#0891b2'");
    expect(analyticsUtil).toContain("CARD: '#3b82f6'");
    expect(analyticsUtil).toContain("DEBT: '#ef4444'");
    expect(analyticsUtil).toContain("SPLIT: '#8b5cf6'");
  });

  it('PAYMENT_METHOD_TEXT is the -700 TEXT voice for the donut legend percentages', () => {
    expect(analyticsUtil).toContain('export const PAYMENT_METHOD_TEXT: Record<string, string> = {');
    expect(analyticsUtil).toContain("CASH: '#047857'");
    expect(analyticsUtil).toContain("MPESA: '#b45309'");
    expect(analyticsUtil).toContain("GIFT_CARD: '#0e7490'");
  });

  it('the donut paints marks with the mark voice and text with the text voice', () => {
    expect(donut).toContain('style={{ backgroundColor: paymentMethodColor(row.method) }}');
    expect(donut).toContain('style={{ color: paymentMethodTextColor(r.method) }}');
    expect(donut).toContain("PAYMENT_METHOD_COLORS[r.method] || '#64748b'");
  });

  it('the KPI accents re-voice (violet and pink already cleared 3:1 and stay)', () => {
    expect(grid).toContain("accent: '#059669'");
    expect(grid).toContain("accent: '#0284c7'");
    expect(grid).toContain("accent: '#d97706'");
    expect(grid).toContain("accent: '#ea580c'");
    expect(grid).toContain("accent: '#8b5cf6'");
    expect(grid).toContain("accent: '#ec4899'");
  });

  it('the area chart re-voices line, gradient, cursor AND the prev-period dash', () => {
    expect(trendChart).toContain('stroke="#059669"');
    expect(trendChart).toContain('stopColor="#059669"');
    expect(trendChart).toContain("cursor={{ stroke: '#059669'");
    expect(trendChart).toContain('stroke="#64748b"');
    expect(trendChart).not.toContain('stroke="#94a3b8"');
  });

  it('the category palette re-voices; violet/pink/purple pass and stay', () => {
    expect(products).toContain("'#059669'");
    expect(products).toContain("'#d97706'");
    expect(products).toContain("'#0d9488'");
    expect(products).toContain("'#ea580c'");
    expect(products).toContain("'#0891b2'");
    expect(products).toContain("'#65a30d'");
    expect(products).toContain("'#a16207'");
    expect(products).not.toContain("'#10b981'");
  });
});

describe('v2.204.0 — the financial / reports / security family', () => {
  it('the financial chart configs re-voice; the aging config moves to the green/yellow -600/-700', () => {
    expect(fin).toContain("revenue: { label: 'Revenue', color: '#059669' }");
    expect(fin).toContain("expenses: { label: 'Expenses', color: '#ea580c' }");
    expect(fin).toContain("DEBT: { label: 'Debt', color: '#d97706' }");
    expect(fin).toContain("current: { label: 'Current', color: '#16a34a' }");
    expect(fin).toContain("days30: { label: '1-30 Days', color: '#a16207' }");
  });

  it('the reports trend family re-voices; the forecast bounds lose their opacity dimming', () => {
    expect(rep).toContain('const TREND_COLORS = [\'#059669\', \'#d97706\', \'#ef4444\', \'#0891b2\', \'#8b5cf6\', \'#ec4899\'];');
    expect(rep).toContain('stroke="#16a34a"');
    expect(rep).toContain('stroke="#d97706"');
    expect(rep).toContain('<Bar dataKey="growth" name="Growth %" fill="#059669"');
    expect(rep).not.toContain('strokeOpacity={0.6}');
  });

  it('the reports pie speaks its split and rides the -600 category voices', () => {
    expect(rep).toContain('Category share of inventory value, loudest first:');
    expect(rep).toContain("'#16a34a', '#ea580c', '#a855f7'");
  });

  it('the security fills re-voice and the score gauge splits arc/text voices', () => {
    expect(sec).toContain("ERROR: '#ea580c'");
    expect(sec).toContain("WARN: '#a16207'");
    expect(sec).toContain("DEBUG: '#6b7280'");
    expect(sec).toContain("const color = score >= 80 ? '#16a34a' : score >= 50 ? '#a16207' : '#ef4444';");
    expect(sec).toContain("const colorClass = score >= 80 ? 'text-green-700' : score >= 50 ? 'text-yellow-700' : 'text-red-700';");
  });
});

describe('v2.204.0 — the audit is enforced, not aspirational', () => {
  it('the probe script exists and pins the ghosts below the bar in reverse', () => {
    expect(probe).toContain('GHOSTS pinned BELOW the bar');
    expect(probe).toContain("emerald-600 as TEXT pinned BELOW");
    expect(probe).toContain('const GRAPHICS_BAR = 3.0, TEXT_BAR = 4.5;');
  });

  it('no audited source paints a mark with the -500 ghost family (comments stripped)', () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
    const ghostRe = /#10b981|#f59e0b|#f97316|#FF8C00|#0ea5e9|#06b6d4|#14b8a6|#22c55e|#eab308|#84cc16|#9ca3af/;
    for (const [name, src] of [
      ['dashboard-tab', dash], ['primitives', prim], ['kpi-row', kpiRow],
      ['store-matrix', matrix], ['kpi-doors', doors], ['branch-doors', branchDoors],
      ['analytics-utils', analyticsUtil], ['payment-donut', donut], ['kpi-grid', grid],
      ['sales-trend-chart', trendChart], ['top-products', products], ['financial', fin],
      ['reports', rep], ['store-health-widget', healthWidget], ['system-health', sysHealth],
      ['security', sec],
    ] satisfies Array<[string, string]>) {
      expect(ghostRe.test(strip(src)), `${name} still carries a -500 ghost`).toBe(false);
    }
  });
});

describe('v2.204.0 — the release surfaces', () => {
  it('the version rides to 2.204.0 in the only place a version is edited', () => {
    expect(pkg.version).toBe('2.208.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.208.0');
  });

  it('the changelog leads with the release', () => {
    const changelog = read('CHANGELOG.md');
    expect(changelog.indexOf('[2.204.0]')).toBeGreaterThanOrEqual(0);
    expect(changelog.indexOf('[2.204.0]')).toBeLessThan(changelog.indexOf('[2.203.0]'));
  });

  it("whats-new has the 2.204.0 entry at the head", () => {
    const wn = read('src/lib/whats-new.ts');
    const head = wn.indexOf("version: '2.204.0'");
    expect(head).toBeGreaterThanOrEqual(0);
    expect(head).toBeLessThan(wn.indexOf("version: '2.203.0'"));
  });
});
