import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildTimesheetDeskCsv,
  escapeDeskCsvCell,
  type TimesheetDeskCsvRow,
} from '@/lib/hr/timesheet-desk-csv';
import {
  bucketPendingDays,
  gatePreviewChips,
  gatePreviewLine,
  type GatePreview,
} from '@/lib/hr/payroll/gate-preview';

/**
 * v2.137.0 — the picker sees the gate; the pending list prints itself.
 *
 * Gap: the "Start a payroll run" dialog listed periods blind — the gate's
 * pre-flight lived on the desk, but the prepare intent itself (the dialog)
 * showed nothing until AFTER the run existed and someone clicked the gate
 * door. And the timesheet desk's pending list had no export door, while its
 * ledger siblings (case list v2.115.0, access ledger v2.118.0) both print.
 *
 * Covered here:
 *  1. The desk CSV serializer — the RFC 4180 family's newest member: exact
 *     header, CRLF, quote-on-need, and the honesty pin (no pay column can
 *     ever exist — the row TYPE has no field for it).
 *  2. The gate preview math — pending days bucketed per period (overlaps
 *     count in both — each period's gate checks its own range), garbage
 *     never buckets, chips in prepare's loop order (consent first), honest
 *     silence when clear, honest "unavailable" when null.
 *  3. The periods API — additive gatePreview with the gate's own where,
 *     one fetch + in-memory bucketing (never one query per period), null
 *     degrade on failure (the list never dies).
 *  4. The picker — chips in the items (they carry into the trigger), the
 *     preview line under the picker, the amber door to the desk when days
 *     are pending.
 *  5. The desk export button — exports the rows AS SHOWN, disabled when
 *     empty, aria says "never pay data".
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. The desk CSV serializer ───────────────────────────────────────────────

const row = (overrides: Partial<TimesheetDeskCsvRow> = {}): TimesheetDeskCsvRow => ({
  employeeCode: 'MBH-1-001',
  employeeName: 'John Mwangi',
  pendingDays: 2,
  firstDay: '2026-10-16',
  lastDay: '2026-10-17',
  pendingDates: ['2026-10-16', '2026-10-17'],
  ...overrides,
});

describe('buildTimesheetDeskCsv - the RFC 4180 family, newest member', () => {
  it('pins the honest column set (first line, exactly)', () => {
    const csv = buildTimesheetDeskCsv([row()]);
    expect(csv.split('\r\n')[0]).toBe('employee_code,employee_name,pending_days,first_day,last_day,pending_dates');
  });

  it('one line per employee, pending_dates joined with ";" inside one cell, CRLF endings, trailing newline', () => {
    const csv = buildTimesheetDeskCsv([row(), row({ employeeCode: 'MBH-1-002', employeeName: 'Grace Achieng', pendingDays: 1, firstDay: '2026-10-19', lastDay: '2026-10-19', pendingDates: ['2026-10-19'] })]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(4); // header + 2 rows + trailing ''
    expect(lines[1]).toBe('MBH-1-001,John Mwangi,2,2026-10-16,2026-10-17,2026-10-16;2026-10-17');
    expect(lines[2]).toBe('MBH-1-002,Grace Achieng,1,2026-10-19,2026-10-19,2026-10-19');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('quotes only when needed, doubles embedded quotes, CRLF inside a cell forces quoting', () => {
    expect(escapeDeskCsvCell('plain')).toBe('plain');
    expect(escapeDeskCsvCell('Ada, One')).toBe('"Ada, One"');
    expect(escapeDeskCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeDeskCsvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeDeskCsvCell(null)).toBe('');
    expect(escapeDeskCsvCell(undefined)).toBe('');
    expect(escapeDeskCsvCell(3)).toBe('3');
  });

  it('empty input is the header alone (an honest empty export)', () => {
    expect(buildTimesheetDeskCsv([])).toBe('employee_code,employee_name,pending_days,first_day,last_day,pending_dates\r\n');
  });

  it('the serializer never sorts — what the desk shows is what prints', () => {
    const csv = buildTimesheetDeskCsv([row({ employeeCode: 'Z-9' }), row({ employeeCode: 'A-1' })]);
    expect(csv.indexOf('Z-9')).toBeLessThan(csv.indexOf('A-1'));
  });
});

// ── 2. The gate preview math ─────────────────────────────────────────────────

describe('bucketPendingDays - one fetch, bucketed in memory', () => {
  const periods = [
    { id: 'oct', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-31T00:00:00.000Z' },
    { id: 'sep', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-30T00:00:00.000Z' },
  ];

  it('buckets days into their own period; a day outside every period is ignored', () => {
    const buckets = bucketPendingDays(
      ['2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z', '2026-08-02T00:00:00.000Z'],
      periods,
    );
    expect(buckets).toEqual({ oct: 2, sep: 0 });
  });

  it('overlapping periods both count the day (each gate checks its own range)', () => {
    const buckets = bucketPendingDays(
      ['2026-10-05T00:00:00.000Z'],
      [...periods, { id: 'overlap', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-10T00:00:00.000Z' }],
    );
    expect(buckets.oct).toBe(1);
    expect(buckets.overlap).toBe(1);
    expect(buckets.sep).toBe(0);
  });

  it('garbage dates never bucket; garbage periods never speak', () => {
    const buckets = bucketPendingDays(
      ['garbage', '2026-10-16T00:00:00.000Z'],
      [...periods, { id: 'bad', startDate: 'nope', endDate: '2026-10-31T00:00:00.000Z' }],
    );
    expect(buckets.oct).toBe(1);
    expect(buckets.bad).toBeUndefined();
  });

  it('accepts plain YYYY-MM-DD strings too (the pure layer stays caller-friendly)', () => {
    const buckets = bucketPendingDays(['2026-09-15'], periods);
    expect(buckets.sep).toBe(1);
  });
});

describe('gatePreviewChips / gatePreviewLine - the gate words, compactly', () => {
  const blocking: GatePreview = { unapprovedDays: 3, missingConsent: 1, checkedAt: '2026-10-19T10:00:00.000Z' };

  it("chips speak in prepare's loop order (consent first, then timesheets)", () => {
    const chips = gatePreviewChips(blocking);
    expect(chips.map((c) => c.tone)).toEqual(['rose', 'amber']);
    expect(chips.map((c) => c.label)).toEqual(['1 missing consent', '3 unapproved days']);
  });

  it('plural honesty: 1 day vs 2 days', () => {
    expect(gatePreviewChips({ ...blocking, unapprovedDays: 1 })[1].label).toBe('1 unapproved day');
    expect(gatePreviewChips({ ...blocking, unapprovedDays: 2 })[1].label).toBe('2 unapproved days');
  });

  it('silence means clear (never a guessed chip), null speaks nothing', () => {
    expect(gatePreviewChips({ unapprovedDays: 0, missingConsent: 0, checkedAt: blocking.checkedAt })).toEqual([]);
    expect(gatePreviewChips(null)).toEqual([]);
    expect(gatePreviewChips(undefined)).toEqual([]);
  });

  it('the preview line: unavailable when null, all-clear when clear, blocking names the consequence', () => {
    expect(gatePreviewLine(null)).toBe('Gate preview unavailable — the run gate still checks on prepare.');
    expect(gatePreviewLine({ unapprovedDays: 0, missingConsent: 0, checkedAt: blocking.checkedAt })).toBe(
      'Gate preview: nothing pending for this period.',
    );
    expect(gatePreviewLine(blocking)).toBe('Gate preview: 1 missing consent · 3 unapproved days — prepare would block until cleared.');
    expect(gatePreviewLine({ ...blocking, unapprovedDays: 1 })).toBe(
      'Gate preview: 1 missing consent · 1 unapproved day — prepare would block until cleared.',
    );
  });
});

// ── 3. The periods API (additive preview) ────────────────────────────────────

describe('periods route - the preview rides additively, gate parity', () => {
  const ROUTE = readRepo('src/app/api/payroll/periods/route.ts');

  it('the SAME unapproved + employee where as the gate (parity pin)', () => {
    expect(ROUTE).toContain('checkIn: { not: null }');
    expect(ROUTE).toContain('timesheetApprovedByUserId: null');
    expect(ROUTE).toContain("employee: { storeId, deletedAt: null, status: 'ACTIVE' }");
  });

  it('consent is one period-independent count (none: { withdrawnAt: null })', () => {
    expect(ROUTE).toContain('consentRecords: { none: { withdrawnAt: null } }');
  });

  it('bucketed in memory, never one query per period', () => {
    expect(ROUTE).toContain('bucketPendingDays');
    expect(ROUTE).not.toMatch(/for \(const p(eriod)? of periods\) \{[\s\S]*?attendanceRecord\.count/);
  });

  it('a preview failure degrades to null — the periods list never dies', () => {
    expect(ROUTE).toContain('gatePreview ? gatePreview[i] : null');
    expect(ROUTE).toMatch(/} catch \{\s*\n\s*gatePreview = null;\s*\n\s*\}/);
  });
});

// ── 4. The picker ────────────────────────────────────────────────────────────

describe('CreateRunDialog - pre-flight inside the prepare intent', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('the picker items wear gate chips (which carry into the trigger)', () => {
    expect(PAGE).toContain('gatePreviewChips(p.gatePreview)');
    expect(PAGE).toContain('data-testid="payroll-picker-gate-chip"');
    expect(PAGE).toContain('font-mono text-[10px] font-medium tabular-nums');
  });

  it('the preview line under the picker speaks both tones honestly', () => {
    expect(PAGE).toContain('gatePreviewLine(selected?.gatePreview)');
    expect(PAGE).toContain('data-testid="payroll-picker-gate-line"');
  });

  it('the amber door to the desk appears only when days are pending', () => {
    expect(PAGE).toContain('const door = (selected?.gatePreview?.unapprovedDays ?? 0) > 0;');
    expect(PAGE).toContain('data-testid="payroll-picker-timesheet-door"');
    expect(PAGE).toContain('href="/hr/timesheets"');
    expect(PAGE).toContain('rel="noopener noreferrer"');
  });

  it('both chip families carry dark twins', () => {
    expect(PAGE).toContain('dark:bg-rose-950/50 dark:text-rose-300');
    expect(PAGE).toContain('dark:bg-amber-950/50 dark:text-amber-300');
    expect(PAGE).toContain('dark:hover:ring-amber-800');
  });

  it('the DTO carries the preview additively (optional, null-safe)', () => {
    expect(PAGE).toContain('gatePreview?: GatePreview | null;');
  });
});

// ── 5. The desk export door ──────────────────────────────────────────────────

describe('timesheet desk - the pending list prints itself', () => {
  const DESK = readRepo('src/app/(shell)/hr/timesheets/page.tsx');

  it('exports the rows AS SHOWN through the pure serializer', () => {
    expect(DESK).toContain('buildTimesheetDeskCsv');
    expect(DESK).toContain('pendingDates: row.days');
    expect(DESK).toContain('timesheet-pending-');
  });

  it('the button is disabled when nothing is pending, aria says "never pay data"', () => {
    expect(DESK).toContain('data-testid="hr-timesheet-csv"');
    expect(DESK).toContain('disabled={!payload || loading || payload.rows.length === 0}');
    expect(DESK).toContain('never pay data');
  });
});
