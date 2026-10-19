import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  groupUnapprovedByEmployee,
  deskDateOnly,
  deskDayLabel,
  deskDayStrip,
  deskRangeLabel,
  type AttendanceDeskInput,
} from '@/lib/hr/attendance-desk';

/**
 * v2.136.0 — the second door finds its desk (/hr/timesheets).
 *
 * Gap: the run gate's TIMESHEET_NOT_APPROVED block had NO UI desk — the
 * approve route (/api/attendance/timesheets/approve) was API-only, so a
 * manager staring at an amber block had nowhere to go. The consent block
 * got its door in v2.135.0; the timesheet block kept honest text and no
 * fix. v2.136.0 ships the desk: a pending read that mirrors the gate's
 * own where/order (parity by construction), a per-employee approve that
 * rides the ONE approveTimesheet service, a day strip that shows the
 * exact pending days in UTC, and the gate row's own amber door.
 *
 * Covered here:
 *  1. Pure grouping — the gate's order (employeeCode asc), day sort +
 *     dedupe, UTC date-only semantics, garbage degrades never guesses.
 *  2. Day strip + labels — 'Mon 19' UTC-correct, overflow honest (+N),
 *     garbage days counted but unlabeled.
 *  3. The pending read route — the gate's read-right quartet, the gate's
 *     unapproved where, the ACTIVE-employee scope, honest 404.
 *  4. The desk page — approve posts the employee's range, focus-param
 *     deep link (lazy init + replaceState strip), honest empty/error
 *     strips, dark twins, tabular numerals.
 *  5. The gate door — the TIMESHEET row carries its amber door, same
 *     shape as the consent door, deep-linking ?employee=<id>.
 *  6. Navigation — the desk is reachable: Timesheets joins the HR nav.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. The pure grouping ─────────────────────────────────────────────────────

const input = (overrides: Partial<AttendanceDeskInput> & { employeeId: string }): AttendanceDeskInput => ({
  employeeCode: 'MBH-1-001',
  firstName: 'Ada',
  lastName: 'One',
  date: '2026-10-05T00:00:00.000Z',
  ...overrides,
});

describe('groupUnapprovedByEmployee - the gate order, the gate honesty', () => {
  it('groups rows per employee and sorts by employeeCode ascending (the gate orderBy)', () => {
    const rows = groupUnapprovedByEmployee([
      input({ employeeId: 'e1', employeeCode: 'MBH-1-002', firstName: 'Bram', lastName: 'Two' }),
      input({ employeeId: 'e2', employeeCode: 'MBH-1-001', firstName: 'Ada', lastName: 'One' }),
      input({ employeeId: 'e1', employeeCode: 'MBH-1-002', firstName: 'Bram', lastName: 'Two', date: '2026-10-06T00:00:00.000Z' }),
    ]);
    expect(rows.map((r) => r.employeeCode)).toEqual(['MBH-1-001', 'MBH-1-002']);
    expect(rows[1].days).toEqual(['2026-10-05', '2026-10-06']);
    expect(rows[1].firstDay).toBe('2026-10-05');
    expect(rows[1].lastDay).toBe('2026-10-06');
  });

  it('reduces Date objects to UTC date-only and dedupes days', () => {
    const rows = groupUnapprovedByEmployee([
      input({ employeeId: 'e1', date: new Date('2026-10-05T00:00:00.000Z') }),
      input({ employeeId: 'e1', date: '2026-10-05T13:45:00.000Z' }),
      input({ employeeId: 'e1', date: '2026-10-04T00:00:00.000Z' }),
    ]);
    expect(rows[0].days).toEqual(['2026-10-04', '2026-10-05']);
  });

  it('garbage dates never invent a day; a row with only garbage speaks honestly empty', () => {
    expect(deskDateOnly('not-a-date')).toBeNull();
    expect(deskDateOnly(new Date('nope'))).toBeNull();
    const rows = groupUnapprovedByEmployee([
      input({ employeeId: 'e1', date: 'garbage' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].days).toEqual([]);
    expect(rows[0].firstDay).toBe('');
    expect(rows[0].lastDay).toBe('');
  });

  it('missing code wears the em-dash, name trims (the gate fallbacks)', () => {
    const rows = groupUnapprovedByEmployee([
      input({ employeeId: 'e1', employeeCode: null, firstName: '  Ada  ', lastName: '' }),
    ]);
    expect(rows[0].employeeCode).toBe('—');
    expect(rows[0].employeeName).toBe('Ada');
  });

  it('empty input is an empty desk (never a null)', () => {
    expect(groupUnapprovedByEmployee([])).toEqual([]);
  });

  it('tie-break on name when codes collide', () => {
    const rows = groupUnapprovedByEmployee([
      input({ employeeId: 'e1', employeeCode: 'MBH-1-001', firstName: 'Zed', lastName: 'Last' }),
      input({ employeeId: 'e2', employeeCode: 'MBH-1-001', firstName: 'Ada', lastName: 'First' }),
    ]);
    expect(rows.map((r) => r.employeeName)).toEqual(['Ada First', 'Zed Last']);
  });
});

// ── 2. The day strip + labels (UTC, always UTC) ──────────────────────────────

describe('deskDayLabel / deskDayStrip - the exact days, never a drifted one', () => {
  it("labels 'Mon 19' — 2026-10-19 is a Monday, read through UTC parts", () => {
    expect(deskDayLabel('2026-10-19')).toBe('Mon 19');
    expect(deskDayLabel('2026-11-01')).toBe('Sun 01');
    expect(deskDayLabel('2026-10-32')).toBeNull();
    expect(deskDayLabel('garbage')).toBeNull();
  });

  it('shows the first max chips and counts the rest honestly (+N)', () => {
    const days = Array.from({ length: 15 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const strip = deskDayStrip(days, 12);
    expect(strip.shown).toHaveLength(12);
    expect(strip.shown[0]).toBe('Thu 01');
    expect(strip.hidden).toBe(3);
  });

  it('garbage days stay counted in the overflow but never render a chip', () => {
    const strip = deskDayStrip(['2026-10-05', 'garbage', '2026-10-06', 'nope'], 2);
    expect(strip.shown).toEqual(['Mon 05', 'Tue 06']);
    expect(strip.hidden).toBe(2);
  });
});

describe('deskRangeLabel - the scope line', () => {
  it('prints the year once when the range shares it, twice when it does not', () => {
    expect(deskRangeLabel('2026-10-01', '2026-10-31')).toBe('1 Oct – 31 Oct 2026');
    expect(deskRangeLabel('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan 2027');
    expect(deskRangeLabel('garbage', '2026-10-31')).toBe('');
  });
});

// ── 3. The pending read route (gate parity) ──────────────────────────────────

describe('pending route - the gate read parity, pinned', () => {
  const ROUTE = readRepo('src/app/api/attendance/timesheets/pending/route.ts');

  it('rides the runs list read-right quartet (seeing the desk is reading payroll)', () => {
    expect(ROUTE).toContain("hrGuard('hr.payroll.read.all'");
    expect(ROUTE).toContain("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']");
  });

  it('mirrors the gate unapproved where line for line', () => {
    expect(ROUTE).toContain('checkIn: { not: null }');
    expect(ROUTE).toContain('timesheetApprovedByUserId: null');
    expect(ROUTE).toContain("employee: { storeId: ctx.storeId, deletedAt: null, status: 'ACTIVE' }");
  });

  it('an unknown or cross-branch period is an honest 404 (the gate read mirror)', () => {
    expect(ROUTE).toContain("'PERIOD_NOT_FOUND'");
    expect(ROUTE).toContain('status: 404');
  });

  it('read-only by construction: no mutation rides this route', () => {
    expect(ROUTE).not.toContain('updateMany');
    expect(ROUTE).not.toContain('create(');
    expect(ROUTE).toContain('groupUnapprovedByEmployee');
  });
});

// ── 4. The desk page ─────────────────────────────────────────────────────────

describe('timesheet desk page - approve honestly, focus deeply', () => {
  const PAGE = readRepo('src/app/(shell)/hr/timesheets/page.tsx');

  it('approve posts the employee pending range to the ONE approve route', () => {
    expect(PAGE).toContain("fetch('/api/attendance/timesheets/approve'");
    expect(PAGE).toContain('employeeId: row.employeeId, from: row.firstDay, to: row.lastDay');
  });

  it('approve buttons disable while one is in flight (never double-stamp)', () => {
    expect(PAGE).toContain('disabled={approvingId !== null}');
  });

  it('the gate deep link focuses a row: lazy init, strip-on-mount, aria-current', () => {
    expect(PAGE).toContain("window.location.search).get('employee')");
    expect(PAGE).toContain("searchParams.delete('employee')");
    expect(PAGE).toContain('window.history.replaceState(null');
    expect(PAGE).toContain("aria-current={focused ? 'true' : undefined}");
  });

  it('honest states: clear strip, error strip + Retry, loading skeleton', () => {
    expect(PAGE).toContain('data-testid="hr-timesheet-clear"');
    expect(PAGE).toContain('data-testid="hr-timesheet-error"');
    expect(PAGE).toContain('data-testid="hr-timesheet-desk"');
    expect(PAGE).toContain('the desk stays dark rather than guess');
  });

  it('the scope picker exists and defaults sensibly', () => {
    expect(PAGE).toContain('data-testid="hr-timesheet-scope-picker"');
    expect(PAGE).toContain("useState<string>('__all__')");
  });

  it('styling: amber family chips, dark twins, tabular numerals, focus rings', () => {
    expect(PAGE).toContain('dark:bg-amber-950/50 dark:text-amber-300');
    expect(PAGE).toContain('tabular-nums');
    expect(PAGE).toContain('ring-inset ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-700');
    expect(PAGE).toContain('focus-visible:ring-2 focus-visible:ring-amber-400');
  });

  it('the overflow chip renders when the strip truncates', () => {
    expect(PAGE).toContain('data-testid="hr-timesheet-strip-overflow"');
    expect(PAGE).toContain('data-testid="hr-timesheet-count-chip"');
  });
});

// ── 5. The gate door ─────────────────────────────────────────────────────────

describe('gate panel - the timesheet row carries its own amber door', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('deep-links the blocked employee to the desk', () => {
    expect(PAGE).toContain('data-testid="payroll-gate-timesheet-door"');
    expect(PAGE).toContain('/hr/timesheets?employee=${encodeURIComponent(r.employeeId)}');
  });

  it('same door shape as the consent door: own tab, labelled, amber family', () => {
    expect(PAGE).toContain('aria-label={`Open the timesheet desk to approve days for ${r.employeeName}`}');
    expect(PAGE).toContain('rel="noopener noreferrer"');
    expect(PAGE).toContain('dark:hover:ring-amber-800');
  });

  it('the consent door survives unchanged (one gate, two doors, no third kind)', () => {
    expect(PAGE).toContain('data-testid="payroll-gate-consent-door"');
    expect(PAGE).toContain('href="/hr/reports?tab=privacy"');
  });
});

// ── 6. Navigation ────────────────────────────────────────────────────────────

describe('HR nav - the desk is reachable', () => {
  const LAYOUT = readRepo('src/app/(shell)/hr/layout.tsx');

  it('Timesheets joins the nav, right after Payroll (the door target adjacency)', () => {
    expect(LAYOUT).toContain("{ href: '/hr/payroll', label: 'Payroll' }");
    expect(LAYOUT).toContain("{ href: '/hr/timesheets', label: 'Timesheets' }");
    const payroll = LAYOUT.indexOf("href: '/hr/payroll'");
    const timesheets = LAYOUT.indexOf("href: '/hr/timesheets'");
    const performance = LAYOUT.indexOf("href: '/hr/performance'");
    expect(timesheets).toBeGreaterThan(payroll);
    expect(timesheets).toBeLessThan(performance);
  });
});
