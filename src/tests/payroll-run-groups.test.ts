// v2.98.0 — payroll runs read as periods: the pure grouping builder.
// Executed for real (no mocks): the seeded October 2026 shape this console
// actually shows — BONUS pending, OFF_CYCLE posted, SUPPLEMENTARY posted,
// REGULAR locked — plus the honesty contract edges the header lives on.

import { describe, expect, it } from 'vitest';
import {
  groupRunsByPeriod,
  type PayrollPeriodGroup,
  type RunGroupSource,
} from '@/lib/hr/payroll/run-groups';

/** Guarded single-period unwrap — the house style prefers guards to `!`. */
function oneGroup(runs: RunGroupSource[]): PayrollPeriodGroup {
  const groups = groupRunsByPeriod(runs);
  if (groups.length !== 1) throw new Error(`expected exactly 1 period, got ${groups.length}`);
  return groups[0];
}

const run = (over: Partial<RunGroupSource> & { id: string }): RunGroupSource => ({
  runType: 'REGULAR',
  status: 'DRAFT',
  totalGross: '100000',
  totalDeductions: '20000',
  totalNet: '80000',
  employeeCount: 4,
  createdAt: '2026-10-18T02:00:00.000Z',
  payrollPeriod: {
    name: 'October 2026',
    payDate: null,
    startDate: '2026-10-01T00:00:00.000Z',
    endDate: '2026-10-31T00:00:00.000Z',
  },
  ...over,
});

// The exact four runs the seeded console shows on /hr/payroll (v2.98.0 QA):
// same period, four types, four different lifecycle stages.
const OCTOBER_SEED: RunGroupSource[] = [
  run({ id: 'r-bonus', runType: 'BONUS', status: 'PENDING_APPROVAL', createdAt: '2026-10-18T01:46:00.000Z' }),
  run({ id: 'r-offcycle', runType: 'OFF_CYCLE', status: 'POSTED', createdAt: '2026-10-17T10:00:00.000Z' }),
  run({ id: 'r-supp', runType: 'SUPPLEMENTARY', status: 'POSTED', createdAt: '2026-10-16T10:00:00.000Z' }),
  run({ id: 'r-regular', runType: 'REGULAR', status: 'LOCKED', totalGross: '0', totalDeductions: '0', totalNet: '0', employeeCount: 4, createdAt: '2026-10-15T10:00:00.000Z' }),
];

describe('groupRunsByPeriod', () => {
  it('returns nothing for no runs', () => {
    expect(groupRunsByPeriod([])).toEqual([]);
  });

  it('folds the seeded October 2026 console into ONE period with honest arithmetic', () => {
    const group = oneGroup(OCTOBER_SEED);
    expect(group.periodName).toBe('October 2026');
    expect(group.runCount).toBe(4);
    // Only POSTED (2) + LOCKED (1) are settled; the BONUS waits.
    expect(group.settledCount).toBe(3);
    expect(group.inMotionCount).toBe(1);
    expect(group.attentionCount).toBe(0);
    expect(group.voidedCount).toBe(0);
    // The waiting run's money NEVER mixes into the settled total —
    // settledNet is exactly the two POSTED runs' 80,000 each. The locked
    // run is real too, but it was prepared at zero (its own row says so).
    expect(group.settledNet).toBe(160000);
    expect(group.settledGross).toBe(200000);
    expect(group.settledDeductions).toBe(40000);
    // Payslips issued: 4 + 4 settled; the pending 4 are promises, not payslips.
    expect(group.settledPayslips).toBe(12);
  });

  it('keeps the API order inside the period (stable — newest first preserved)', () => {
    const group = oneGroup(OCTOBER_SEED);
    expect(group.runs.map((r) => r.id)).toEqual(['r-bonus', 'r-offcycle', 'r-supp', 'r-regular']);
  });

  it('orders periods by their LATEST run, newest month first', () => {
    const groups = groupRunsByPeriod([
      run({ id: 'old', payrollPeriod: { ...OCTOBER_SEED[0].payrollPeriod, name: 'September 2026' }, createdAt: '2026-09-30T10:00:00.000Z' }),
      ...OCTOBER_SEED,
    ]);
    expect(groups.map((g) => g.periodName)).toEqual(['October 2026', 'September 2026']);
  });

  it('counts REJECTED and FAILED as attention so a period cannot read as done', () => {
    const group = oneGroup([
      run({ id: 'rej', status: 'REJECTED' }),
      run({ id: 'fail', status: 'FAILED', createdAt: '2026-10-18T03:00:00.000Z' }),
    ]);
    expect(group.attentionCount).toBe(2);
    expect(group.settledCount).toBe(0);
    expect(group.settledNet).toBe(0);
  });

  it('counts VOIDED toward runCount and nothing else', () => {
    const group = oneGroup([
      run({ id: 'void', status: 'VOIDED' }),
      run({ id: 'posted', status: 'POSTED', createdAt: '2026-10-18T04:00:00.000Z' }),
    ]);
    expect(group.runCount).toBe(2);
    expect(group.voidedCount).toBe(1);
    expect(group.inMotionCount).toBe(0);
    expect(group.attentionCount).toBe(0);
    // Only the POSTED run's money and payslips.
    expect(group.settledNet).toBe(80000);
    expect(group.settledPayslips).toBe(4);
  });

  it('never invents a category for an unknown status (row and count survive)', () => {
    const group = oneGroup([run({ id: 'odd', status: 'SOMETHING_NEW' })]);
    expect(group.runCount).toBe(1);
    expect(group.settledCount).toBe(0);
    expect(group.inMotionCount).toBe(0);
    expect(group.attentionCount).toBe(0);
    expect(group.voidedCount).toBe(0);
    expect(group.settledNet).toBe(0);
    expect(group.runs).toHaveLength(1);
  });

  it('carries the period head (payDate, start, end) from the runs it folded', () => {
    const group = oneGroup(OCTOBER_SEED);
    expect(group.payDate).toBe(null);
    expect(group.startDate).toBe('2026-10-01T00:00:00.000Z');
    expect(group.endDate).toBe('2026-10-31T00:00:00.000Z');
  });

  it('sums money as numbers, not string concatenation', () => {
    const group = oneGroup([
      run({ id: 'a', status: 'POSTED', totalNet: '1500.50', totalGross: '2000', totalDeductions: '499.50' }),
      run({ id: 'b', status: 'POSTED', totalNet: '250.25', totalGross: '400', totalDeductions: '149.75', createdAt: '2026-10-18T05:00:00.000Z' }),
    ]);
    expect(group.settledNet).toBeCloseTo(1750.75, 2);
    expect(group.settledGross).toBe(2400);
    expect(group.settledDeductions).toBeCloseTo(649.25, 2);
  });
});
