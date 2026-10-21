#!/usr/bin/env node
// v2.200.0 verification — "the branch row speaks".
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
const DOORS = read('src/components/dashboard/kpi-doors.tsx');
const TAB = read('src/app/(shell)/tabs/dashboard-tab.tsx');
const ROUTE = read('src/app/api/dashboard/route.ts');
const A11Y = read('docs/a11y/contrast-math.md');
const WORKSPACE = read('docs/multi-store-workspaces.md');
const CHANGELOG = read('CHANGELOG.md');
const TEST = read('src/tests/branch-kpi-doors-v2200.test.ts');
const CONTRAST = read('scripts/contrast-math-branch-doors-v2200.mjs');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.200.0', () => {
  assert(atLeast(PKG.version, '2.200.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.200.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.200.0'), 'baseVersion');
});

check('whats-new leads with 2.200.0 and tells the branch story', () => {
  const i200 = WN.indexOf("version: '2.200.0'");
  const i199 = WN.indexOf("version: '2.199.0'");
  assert(i200 >= 0, 'no 2.200.0 entry');
  assert(i199 > i200, '2.200.0 does not lead the feed');
  assert(WN.includes('The branch row speaks'), 'headline');
  assert(WN.includes('basket ladder'), 'ladder bullet');
});

// ── 2. The wire: zero new queries ───────────────────────────────────────────
check('the doors ride the dashboard wire the row already carries', () => {
  assert(ROUTE.includes('paymentMethodBreakdown'), 'tender mix (full GROUP BY)');
  assert(ROUTE.includes('hourlySalesBreakdown'), 'the day by hour');
  assert(ROUTE.includes('recentTransactions'), 'the named roster');
  assert(ROUTE.includes('take: 10'), 'the roster window (10)');
});

check('the doors compose, they never invent - no fetch, no db, no prisma', () => {
  assert(!DOORS.includes('fetch('), 'kpi-doors must not fetch');
  assert(!DOORS.includes("from '@/lib/db'"), 'no db import');
  assert(!DOORS.includes('prisma'), 'no prisma');
  assert(DOORS.includes('export interface BranchKpiWire'), 'the structural subset type');
});

// ── 3. The row wiring: three buttons in the family vocabulary ──────────────
check('the door state is declared before the early return (rules-of-hooks)', () => {
  const row = TAB.slice(TAB.indexOf('function KpiRow('), TAB.indexOf('// 4b. LIMITED DASHBOARD'));
  const stateIdx = row.indexOf('const [door, setDoor] = useState');
  const nullIdx = row.indexOf('if (!data) return null;');
  assert(stateIdx > -1 && nullIdx > stateIdx, 'hook order depends on data');
});

check('the three tiles speak their handles, handlers and hue faces', () => {
  assert(TAB.includes('testId="branch-revenue-card"') && TAB.includes("onClick={() => setDoor('ledger')}") && TAB.includes('edgeClass="bg-emerald-600"'), 'revenue door');
  assert(TAB.includes('testId="branch-transactions-card"') && TAB.includes("onClick={() => setDoor('receipts')}") && TAB.includes('edgeClass="bg-teal-600"'), 'receipts door');
  assert(TAB.includes('testId="branch-atv-card"') && TAB.includes("onClick={() => setDoor('ladder')}") && TAB.includes('edgeClass="bg-amber-600"'), 'ladder door');
});

check('the hot ring speaks only when the day is live', () => {
  assert(TAB.includes('hotRing={!noSalesToday}'), 'revenue gate');
  assert(TAB.includes('hotRing={txns > 0}'), 'receipts gate');
  assert(TAB.includes('hotRing={atv > 0}'), 'ladder gate');
});

check('the KpiCard renders the handle, edge bar and live dot', () => {
  assert(TAB.includes('data-testid={testId}'), 'the handle');
  assert(TAB.includes('`absolute inset-y-0 left-0 w-1 ${edgeClass}`'), 'the edge');
  assert(TAB.includes('anim-pulse-dot'), 'the dot');
});

check('the non-door tiles keep their voices', () => {
  const row = TAB.slice(TAB.indexOf('function KpiRow('), TAB.indexOf('// 4b. LIMITED DASHBOARD'));
  assert(row.includes("onClick={() => onTab('inventory')}"), 'stock navigates');
  assert(row.includes("onClick={() => onTab('debt-management')}"), 'debt navigates');
});

check('the three modals mount inside the row', () => {
  assert(TAB.includes('<DayLedgerModal data={data} open={door === \'ledger\'} onClose={() => setDoor(null)} />'), 'ledger mount');
  assert(TAB.includes('<DayReceiptsModal data={data} open={door === \'receipts\'} onClose={() => setDoor(null)} />'), 'receipts mount');
  assert(TAB.includes('<BasketLadderModal data={data} open={door === \'ladder\'} onClose={() => setDoor(null)} />'), 'ladder mount');
});

// ── 4. The three doors ──────────────────────────────────────────────────────
check('the day\'s ledger speaks the whole story', () => {
  assert(DOORS.includes('data-testid="day-ledger-modal"'), 'testid');
  assert(DOORS.includes('data-testid="day-ledger-amount"'), 'headline');
  assert(DOORS.includes('data-testid="day-ledger-clear"'), 'zero day');
  assert(DOORS.includes('Revenue by hour, 6 AM to 9 PM. Peak'), 'bar aria');
  assert(DOORS.includes('data-testid="day-ledger-peak"'), 'peak spoken twice');
  assert(DOORS.includes('% of the day'), 'tender shares');
  assert(DOORS.includes('.slice(0, 5)'), 'mini-roster cap');
});

check('the day\'s receipts speaks the named roster', () => {
  assert(DOORS.includes('data-testid="day-receipts-modal"'), 'testid');
  assert(DOORS.includes('data-testid="day-receipts-count"'), 'headline');
  assert(DOORS.includes('data-testid="day-receipts-window"'), 'window note');
  assert(DOORS.includes('the wire&rsquo;s 10-receipt window — {txns - receipts.length} more on the day'), 'window words');
  assert(DOORS.includes("{r.customer?.name ? r.customer.name : 'Walk-in'}"), 'walk-in honesty');
  assert(DOORS.includes('· served by {r.cashier.name}'), 'cashier voice');
  assert(DOORS.includes('data-testid="day-receipts-busiest"'), 'busiest spoken twice');
});

check('the basket ladder reads the window and says so', () => {
  assert(DOORS.includes('data-testid="basket-ladder-modal"'), 'testid');
  assert(DOORS.includes('data-testid="basket-ladder-value"'), 'headline');
  assert(DOORS.includes("{ key: 'over20k', label: 'Over KES 20,000', lo: 20_000.01, hi: Number.POSITIVE_INFINITY }"), 'gaps impossible');
  assert(DOORS.includes('% of the named'), 'honest shares');
  assert(DOORS.includes('data-testid="basket-ladder-window"'), 'window note');
  assert(DOORS.includes('data-testid="basket-ladder-clear"'), 'zero day');
});

check('the honest absences all speak', () => {
  assert(DOORS.includes('data-testid="day-ledger-clear"'), 'ledger zero');
  assert(DOORS.includes('data-testid="day-receipts-clear"'), 'receipts zero');
  assert(DOORS.includes('data-testid="basket-ladder-clear"'), 'ladder zero');
  assert(DOORS.includes('data-testid="day-ledger-methods-clear"'), 'zero-total mix');
  assert(DOORS.includes('{methodTotal > 0 && ('), 'no % of nothing');
  assert(DOORS.includes('{b.count > 0 && ('), 'zero bucket bar draws nothing');
});

check('NO anchors inside the doors (the honest-door law)', () => {
  assert(!DOORS.includes('<a '), 'no anchors');
  assert(!DOORS.includes('href='), 'no hrefs');
});

check('the panels paint their dark half from birth (the branch three-mount law)', () => {
  assert(DOORS.includes('dark:border-slate-700 dark:bg-slate-900'), 'panel dark half');
  assert(DOORS.includes('dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'), 'emerald chips dark');
  assert(DOORS.includes('dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/30'), 'teal chips dark');
  assert(DOORS.includes('dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30'), 'slate chips dark');
});

// ── 5. The contrast round ───────────────────────────────────────────────────
check('the draft meta voice is fixed at the source', () => {
  assert(DOORS.includes('text-slate-500 dark:text-slate-400'), 'fixed voice');
  assert(!DOORS.includes('text-slate-400 dark:text-slate-500'), 'draft voice gone');
});

check('the contrast script pins the ghosts in reverse and documents the fills', () => {
  assert(CONTRAST.includes('checkBug'), 'reverse pins');
  assert(CONTRAST.includes('ghost: slate-400 on white (the draft light voice)'), 'light ghost');
  assert(CONTRAST.includes('ghost: slate-500 on slate-900 (the draft dark voice)'), 'dark ghost');
  assert(CONTRAST.includes('documented as DECORATION'), 'fills law');
});

// ── 6. Docs & surfaces ──────────────────────────────────────────────────────
check('the a11y doc records the round\'s numbers', () => {
  assert(A11Y.includes('v2.200.0'), 'round section');
  assert(A11Y.includes('2.63'), 'pre-fix light number');
  assert(A11Y.includes('3.74'), 'pre-fix dark number');
  assert(A11Y.includes('4.77'), 'fixed light number');
});

check('the workspace doc\'s door register carries the branch doors', () => {
  assert(WORKSPACE.includes('v2.200.0'), 'register row');
  assert(WORKSPACE.includes("The day's ledger"), 'ledger name');
  assert(WORKSPACE.includes("The day's receipts"), 'receipts name');
  assert(WORKSPACE.includes('The basket ladder'), 'ladder name');
});

check('the changelog leads with 2.200.0', () => {
  assert(CHANGELOG.slice(0, 400).includes('## [2.200.0] The branch row speaks'), 'headline');
});

check('the round\'s test file exists and pins the round', () => {
  assert(TEST.includes('the branch row speaks'), 'headline');
  assert(TEST.includes('testId="branch-revenue-card"'), 'card pin');
  assert(TEST.includes("'2.200.0'"), 'version pin context');
});

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail > 0 ? 1 : 0);
