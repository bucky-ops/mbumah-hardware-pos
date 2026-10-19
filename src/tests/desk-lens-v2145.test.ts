import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deskWeekdayDays,
  deskWeekendDays,
  readDeskLensPref,
  writeDeskLensPref,
  DESK_LENS_STORAGE_KEY,
  type DeskLensPref,
} from '@/lib/hr/attendance-desk';

/**
 * v2.145.0 — the desk lens learns weekdays.
 *
 * Gap: the weekends-only lens (v2.140.0) answered "who worked the weekend?";
 * the mirror question — "show me just the working-week days" — still needed
 * an eyeball. The lens completes the pair as a three-way day-kind filter
 * (the gate card's outcome trio's own shape, v2.144.0), and the persisted
 * preference grows WITHOUT abandoning old browsers.
 *
 * Covered here:
 *  1. deskWeekdayDays — deskWeekendDays's honest sibling: valid non-weekend
 *     days only, order preserved, garbage drops from BOTH day-kind lenses
 *     (an unreadable day is honestly neither).
 *  2. The persisted preference's three-value era: 'weekends'/'weekdays'
 *     read as themselves, the LEGACY '1' still reads 'weekends' (a reader
 *     who chose the weekend lens keeps it across the upgrade — never a
 *     silent reset), '0'/junk/unset read 'all', 'all' REMOVES the key (the
 *     old turn-off's own no-litter rule), dead storage degrades, and the
 *     storage KEY is unchanged.
 *  3. The desk page's trio contract: joined segmented group with three
 *     aria-pressed members dressing as the chips they keep (ALL neutral /
 *     WEEKENDS sky / WEEKDAYS amber), the strip composing through the
 *     three-way ternary BEFORE the builder, the data-lens marker carrying
 *     the lens word, both honest-empty voices, the post-hydration read
 *     preserved (lesson 56), and the count chip still route-built.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. The day-kind filters ──────────────────────────────────────────────────

describe('deskWeekdayDays - the weekend lens\u2019s honest sibling', () => {
  it('keeps valid non-weekend days, in order', () => {
    // Mon 12 → Fri 16 of Oct 2026; Sat 17 + Sun 18 drop.
    const days = ['2026-10-16', '2026-10-17', '2026-10-12', '2026-10-18', '2026-10-13'];
    expect(deskWeekdayDays(days)).toEqual(['2026-10-16', '2026-10-12', '2026-10-13']);
    expect(deskWeekendDays(days)).toEqual(['2026-10-17', '2026-10-18']); // sibling parity
  });

  it('garbage drops from BOTH day-kind lenses — an unreadable day is honestly neither', () => {
    const days = ['2026-10-14', 'not-a-date', '20261015', '2026-10-17'];
    expect(deskWeekdayDays(days)).toEqual(['2026-10-14']);
    expect(deskWeekendDays(days)).toEqual(['2026-10-17']);
    // Garbage only ever survives under All — the page feeds row.days there.
  });

  it('empty, non-array, and all-weekend inputs degrade honestly', () => {
    expect(deskWeekdayDays([])).toEqual([]);
    expect(deskWeekdayDays(undefined as unknown as string[])).toEqual([]);
    expect(deskWeekdayDays(['2026-10-17', '2026-10-18'])).toEqual([]);
    expect(deskWeekdayDays(null as unknown as string[])).toEqual([]);
  });
});

// ── 2. The persisted preference ──────────────────────────────────────────────

class FakeStore {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  has(k: string): boolean {
    return this.m.has(k);
  }
}

class DeadStore {
  getItem(_k: string): string | null {
    throw new Error('storage dead');
  }
  setItem(_k: string, _v: string): void {
    throw new Error('storage dead');
  }
  removeItem(_k: string): void {
    throw new Error('storage dead');
  }
}

describe('readDeskLensPref / writeDeskLensPref - the three-value era', () => {
  it('reads the word values as themselves; the LEGACY 1 still reads weekends', () => {
    const store = new FakeStore();
    expect(readDeskLensPref(store)).toBe('all'); // never set
    store.setItem(DESK_LENS_STORAGE_KEY, 'weekdays');
    expect(readDeskLensPref(store)).toBe('weekdays');
    store.setItem(DESK_LENS_STORAGE_KEY, 'weekends');
    expect(readDeskLensPref(store)).toBe('weekends');
    store.setItem(DESK_LENS_STORAGE_KEY, '1');
    expect(readDeskLensPref(store)).toBe('weekends'); // v2.141 upgrade never resets a choice
  });

  it('anything else reads all — a stale 0 / junk never reads a lens', () => {
    const store = new FakeStore();
    store.setItem(DESK_LENS_STORAGE_KEY, '0');
    expect(readDeskLensPref(store)).toBe('all');
    store.setItem(DESK_LENS_STORAGE_KEY, 'yes');
    expect(readDeskLensPref(store)).toBe('all');
    store.setItem(DESK_LENS_STORAGE_KEY, 'weekdaze');
    expect(readDeskLensPref(store)).toBe('all');
  });

  it("writing stores the word; 'all' REMOVES the key — no stale-value litter", () => {
    const store = new FakeStore();
    writeDeskLensPref(store, 'weekdays');
    expect(store.getItem(DESK_LENS_STORAGE_KEY)).toBe('weekdays');
    writeDeskLensPref(store, 'weekends');
    expect(store.getItem(DESK_LENS_STORAGE_KEY)).toBe('weekends');
    writeDeskLensPref(store, 'all');
    expect(store.getItem(DESK_LENS_STORAGE_KEY)).toBeNull();
  });

  it('a throwing storage degrades to all / silence — never a crashed render', () => {
    const dead = new DeadStore();
    expect(readDeskLensPref(dead)).toBe('all');
    expect(() => writeDeskLensPref(dead, 'weekdays')).not.toThrow();
    expect(readDeskLensPref(null)).toBe('all');
    expect(() => writeDeskLensPref(null, 'all')).not.toThrow();
    expect(readDeskLensPref(undefined)).toBe('all');
  });

  it('the storage KEY is unchanged — the old browser\u2019s stored value stays reachable', () => {
    expect(DESK_LENS_STORAGE_KEY).toBe('mbumah.hr.timesheets.lens.weekendsOnly');
  });

  it('the full round-trip: write weekends -> read weekends -> write all -> read all', () => {
    const store = new FakeStore();
    for (const pref of ['weekdays', 'weekends', 'all'] as DeskLensPref[]) {
      writeDeskLensPref(store, pref);
      expect(readDeskLensPref(store)).toBe(pref);
    }
  });
});

// ── 3. The desk page's trio contract ─────────────────────────────────────────

describe("the desk page's day-kind lens trio", () => {
  const page = readRepo('src/app/(shell)/hr/timesheets/page.tsx');
  const pure = readRepo('src/lib/hr/attendance-desk.ts');

  it('a joined segmented group with three aria-pressed members', () => {
    expect(page).toContain('data-testid="hr-timesheet-lens"');
    expect(page).toContain('role="group"');
    expect(page).toContain('data-testid="hr-timesheet-lens-all"');
    expect(page).toContain('data-testid="hr-timesheet-lens-weekends"');
    expect(page).toContain('data-testid="hr-timesheet-lens-weekdays"');
    expect(page).toContain("aria-pressed={lens === 'all'}");
    expect(page).toContain("aria-pressed={lens === 'weekends'}");
    expect(page).toContain("aria-pressed={lens === 'weekdays'}");
    expect(page).toContain("useState<DeskLensPref>('all')");
  });

  it('each member dresses as the chips it keeps: ALL neutral, WEEKENDS sky, WEEKDAYS amber', () => {
    expect(page).toContain('bg-muted text-foreground hover:bg-muted hover:text-foreground');
    expect(page).toContain('border border-sky-300 bg-sky-50 text-sky-800');
    expect(page).toContain('dark:bg-sky-950/50 dark:text-sky-300');
    expect(page).toContain('border border-amber-300 bg-amber-50 text-amber-800');
    expect(page).toContain('dark:bg-amber-950/50 dark:text-amber-300');
    expect(page).toContain('All days');
    expect(page).toContain('Weekends only');
    expect(page).toContain('Weekdays only');
  });

  it('the strip composes through the three-way ternary BEFORE the builder', () => {
    expect(page).toContain("lens === 'weekends'");
    expect(page).toContain('? deskWeekendDays(row.days)');
    expect(page).toContain('? deskWeekdayDays(row.days)');
    expect(page).not.toContain('weekendsOnly');
  });

  it('the strip marker carries the lens word; both honest empties speak', () => {
    expect(page).toContain("data-lens={lens !== 'all' ? lens : undefined}");
    expect(page).toContain('no weekend days');
    expect(page).toContain('no weekday days');
    expect(page).toContain("lens === 'weekends' ? 'no weekend days' : 'no weekday days'");
  });

  it('the count chip keeps speaking the row TOTAL — a view, not a rewrite', () => {
    expect(page).toContain('{row.days.length} {row.days.length === 1 ? \'day\' : \'days\'}');
  });

  it('the post-hydration persisted read is preserved (lesson 56)', () => {
    expect(page).toContain('Promise.resolve().then(() => setLens(readDeskLensPref(window.localStorage)))');
    expect(page).toContain('writeDeskLensPref(window.localStorage, next)');
    // The write goes through the setLensPref callback on every member.
    expect(page.match(/setLensPref\('/g)?.length).toBe(3);
  });

  it('the pure module carries the sibling + the pref family; stays PURE', () => {
    expect(pure).toContain('export function deskWeekdayDays');
    expect(pure).toContain("export type DeskLensPref = 'all' | 'weekends' | 'weekdays'");
    expect(pure).toContain("if (raw === 'weekends' || raw === '1') return 'weekends';");
    const code = pure.replace(/^\s*\/\/.*$/gm, '');
    expect(!/@prisma\/client|node-fetch|axios|fetch\(|window\.|new Date\(\)/.test(code)).toBe(true);
  });
});
