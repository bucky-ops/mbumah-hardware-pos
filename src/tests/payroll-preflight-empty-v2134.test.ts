import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyPeriodRows, groupRunsByPeriod, type EmptyPeriodSource } from '@/lib/hr/payroll/run-groups';

/**
 * v2.134.0 — the gate opens onto empty months.
 *
 * Gap: the v2.133.0 pre-flight gate door rode the runs table's period
 * headers, and the runs table only renders periods that HAVE runs. A
 * freshly opened month — zero runs, exactly when the front door matters
 * most — rendered nowhere, so nobody could ask the gate who it would
 * block before the FIRST run of the month was prepared.
 *
 * Covered here:
 *  1. The pure builder `emptyPeriodRows`: name-keyed filtering against the
 *     run groups (the grouping's own house rule), real period ids on every
 *     row (the gate is period-keyed; a run-less period has no run to borrow
 *     an id from), newest-month-first ordering with a deterministic
 *     tie-break, wide-in/unnarrowed typing, VOIDED periods stay (the gate
 *     speaks to them honestly), missing status degrades to ''.
 *  2. The page contract: the pre-flight section renders ONLY when a run-less
 *     period exists, each row carries the SAME gate door the header rail
 *     carries (same aria family, same loader, same panel), the gate panel
 *     rides the row by the period's real id, and the honesty copy states
 *     what the door does and does not do.
 *  3. The styling contract (house discipline): dark twins on every colored
 *     surface, tabular numerals on the stamps, the mono status chip, hover
 *     and focus-within affordances, and the honest "pay date not set"
 *     fallback instead of a fabricated date.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const period = (over: Partial<EmptyPeriodSource>): EmptyPeriodSource => ({
  id: over.id ?? 'per-1',
  name: over.name ?? 'October 2026',
  startDate: over.startDate ?? '2026-10-01T00:00:00.000Z',
  endDate: over.endDate ?? '2026-10-31T23:59:59.999Z',
  payDate: over.payDate ?? null,
  status: over.status,
});

describe('emptyPeriodRows - the periods the runs table will never render', () => {
  it('keeps only periods whose name appears in NO run group (name-keyed, the grouping rule)', () => {
    const periods = [
      period({ id: 'per-sep', name: 'September 2026' }),
      period({ id: 'per-oct', name: 'October 2026' }),
    ];
    const groups = [{ periodName: 'September 2026' }];
    const rows = emptyPeriodRows(periods, groups);
    expect(rows).toHaveLength(1);
    expect(rows[0].periodName).toBe('October 2026');
    expect(rows[0].periodId).toBe('per-oct');
  });

  it('carries the REAL period id — a run-less period has no run to borrow one from', () => {
    const rows = emptyPeriodRows([period({ id: 'per-real', name: 'October 2026' })], []);
    expect(rows[0].periodId).toBe('per-real');
  });

  it('passes the lifecycle status through verbatim — VOIDED stays, missing degrades to empty', () => {
    const rows = emptyPeriodRows(
      [period({ id: 'per-a', name: 'A', status: 'VOIDED' }), period({ id: 'per-b', name: 'B' })],
      [],
    );
    expect(rows.find((r) => r.periodId === 'per-a')?.status).toBe('VOIDED');
    expect(rows.find((r) => r.periodId === 'per-b')?.status).toBe('');
  });

  it('orders newest month first (startDate desc) with a name-ascending tie-break', () => {
    const rows = emptyPeriodRows(
      [
        period({ id: 'p1', name: 'March 2026', startDate: '2026-03-01T00:00:00.000Z' }),
        period({ id: 'p2', name: 'November 2026', startDate: '2026-11-01T00:00:00.000Z' }),
        period({ id: 'p3', name: 'Alpha 2026', startDate: '2026-11-01T00:00:00.000Z' }),
      ],
      [],
    );
    expect(rows.map((r) => r.periodName)).toEqual(['Alpha 2026', 'November 2026', 'March 2026']);
  });

  it('is honest about both empties: no periods → no rows; fully-run months → no rows', () => {
    expect(emptyPeriodRows([], [])).toEqual([]);
    const periods = [period({ id: 'p1', name: 'September 2026' })];
    const groups = groupRunsByPeriod([
      {
        id: 'run-1',
        runType: 'STANDARD',
        status: 'POSTED',
        totalGross: '100',
        totalDeductions: '10',
        totalNet: '90',
        employeeCount: 2,
        createdAt: '2026-10-05T09:00:00.000Z',
        payrollPeriod: { name: 'September 2026', payDate: null, startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-30T23:59:59.999Z' },
      },
    ]);
    expect(emptyPeriodRows(periods, groups)).toEqual([]);
  });

  it('maps only the row fields — a wide DTO (periodType etc.) flows through unnarrowed', () => {
    const wide = {
      ...period({ id: 'per-wide', name: 'October 2026', status: 'OPEN' }),
      periodType: 'MONTHLY',
      someFutureField: 'ignored',
    } as EmptyPeriodSource & { periodType: string; someFutureField: string };
    const rows = emptyPeriodRows([wide], []);
    expect(rows[0]).toEqual({
      periodId: 'per-wide',
      periodName: 'October 2026',
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-31T23:59:59.999Z',
      payDate: null,
      status: 'OPEN',
    });
  });
});

describe('the pre-flight section - the front door unlocks from the outside', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('renders only when a run-less period exists', () => {
    expect(PAGE.includes('{emptyPeriods.length > 0 && (')).toBe(true);
    expect(PAGE.includes('const emptyPeriods = useMemo(() => emptyPeriodRows(periods ?? [], periodGroups)')).toBe(true);
  });

  it('each row opens the SAME gate door the header rail carries (same aria family, same loader)', () => {
    // Same aria family as the header door ("Check the <period> run gate"),
    // keyed by the pre-flight row.
    expect(PAGE).toContain('aria-label={`Check the ${row.periodName} run gate`}');
    // The real id rides the click — never the runs[0] borrow trick.
    expect(PAGE.includes('onClick={() => toggleGate(row.periodId, row.periodName)}')).toBe(true);
    expect(PAGE).toContain('data-testid="payroll-preflight-gate"');
    // The shared loader + shared panel: one gate, two doors.
    expect(PAGE).toContain('<GatePanel');
    expect(PAGE.includes("gatePanel?.periodId === row.periodId")).toBe(true);
  });

  it('the honesty copy states what the door does and does not do', () => {
    expect(PAGE).toContain('Periods with no runs yet');
    expect(PAGE).toContain('no run is created');
  });

  it('the section family carries stable testids', () => {
    expect(PAGE).toContain('data-testid="payroll-preflight-section"');
    expect(PAGE).toContain('data-testid="payroll-preflight-list"');
    expect(PAGE).toContain('data-testid={`payroll-preflight-row-${row.periodId}`}');
    expect(PAGE).toContain('data-testid="payroll-preflight-gate-panel"');
    expect(PAGE).toContain('data-testid={`payroll-preflight-status-${row.periodId}`}');
  });

  it('the status chip speaks the period lifecycle word; an unknown word renders UNKNOWN, never a guess', () => {
    expect(PAGE).toContain("{row.status ? row.status.toUpperCase() : 'UNKNOWN'}");
    expect(PAGE).toContain("case 'OPEN':");
    expect(PAGE).toContain("case 'VOIDED':");
    expect(PAGE).toContain('return \'border-border bg-muted text-muted-foreground\';');
  });

  it('the honest pay-date fallback — a missing pay date says so, never a fabricated stamp', () => {
    expect(PAGE).toContain("' · pay date not set'");
  });
});

describe('the styling contract - house discipline on the pre-flight rows', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('dark twins ride every colored surface (door title icon, OPEN chip, VOIDED chip)', () => {
    expect(PAGE).toContain('text-violet-600 dark:text-violet-400');
    expect(PAGE).toContain('border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300');
    expect(PAGE).toContain('border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300');
  });

  it('the stamps are tabular; rows hover and focus like the rest of the desk', () => {
    expect(PAGE).toContain('text-xs tabular-nums text-muted-foreground');
    expect(PAGE).toContain('transition-colors hover:bg-muted/40 focus-within:bg-muted/40');
  });

  it('the door button matches the header rail affordance (round ghost, ring on hover, mono chip letterform)', () => {
    expect(PAGE).toContain('h-8 gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground hover:ring-1 hover:ring-border focus-visible:ring-1 focus-visible:ring-ring');
    expect(PAGE).toContain('font-mono text-[10px] font-medium uppercase tracking-wide');
  });

  it('the gate panel inset carries its own keyed testid wrapper distinct from the table panel', () => {
    // The runs-table panel row keeps its own testid; the pre-flight inset
    // must not collide with it.
    expect(PAGE).toContain('data-testid="payroll-gate-panel-row"');
    expect(PAGE).toContain('data-testid="payroll-preflight-gate-panel"');
  });
});
