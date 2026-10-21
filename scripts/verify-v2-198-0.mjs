#!/usr/bin/env node
// v2.198.0 verification — "the overdue tile opens the yard".
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
const EXPERTS = read('src/components/org/experts.tsx');
const PRIMITIVES = read('src/components/org/primitives.tsx');
const ROUTE = read('src/app/api/org/kpi-summary/route.ts');
const A11Y = read('docs/a11y/contrast-math.md');
const WORKSPACE = read('docs/multi-store-workspaces.md');
const CHANGELOG = read('CHANGELOG.md');
const TEST = read('src/tests/rental-yard-v2198.test.ts');
const CONTRAST = read('scripts/contrast-math-rental-yard-v2198.mjs');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.198.0', () => {
  assert(atLeast(PKG.version, '2.198.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.198.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.198.0'), 'baseVersion');
});

check('whats-new leads with 2.198.0 and tells the yard story', () => {
  const i98 = WN.indexOf("version: '2.198.0'");
  const i97 = WN.indexOf("version: '2.197.0'");
  assert(i98 >= 0, 'no 2.198.0 entry');
  assert(i97 > i98, '2.198.0 does not lead the feed');
  assert(WN.includes('The overdue tile opens the yard'), 'headline');
  assert(WN.includes('deepest breach first'), 'roster bullet');
});

// ── 2. The wire: zero new queries ───────────────────────────────────────────
check('the wire is unchanged - the yard rides rentals.items (the Expert payload)', () => {
  assert(PRIMITIVES.includes('rentals: {'), 'type contract');
  assert(PRIMITIVES.includes('ratePerDay: number; deposit: number; status: string;'), 'row shape');
  assert(ROUTE.includes("where: { status: { in: ['ACTIVE', 'OVERDUE'] } }"), 'route query');
  assert(ROUTE.includes('orderBy: { expectedReturnDate: \'asc\' }'), 'route order');
});

check('the component composes, it never invents - no fetch, no new query in kpi-row', () => {
  assert(!KPI.includes('fetch('), 'kpi-row must not fetch');
  assert(KPI.includes('const yardReady = Array.isArray(data.rentals?.items);'), 'ready gate');
  assert(KPI.includes('.filter((r) => r.status === \'OVERDUE\')'), 'overdue filter');
  assert(KPI.includes('.sort((a, b) => b.days - a.days || b.ratePerDay - a.ratePerDay)'), 'loudest breach first');
  assert(KPI.includes('Math.max(0, Math.floor((todayStart - startOfLocalDay(iso)) / DAY_MS))'), 'days past floored at 0');
});

// ── 3. The card: the row's fifth voice ──────────────────────────────────────
check('the overdue card is the row\u2019s fifth button with the family face', () => {
  assert(KPI.includes('onClick={() => setYardOpen(true)}'), 'opens the drill-down');
  assert(KPI.includes('data-testid="overdue-card"'), 'testid');
  assert(KPI.includes('<span className="absolute inset-y-0 left-0 w-1 bg-rose-600" />'), 'rose edge');
  assert(KPI.includes('>roster</span>'), 'qualifier chip');
  assert((KPI.match(/data-testid="(transactions|debt|lowstock|overdue)-card"/g) || []).length === 4, 'exactly four voice cards now');
});

check('the card learns its shape - the breach-age mini bar with honest segments only', () => {
  assert(KPI.includes('{yardSev && k.overdueRentals.count > 0 && ('), 'gated on named rows + live count');
  assert(KPI.includes('b.value > 0 && yardSev.rows.length > 0 ? ('), 'zero bucket draws nothing');
  assert(KPI.includes('aria-label={`Breach ages: ${yardSev.counts.map((b) => `${b.label} ${b.value}`).join(\', \')}`}'), 'bar self-speaks');
});

// ── 4. The drill-down anatomy ───────────────────────────────────────────────
check('the modal mirrors the family anatomy, wearing the rose face', () => {
  assert(KPI.includes('<Dialog open={yardOpen} onOpenChange={setYardOpen}>'), 'dialog');
  assert(KPI.includes('<Clock3 className="h-4 w-4 text-rose-600" /> The rental yard</DialogTitle>'), 'title');
  assert(KPI.includes('data-testid="rental-yard-count"'), 'headline count');
  assert(KPI.includes('data-testid="rental-days-bar"'), 'breach-age bar');
  assert(KPI.includes('data-testid={`rental-bucket-${b.key}`}'), 'bucket cells');
  assert(KPI.includes('data-testid="rental-exposure-strip"'), 'exposure strip');
  assert(KPI.includes('data-testid="rental-overdue-row"'), 'overdue rows');
  assert(KPI.includes('data-testid="rental-active-row"'), 'active rows');
  assert(KPI.includes('data-testid="rental-branch-row"'), 'branch rows');
});

check('the honesty rules hold in source - no invented percentages, no negative due voices', () => {
  assert(KPI.includes('overdueRows != null && overdueRows.length > 0 ? Math.round((v / overdueRows.length) * 1000) / 10 : null'), 'zero-total share rule');
  assert(KPI.includes('exposurePerDay > 0 && ('), 'clean yard renders no strip');
  assert(KPI.includes('{yardSev && ('), 'no bar/grid on a clean yard');
  assert(KPI.includes('d > 0 ? `${d}d past` : \'past return\''), 'zero-day breach speaks honestly');
  assert(KPI.includes('d > 0 ? `due in ${d}d` : d === 0 ? \'due today\' : \'past return\''), 'no negative "due in -1d"');
  assert(KPI.includes('Math.ceil((startOfLocalDay(iso) - todayStart) / DAY_MS)'), 'days until signed math');
});

check('the tolerances speak - clear, stale, and the meta\u2019s named-population disclosure', () => {
  assert(KPI.includes('data-testid="rental-yard-clear"'), 'clear state');
  assert(KPI.includes('Nothing is past return — the yard is clean.'), 'the clear line');
  assert(KPI.includes('data-testid="rental-yard-stale"'), 'stale step-aside');
  assert(KPI.includes('roster not on this cached answer'), 'stale meta voice');
  assert(KPI.includes('named on this answer'), 'named-population meta');
});

// ── 5. The a11y surface + the discovery fix ─────────────────────────────────
check('the contrast script derives over the REAL chain and pins the discovery in reverse', () => {
  assert(CONTRAST.includes('v2.198.0 contrast math — the rental yard'), 'header');
  assert(CONTRAST.includes('checkBug'), 'reverse pins exist');
  assert(CONTRAST.includes('pre-fix Expert OVERDUE badge red-600 on red-50'), 'the 4.36:1 find pinned');
  assert(CONTRAST.includes("split('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900').length - 1) !== 5"), 'the five-panel dark-half law guarded');
});

check('THE FIX: the Expert OVERDUE badge re-voices red-600 to red-700 (the 4.36:1 find)', () => {
  assert(EXPERTS.includes("r.status === 'OVERDUE' ? 'border-red-200 bg-red-50 text-red-700'"), 'badge red-700');
  assert(!EXPERTS.includes('bg-red-50 text-red-600'), 'the 4.36:1 combination is gone');
});

check('the a11y doc and the workspace doc close the surface', () => {
  assert(A11Y.includes("the rental yard + the Expert OVERDUE badge's re-voice (v2.198.0)"), 'a11y section');
  assert(A11Y.includes('49/49'), 'the families count');
  assert(WORKSPACE.includes('v2.198.0 gives the rentals face the same voice'), 'workspace sentence');
});

// ── 6. The gates and the suite ──────────────────────────────────────────────
check('the release face is complete - changelog, feed, test suite, verify wiring', () => {
  assert(CHANGELOG.includes('## [2.198.0] The overdue tile opens the yard'), 'changelog heads');
  assert(CHANGELOG.indexOf('## [2.198.0]') < CHANGELOG.indexOf('## [2.197.0]'), 'changelog order');
  assert(TEST.includes('the overdue tile opens the yard (the KPI row'), 'suite header');
  assert(TEST.includes("toEqual(['vibrator', 'scaffolding-thika', 'scaffolding-juja', 'mixer'])"), 'the sort pinned on the seed');
  assert(PKG.scripts['verify:v2-198-0'] === 'node scripts/verify-v2-198-0.mjs', 'verify wired');
  assert(PKG.scripts['verify:v2-197-0'] === 'node scripts/verify-v2-197-0.mjs', 'prior verify stays');
});

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail > 0 ? 1 : 0);
