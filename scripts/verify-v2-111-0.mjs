#!/usr/bin/env node
// v2.111.0 verification — "The app speaks deep links; every settled run opens its door".
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
check('version: package.json stays at-or-above 2.111.0 (all three slots)', () => {
  // v2.113.0 chore re-anchor (the PR #235 precedent): floor holds (never
  // backward), slots must AGREE with each other (no half-bumped trees).
  const pkg = JSON.parse(read('package.json'));
  const atLeast = (v, floor) => {
    const p = v.split('.').map(Number);
    const f = floor.split('.').map(Number);
    return p[0] > f[0] || (p[0] === f[0] && (p[1] > f[1] || (p[1] === f[1] && p[2] >= f[2])));
  };
  assert(atLeast(pkg.version, '2.111.0'), `version=${pkg.version}`);
  assert(atLeast(pkg.mbumah.releaseVersion, '2.111.0'), `release=${pkg.mbumah.releaseVersion}`);
  assert(atLeast(pkg.mbumah.baseVersion, '2.111.0'), `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.version === pkg.mbumah.releaseVersion && pkg.mbumah.releaseVersion === pkg.mbumah.baseVersion, 'slots disagree');
});

check('whats-new: 2.111.0 leads the feed with the deep-link story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.111.0'");
  assert(head > -1, 'no 2.111.0 entry');
  assert(head < wn.indexOf("version: '2.110.0'"), '2.111.0 does not lead');
  assert(wn.includes('The app speaks deep links'), 'title missing');
});

// ── the boot deep link (?tab=) ─────────────────────────────────────────────
check('boot: ?tab= validated against TAB_CONFIG, applied AFTER rehydrate, stripped once', () => {
  const boot = read('src/app/(shell)/page.tsx');
  assert(boot.includes('const consumeDeepLink = () => {'), 'consumer fn');
  assert(boot.includes('TAB_CONFIG.some((t) => t.id === tabParam)'), 'validation');
  assert(boot.includes('.then(consumeDeepLink, consumeDeepLink)'), 'post-rehydrate order');
  assert(boot.includes('useAppStore.getState().setActiveTab(tabParam as AppTab)'), 'tab applied');
  assert(boot.includes("sp.delete('tab')"), 'param stripped');
  assert(boot.includes("sp.delete('branch')") === false, 'boot must NOT consume ?branch');
  assert(boot.includes("import { TAB_CONFIG } from '@/lib/app-config'"), 'registry import');
  assert(boot.includes("type AppTab } from '@/lib/stores'"), 'AppTab rides the stores import');
});

// ── the tab deep link (?branch=) ───────────────────────────────────────────
check('tab: ?branch read on mount, mirrored on change, stripped on unmount', () => {
  const tab = read('src/app/(shell)/tabs/people-payroll-tab.tsx');
  assert(tab.includes(".get('branch') ?? ''"), 'read (lazy initializer)');
  assert(tab.includes('mirrorBranchToUrl'), 'mirror fn');
  assert(tab.includes('window.history.replaceState'), 'no-navigation writes');
  const cleanup = tab.split('return () => {')[1]?.split('};')[0] ?? '';
  assert(cleanup.includes("sp.delete('branch')"), 'unmount strip');
  assert(tab.includes('defaultBranchId={linkBranchId}'), 'seed handed to panel');
  assert(tab.includes('onBranchFilterChange={mirrorBranchToUrl}'), 'changes reported');
});

check('panel: defaultBranchId seeds, changeBranch funnels, the link hint retires on touch', () => {
  const src = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(src.includes('useState(defaultBranchId)'), 'seeded state');
  assert(src.includes('onBranchFilterChange?.(id)'), 'report');
  assert(src.includes('setUserTouched(true)'), 'touch tracked');
  assert(src.includes('(from link)'), 'honest hint');
  assert(src.includes('&& !userTouched ?'), 'hint retires');
});

// ── the run doors ──────────────────────────────────────────────────────────
check('drawer: settled-run chips are doors (zero slate, missing rose), aria-labelled', () => {
  const page = read('src/app/(shell)/hr/payroll/page.tsx');
  assert(page.includes('data-testid="payroll-ledger-zero-run-door"'), 'zero door');
  assert(page.includes('data-testid="payroll-ledger-missing-run-door"'), 'missing door');
  assert(page.includes("aria-label={`Open the ${r.runType} run's detail — a zero-value settled run`}"), 'zero aria');
  assert(page.includes("aria-label={`Open the ${r.runType} run's detail — a settled run missing its journal`}"), 'missing aria');
  assert(page.includes('onClick={() => onOpenRun?.(r.runId)}'), 'wired');
  const zeroBlock = page.split('data-testid="payroll-ledger-zero-runs"')[1].split('payload.missingJournal.length > 0')[0];
  assert(zeroBlock.includes('role="alert"') === false, 'zero block stays quiet');
});

check('parent: the door closes the ledger drawer and opens the run dialog (never stacked)', () => {
  const page = read('src/app/(shell)/hr/payroll/page.tsx');
  const wiring = page.split('onOpenRun={(runId) => {')[1]?.split('}}')[0] ?? '';
  assert(wiring.includes('setLedgerPeriodId(null);'), 'ledger id cleared');
  assert(wiring.includes('setLedgerPeriodName(null);'), 'ledger name cleared');
  assert(wiring.includes('setOpenRunId(runId);'), 'run dialog opened');
  assert(page.includes('onOpenRun?: (runId: string) => void;'), 'prop typed');
});

// ── the lifecycle proof (live data contract) ───────────────────────────────
check('lifecycle: maker-checker guard exists server-side (approve roles + distinct actor)', () => {
  const approve = read('src/app/api/payroll/runs/[id]/approve/route.ts');
  assert(approve.includes("['STORE_OWNER']"), 'approve roles');
  const svc = read('src/lib/hr/payroll/run-service.ts');
  assert(svc.toLowerCase().includes('preparedbyuserid'), 'preparer tracked');
});

// ── tests + docs + changelog ───────────────────────────────────────────────
check('tests: the deep-link + run-door round is pinned in its own file', () => {
  const t = read('src/tests/deep-link-run-doors-v2111.test.ts');
  assert(t.includes('?tab= is consumed ONCE at boot'), 'boot describe');
  assert(t.includes('open the run dialog'), 'doors describe');
  assert(t.includes('(from link)'), 'hint pin');
  assert(t.includes('!userTouched'), 'retire pin');
});

check('tests: the v2.110.0 filter pins were re-pinned for the seeded panel', () => {
  const t = read('src/tests/people-payroll-filter-v2110.test.ts');
  assert(t.includes('<PeoplePayrollByBranch'), 'updated pin');
  assert(t.includes('defaultBranchId'), 'v2.111.0 note rides the pin');
});

check('changelog: the [2.111.0] entry records the round', () => {
  const cl = read('CHANGELOG.md');
  assert(cl.includes('## [2.111.0]'), 'entry');
  assert(cl.includes('Deep links'), 'deep links');
  assert(cl.includes('Run-detail doors'), 'doors');
});

check('docs: the run-door and deep-link contracts are written down', () => {
  const z = read('docs/PAYROLL_LEDGER_ZERO_RUNS.md');
  assert(z.includes('Run doors'), 'zero doc door');
  const p = read('docs/PEOPLE_PAYROLL_BY_BRANCH.md');
  assert(p.includes('?branch='), 'deep link contract');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
