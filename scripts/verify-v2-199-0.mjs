#!/usr/bin/env node
// v2.199.0 verification — "the pending tile opens the approval desk".
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
const CHROME = read('src/components/org/chrome.tsx');
const MATRIX = read('src/components/org/store-matrix.tsx');
const PRIMITIVES = read('src/components/org/primitives.tsx');
const ROUTE = read('src/app/api/org/kpi-summary/route.ts');
const A11Y = read('docs/a11y/contrast-math.md');
const WORKSPACE = read('docs/multi-store-workspaces.md');
const CHANGELOG = read('CHANGELOG.md');
const TEST = read('src/tests/approval-desk-v2199.test.ts');
const CONTRAST = read('scripts/contrast-math-approval-desk-v2199.mjs');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.199.0', () => {
  assert(atLeast(PKG.version, '2.199.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.199.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.199.0'), 'baseVersion');
});

check('whats-new leads with 2.199.0 and tells the desk story', () => {
  const i99 = WN.indexOf("version: '2.199.0'");
  const i98 = WN.indexOf("version: '2.198.0'");
  assert(i99 >= 0, 'no 2.199.0 entry');
  assert(i98 > i99, '2.199.0 does not lead the feed');
  assert(WN.includes('The pending tile opens the approval desk'), 'headline');
  assert(WN.includes('loudest order first'), 'roster bullet');
});

// ── 2. The wire: zero new queries ───────────────────────────────────────────
check('the wire is unchanged - the desk rides the action queue + the Suppliers roster', () => {
  assert(PRIMITIVES.includes('pending: { purchaseOrders: number; openShifts: number; expenses: number }'), 'action-queue shape');
  assert(PRIMITIVES.includes('purchaseOrders: Array<{ id: string; supplier: string; store: string | null; status: string; total: number; expectedDate: string | null }>'), 'roster shape');
  assert(ROUTE.includes("rawDb.purchaseOrder.count({ where: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] } } })"), 'route count');
  assert(ROUTE.includes('purchaseOrders: poRows.slice(0, 8)'), 'roster window (8)');
});

check('the component composes, it never invents - no fetch, no new query in kpi-row', () => {
  assert(!KPI.includes('fetch('), 'kpi-row must not fetch');
  assert(KPI.includes('const poRosterReady = Array.isArray(data.suppliers?.purchaseOrders);'), 'ready gate');
  assert(KPI.includes(".filter((p) => p.status === 'DRAFT' || p.status === 'PENDING_APPROVAL')"), 'pending-slice filter');
  assert(KPI.includes('.sort((a, b) => b.total - a.total)'), 'loudest order first');
});

// ── 3. The card: the row's sixth voice ──────────────────────────────────────
check('the pending card is the row\u2019s sixth button with the family face', () => {
  assert(KPI.includes('onClick={() => setDeskOpen(true)}'), 'opens the drill-down');
  assert(KPI.includes('data-testid="pending-card"'), 'testid');
  assert(KPI.includes('<span className="absolute inset-y-0 left-0 w-1 bg-indigo-600" />'), 'indigo edge');
  assert(KPI.includes('>queue</span>'), 'qualifier chip');
  assert(KPI.includes('{pendingTotal > 0 && <span className="h-2 w-2 rounded-full bg-indigo-600 anim-pulse-dot" />}'), 'live dot');
  assert(KPI.includes("pendingTotal > 0 ? 'ring-1 ring-indigo-300' : ''"), 'hot ring');
});

check('the card draws the queue mini bar with honest segments only', () => {
  assert(KPI.includes('aria-label={`Approval queues: ${deskQueues.map((q) => `${q.label} ${q.value}`).join(\', \')}`}'), 'bar aria-label');
  assert(KPI.includes('q.value > 0 ? ('), 'zero queue draws nothing');
  assert(KPI.includes("style={{ width: `${(q.value / pendingTotal) * 100}%` }}"), 'honest widths');
});

check('the revenue card gained its QA handle', () => {
  assert(KPI.includes('data-testid="revenue-card"'), 'testid');
});

// ── 4. The drill-down ───────────────────────────────────────────────────────
check('the approval desk modal speaks the whole story', () => {
  assert(KPI.includes('<Dialog open={deskOpen} onOpenChange={setDeskOpen}>'), 'dialog');
  assert(KPI.includes('The approval desk</DialogTitle>'), 'title');
  assert(KPI.includes('data-testid="approval-desk-count"'), 'count');
  assert(KPI.includes('data-testid="approval-desk-bar"'), 'bar');
  assert(KPI.includes('data-testid={`approval-desk-queue-${q.key}`}'), 'grid cells');
  assert(KPI.includes('% of desk'), 'shares');
  assert(KPI.includes('data-testid="approval-desk-po-row"'), 'named rows');
  assert(KPI.includes('{kes(p.total)}'), 'order total');
});

check('the honest absences all speak', () => {
  assert(KPI.includes('data-testid="approval-desk-clear"'), 'clean desk');
  assert(KPI.includes('Nothing waits on a human — the desk is clear.'), 'clear line');
  assert(KPI.includes('data-testid="approval-desk-shifts-note"'), 'shifts pointer');
  assert(KPI.includes('the Shift Scheduling tab — the shift roster is not on this answer'), 'shifts words');
  assert(KPI.includes('data-testid="approval-desk-expenses-note"'), 'expenses pointer');
  assert(KPI.includes('the Financial tab — the expense ledger is not on this answer'), 'expenses words');
  assert(KPI.includes('data-testid="approval-desk-po-stale"'), 'stale roster');
  assert(KPI.includes('data-testid="approval-desk-po-capped"'), 'cap note');
  assert(KPI.includes('the named rows are a window on this answer'), 'cap words');
});

check('NO deep links - the pointer is not a door (the honest-door law)', () => {
  const deskBlock = KPI.slice(KPI.indexOf('The approval desk — v2.199.0'), KPI.lastIndexOf('</Dialog>'));
  assert(!deskBlock.includes('<a '), 'no anchors inside the desk modal');
  assert(!deskBlock.includes('href='), 'no hrefs inside the desk modal');
  assert(deskBlock.includes('Shift Scheduling tab'), 'shifts destination spoken in words');
  assert(deskBlock.includes('Financial tab'), 'expenses destination spoken in words');
});

check('the panel paints its dark half from birth (the six-panel law)', () => {
  const deskBlock = KPI.slice(KPI.indexOf('The approval desk — v2.199.0'), KPI.lastIndexOf('</Dialog>'));
  assert(deskBlock.includes('dark:border-slate-700 dark:bg-slate-900'), 'panel dark half');
  // the chip voices live in the single-writer chip fns above the modal
  assert(KPI.includes('dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30'), 'indigo chips dark');
  assert(KPI.includes('dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30'), 'amber chips dark');
  assert(KPI.includes('dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30'), 'slate chips dark');
  assert(deskBlock.includes('dark:bg-slate-900/60 dark:text-slate-400'), 'note dark half');
});

// ── 5. The contrast round ───────────────────────────────────────────────────
check('the lens ACTIVE GROSS chip re-voices to emerald-700', () => {
  assert(KPI.includes("'bg-emerald-700 text-white shadow'"), 'fixed voice');
  assert(!KPI.includes("'bg-emerald-600 text-white shadow'"), 'old voice gone');
});

check('the login error line re-voices to red-700', () => {
  assert(CHROME.includes('rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700'), 'fixed voice');
  assert(!CHROME.includes('text-xs text-red-600'), 'old voice gone');
});

check('the Store Matrix hot debt figure re-voices to red-700 (family alignment)', () => {
  assert(MATRIX.includes("'font-semibold text-red-700'"), 'fixed voice');
  assert(!MATRIX.includes("'font-semibold text-red-600'"), 'old voice gone');
});

check('the contrast script pins the ghosts in reverse and documents the bar fills', () => {
  assert(CONTRAST.includes('checkBug'), 'reverse pins');
  assert(CONTRAST.includes('white on emerald-600 (pre-fix, must stay under)'), 'lens ghost');
  assert(CONTRAST.includes('red-600 on red-50 (pre-fix, must stay under)'), 'login ghost');
  assert(CONTRAST.includes('decoration by the house rule (NOT asserted)'), 'bar fills law');
});

// ── 6. Docs & surfaces ──────────────────────────────────────────────────────
check('the a11y doc records the round\u2019s numbers', () => {
  assert(A11Y.includes('v2.199.0'), 'round section');
  assert(A11Y.includes('3.67'), 'pre-fix lens number');
  assert(A11Y.includes('5.37'), 'fixed lens number');
  assert(A11Y.includes('4.36'), 'pre-fix login number');
});

check('the workspace doc\u2019s door register carries the sixth door', () => {
  assert(WORKSPACE.includes('v2.199.0'), 'register row');
  assert(WORKSPACE.includes('The approval desk'), 'door name');
});

check('the changelog leads with 2.199.0', () => {
  assert(CHANGELOG.slice(0, 400).includes('## [2.199.0] The pending tile opens the approval desk'), 'headline');
});

check('the round\u2019s test file exists and pins the round', () => {
  assert(TEST.includes('the pending tile opens the approval desk'), 'headline');
  assert(TEST.includes('data-testid="pending-card"'), 'card pin');
  assert(TEST.includes("version: '2.199.0'"), 'version pin context');
});

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail > 0 ? 1 : 0);
