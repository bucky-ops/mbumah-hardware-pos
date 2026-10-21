#!/usr/bin/env node
// v2.197.0 verification — "the stock tile opens the watchlist".
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
const KPI = read('src/components/org/kpi-row.tsx');
const PRIMITIVES = read('src/components/org/primitives.tsx');
const ROUTE = read('src/app/api/org/kpi-summary/route.ts');
const A11Y = read('docs/a11y/contrast-math.md');
const WORKSPACE = read('docs/multi-store-workspaces.md');
const CHANGELOG = read('CHANGELOG.md');
const TEST = read('src/tests/stock-watchlist-v2197.test.ts');
const CONTRAST = read('scripts/contrast-math-stock-watchlist-v2197.mjs');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.197.0', () => {
  assert(atLeast(PKG.version, '2.197.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.197.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.197.0'), 'baseVersion');
});

check('whats-new leads with 2.197.0 and tells the watchlist story', () => {
  const i97 = WN.indexOf("version: '2.197.0'");
  const i96 = WN.indexOf("version: '2.196.0'");
  assert(i97 >= 0, 'no 2.197.0 entry');
  assert(i96 > i97, '2.197.0 does not lead the feed');
  assert(WN.includes('The stock tile opens the watchlist'), 'headline');
  assert(WN.includes('deepest shortage first'), 'watchlist bullet');
});

// ── 2. The wire: zero new queries ───────────────────────────────────────────
check('the wire is unchanged - the watchlist rides inventory.lowStockItems (the Expert payload)', () => {
  assert(PRIMITIVES.includes('lowStockItems: Array<{ id: string; sku: string; name: string; category: string; store: string | null; stockQty: number; reorderLevel: number }>'), 'type contract');
  assert(ROUTE.includes('lowStockItems = lowItems'), 'route mapping');
  assert(ROUTE.includes('.slice(0, 12)'), 'the route cap');
  assert(ROUTE.includes('where: { isActive: true }'), 'active products only');
});

check('the component composes, it never invents - no fetch, no new query in kpi-row', () => {
  assert(!KPI.includes('fetch('), 'kpi-row must not fetch');
  assert(KPI.includes('const watchlistReady = Array.isArray(data.inventory?.lowStockItems);'), 'ready gate');
  assert(KPI.includes('.map((p) => ({ ...p, deficit: Math.max(0, p.reorderLevel - p.stockQty) }))'), 'deficit re-derivation');
});

// ── 3. The card: the row's fourth voice ─────────────────────────────────────
check('the low-stock card is the row\u2019s fourth button with the family face', () => {
  assert(KPI.includes('onClick={() => setStockOpen(true)}'), 'opens the drill-down');
  assert(KPI.includes('data-testid="lowstock-card"'), 'testid');
  assert(KPI.includes('<span className="absolute inset-y-0 left-0 w-1 bg-amber-600" />'), 'amber edge');
  assert(KPI.includes('>watchlist</span>'), 'qualifier chip');
  assert((KPI.match(/data-testid="(transactions|debt|lowstock)-card"/g) || []).length === 3, 'exactly three voice cards now');
});

check('THE FIX: the card face is re-hued orange-500 to amber-600 (the 2.89:1 find)', () => {
  assert(!KPI.includes('<PackageOpen className="h-3.5 w-3.5 text-orange-500" />'), 'icon still orange-500');
  assert(KPI.includes('<PackageOpen className="h-3.5 w-3.5 text-amber-600" />'), 'icon amber-600');
  assert(KPI.includes("k.lowStock.count > 0 ? 'text-amber-600' : 'text-slate-700'"), 'hot number amber-600');
  assert(KPI.includes("'ring-1 ring-amber-300'"), 'hot ring follows the face');
});

check('the card learns its shape - the severity mini bar with honest segments only', () => {
  assert(KPI.includes('{severity && k.lowStock.count > 0 && ('), 'gated on named rows + live count');
  assert(KPI.includes('b.value > 0 && severity.rows.length > 0 ? ('), 'zero bucket draws nothing');
  assert(KPI.includes('aria-label={`Severity: ${severity.counts.map((b) => `${b.label.toLowerCase()} ${b.value}`).join(\', \')}`}'), 'bar self-speaks');
});

// ── 4. The drill-down anatomy ───────────────────────────────────────────────
check('the modal mirrors the family anatomy, wearing the amber face', () => {
  assert(KPI.includes('<Dialog open={stockOpen} onOpenChange={setStockOpen}>'), 'dialog');
  assert(KPI.includes('<PackageOpen className="h-4 w-4 text-amber-600" /> Reorder watchlist</DialogTitle>'), 'title');
  assert(KPI.includes('data-testid="lowstock-watchlist-count"'), 'headline count');
  assert(KPI.includes('data-testid="lowstock-severity-bar"'), 'severity bar');
  assert(KPI.includes('data-testid={`lowstock-bucket-${b.key}`}'), 'bucket cells');
  assert(KPI.includes('data-testid="lowstock-short-strip"'), 'units-short strip');
  assert(KPI.includes('data-testid="lowstock-item-row"'), 'named rows');
  assert(KPI.includes('data-testid="lowstock-branch-row"'), 'branch rows');
});

check('the honesty rules hold in source - no invented percentages, no bar of zeros', () => {
  assert(KPI.includes('stockRows != null && stockRows.length > 0 ? Math.round((v / stockRows.length) * 1000) / 10 : null'), 'zero-total share rule');
  assert(KPI.includes('p.reorderLevel > 0 ? p.stockQty / p.reorderLevel : null'), 'zero-level coverage rule');
  assert(KPI.includes('shortSum > 0 && ('), 'all-at-level renders no strip');
  assert(KPI.includes('{severity && ('), 'no bar/grid on an empty watchlist');
  assert(KPI.includes('Math.max(0, p.reorderLevel - p.stockQty)'), 'deficit floored at zero');
});

check('the tolerances speak - empty, stale, and the meta\u2019s named-population disclosure', () => {
  assert(KPI.includes('data-testid="lowstock-watchlist-empty"'), 'empty state');
  assert(KPI.includes('Everything is above its reorder level.'), 'the Expert panel\u2019s line');
  assert(KPI.includes('data-testid="lowstock-watchlist-stale"'), 'stale step-aside');
  assert(KPI.includes('named watchlist not on this cached answer'), 'stale meta voice');
  assert(KPI.includes('named on this answer'), 'named-population meta');
});

// ── 5. The a11y surface ─────────────────────────────────────────────────────
check('the contrast script derives over the REAL chain and pins the discovery in reverse', () => {
  assert(CONTRAST.includes('v2.197.0 contrast math — the reorder watchlist'), 'header');
  assert(CONTRAST.includes('checkBug'), 'reverse pins exist');
  assert(CONTRAST.includes('pre-fix hot number orange-500 on white'), 'the 2.89:1 find pinned');
  assert(CONTRAST.includes("split('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900').length - 1) !== 4"), 'the four-panel dark-half law guarded');
});

check('the a11y doc and the workspace doc close the surface', () => {
  assert(A11Y.includes("the reorder watchlist + the card face's re-hue (v2.197.0)"), 'a11y section');
  assert(A11Y.includes('49/49'), 'the families count');
  assert(WORKSPACE.includes('v2.197.0 gives the stock face the same voice'), 'workspace sentence');
});

// ── 6. The gates and the suite ──────────────────────────────────────────────
check('the release face is complete - changelog, feed, test suite, verify wiring', () => {
  assert(CHANGELOG.includes('## [2.197.0] The stock tile opens the watchlist'), 'changelog heads');
  assert(CHANGELOG.indexOf('## [2.197.0]') < CHANGELOG.indexOf('## [2.196.0]'), 'changelog order');
  assert(TEST.includes("the stock tile opens the watchlist (the KPI row's FOURTH"), 'suite header');
  assert(TEST.includes("the door arc's fourth door"), 'the arc pin');
  assert(TEST.includes("toEqual(['nails', 'cable', 'chainlink', 'dulux', 'cement'])"), 'the sort pinned on the seed');
  assert(PKG.scripts['verify:v2-197-0'] === 'node scripts/verify-v2-197-0.mjs', 'verify wired');
  assert(PKG.scripts['verify:v2-196-0'] === 'node scripts/verify-v2-196-0.mjs', 'prior verify stays');
});

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail > 0 ? 1 : 0);
