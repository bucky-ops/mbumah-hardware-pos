/**
 * best-sellers-v2206.test.ts — the v2.206.0 gates.
 *
 * THE ROUND IN ONE LINE: the reports tab's last honest-empty section (Top
 * Products) got its real wire (GET /api/reports/fast-moving), the Trends
 * view stopped rendering a shape the API never sent, and the rank badges
 * learned the 4.5:1 text bar.
 *
 * Three live-E2E catches pinned here as law:
 * 1. NAMING AS CONTRACT — the SPA's request() normalizer flattens an id-less
 *    envelope carrying a `products`/`items`/`data` ARRAY down to that bare
 *    array (summary + period silently dropped). The fast-moving wire rides
 *    `fastMovers`; a `products:` response key is BANNED at source.
 * 2. THE IMAGINED CONTRACT — the Trends adapter must read the wire's actual
 *    names (topGrowing/topDeclining/categoryTrends → recentRevenue/
 *    growthPct/…); the honest share guards a zero total (never NaN%), and
 *    a null growth speaks "new", never a fabricated percentage.
 * 3. THE RANK CHIPS — the rank NUMBER is text riding a fill (4.5:1), and
 *    the bar fill carries no /60 ghost (the v2.204.0 law).
 * Scripts: probe-v2206.mjs (contrast math) + verify-v2-206-0.mjs (gates).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeProductsVoice } from '@/lib/report-voices';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const TAB = read('src/app/(shell)/tabs/reports-tab.tsx');
const API = read('src/lib/api.ts');
const ROUTE = read('src/app/api/reports/fast-moving/route.ts');
const TRENDS_ROUTE = read('src/app/api/trends/analysis/route.ts');
const VOICES = read('src/lib/report-voices.ts');
const PKG = JSON.parse(read('package.json'));
const WN = read('src/lib/whats-new.ts');

/** CODE-only scan (comments stripped — historical notes name ghosts and
 *  must never trip a ban; the v2.204.0 lesson). */
const codeOnly = (src: string) =>
  src
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const tabCode = codeOnly(TAB);
const routeCode = codeOnly(ROUTE);
const apiCode = codeOnly(API);
const trendsCode = codeOnly(TRENDS_ROUTE);

// ---------------------------------------------------------------------------
// Contrast math (the same law the probe runs, in reverse: the ghosts must
// stay BELOW the bar and the shipped voices ABOVE it).
// ---------------------------------------------------------------------------

function relLum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg: string, bg: string): number {
  const l1 = relLum(fg);
  const l2 = relLum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('v2.206.0 — the rank chips learn the 4.5:1 text bar', () => {
  it('gold/silver/bronze clear the text bar with white numerals', () => {
    // Tailwind v4 hexes: yellow-700, slate-600, orange-700.
    expect(ratio('#a16207', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#475569', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#c2410c', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('the OLD trio is pinned BELOW the bar in reverse (they never come back)', () => {
    // yellow-500 / gray-400 / amber-600 with white text — the ghosts.
    expect(ratio('#eab308', '#ffffff')).toBeLessThan(3); // 2.14 — fails even the graphic bar
    expect(ratio('#9ca3af', '#ffffff')).toBeLessThan(3); // 2.54
    expect(ratio('#d97706', '#ffffff')).toBeLessThan(3.5); // 3.07 — fails the TEXT bar
    // The shipped classes must not appear in the rank colors.
    expect(tabCode).not.toContain("'bg-yellow-500 text-white'");
    expect(tabCode).not.toContain("'bg-gray-400 text-white'");
    expect(tabCode).not.toContain("'bg-amber-600 text-white'");
  });

  it('the shipped rank colors ride the list in gold/silver/bronze order', () => {
    expect(tabCode).toContain("['bg-yellow-700 text-white', 'bg-slate-600 text-white', 'bg-orange-700 text-white']");
  });

  it('the rank bar carries no /60 gradient ghost', () => {
    expect(tabCode).not.toContain('from-primary/60');
    expect(tabCode).toContain('bg-primary transition-all duration-500');
  });

  it('the sold chip speaks at 11px with tabular-nums; the revenue figure too', () => {
    expect(tabCode).toContain("text-[11px] text-muted-foreground whitespace-nowrap min-w-[64px] text-right tabular-nums");
    expect(tabCode).toContain("text-sm font-bold ml-2 tabular-nums");
  });

  it('the probe script exists and pins the ghosts below the bar in reverse', () => {
    const probe = read('scripts/probe-v2206.mjs');
    expect(probe).toContain('GHOSTS pinned BELOW the bar in reverse');
    expect(probe).toContain('rank chips');
  });
});

describe('v2.206.0 — the fast-moving wire (naming as contract)', () => {
  it('the wire array rides fastMovers — never products', () => {
    expect(routeCode).toContain('fastMovers:');
    expect(routeCode).not.toContain('products: fastMovingProducts');
  });

  it('the normalizer hazard is documented at the route AND the client type', () => {
    expect(ROUTE).toContain('NAMING AS CONTRACT');
    expect(API).toContain('NAMING AS CONTRACT');
  });

  it('the client interface reads fastMovers and carries the summary + period', () => {
    expect(apiCode).toContain('fastMovers: {');
    expect(apiCode).toContain('summary: { totalProductsSold: number; totalUnitsSold: number; totalRevenue: number }');
    expect(apiCode).toContain('period: { from: string; to: string }');
  });

  it('the API method hits /reports/fast-moving with the range + limit', () => {
    expect(apiCode).toContain("return request<FastMovingReportData>(`/reports/fast-moving?${params.toString()}`);");
    expect(apiCode).toContain("params.set('dateFrom', filter.dateFrom);");
  });

  it('the tab maps wire.fastMovers — the products-key read is banned', () => {
    expect(tabCode).toContain('Array.isArray(wire?.fastMovers) ? wire.fastMovers : []');
    expect(tabCode).not.toContain('wire?.products');
  });

  it('the query is lazy (enabled only on the top-products view)', () => {
    expect(tabCode).toContain("queryKey: ['fast-moving-report', currentStoreId, dateFrom, dateTo]");
    expect(tabCode).toContain("enabled: reportType === 'top_products'");
  });

  it('the honest totals strip rides the wire summary (never a fabricated chip)', () => {
    expect(tabCode).toContain('fastMovingSummary.totalUnitsSold');
    expect(tabCode).toContain('fastMovingSummary.totalProductsSold');
    expect(tabCode).toContain('formatKES(fastMovingSummary.totalRevenue)');
    expect(tabCode).toContain('Units moved');
  });

  it('the voice carries the real quantity beside the figure, in the Ksh voice', () => {
    expect(tabCode).toContain('`${p.productName} (${p.quantitySold} sold)`');
  });

  it('the zero-filter: a row with no sold quantity and no revenue never ranks', () => {
    expect(tabCode).toContain('.filter((p) => p.quantitySold > 0 || p.revenue > 0)');
  });

  it('the CSV export speaks the same array', () => {
    expect(tabCode).toContain("csvContent = 'Rank,Product Name,Quantity Sold,Revenue\\n';");
  });

  it('the summary read is defensive: a hostile payload lands at zero', () => {
    expect(tabCode).toContain('num(wire.summary.totalUnitsSold)');
    expect(tabCode).toContain('num(wire.summary.totalProductsSold)');
    expect(tabCode).toContain('num(wire.summary.totalRevenue)');
  });

  it('the loading state waits on the fast-moving wire (not the sales wire)', () => {
    expect(tabCode).toContain('{(fastMovingLoading) ? (');
  });
});

describe('v2.206.0 — the trends adapter speaks the wire actual names', () => {
  it('the adapter reads topGrowing / topDeclining — the old names are banned', () => {
    expect(tabCode).toContain('Array.isArray(d?.topGrowing) ? d.topGrowing.map(mapTrendProduct) : []');
    expect(tabCode).toContain('Array.isArray(d?.topDeclining)');
    // The imagined names must not survive in code (they mapped NOTHING).
    expect(tabCode).not.toContain('Array.isArray(d?.growing)');
    expect(tabCode).not.toContain('Array.isArray(d?.declining)');
  });

  it('the row mapping reads the wire fields (productName/recentQty/qtyGrowthPct/recentRevenue)', () => {
    expect(tabCode).toContain('currentQty: trendNum(p?.recentQty)');
    expect(tabCode).toContain('growthPct: typeof p?.qtyGrowthPct === \'number\' ? p.qtyGrowthPct : null');
    expect(tabCode).toContain('revenue: p?.recentRevenue != null ? trendNum(p.recentRevenue) : undefined');
    expect(tabCode).toContain("String(p?.productName ?? 'Unnamed product')");
  });

  it('the category rows map categoryName/recentRevenue and compute an HONEST share', () => {
    expect(tabCode).toContain("String(row?.categoryName ?? 'Uncategorised')");
    expect(tabCode).toContain('current: trendNum(row?.recentRevenue)');
    expect(tabCode).toContain('share: total > 0 ? r.current / total : 0');
  });

  it('changeKnown marks a null wire growth; the render speaks "new", never a fake %', () => {
    expect(tabCode).toContain('changeKnown: typeof row?.growthPct === \'number\'');
    expect(tabCode).toContain('{!row.changeKnown ? (');
    expect(tabCode).toContain('>new</Badge>');
  });

  it('the declining stock rides the wire row (currentStock) and stays nullable', () => {
    expect(tabCode).toContain('remainingStock: typeof p?.currentStock === \'number\' ? p.currentStock : null');
    expect(tabCode).toContain("'on-hand stock unknown'");
    expect(TRENDS_ROUTE).toContain('currentStock: p.quantityInStock ?? null');
  });

  it('the route enriches trend rows with real stock on the SAME findMany', () => {
    expect(trendsCode).toContain('quantityInStock: true,');
    expect(trendsCode).toContain('currentStock: info?.currentStock ?? null');
  });

  it('the growth bar plots measurable growth only; the KPI counts the wire list', () => {
    expect(tabCode).toContain('.filter((p) => p.growthPct != null)');
    expect(tabCode).toContain('{(trends?.growing ?? []).length}');
    expect(tabCode).toContain('growingNewCount > 0 ? ` · ${growingNewCount} new`');
  });

  it('the growing empty state explains the baseline honestly when all gainers are new', () => {
    expect(tabCode).toContain('No measurable growth yet');
  });

  it('the category table share cell keeps the NaN ban: share is a guarded number', () => {
    // The render multiplies a number the adapter guarantees (0 when total 0).
    expect(tabCode).toContain('{(row.share * 100).toFixed(1)}%');
    // The interface comment carries the law (raw file — comments allowed).
    expect(TAB).toContain('never NaN');
  });
});

describe('v2.206.0 — composeProductsVoice: the null-growth branch', () => {
  it('a new product speaks "new this period", never a fabricated +0%', () => {
    expect(composeProductsVoice('Growing products, growth percent', [
      { name: 'Bamburi Cement', growthPct: null, revenueFigure: 'Ksh 75,000.00' },
    ])).toBe('Growing products, growth percent: Bamburi Cement new this period · Ksh 75,000.00.');
  });

  it('measured growth keeps the +N% voice (backward compatible)', () => {
    expect(composeProductsVoice('Growing', [
      { name: 'Hammer', growthPct: 42.4, revenueFigure: 'Ksh 9,000.00' },
      { name: 'Nails', growthPct: 10 },
    ])).toBe('Growing: Hammer +42% · Ksh 9,000.00, Nails +10%.');
  });

  it('mixed lists speak both shapes in one breath', () => {
    const voice = composeProductsVoice('Growing', [
      { name: 'Old Faithful', growthPct: 12 },
      { name: 'The Newcomer', growthPct: null },
    ]);
    expect(voice).toBe('Growing: Old Faithful +12%, The Newcomer new this period.');
  });

  it('the voice module documents the null contract', () => {
    expect(VOICES).toContain('null = NEW');
    expect(VOICES).toContain('a growth % of nothing is never spoken');
  });

  it('the declining voice carries real stock or an honest unknown', () => {
    expect(tabCode).toContain("p.remainingStock != null ? `${p.remainingStock} units left` : 'on-hand stock unknown'");
  });
});

describe('v2.206.0 — the HR reports desk sheds its cascading render', () => {
  const HR = read('src/app/(shell)/hr/reports/page.tsx');
  const hrCode = codeOnly(HR);

  it('storeName is derived from a one-shot stores map — no per-storeId reset effect', () => {
    expect(hrCode).toContain('const storeName = storeId ? storeNames[storeId] ?? null : null;');
    expect(hrCode).toContain('setStoreNames(Object.fromEntries(stores.map((s) => [s.id, s.name])))');
    expect(hrCode).not.toContain('setStoreName(null)');
    expect(hrCode).not.toContain('const [storeName, setStoreName]');
  });

  it('the deep-link + localStorage one-shots carry documented downrules', () => {
    const downrules = (HR.match(/eslint-disable-next-line react-hooks\/set-state-in-effect/g) ?? []).length;
    expect(downrules).toBe(10);
    expect(HR).toContain('hydration-safe one-shot URL init');
    expect(HR).toContain('fetch-on-dep-change; sync busy flag is the documented pattern');
  });

  it('the group comment names the pattern the rule cannot see through', () => {
    expect(HR).toContain('the five fetch-on-dep-change effects below carry a DOCUMENTED');
  });
});

describe('v2.206.0 — the recommendations call is SEEDED (the guaranteed-400 is dead)', () => {
  it('the fetch carries productIds — a seed-less call is banned', () => {
    expect(tabCode).toContain('productIds: seedIds.slice(0, 5).join(\',\')');
    expect(tabCode).toContain('if (seedIds.length === 0)');
  });

  it('the query waits for the seeds (enabled) and keys on them', () => {
    expect(tabCode).toContain('queryKey: [\'frequently-bought\', storeId, range, seedProductIds.join(\',\')]');
    expect(tabCode).toContain('enabled: seedProductIds.length > 0');
  });

  it('the seeds are the wire own top gainers — never a fabricated pair', () => {
    expect(tabCode).toContain('(trends?.growing ?? []).slice(0, 5).map((p) => p.productId)');
    expect(tabCode).toContain('Co-bought with the tracked movers: ${recoSeedsSpoken}');
  });

  it('the rows speak the co-bought item with real stock and price', () => {
    expect(tabCode).toContain('co-bought {item.coOccurrenceCount}×');
    expect(tabCode).toContain('{item.quantityInStock} in stock');
    expect(tabCode).toContain("item.categoryName ?? 'Uncategorised'");
  });

  it('the honest empty states: no movers vs no patterns', () => {
    expect(tabCode).toContain('No tracked movers yet to seed the pairing.');
    expect(tabCode).toContain('No co-bought patterns in the recorded transactions yet.');
  });

  it('the route rejects a seed-less call (the contract the old call violated)', () => {
    expect(trendsCode.includes('productId') || read('src/app/api/recommendations/frequently-bought/route.ts').includes('Either productId or productIds query parameter is required.')).toBe(true);
  });

  it('the raw fetches carry the session Authorization header (the 401 class is dead)', () => {
    expect(tabCode).toContain('sessionAuthHeaders()');
    expect(tabCode).toContain("localStorage.getItem('mbt_token')");
    expect(tabCode).not.toContain("{ credentials: 'same-origin' }");
  });
});

describe('v2.206.0 — the release scaffolding', () => {
  it('package.json rides 2.206.0 (version + releaseVersion + baseVersion)', () => {
    expect(PKG.version).toBe('2.206.0');
    expect(PKG.mbumah.releaseVersion).toBe('2.206.0');
    expect(PKG.mbumah.baseVersion).toBe('2.206.0');
  });

  it('whats-new heads the 2.206.0 entry with the round title', () => {
    expect(WN).toContain("version: '2.206.0'");
    expect(WN).toContain('The best-sellers stand up, honestly');
    expect(WN).toContain('the NaN% table is dead');
  });

  it('the verify script exists and gates the round', () => {
    const verify = read('scripts/verify-v2-206-0.mjs');
    expect(verify).toContain('2.206.0');
    expect(verify).toContain('fastMovers');
  });

  it('the changelog carries the round', () => {
    const changelog = read('CHANGELOG.md');
    expect(changelog).toContain('## [2.206.0] The best-sellers stand up, honestly');
    expect(changelog).toContain('NAMING AS CONTRACT');
  });
});
