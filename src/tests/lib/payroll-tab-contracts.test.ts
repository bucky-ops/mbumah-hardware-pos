// MBUMAH HARDWARE POS - payroll tab API-contract guard (v2.30.0)
//
// REGRESSION GUARD for the v2.29.x QA-caught Payroll-tab crash: the Leave
// and Attendance sub-tabs rendered `l.employee.firstName` / `r.employee.*`,
// but GET /api/leaves and GET /api/attendance return FLAT DTOs
// (employeeName / employeeJobTitle / leaveTypeName at the top level — no
// nested `employee` or `leaveType` object). The very first leave request in
// the store crashed the whole Payroll tab into its error boundary
// ("Unable to load Payroll"), and the attendance table would have crashed
// the same way on the first record.
//
// A second latent bug in the same tab: the approve/reject buttons sent
// lowercase action values ('approve' / 'reject') while PUT /api/leaves
// requires UPPERCASE ('APPROVE' | 'REJECT') — every decision click would
// have 400'd.
//
// These tests statically pin the tab to the flat DTO field names and the
// uppercase action values, plus unit coverage for the presentation helpers
// extracted into the pure module src/lib/leave-tab.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leaveTypeStyle, balanceTone, balanceUtilization, initialsOf } from '@/lib/leave-tab';

const TAB_SRC = readFileSync(
  join(process.cwd(), 'src/app/(shell)/tabs/payroll-tab.tsx'),
  'utf8',
);

describe('payroll tab reads the flat /api/leaves + /api/attendance DTOs', () => {
  it('never reads a nested l.employee / r.employee object (the v2.29.x crash)', () => {
    // The API never returns a nested `employee` — any `x.employee.` read is
    // undefined-property access waiting for the first row of data.
    expect(TAB_SRC).not.toMatch(/\b[lr]\.employee\./);
  });

  it('never reads a nested l.leaveType object', () => {
    expect(TAB_SRC).not.toMatch(/\b[lr]\.leaveType\./);
  });

  it('never reads the old `l.days` field (the API returns workingDays)', () => {
    expect(TAB_SRC).not.toMatch(/\b[lr]\.days\b/);
  });

  it('renders the flat fields the API actually returns', () => {
    for (const field of ['employeeName', 'employeeJobTitle', 'leaveTypeName', 'leaveTypeCode', 'workingDays', 'rejectionReason']) {
      expect(TAB_SRC).toContain(`l.${field}`);
    }
    for (const field of ['employeeName', 'employeeJobTitle']) {
      expect(TAB_SRC).toContain(`r.${field}`);
    }
  });

  it('sends UPPERCASE actions to PUT /api/leaves (lowercase 400s)', () => {
    expect(TAB_SRC).toContain("action: 'APPROVE'");
    expect(TAB_SRC).toContain("action: 'REJECT'");
    expect(TAB_SRC).not.toMatch(/action:\s*'(approve|reject)'/);
  });

  it('reads the balances side-payload via apiFetchEnvelope (apiFetch drops it)', () => {
    expect(TAB_SRC).toContain('apiFetchEnvelope');
    expect(TAB_SRC).toMatch(/leavesEnvelope\?\.balances/);
  });

  it('never calls .toFixed() directly on DTO numeric fields (Decimals arrive as STRINGS)', () => {
    // GET /api/attendance serializes Decimal columns through Response.json,
    // where decimal.js toJSON emits a STRING — `.toFixed()` on it throws
    // (the second QA-caught Payroll-tab crash this round). Every numeric
    // read must go through the tab's toNum() guard.
    expect(TAB_SRC).not.toMatch(/r\.workingHours\?\.|r\.workingHours\.toFixed|r\.overtimeHours\?\.|r\.overtimeHours\.toFixed/);
    expect(TAB_SRC).not.toMatch(/l\.workingDays\.toFixed/);
    expect(TAB_SRC).toMatch(/toNum\(r\.workingHours\)/);
  });

  it('still imports the presentation helpers from the pure leave-tab module', () => {
    expect(TAB_SRC).toContain("from '@/lib/leave-tab'");
  });
});

describe('leaveTypeStyle', () => {
  it('gives each known code its own color family', () => {
    const styles = ['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'COMPASSIONATE'].map(leaveTypeStyle);
    expect(new Set(styles).size).toBe(5);
  });

  it('falls back to a neutral badge for unknown codes', () => {
    const fallback = leaveTypeStyle('SABBATICAL');
    expect(fallback).toContain('border-border');
    expect(leaveTypeStyle('ANNUAL')).not.toEqual(fallback);
  });
});

describe('balanceUtilization', () => {
  it('computes used / (allocated + carryForward)', () => {
    expect(balanceUtilization(5, 21, 0)).toBeCloseTo(5 / 21);
    expect(balanceUtilization(10, 10, 5)).toBeCloseTo(10 / 15);
  });

  it('clamps to 0..1 and treats zero capacity as 0 (no NaN bars)', () => {
    expect(balanceUtilization(0, 0, 0)).toBe(0);
    expect(balanceUtilization(30, 21, 0)).toBe(1);
    expect(balanceUtilization(-4, 21, 0)).toBe(0);
    expect(Number.isNaN(balanceUtilization(5, 0, 0))).toBe(false);
  });
});

describe('balanceTone', () => {
  it('buckets <50% comfortable, 50-79% watch, >=80% critical', () => {
    expect(balanceTone(5, 21, 0).bar).toContain('emerald');
    expect(balanceTone(11, 21, 0).bar).toContain('amber');
    expect(balanceTone(17, 21, 0).bar).toContain('rose');
  });

  it('never throws on missing data', () => {
    expect(() => balanceTone(NaN, 0, 0)).not.toThrow();
    expect(balanceTone(NaN, 0, 0).bar).toContain('emerald');
  });
});

describe('initialsOf', () => {
  it('takes first + last name initials, uppercased', () => {
    expect(initialsOf('David Otieno')).toBe('DO');
    expect(initialsOf('grace achieng')).toBe('GA');
  });

  it('handles single names, extra spaces, and empty input', () => {
    expect(initialsOf('Cher')).toBe('CH');
    expect(initialsOf('  John   Mwangi  ')).toBe('JM');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(undefined as unknown as string)).toBe('?');
  });
});
