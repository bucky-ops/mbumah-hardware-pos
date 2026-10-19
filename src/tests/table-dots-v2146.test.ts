import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deskDaySplit, deskSplitLabel } from '@/lib/hr/attendance-desk';

/**
 * v2.146.0 — the table wears the same dots.
 *
 * Gap: the picker's period dots (v2.144.0) and the desk's day-kind counts
 * lived on different pages than the questions they answer — the runs
 * table's collapsed header said nothing about what the gate last said, and
 * the desk's count chip hid the weekday/weekend shape the lenses imply.
 *
 * Covered here:
 *  1. deskDaySplit — the split composes deskWeekdayDays/deskWeekendDays
 *     themselves (ONE definition of each kind); garbage days count in
 *     NEITHER bucket; non-array reads zero.
 *  2. deskSplitLabel — both kinds join with ' · '; a lone kind speaks
 *     alone; zero/garbage speaks ''.
 *  3. The desk's split line contract: under the count chip, the lens
 *     trio's own dress code (amber weekday / sky weekend), the words in
 *     the aria-label, the total chip unchanged.
 *  4. The runs table's period outcome dots: the picker's own dot riding
 *     the group header — same classes (pinned), ONE lookup source (the
 *     SAME listTimelinePeriods memo the picker reads), aria-label word,
 *     honest absence.
 *  5. Docs: PAYROLL_LEDGER_ZERO_RUNS.md links the gate-contract section.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('deskDaySplit - the split composes the siblings (ONE definition)', () => {
  it('counts weekdays and weekends through the same two builders', () => {
    // Mon 12 + Tue 13 weekdays, Sat 17 + Sun 18 weekend — the split is the
    // two day-kind builders' own counts, never a second parser.
    expect(deskDaySplit(['2026-10-12', '2026-10-13', '2026-10-17', '2026-10-18'])).toEqual({
      weekday: 2,
      weekend: 2,
    });
  });

  it('an all-weekday row and an all-weekend row speak one bucket each', () => {
    expect(deskDaySplit(['2026-10-12', '2026-10-13', '2026-10-14'])).toEqual({
      weekday: 3,
      weekend: 0,
    });
    expect(deskDaySplit(['2026-10-17', '2026-10-18'])).toEqual({
      weekday: 0,
      weekend: 2,
    });
  });

  it('garbage days count in NEITHER bucket (honestly neither)', () => {
    expect(deskDaySplit(['2026-10-12', 'not-a-date', '2026-13-99', ''])).toEqual({
      weekday: 1,
      weekend: 0,
    });
    expect(deskDaySplit(['garbage', 'nonsense'])).toEqual({ weekday: 0, weekend: 0 });
  });

  it('non-array reads zero — never a guessed pair', () => {
    expect(deskDaySplit(undefined as unknown as string[])).toEqual({ weekday: 0, weekend: 0 });
    expect(deskDaySplit(null as unknown as string[])).toEqual({ weekday: 0, weekend: 0 });
    expect(deskDaySplit('2026-10-12' as unknown as string[])).toEqual({
      weekday: 0,
      weekend: 0,
    });
  });
});

describe('deskSplitLabel - the spoken form', () => {
  it('joins both kinds with the muted separator when both are present', () => {
    expect(deskSplitLabel({ weekday: 1, weekend: 1 })).toBe('1 weekday · 1 weekend');
    expect(deskSplitLabel({ weekday: 3, weekend: 2 })).toBe('3 weekdays · 2 weekends');
  });

  it('a lone kind speaks alone — a zero bucket adds noise, not honesty', () => {
    expect(deskSplitLabel({ weekday: 2, weekend: 0 })).toBe('2 weekdays');
    expect(deskSplitLabel({ weekday: 0, weekend: 3 })).toBe('3 weekends');
    expect(deskSplitLabel({ weekday: 1, weekend: 0 })).toBe('1 weekday');
  });

  it('nothing readable speaks nothing (and garbage input never guesses)', () => {
    expect(deskSplitLabel({ weekday: 0, weekend: 0 })).toBe('');
    expect(deskSplitLabel(null)).toBe('');
    expect(deskSplitLabel(undefined)).toBe('');
    expect(deskSplitLabel({ weekday: Number.NaN, weekend: 1 })).toBe('1 weekend');
  });
});

describe('the desk wears the split (page contract)', () => {
  const page = readRepo('src/app/(shell)/hr/timesheets/page.tsx');
  const pure = readRepo('src/lib/hr/attendance-desk.ts');

  it('the split composes the same builders the lenses use — never a second parser', () => {
    expect(pure).toContain(
      'return { weekday: deskWeekdayDays(days).length, weekend: deskWeekendDays(days).length };',
    );
  });

  it('the split line sits under the count chip, always visible without lensing', () => {
    expect(page).toContain('data-testid="hr-timesheet-split"');
    expect(page).toContain('deskDaySplit(row.days)');
    expect(page).toContain('deskSplitLabel(split)');
    // The stack: count chip + split in one column — the total stays first.
    expect(page).toContain('flex flex-col items-start gap-1');
  });

  it('the split dresses as the chips it counts (amber weekday, sky weekend)', () => {
    expect(page).toContain('<Briefcase className="h-3 w-3 text-amber-700 dark:text-amber-400" aria-hidden />');
    expect(page).toContain('<Sun className="h-3 w-3 text-sky-700 dark:text-sky-400" aria-hidden />');
  });

  it('the words live in the aria-label; an unreadable row renders no split', () => {
    expect(page).toContain('aria-label={`${row.days.length} pending ${row.days.length === 1 ? \'day\' : \'days\'} — ${splitLabel}`}');
    expect(page).toContain('{splitLabel ? (');
  });

  it('the count chip keeps speaking the row total (the split adds, never rewrites)', () => {
    expect(page).toContain('data-testid="hr-timesheet-count-chip"');
    expect(page).toContain('{row.days.length} {row.days.length === 1 ? \'day\' : \'days\'}');
  });

  it('purity pin: the split module stays free of db, network, and clock', () => {
    const splitBlock = pure.slice(pure.indexOf('// ── v2.146.0'));
    expect(splitBlock).not.toMatch(/prisma|fetch\(|Date\.now|new Date\(\)/);
  });
});

describe('the runs table wears the same dots (page contract)', () => {
  const page = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('the lookup rides the SAME memo the picker reads — one definition of last', () => {
    expect(page).toContain(
      'new Map(timelinePeriods.map((p) => [p.label, p.lastOutcome] as const))',
    );
    expect(page).toContain(
      'const periodOutcome =\n                          timelineOutcomeByPeriod.get(group.periodName) ?? null;',
    );
  });

  it('the group header wears the picker-class dot', () => {
    expect(page).toContain('data-testid="payroll-period-gate-outcome"');
    // Exact class parity with the picker's dots (v2.144.0).
    expect(page).toContain(
      "'bg-emerald-500 dark:bg-emerald-400'\n                                          : periodOutcome === 'BLOCKED'\n                                            ? 'bg-amber-500 dark:bg-amber-400'\n                                            : 'bg-muted-foreground/40'",
    );
    expect(page).toContain('inline-block h-1.5 w-1.5 shrink-0 rounded-full');
    expect(page).toContain('title={`Last prepare attempt outcome in the gate trail: ${periodOutcome}`}');
  });

  it('the dot is decoration; the toggle aria-label carries the word', () => {
    expect(page).toContain(
      'aria-label={`${open ? \'Collapse\' : \'Expand\'} the ${group.periodName} payroll period${periodOutcome ? ` — last gate attempt ${periodOutcome}` : \'\'}`}',
    );
  });

  it('honest absence: no outcome renders no dot', () => {
    expect(page).toContain('{periodOutcome ? (');
  });
});

describe('docs: the ledger doc links the gate-contract catalogue', () => {
  const doc = readRepo('docs/PAYROLL_LEDGER_ZERO_RUNS.md');

  it('points at the lifecycle doc\'s "Gate surfaces and contracts" section', () => {
    expect(doc).toContain('## Related contracts');
    expect(doc).toContain('[docs/hr/payroll-run-lifecycle.md](./hr/payroll-run-lifecycle.md)');
    expect(doc).toContain('"Gate surfaces and contracts"');
  });
});
