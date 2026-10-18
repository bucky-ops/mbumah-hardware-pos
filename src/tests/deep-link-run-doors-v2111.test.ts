// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.111.0: the app learns three new doors.
 *
 *   1. DEEP LINKS — a URL may name the tab (?tab=<id>, consumed ONCE at
 *      boot AFTER the persisted store rehydrates, then stripped) and carry
 *      branch context (?branch=<storeId>, owned by the People & Payroll
 *      tab: read on mount, mirrored on every change, stripped on unmount).
 *   2. RUN DOORS — the ledger drawer's settled-run chips (zero runs AND
 *      missing journals) are real buttons that hand the run to the
 *      run-detail dialog; one drawer closes, one opens, never stacked.
 *   3. The (from link) hint is honest — it retires the moment the user
 *      overrides the seeded filter.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('deep link — ?tab= is consumed ONCE at boot, after rehydrate', () => {
  it('the boot effect validates against TAB_CONFIG and applies the tab after rehydrate', () => {
    const boot = read('src/app/(shell)/page.tsx');
    expect(boot.includes('const consumeDeepLink = () => {')).toBe(true);
    expect(boot.includes('TAB_CONFIG.some((t) => t.id === tabParam)')).toBe(true);
    // ORDER MATTERS: a synchronous setActiveTab would be overwritten by the
    // async rehydrate — the consumption chains onto its promise.
    expect(boot.includes('.then(consumeDeepLink, consumeDeepLink)')).toBe(true);
    expect(boot.includes('useAppStore.getState().setActiveTab(tabParam as AppTab)')).toBe(true);
    // The tab param is consumed (stripped) — a refresh returns to the persisted tab.
    expect(boot.includes("sp.delete('tab')")).toBe(true);
    // ?branch is NOT the boot's to consume — the tab owns it.
    expect(boot.includes("sp.delete('branch')")).toBe(false);
  });
});

describe('deep link — ?branch= is the People & Payroll tab\'s contract', () => {
  it('the tab reads it on mount, mirrors changes, strips on unmount', () => {
    const tab = read('src/app/(shell)/tabs/people-payroll-tab.tsx');
    // The seed is a LAZY initializer (no setState-in-effect — lint purity).
    expect(tab.includes(".get('branch') ?? ''")).toBe(true);
    expect(tab.includes('window.history.replaceState')).toBe(true);
    expect(tab.includes('mirrorBranchToUrl')).toBe(true);
    // Unmount cleanup: a stale filter cannot haunt the next mount.
    const cleanup = tab.split('return () => {')[1]?.split('};')[0] ?? '';
    expect(cleanup.includes("sp.has('branch')")).toBe(true);
    expect(cleanup.includes("sp.delete('branch')")).toBe(true);
    // The panel receives the seeded value and reports changes back.
    expect(tab.includes('defaultBranchId={linkBranchId}')).toBe(true);
    expect(tab.includes('onBranchFilterChange={mirrorBranchToUrl}')).toBe(true);
  });

  it('the panel seeds its filter from the link and reports every change', () => {
    const src = read('src/components/finance/people-payroll-by-branch.tsx');
    expect(src.includes('defaultBranchId = \'\'')).toBe(true);
    expect(src.includes('onBranchFilterChange?: (branchId: string) => void;')).toBe(true);
    expect(src.includes('useState(defaultBranchId)')).toBe(true);
    expect(src.includes('onBranchFilterChange?.(id)')).toBe(true);
    // Every mutation path goes through changeBranch (select AND Reset).
    expect(src.includes('onChange={(e) => changeBranch(e.target.value)}')).toBe(true);
    expect(src.includes('onClick={() => changeBranch(\'\')}')).toBe(true);
    // The (from link) hint retires once the user overrides the seed.
    expect(src.includes('(from link)')).toBe(true);
    expect(src.includes("!userTouched")).toBe(true);
  });
});

describe('run doors — the drawer\'s settled-run chips open the run dialog', () => {
  const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');

  it('zero-run AND missing-journal chips are doors with honest labels', () => {
    for (const tid of ['payroll-ledger-zero-run-door', 'payroll-ledger-missing-run-door']) {
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
    expect(PAGE.includes("aria-label={`Open the ${r.runType} run's detail — a zero-value settled run`}")).toBe(true);
    expect(PAGE.includes("aria-label={`Open the ${r.runType} run's detail — a settled run missing its journal`}")).toBe(true);
    // Chips are real buttons wired to onOpenRun.
    expect(PAGE.includes('onClick={() => onOpenRun?.(r.runId)}')).toBe(true);
  });

  it('the parent hands the run to the dialog and closes the drawer (never stacked)', () => {
    const wiring = PAGE.split('onOpenRun={(runId) => {')[1]?.split('}}')[0] ?? '';
    expect(wiring.includes('setLedgerPeriodId(null);')).toBe(true);
    expect(wiring.includes('setLedgerPeriodName(null);')).toBe(true);
    expect(wiring.includes('setOpenRunId(runId);')).toBe(true);
  });

  it('the quiet zero block stays quiet — its doors wear slate, never role=alert', () => {
    // Cut at the next block's CONDITION, not its testid: the missing block's
    // role="alert" sits BEFORE its own data-testid in the JSX opening tag.
    const zeroBlock = PAGE.split('data-testid="payroll-ledger-zero-runs"')[1].split('payload.missingJournal.length > 0')[0];
    expect(zeroBlock.includes('role="alert"')).toBe(false);
    expect(zeroBlock.includes('focus-visible:ring-violet-500')).toBe(true);
  });
});
