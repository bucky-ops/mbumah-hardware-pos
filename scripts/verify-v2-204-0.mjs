#!/usr/bin/env node
// v2.204.0 verification — "the pictures learn to speak".
// Written fresh this round (never patch a prior round's copy): every
// check reads the SOURCE OF RECORD, not memory.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
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
const PRIM = read('src/components/org/primitives.tsx');
const TAB = read('src/app/(shell)/tabs/dashboard-tab.tsx');
const UTIL = read('src/lib/analytics-utils.ts');
const DOORS = read('src/components/dashboard/kpi-doors.tsx');
const BRANCH_DOORS = read('src/components/dashboard/branch-doors.tsx');
const CHANGELOG = read('CHANGELOG.md');

check('package.json is 2.204.0 (version + releaseVersion + baseVersion)', () => {
  assert(PKG.version === '2.204.0', `version is ${PKG.version}`);
  assert(PKG.mbumah.releaseVersion === '2.204.0', `releaseVersion is ${PKG.mbumah.releaseVersion}`);
  assert(PKG.mbumah.baseVersion === '2.204.0', `baseVersion is ${PKG.mbumah.baseVersion}`);
});

check("whats-new leads with the 2.204.0 entry ('The pictures learn to speak')", () => {
  const head = WN.indexOf("version: '2.204.0'");
  assert(head >= 0, 'no 2.204.0 entry');
  assert(head < WN.indexOf("version: '2.203.0'"), '2.204.0 is not at the head');
  assert(WN.includes('The pictures learn to speak'), 'title missing');
});

check('changelog leads with [2.204.0]', () => {
  assert(CHANGELOG.indexOf('[2.204.0]') >= 0 && CHANGELOG.indexOf('[2.204.0]') < CHANGELOG.indexOf('[2.203.0]'), 'order wrong');
});

check('the Sparkline speaks: spokenLabel prop + role=img + the day-order composition', () => {
  assert(PRIM.includes('spokenLabel?: string'), 'no spokenLabel prop');
  assert(PRIM.includes("'aria-label': spoken"), 'no composed aria');
  assert(PRIM.includes("{...(spoken ? { role: 'img' as const, 'aria-label': spoken } : { 'aria-hidden': true as const })}"), 'no conditional voice contract');
  assert(PRIM.includes(".join(' · ')"), 'values not spoken in day order');
});

check('the unlabeled spark keeps the old aria-hidden contract', () => {
  assert(PRIM.includes("{ 'aria-hidden': true as const }"), 'unlabeled spark no longer silent');
});

check('nine spark call sites gained voices (7 kpi-row + 2 store-matrix)', () => {
  const kpiRow = read('src/components/org/kpi-row.tsx');
  const matrix = read('src/components/org/store-matrix.tsx');
  assert((kpiRow.split('spokenLabel=').length - 1) === 7, 'kpi-row voices wrong');
  assert((matrix.split('spokenLabel=').length - 1) === 2, 'matrix voices wrong');
});

check('the Kenya map speaks its ranks and re-voices its dots', () => {
  assert(PRIM.includes("Store heatmap of today's revenue, loudest first:"), 'no composed map aria');
  assert(PRIM.includes('every branch quiet so far'), 'no quiet-org voice');
  assert(PRIM.includes("heat > 0.5 ? '#ea580c' : heat > 0 ? '#059669' : '#64748b'"), 'dots not re-voiced');
  assert(!PRIM.includes("'#FF8C00'"), 'darkorange ghost still present');
});

check('the payment donut speaks its split; no two methods share a color', () => {
  assert(TAB.includes('Payment methods today, loudest first:'), 'no composed split');
  assert(TAB.includes('aria-label={donutSpoken}'), 'aria not wired');
  const meta = TAB.match(/const PAYMENT_META[^=]*= \{[\s\S]*?\n\};/)?.[0] ?? '';
  const colors = [...meta.matchAll(/color: '(#\w{6})'/g)].map((m) => m[1]);
  assert(new Set(colors).size === colors.length, 'duplicate method colors');
  assert(!meta.includes('#10b981') && !meta.includes('#f59e0b') && !meta.includes('#94a3b8'), 'ghost -500/-400 in PAYMENT_META');
});

check('the debt aging bar speaks its buckets; segments ride the -600 family', () => {
  assert(TAB.includes('aria-label={agingSpoken}'), 'bar aria not wired');
  assert(TAB.includes("Debt aging: ${segments.map((seg) => `${seg.label} ${formatKES(seg.value)}`).join(' · ')} — ${formatKES(total)} outstanding`"), 'composition wrong');
  assert(TAB.includes("{ key: 'current', label: 'Current', value: buckets.current, color: '#059669' }"), 'current not -600');
  assert(BRANCH_DOORS.includes("color: '#ea580c', dot: 'bg-orange-600'"), 'debt book dots not synced');
  assert(DOORS.includes("CASH: { label: 'Cash', color: '#059669' }"), 'tender map not synced');
});

check('the week chart + heatmap arias compose from the wire', () => {
  assert(TAB.includes('Revenue trend, last 7 days, Ksh:'), 'week aria missing');
  assert(TAB.includes('`, peak ${formatHour(peak.hour)} at ${formatKES(peak.amount)}`'), 'heatmap peak missing');
  assert(!TAB.includes('stopColor="#10b981"'), 'gradient still emerald-500');
});

check('health split its graphic and text voices (both files, all three species)', () => {
  assert(TAB.includes('function healthTextColor(score: number, key?: string): string {'), 'no text voice fn');
  assert(TAB.includes("style={{ color: healthTextColor(score, item?.key) }}"), 'breakdown numbers not using the text voice');
  assert(PRIM.includes("const textColor = score >= 80 ? '#047857' : score >= 60 ? '#b45309' : '#b91c1c';"), 'gauge text voice missing');
  const healthWidget = read('src/app/(shell)/tabs/dashboard/StoreHealthWidget.tsx');
  assert(healthWidget.includes("stroke: '#059669'") && healthWidget.includes("stroke: '#e11d48'"), 'widget arcs not re-voiced');
  const sec = read('src/app/(shell)/tabs/security-tab.tsx');
  assert(sec.includes("const colorClass = score >= 80 ? 'text-green-700' : score >= 50 ? 'text-yellow-700' : 'text-red-700';"), 'security text voice missing');
});

check('the analytics donut separates mark text voices (PAYMENT_METHOD_TEXT)', () => {
  assert(UTIL.includes('export const PAYMENT_METHOD_TEXT: Record<string, string> = {'), 'no text map');
  assert(UTIL.includes('export function paymentMethodTextColor'), 'no text fn');
  const donut = read('src/components/analytics/payment-donut.tsx');
  assert(donut.includes('paymentMethodTextColor(r.method)'), '% cells not using text voice');
  assert(donut.includes('paymentMethodColor(row.method)'), 'mark voice regressed');
});

check('the probe script exists, pins ghosts in reverse, and PASSES right now', () => {
  const probe = read('scripts/probe-graphics-v2204.mjs');
  assert(probe.includes('GHOSTS pinned BELOW the bar'), 'no reverse pins');
  assert(probe.includes('const GRAPHICS_BAR = 3.0, TEXT_BAR = 4.5;'), 'bars missing');
  const out = execSync('node scripts/probe-graphics-v2204.mjs', { encoding: 'utf8' });
  assert(/102 passed, 0 failed/.test(out), 'probe not green');
});

check('no audited file paints a mark with the -500 ghost family (code only)', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
  const ghostRe = /#10b981|#f59e0b|#f97316|#FF8C00|#0ea5e9|#06b6d4|#14b8a6|#22c55e|#eab308|#84cc16|#9ca3af/;
  const files = [
    'src/app/(shell)/tabs/dashboard-tab.tsx',
    'src/components/org/primitives.tsx',
    'src/components/org/kpi-row.tsx',
    'src/components/org/store-matrix.tsx',
    'src/components/dashboard/kpi-doors.tsx',
    'src/components/dashboard/branch-doors.tsx',
    'src/lib/analytics-utils.ts',
    'src/components/analytics/payment-donut.tsx',
    'src/components/analytics/kpi-grid.tsx',
    'src/components/analytics/sales-trend-chart.tsx',
    'src/components/analytics/top-products-chart.tsx',
    'src/app/(shell)/tabs/financial-tab.tsx',
    'src/app/(shell)/tabs/reports-tab.tsx',
    'src/app/(shell)/tabs/dashboard/StoreHealthWidget.tsx',
    'src/app/(shell)/tabs/system-health-tab.tsx',
    'src/app/(shell)/tabs/security-tab.tsx',
  ];
  for (const f of files) {
    assert(!ghostRe.test(strip(read(f))), `${f} still carries a ghost`);
  }
});

check('the round suite exists and the gates are wired', () => {
  const t = read('src/tests/graphics-speak-v2204.test.ts');
  assert(t.includes('graphics-speak-v2204') || t.includes('the pictures learn to speak'), 'wrong suite');
  assert(PKG.scripts['verify:v2-204-0'] === 'node scripts/verify-v2-204-0.mjs', 'verify not wired');
  const wr = read('package.json').includes('"test"');
  assert(wr, 'no test script');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
