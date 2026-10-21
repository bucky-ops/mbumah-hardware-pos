#!/usr/bin/env node
// v2.206.0 verification — "the best-sellers stand up, honestly".
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
const API = read('src/lib/api.ts');
const ROUTE = read('src/app/api/reports/fast-moving/route.ts');
const TRENDS = read('src/app/api/trends/analysis/route.ts');
const HR = read('src/app/(shell)/hr/reports/page.tsx');
const VOICES = read('src/lib/report-voices.ts');

check('package.json is 2.206.0 (version + releaseVersion + baseVersion)', () => {
  assert(PKG.version === '2.206.0', `version is ${PKG.version}`);
  assert(PKG.mbumah.releaseVersion === '2.206.0', `releaseVersion is ${PKG.mbumah.releaseVersion}`);
  assert(PKG.mbumah.baseVersion === '2.206.0', `baseVersion is ${PKG.mbumah.baseVersion}`);
});

check('whats-new heads the 2.206.0 entry', () => {
  const head = WN.indexOf("version: '2.206.0'");
  assert(head >= 0, 'no 2.206.0 whats-new entry');
  assert(head < WN.indexOf("version: '2.205.0'"), '2.206.0 does not head the feed');
  assert(WN.includes('The best-sellers stand up, honestly'), 'round title missing');
});

check('changelog carries the round', () => {
  assert(CHANGELOG.includes('## [2.206.0] The best-sellers stand up, honestly'), 'no changelog entry');
});

check('the fast-moving wire: the client method + type exist', () => {
  assert(API.includes('getFastMovingReport'), 'the API method is missing');
  assert(API.includes('interface FastMovingReportData'), 'the interface is missing');
  assert(API.includes('fastMovers: {'), 'the interface does not read fastMovers');
});

check('the wire rides fastMovers — the normalizer flattening stays impossible', () => {
  assert(ROUTE.includes('fastMovers: fastMovingProducts.map'), 'the route array is not fastMovers');
  assert(!/products:\s*fastMovingProducts/.test(ROUTE), 'a products response key would be flattened client-side');
  assert(ROUTE.includes('NAMING AS CONTRACT'), 'the contract note is missing');
  assert(TAB.includes('Array.isArray(wire?.fastMovers)'), 'the tab stopped reading fastMovers');
  assert(!TAB.includes('wire?.products'), 'the tab reads a products key');
});

check('the tab fetches the wire lazily on the top-products view', () => {
  assert(TAB.includes("queryKey: ['fast-moving-report', currentStoreId, dateFrom, dateTo]"), 'queryKey missing');
  assert(TAB.includes("enabled: reportType === 'top_products'"), 'the query is not lazy');
});

check('the honest totals strip rides the wire summary', () => {
  assert(TAB.includes('Units moved'), 'units chip missing');
  assert(TAB.includes('Products sold'), 'products chip missing');
  assert(TAB.includes('Revenue in range'), 'revenue chip missing');
  assert(TAB.includes('formatKES(fastMovingSummary.totalRevenue)'), 'the summary revenue is unspoken');
});

check('the rank list speaks quantities and the voice carries them', () => {
  assert(TAB.includes('`${p.productName} (${p.quantitySold} sold)`'), 'the voice lost the quantity');
  assert(TAB.includes("text-[11px] text-muted-foreground whitespace-nowrap min-w-[64px] text-right tabular-nums"), 'the sold chip regressed');
});

check('the rank chips clear the 4.5:1 text bar (shipped classes)', () => {
  assert(TAB.includes("['bg-yellow-700 text-white', 'bg-slate-600 text-white', 'bg-orange-700 text-white']"), 'the gold/silver/bronze trio is not shipped');
  assert(!TAB.includes("'bg-yellow-500 text-white'"), 'yellow-500 ghost shipped');
  assert(!TAB.includes("'bg-gray-400 text-white'"), 'gray-400 ghost shipped');
  assert(!TAB.includes("'bg-amber-600 text-white'"), 'amber-600 ghost shipped');
});

check('the rank bar lost its ghost (the v2.204 law holds)', () => {
  assert(!TAB.includes('from-primary/60'), 'the /60 gradient is back');
});

check('the trends adapter reads the wire actual names', () => {
  assert(TAB.includes('d?.topGrowing'), 'topGrowing unmapped');
  assert(TAB.includes('d?.topDeclining'), 'topDeclining unmapped');
  assert(!/Array\.isArray\(d\?\.(growing|declining)\)/.test(TAB), 'the imagined names survive in code');
  assert(TAB.includes('mapTrendProduct'), 'the row mapper is missing');
});

check('the trends share is honest (zero-total guard, never NaN)', () => {
  assert(TAB.includes('share: total > 0 ? r.current / total : 0'), 'the zero-total guard is missing');
  assert(TAB.includes("changeKnown: typeof row?.growthPct === 'number'"), 'changeKnown missing');
  assert(TAB.includes('{!row.changeKnown ? ('), 'the new chip is not rendered');
});

check('the trend wire rows carry real stock (zero extra queries)', () => {
  assert(TRENDS.includes('quantityInStock: true,'), 'the select lost quantityInStock');
  assert(TRENDS.includes('currentStock: info?.currentStock ?? null'), 'the rows lost currentStock');
  assert(TAB.includes("typeof p?.currentStock === 'number' ? p.currentStock : null"), 'the adapter lost the stock read');
  assert(TAB.includes("'on-hand stock unknown'"), 'the unknown-stock voice is missing');
});

check('composeProductsVoice speaks the null-growth contract', () => {
  assert(VOICES.includes("'new this period'"), 'the new-this-period voice is missing');
  assert(TAB.includes('No measurable growth yet'), 'the honest empty state is missing');
});

check('the HR reports desk: derived storeName + documented downrules', () => {
  assert(HR.includes('const storeName = storeId ? storeNames[storeId] ?? null : null;'), 'storeName is not derived');
  assert(!HR.includes('setStoreName(null)'), 'the cascading reset survives');
  const downrules = (HR.match(/eslint-disable-next-line react-hooks\/set-state-in-effect/g) ?? []).length;
  assert(downrules === 10, `${downrules} downrules (expected 10)`);
});

check('the probe + guard suite exist', () => {
  const probe = read('scripts/probe-v2206.mjs');
  assert(probe.includes('GHOSTS pinned BELOW the bar in reverse'), 'the probe lost its ghost pins');
  const test = read('src/tests/best-sellers-v2206.test.ts');
  assert(test.includes('best-sellers-v2206'), 'the guard suite is misnamed');
});

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail === 0 ? 0 : 1);
