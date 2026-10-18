#!/usr/bin/env node
// v2.110.0 verification — "The drawer knows a zero when it sees one".
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

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.110.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.110.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.110.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.110.0', `base=${pkg.mbumah.baseVersion}`);
});

check('whats-new: 2.110.0 leads the feed with the zero-run story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.110.0'");
  assert(head > -1, 'no 2.110.0 entry');
  assert(head < wn.indexOf("version: '2.109.0'"), '2.110.0 does not lead');
  assert(wn.includes('The drawer knows a zero when it sees one'), 'title missing');
});

// ── the builder: the value-aware split ─────────────────────────────────────
check('builder: LedgerRunSource carries the payable truth (totalNet)', () => {
  const src = read('src/lib/hr/payroll/period-journal.ts');
  assert(src.includes('totalNet: number;'), 'totalNet field');
  assert(src.includes('PAYABLE TRUTH'), 'doc contract');
});

check('builder: PeriodLedger grows the zeroRuns bucket, documented as never-an-alarm', () => {
  const src = read('src/lib/hr/payroll/period-journal.ts');
  assert(src.includes('zeroRuns: UnsettledLedgerRun[];'), 'zeroRuns bucket');
  assert(src.includes('Never an alarm'), 'doc promise');
});

check('builder: the split is value-aware at 2dp — money alarms, dust does not', () => {
  const src = read('src/lib/hr/payroll/period-journal.ts');
  assert(src.includes('money2(Number(run.totalNet || 0)) > 0'), 'value-aware condition');
  assert(src.includes('missingJournal.push'), 'alarm branch kept');
  assert(src.includes('zeroRuns.push'), 'quiet branch added');
  assert(src.includes('return { entries: posted, unsettled, missingJournal, zeroRuns };'), 'all buckets returned');
});

// ── the route: feeds the truth ─────────────────────────────────────────────
check('route: the runs select now reads totalNet and feeds the builder', () => {
  const route = read('src/app/api/payroll/period-journal/route.ts');
  assert(route.includes('totalNet: true'), 'select field');
  assert(route.includes('totalNet: Number(r.totalNet)'), 'builder feed');
});

// ── the drawer: quiet block + alarm kept separate ──────────────────────────
check('drawer: the zero block renders quietly (slate, not alert) with its own testid', () => {
  const page = read('src/app/(shell)/hr/payroll/page.tsx');
  assert(page.includes('data-testid="payroll-ledger-zero-runs"'), 'testid');
  assert(page.includes('zero-value'), 'copy');
  assert(page.includes('Correct by design'), 'design note');
  assert(page.includes('This is not the missing-journal alarm.'), 'explicit non-alarm line');
  const zeroBlock = page.split('data-testid="payroll-ledger-zero-runs"')[0].slice(-300);
  assert(!zeroBlock.includes('role="alert"'), 'zero block must not be an alert');
});

check('drawer: the red alarm keeps role="alert" and its teeth for money', () => {
  const page = read('src/app/(shell)/hr/payroll/page.tsx');
  assert(page.includes('data-testid="payroll-ledger-missing"'), 'alarm testid');
  assert(page.includes('this must never happen'), 'alarm copy kept');
  assert(page.includes('payload.zeroRuns.length === 0 && ('), 'empty-state counts zero runs');
});

check('drawer: payload interface declares zeroRuns', () => {
  const page = read('src/app/(shell)/hr/payroll/page.tsx');
  assert(page.includes('zeroRuns: Array<{ runId: string; runType: string; status: string }>'), 'interface field');
});

// ── the panel: the branch filter ───────────────────────────────────────────
check('panel: the filter is one pure function shared by table and cards', () => {
  const src = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(src.includes('export function filterBranchRows'), 'pure fn');
  assert(src.includes('filterBranchRows(rows, branchId)'), 'wired');
  assert(src.includes('{visible.map((row) => ('), 'desktop reads visible');
  assert(src.includes('visible.map((row) => {'), 'mobile reads visible');
});

check('panel: filter UI has select, count and Reset, styled to the panel', () => {
  const src = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(src.includes('All branches'), 'all option');
  assert(src.includes('-branch-filter'), 'select testid');
  assert(src.includes('-filter-count'), 'showing X of Y');
  assert(src.includes('-filter-reset'), 'reset affordance');
  assert(src.includes('SlidersHorizontal'), 'filter icon');
  assert(src.includes('focus:ring-orange-400/30'), 'focus ring styling');
});

check('panel: an honest empty state when nothing matches', () => {
  const src = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(src.includes('No branches match this filter.'), 'empty copy');
  assert(src.includes('-cards-empty'), 'empty testid');
});

check('panel: both homes consume the shared component (no filter copies)', () => {
  const tab = read('src/app/(shell)/tabs/people-payroll-tab.tsx');
  assert(tab.includes('<PeoplePayrollByBranch rows={rows} defaultOpen'), 'tab uses shared panel');
  assert(!tab.toLowerCase().includes('select'), 'tab grows no own select');
  const consolePage = read('src/app/(shell)/console/page.tsx');
  assert(consolePage.includes('PeoplePayrollByBranch'), 'console uses shared panel');
});

// ── tests + docs + changelog ───────────────────────────────────────────────
check('tests: the zero-run honesty is pinned in period-journal.test.ts', () => {
  const t = read('src/tests/period-journal.test.ts');
  assert(t.includes('the drawer knows a zero when it sees one'), 'describe');
  assert(t.includes("run('zero-1', 'REGULAR', 'LOCKED', 0)"), 'zero case');
  assert(t.includes('the alarm keeps its teeth'), 'alarm case');
});

check('tests: the filter is pinned in its own round file', () => {
  const t = read('src/tests/people-payroll-filter-v2110.test.ts');
  assert(t.includes('the filter narrows, never reorders'), 'describe');
  assert(t.includes("filterBranchRows(ROWS, 's-ghost')"), 'unknown-id case');
});

check('changelog: the [2.110.0] entry records the round', () => {
  const cl = read('CHANGELOG.md');
  assert(cl.includes('## [2.110.0]'), 'entry');
  assert(cl.includes('zero'), 'zero story');
});

check('docs: the zero-run contract and the filter contract are written down', () => {
  const z = read('docs/PAYROLL_LEDGER_ZERO_RUNS.md');
  assert(z.includes('zeroRuns'), 'zero doc');
  const p = read('docs/PEOPLE_PAYROLL_BY_BRANCH.md');
  assert(p.includes('filterBranchRows'), 'filter doc rides the panel doc');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
