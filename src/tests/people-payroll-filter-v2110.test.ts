// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.110.0: the People & Payroll panel learns to filter. The per-branch
 * filter lives INSIDE the shared panel, so the Finance & Insights tab and
 * the Expert Console get it from ONE implementation. The pure function
 * (filterBranchRows) is the one truth both the desktop table and the mobile
 * cards render — these tests pin it:
 *
 *   1. '' = every branch, original order preserved (a filter narrows,
 *      never reorders);
 *   2. a known storeId narrows to exactly that branch;
 *   3. an unknown id narrows to nothing (honest empty, not a fallback);
 *   4. the input is never mutated;
 *   5. the filter UI rides the shared panel — both homes inherit it
 *      (the tab does NOT grow its own copy), with count + Reset affordances.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

import { filterBranchRows, type HrPerStoreRow } from '@/components/finance/people-payroll-by-branch';

const row = (storeId: string, storeName: string): HrPerStoreRow =>
  ({
    storeId,
    storeName,
    headcountActive: 1,
    monthEmploymentCost: 100,
    monthAbsenceRatePct: 0,
    latestPayroll: null,
    expiryAlerts: { documentsExpiring90Days: 0, assetsOverdue: 0 },
  }) as HrPerStoreRow;

const ROWS = [row('s-juja', 'Juja Main'), row('s-cbd', 'Nairobi CBD'), row('s-nakuru', 'Nakuru')];

describe('filterBranchRows — the filter narrows, never reorders', () => {
  it("'' serves every branch in the server's order", () => {
    expect(filterBranchRows(ROWS, '').map((r) => r.storeId)).toEqual(['s-juja', 's-cbd', 's-nakuru']);
  });

  it('a known storeId narrows to exactly that branch', () => {
    const out = filterBranchRows(ROWS, 's-cbd');
    expect(out).toHaveLength(1);
    expect(out[0]?.storeName).toBe('Nairobi CBD');
  });

  it('an unknown id is an honest empty, not a silent fallback to all', () => {
    expect(filterBranchRows(ROWS, 's-ghost')).toEqual([]);
  });

  it('filtering never mutates the input rows', () => {
    const snapshot = JSON.stringify(ROWS);
    filterBranchRows(ROWS, 's-nakuru');
    filterBranchRows(ROWS, '');
    expect(JSON.stringify(ROWS)).toBe(snapshot);
  });

  it('the filter UI lives in the SHARED panel (both homes inherit it), with count and Reset', () => {
    const src = read('src/components/finance/people-payroll-by-branch.tsx');
    expect(src.includes('export function filterBranchRows')).toBe(true);
    expect(src.includes('filterBranchRows(rows, branchId)')).toBe(true);
    expect(src.includes('All branches')).toBe(true);
    expect(src.includes('-filter-count')).toBe(true);
    expect(src.includes('-filter-reset')).toBe(true);
    // Both rendered surfaces read `visible`, never raw rows.
    expect(src.includes('{visible.map((row) => (')).toBe(true);
    expect(src.includes('visible.map((row) => {')).toBe(true);
    // The tab and the console consume the shared component unchanged —
    // neither grows its own filter copy.
    const tab = read('src/app/(shell)/tabs/people-payroll-tab.tsx');
    expect(tab.includes('PeoplePayrollByBranch rows={rows}')).toBe(true);
    expect(tab.toLowerCase().includes('select')).toBe(false);
  });
});
