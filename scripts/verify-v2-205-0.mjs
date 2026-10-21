#!/usr/bin/env node
// v2.205.0 verification — "the reports learn to speak, honestly".
// Written fresh this round (never patch a prior round's copy): every
// check reads the SOURCE OF RECORD, not memory.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

const PKG = JSON.parse(read('package.json'));
const WN = read('src/lib/whats-new.ts');
const CHANGELOG = read('CHANGELOG.md');
const TAB = read('src/app/(shell)/tabs/reports-tab.tsx');
const VOICES = read('src/lib/report-voices.ts');

/** CODE-only scan: comments stripped so historical notes never trip a ban. */
const tabCode = TAB
  .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

check('package.json is 2.205.0 (version + releaseVersion + baseVersion)', () => {
  assert(PKG.version === '2.205.0', `version is ${PKG.version}`);
  assert(PKG.mbumah.releaseVersion === '2.205.0', `releaseVersion is ${PKG.mbumah.releaseVersion}`);
  assert(PKG.mbumah.baseVersion === '2.205.0', `baseVersion is ${PKG.mbumah.baseVersion}`);
});

check("whats-new leads with the 2.205.0 entry ('The reports learn to speak, honestly')", () => {
  const head = WN.indexOf("version: '2.205.0'");
  assert(head >= 0, 'no 2.205.0 entry');
  assert(head < WN.indexOf("version: '2.204.0'"), '2.205.0 is not at the head');
  assert(WN.includes('The reports learn to speak, honestly'), 'title missing');
});

check('changelog leads with [2.205.0]', () => {
  assert(CHANGELOG.indexOf('[2.205.0]') >= 0 && CHANGELOG.indexOf('[2.205.0]') < CHANGELOG.indexOf('[2.204.0]'), 'order wrong');
});

check('THE FABRICATION BAN: no Math.random in the reports tab (code only)', () => {
  assert(!tabCode.includes('Math.random'), 'Math.random survives');
});

check('THE FABRICATION BAN: no salesComparison, no hardcoded chips, no orphaned helpers', () => {
  assert(!tabCode.includes('salesComparison'), 'salesComparison survives');
  assert(!tabCode.includes('revenueChange: 12.5'), 'the hardcoded revenue chip survives');
  assert(!tabCode.includes('const changeIndicator'), 'changeIndicator survives');
  assert(!tabCode.includes('const changeColor'), 'changeColor survives');
});

check('the hourly chart reads the REAL wire (hourlySalesBreakdown, zero new queries)', () => {
  assert(tabCode.includes('hourlySalesBreakdown'), 'the real wire is not read');
  assert(tabCode.includes('const dailyHourlyData = useMemo'), 'the memo is gone');
  assert(tabCode.includes('dashboardApi.getStats'), 'not riding the existing dashboard query');
  // The envelope-vs-data-slot lesson (live-E2E): the series rides at .data.
  assert(tabCode.includes('const wire = dashboardData?.data as'), 'the hourly read is off the envelope');
});

check('the quick-stat companions speak real figures or stay silent', () => {
  assert(tabCode.includes('quickStatCompanions'), 'no companions memo');
  assert(tabCode.includes('paymentMethodLabel(loudest.method)'), 'the loudest method is not named');
  assert(tabCode.includes('per sale'), 'the avg-ticket line is gone');
});

check('report-voices is the one writer (seven composers, pure module)', () => {
  for (const composer of ['composeSeriesVoice', 'composeLoudestVoice', 'composeHourlyVoice', 'composeStockHealthVoice', 'composeProductsVoice', 'composeForecastVoice', 'composeNamedTotalsVoice']) {
    assert(VOICES.includes(`export function ${composer}`), `missing ${composer}`);
  }
  assert(!VOICES.includes('fetch('), 'the voice module must never fetch');
  assert(VOICES.includes('Number.isFinite'), 'the NaN guard is gone');
  assert(VOICES.includes("'0%'"), 'the zero-share guard is gone');
});

check('the tab imports the voices module', () => {
  assert(TAB.includes("from '@/lib/report-voices'"), 'no import');
  assert(TAB.includes('composeHourlyVoice('), 'composers unused');
});

check('the SVG charts speak: role=img + composed labels on all six mounts', () => {
  for (const mount of [
    'SVGBarChart data={valuationData} height={200} ariaLabel={valuationVoice}',
    'SVGLineChart data={valuationData} height={200} ariaLabel={valuationVoice}',
    'SVGBarChart data={dailyHourlyData} height={200} ariaLabel={hourlyVoice}',
    'SVGLineChart data={dailyHourlyData} height={200} ariaLabel={hourlyVoice}',
    'SVGBarChart data={topProductsChartData} height={220} ariaLabel={topProductsVoice}',
    'SVGLineChart data={topProductsChartData} height={220} ariaLabel={topProductsVoice}',
  ]) assert(TAB.includes(mount), `missing: ${mount}`);
  assert(TAB.includes('role="img"'), 'no role=img');
});

check('the recharts surfaces speak: five composed wrappers + the gauge', () => {
  assert(TAB.includes('className="h-64" role="img" aria-label={growingVoice}'), 'growing silent');
  assert(TAB.includes('className="h-56" role="img" aria-label={decliningVoice}'), 'declining silent');
  assert(TAB.includes('className="h-72" role="img" aria-label={forecastVoice}'), 'forecast silent');
  assert(TAB.includes('className="h-72" role="img" aria-label={customerChartVoice}'), 'customers silent');
  assert(TAB.includes('className="h-72" role="img" aria-label={rentalChartVoice}'), 'rentals silent');
  assert(TAB.includes('role="img" aria-label={stockHealthVoice}'), 'gauge silent');
});

check('the style arc: no opacity-80 bars, tabular-nums labels, the 9px step', () => {
  assert(!TAB.includes('opacity-80 hover:opacity-100'), 'the bar dimming survives');
  assert(TAB.includes('text-[9px] tabular-nums'), 'the label step is gone');
  assert(TAB.includes('hover:brightness-110'), 'no hover affordance');
  assert(TAB.includes('stroke-muted/40'), 'no grounding baseline');
});

check('the composed arias stay on the tab currency voice (Ksh, never a KES literal)', () => {
  const ariaLines = TAB.split('\n').filter((l) => /ariaLabel=\{|aria-label=\{/.test(l));
  assert(ariaLines.length >= 11, `only ${ariaLines.length} aria mounts`);
  for (const line of ariaLines) assert(!/\bKES\b/.test(line), `KES rides an aria: ${line.trim().slice(0, 80)}`);
  assert(!/`[^`]*\bKES\b/.test(VOICES), 'the voice module prints a KES literal');
});

check('THE WIRE-SHAPE FIX: the inventory stats read the REAL summary slot', () => {
  assert(tabCode.includes('const inventorySummary = inventoryData?.summary ?? null'), 'summary not read');
  assert(tabCode.includes('const inventoryProducts = Array.isArray(inventoryData?.data)'), 'products array not read');
  assert(!tabCode.includes('totalInventoryValue'), 'the phantom field name survives');
  assert(tabCode.includes('Number(inventorySummary.totalProducts ?? 0)'), 'no NaN guard');
  assert(!tabCode.includes('inventoryReport'), 'the old array-typed handle survives');
});

check('the trends voices live in TrendsPredictionsSection (scope honesty)', () => {
  const trendsSection = TAB.slice(TAB.indexOf('function TrendsPredictionsSection'), TAB.indexOf('export default function ReportsTab'));
  assert(trendsSection.includes('const growingVoice'), 'growingVoice out of scope');
  assert(trendsSection.includes('const forecastVoice'), 'forecastVoice out of scope');
  assert(trendsSection.includes('p.declinePct'), 'declining does not read its own wire field');
});

console.log(`\nverify:v2-205-0 — ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
