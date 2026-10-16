// MBUMAH HARDWARE POS - payslip year bucketing tests (v2.29.0)
//
// Covers listMyPayslipYears: the distinct-year helper that drives the SSR
// year switcher on /employees/me/payslips. The bucket MUST use
// getUTCFullYear (payroll periods are stored UTC-midnight and the list
// endpoint filters with Date.UTC bounds — a local-year bucket would put
// 2027-01-01 periods into the wrong tab for viewers west of UTC).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  payrollDetail: { findMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));

import { listMyPayslipYears } from '@/lib/hr/self-service';

const EMPLOYEE = { id: 'emp-1' } as Parameters<typeof listMyPayslipYears>[0];

function detailRow(periodStartUtc: Date) {
  return { payrollRun: { payrollPeriod: { startDate: periodStartUtc } } };
}

describe('listMyPayslipYears', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns distinct years newest first from the 60-row window', async () => {
    db.payrollDetail.findMany.mockResolvedValue([
      detailRow(new Date('2026-10-01T00:00:00Z')),
      detailRow(new Date('2026-09-01T00:00:00Z')),
      detailRow(new Date('2025-12-01T00:00:00Z')),
      detailRow(new Date('2025-11-01T00:00:00Z')),
      detailRow(new Date('2024-06-01T00:00:00Z')),
    ]);

    await expect(listMyPayslipYears(EMPLOYEE)).resolves.toEqual([2026, 2025, 2024]);
    // Same 60-row window the list endpoint reads.
    expect(db.payrollDetail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 60, where: { employeeId: 'emp-1' } }),
    );
  });

  it('buckets by UTC year, not viewer-local year', async () => {
    db.payrollDetail.findMany.mockResolvedValue([
      detailRow(new Date('2027-01-01T00:00:00Z')),
    ]);
    await expect(listMyPayslipYears(EMPLOYEE)).resolves.toEqual([2027]);
  });

  it('returns an empty list when the employee has no payslips', async () => {
    db.payrollDetail.findMany.mockResolvedValue([]);
    await expect(listMyPayslipYears(EMPLOYEE)).resolves.toEqual([]);
  });
});
