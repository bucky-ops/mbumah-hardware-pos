import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deskWeekendDays, deskDayStrip, deskDayIsWeekend } from '@/lib/hr/attendance-desk';
import { buildGateAttemptChip } from '@/lib/hr/payroll/gate-trail';

/**
 * v2.140.0 — the desk finds its weekends; the chip rides the verdict strip.
 *
 * Gap: the weekend TINT (v2.138.0) made a Saturday punch stand out, but a
 * long strip still buries it — a Monday-morning review asking "who worked
 * the weekend?" had to count sky chips by eye. And the run dialog kept the
 * full trail story while its frozen-verdict strip (the dialog's own
 * counterpart of the table's verdict chip) went without the compact
 * attempts surface the table has worn since v2.139.0.
 *
 * Covered here:
 *  1. deskWeekendDays — the lens's pure half: only real Sat/Sun date-onlys
 *     survive, in order, garbage never passes, non-arrays degrade to [].
 *  2. The lens composition — filtering BEFORE deskDayStrip keeps the +N
 *     overflow honest about exactly what the lens shows; the unfiltered
 *     strip is untouched when the lens is off.
 *  3. The dialog chip — buildGateAttemptChip over the trail the dialog
 *     already holds; the verdict strip carries it (testid + History icon +
 *     trail-pointer title), and a run with no trail renders nothing.
 *  4. The desk lens UI contract — aria-pressed toggle, sky family when on,
 *     disabled only while loading, data-lens on the strip, the honest
 *     "no weekend days" note, count chip untouched by the lens.
 *  5. The docs — payroll-run-lifecycle.md names the six gate contracts
 *     (frozen verdict, trail, attempt chip, desk, batch receipt, lens).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. The lens's pure half ──────────────────────────────────────────────────

describe('deskWeekendDays - the strip\'s second reading', () => {
  it('keeps only real Saturdays and Sundays, in the given order', () => {
    // 2026-10-16 Fri, 17 Sat, 18 Sun, 19 Mon, 24 Sat.
    expect(deskWeekendDays(['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-24'])).toEqual([
      '2026-10-17',
      '2026-10-18',
      '2026-10-24',
    ]);
  });

  it('garbage never passes — a junk day cannot read as weekend', () => {
    expect(deskWeekendDays(['not-a-date', '2026-10-17', '', '2026-13-99'])).toEqual(['2026-10-17']);
    expect(deskDayIsWeekend('not-a-date')).toBe(false);
  });

  it('degrades to empty on junk input — the lens never invents days', () => {
    expect(deskWeekendDays([])).toEqual([]);
    expect(deskWeekendDays(undefined as unknown as string[])).toEqual([]);
    expect(deskWeekendDays('2026-10-17' as unknown as string[])).toEqual([]);
  });
});

// ── 2. The lens composition ─────────────────────────────────────────────────

describe('lens over strip - the overflow stays honest', () => {
  const days = [
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
    '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
    '2026-10-11', '2026-10-17', '2026-10-18',
  ]; // 13 days; weekends: 03, 04, 10, 11, 17, 18

  it('lens off: the strip is exactly what v2.136.0 shipped', () => {
    const strip = deskDayStrip(days);
    expect(strip.shown).toHaveLength(12);
    expect(strip.hidden).toBe(1);
  });

  it('lens on: only weekend chips, +N counts hidden WEEKENDS — no weekday smuggled in', () => {
    const strip = deskDayStrip(deskWeekendDays(days));
    expect(strip.shown).toHaveLength(6);
    expect(strip.shownDays.every((d) => deskDayIsWeekend(d))).toBe(true);
    expect(strip.hidden).toBe(0);
  });

  it('lens on with more weekends than max: overflow speaks only weekends', () => {
    const weekendHeavy = Array.from({ length: 16 }, (_, i) => {
      // Sixteen consecutive Saturdays from 2026-10-03.
      const d = new Date(`${'2026'}-10-03T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i * 7);
      return d.toISOString().slice(0, 10);
    });
    const strip = deskDayStrip(deskWeekendDays(weekendHeavy));
    expect(strip.shown).toHaveLength(12);
    expect(strip.hidden).toBe(4);
  });

  it('a row with no weekend days lenses to an honest empty — never silence about the row', () => {
    const strip = deskDayStrip(deskWeekendDays(['2026-10-19', '2026-10-20']));
    expect(strip.shown).toHaveLength(0);
    expect(strip.hidden).toBe(0);
    expect(strip.shownDays).toHaveLength(0);
  });
});

// ── 3. The dialog chip ───────────────────────────────────────────────────────

describe('the verdict strip wears the attempt chip', () => {
  const dialog = () => readRepo('src/components/hr/payroll-run-dialog.tsx');

  it('the strip builds the chip from the trail the dialog already holds', () => {
    const src = dialog();
    expect(src.includes('buildGateAttemptChip')).toBe(true);
    expect(src.includes('attemptCount: gateTrail.length')).toBe(true);
    expect(src.includes("gateTrail[gateTrail.length - 1]?.outcome")).toBe(true);
  });

  it('the chip rides INSIDE the frozen-verdict strip with its own testid', () => {
    const src = dialog();
    const stripIdx = src.indexOf('payroll-run-gate-verdict-strip');
    const chipIdx = src.indexOf('payroll-run-gate-attempts-dialog');
    expect(stripIdx).toBeGreaterThan(-1);
    expect(chipIdx).toBeGreaterThan(stripIdx);
  });

  it('honest absence: a run with no trail renders no chip', () => {
    // The builder's contract the dialog relies on: zero attempts → null.
    expect(buildGateAttemptChip({ attemptCount: 0, lastOutcome: 'PASSED' })).toBeNull();
    expect(buildGateAttemptChip({ attemptCount: null, lastOutcome: 'BLOCKED' })).toBeNull();
  });

  it('the chip points at the trail below — History icon + title', () => {
    const src = dialog();
    const chipIdx = src.indexOf('payroll-run-gate-attempts-dialog');
    const block = src.slice(chipIdx - 400, chipIdx + 600);
    expect(block.includes('History')).toBe(true);
    expect(block.includes('Gate trail')).toBe(true);
  });
});

// ── 4. The desk lens UI contract ─────────────────────────────────────────────

describe('the desk\'s day-kind lens (v2.145.0 re-anchor: trio era)', () => {
  const page = () => readRepo('src/app/(shell)/hr/timesheets/page.tsx');

  it('the weekends member speaks its state and its sky family', () => {
    const src = page();
    expect(src.includes("aria-pressed={lens === 'weekends'}")).toBe(true);
    expect(src.includes('hr-timesheet-lens-weekends')).toBe(true);
    expect(src.includes('border border-sky-300 bg-sky-50 text-sky-800')).toBe(true);
    expect(src.includes('dark:bg-sky-950/50')).toBe(true);
  });

  it('the lens composes BEFORE the strip builder (three ways now)', () => {
    const src = page();
    expect(src.includes('? deskWeekendDays(row.days)')).toBe(true);
    expect(src.includes('? deskWeekdayDays(row.days)')).toBe(true);
  });

  it('the strip wears the lens marker and both honest empty notes', () => {
    const src = page();
    expect(src.includes("data-lens={lens !== 'all' ? lens : undefined}")).toBe(true);
    expect(src.includes('hr-timesheet-strip-empty')).toBe(true);
    expect(src.includes('no weekend days')).toBe(true);
    expect(src.includes('no weekday days')).toBe(true);
  });

  it('a view preference: disabled only while loading, never cleared by scopes', () => {
    const src = page();
    const trioIdx = src.indexOf('hr-timesheet-lens-weekends');
    const block = src.slice(trioIdx - 900, trioIdx + 400);
    expect(block.includes('disabled={loading}')).toBe(true);
    // v2.145.0 re-anchor: the flip moved into setLensPref (the write-through
    // callback) — same view-preference contract, now three ways wide.
    expect(src.includes("onClick={() => setLensPref('weekends')}")).toBe(true);
    expect(src.includes('const setLensPref = useCallback')).toBe(true);
  });
});

// ── 5. The docs name the contracts ───────────────────────────────────────────

describe('payroll-run-lifecycle.md keeps the gate contract honest', () => {
  const doc = () => readRepo('docs/hr/payroll-run-lifecycle.md');

  it('names all six gate surfaces', () => {
    const src = doc();
    expect(src.includes('### Gate surfaces and contracts')).toBe(true);
    expect(src.includes('**Frozen verdict (v2.135.0).**')).toBe(true);
    expect(src.includes('**Gate trail (v2.138.0).**')).toBe(true);
    expect(src.includes('**Attempt chip (v2.139.0/v2.140.0).**')).toBe(true);
    expect(src.includes('**Timesheet desk (v2.136.0).**')).toBe(true);
    expect(src.includes('**Batch receipt (v2.139.0).**')).toBe(true);
    // Re-anchored for v2.141.0: the lens gained its persistence half (and the
    // doc gained the store gate timeline surface beside it).
    expect(src.includes('**Weekends-only lens (v2.140.0/v2.141.0).**')).toBe(true);
  });

  it('pins the trail\u2019s core promises: append-only, same clock, no bulk path', () => {
    const src = doc();
    expect(src.includes('Append-only: no update or delete path exists')).toBe(true);
    expect(src.includes('the SAME clock the snapshot froze')).toBe(true);
    expect(src.includes('never a new bulk write path')).toBe(true);
  });
});
