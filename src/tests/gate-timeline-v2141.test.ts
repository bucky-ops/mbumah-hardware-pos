import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGateTimeline, summarizeGateTimeline, type GateTimelineEvent } from '@/lib/hr/payroll/gate-timeline';
import { readDeskLensPref, writeDeskLensPref, DESK_LENS_STORAGE_KEY } from '@/lib/hr/attendance-desk';

/**
 * v2.141.0 — the gate tells its story across runs; the lens keeps its pref.
 *
 * Gap: the trail (v2.138.0) lived inside each run's dialog and the attempt
 * chip (v2.139.0/v2.140.0) counted one run at a time — "how has the gate
 * behaved across every run?" meant opening run after run. And the desk's
 * weekends-only lens reset on every navigation, so an anomaly hunt meant
 * re-toggling all morning.
 *
 * Covered here:
 *  1. The store timeline builder — every attempt speaks (never deduped),
 *     movement computed CHRONOLOGICALLY (a run boundary never resets the
 *     comparison), garbage degrades row by row, junk rows drop, newest-first
 *     is the CALLER's job (the builder eats oldest-first like the trail).
 *  2. The summary rollup — attempts, distinct runs, last outcome by clock
 *     (not by position), zeros for an empty store.
 *  3. The lens preference — guarded reads degrade to OFF, turn-off removes
 *     the key, throwing storage never crashes.
 *  4. The gate-timeline route — the gate read-right quartet, store scoping,
 *     the desc→chronological reversal, the window honesty (window + totalEvents).
 *  5. The Gate activity card — newest-first render, the moved pill, the
 *     summary chip, honest empty/error/skeleton states, the show-all toggle,
 *     the refresh wiring, and the dialog's onChanged re-reading the timeline.
 *  6. The desk lens contract — init from storage, persist on flip.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const CLEAR = { total: 5, clear: 5, missingConsent: 0, timesheetNotApproved: 0, codes: [] };
const BLOCKED_TS = {
  total: 5,
  clear: 4,
  missingConsent: 0,
  timesheetNotApproved: 1,
  codes: ['TIMESHEET_NOT_APPROVED'],
};

const ev = (over: Partial<GateTimelineEvent> & { id: string; runId: string }): GateTimelineEvent => ({
  runLabel: 'October 2026',
  runStatus: 'DRAFT',
  outcome: 'PASSED',
  checkedAt: '2026-10-19T07:44:00.000Z',
  summary: CLEAR,
  actorLabel: 'Owner',
  ...over,
});

// ── 1. The store timeline builder ────────────────────────────────────────────

describe('buildGateTimeline - the story across runs', () => {
  it('every attempt speaks, in the order fed — never deduped, never smoothed', () => {
    const rows = buildGateTimeline([
      ev({ id: 'e1', runId: 'r1' }),
      ev({ id: 'e2', runId: 'r1' }),
      ev({ id: 'e3', runId: 'r1' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['e1', 'e2', 'e3']);
    expect(rows.every((r) => r.text === '5 clear')).toBe(true);
  });

  it('movement is chronological: the row whose verdict differs from the one BEFORE it wears moved', () => {
    const rows = buildGateTimeline([
      ev({ id: 'e1', runId: 'r1', summary: BLOCKED_TS, outcome: 'BLOCKED' }),
      ev({ id: 'e2', runId: 'r1', summary: CLEAR, outcome: 'PASSED' }),
      ev({ id: 'e3', runId: 'r1', summary: CLEAR, outcome: 'PASSED' }),
    ]);
    expect(rows[0].moved).toBe(false); // nothing before the first attempt
    expect(rows[1].moved).toBe(true); // BLOCKED → PASSED
    expect(rows[2].moved).toBe(false); // the verdict held
  });

  it('a run boundary does NOT reset the comparison — the story is the gate\'s, not the run\'s', () => {
    const rows = buildGateTimeline([
      ev({ id: 'e1', runId: 'r-september', runLabel: 'September 2026', summary: CLEAR, outcome: 'PASSED' }),
      ev({ id: 'e2', runId: 'r-october', runLabel: 'October 2026', summary: BLOCKED_TS, outcome: 'BLOCKED' }),
      ev({ id: 'e3', runId: 'r-october', runLabel: 'October 2026', summary: CLEAR, outcome: 'PASSED' }),
    ]);
    // e2 crosses the run boundary AND moves the verdict — both must be true at once.
    expect(rows[1].moved).toBe(true);
    expect(rows[1].runId).toBe('r-october');
    expect(rows[0].runId).toBe('r-september');
  });

  it('garbage degrades, never guesses: unreadable summary keeps its row, muted', () => {
    const rows = buildGateTimeline([
      ev({ id: 'e1', runId: 'r1', summary: { nonsense: true } }),
      ev({ id: 'e2', runId: 'r1', summary: CLEAR }),
    ]);
    expect(rows[0].text).toBe('Verdict unreadable');
    expect(rows[0].tone).toBe('muted');
    expect(rows[1].moved).toBe(true); // unreadable → "5 clear" IS a move
  });

  it('an unreadable clock has no ISO; an unknown outcome speaks UNKNOWN — but the tone stays the VERDICT\'s voice', () => {
    const rows = buildGateTimeline([
      ev({ id: 'e1', runId: 'r1', checkedAt: 'not-a-date', outcome: 'WEIRD' }),
    ]);
    expect(rows[0].atIso).toBeNull();
    expect(rows[0].outcome).toBe('UNKNOWN');
    // Tone follows the VERDICT (the summary), not the outcome literal — the
    // same independence the per-run trail speaks. Muted comes from garbage
    // (covered above), not from an unknown outcome wearing a readable tally.
    expect(rows[0].tone).toBe('emerald');
    expect(rows[0].runStatus).toBe('DRAFT');
  });

  it('junk drops: no id, empty id, or a missing runId cannot sit in a cross-run story', () => {
    const rows = buildGateTimeline([
      ev({ id: '', runId: 'r1' }),
      ev({ id: 'e2', runId: '' }),
      ev({ id: 'e3', runId: 'r2' }),
      // @ts-expect-error — a null row from a JSON crossing
      null,
    ]);
    expect(rows.map((r) => r.id)).toEqual(['e3']);
  });

  it('non-array input degrades to an empty story — never a crash', () => {
    expect(buildGateTimeline(undefined as unknown as GateTimelineEvent[])).toEqual([]);
    expect(buildGateTimeline(null as unknown as GateTimelineEvent[])).toEqual([]);
  });

  it('blank run labels degrade to null — honest absence, not an invented name', () => {
    const rows = buildGateTimeline([ev({ id: 'e1', runId: 'r1', runLabel: '   ' }), ev({ id: 'e2', runId: 'r1', runLabel: undefined })]);
    expect(rows[0].runLabel).toBeNull();
    expect(rows[1].runLabel).toBeNull();
  });
});

// ── 2. The summary rollup ────────────────────────────────────────────────────

describe('summarizeGateTimeline - the card header\'s chip', () => {
  it('counts attempts, DISTINCT runs, and the last outcome BY CLOCK (not by position)', () => {
    const rows = buildGateTimeline([
      ev({ id: 'e1', runId: 'r1', checkedAt: '2026-10-19T07:44:00.000Z', summary: BLOCKED_TS, outcome: 'BLOCKED' }),
      ev({ id: 'e2', runId: 'r2', runLabel: 'September 2026', checkedAt: '2026-10-19T08:45:00.000Z', summary: CLEAR }),
    ]);
    const s = summarizeGateTimeline(rows);
    expect(s.attempts).toBe(2);
    expect(s.runs).toBe(2);
    expect(s.lastOutcome).toBe('PASSED');
    expect(s.lastAtIso).toBe('2026-10-19T08:45:00.000Z');
  });

  it('an out-of-order feed still finds the newest attempt by its clock', () => {
    const rows = buildGateTimeline([
      ev({ id: 'e1', runId: 'r1', checkedAt: '2026-10-19T09:00:00.000Z', summary: CLEAR }),
      ev({ id: 'e2', runId: 'r1', checkedAt: '2026-10-19T08:00:00.000Z', summary: BLOCKED_TS, outcome: 'BLOCKED' }),
    ]);
    const s = summarizeGateTimeline(rows);
    expect(s.lastOutcome).toBe('PASSED'); // 09:00 is newer than 08:00
  });

  it('zeros are honest: no attempts is a store that never prepared, not a failure', () => {
    expect(summarizeGateTimeline([])).toEqual({ attempts: 0, runs: 0, lastOutcome: null, lastAtIso: null });
    expect(summarizeGateTimeline(undefined as unknown as [])).toEqual({
      attempts: 0,
      runs: 0,
      lastOutcome: null,
      lastAtIso: null,
    });
  });
});

// ── 3. The lens preference ───────────────────────────────────────────────────

describe('the desk lens keeps its preference', () => {
  class FakeStore {
    private map = new Map<string, string>();
    getItem(k: string): string | null {
      // has() then get() — no non-null assertion needed (the map cannot
      // shrink between the two calls).
      return this.map.has(k) ? (this.map.get(k) ?? null) : null;
    }
    setItem(k: string, v: string): void {
      this.map.set(k, v);
    }
    removeItem(k: string): void {
      this.map.delete(k);
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

  it('reads the three-value era; the LEGACY 1 still reads weekends (v2.145.0 re-anchor)', () => {
    const store = new FakeStore();
    expect(readDeskLensPref(store)).toBe('all'); // never set
    store.setItem(DESK_LENS_STORAGE_KEY, '1');
    expect(readDeskLensPref(store)).toBe('weekends'); // the old choice survives the upgrade
    store.setItem(DESK_LENS_STORAGE_KEY, 'weekdays');
    expect(readDeskLensPref(store)).toBe('weekdays');
    store.setItem(DESK_LENS_STORAGE_KEY, '0');
    expect(readDeskLensPref(store)).toBe('all'); // a stale '0' never reads a lens
    store.setItem(DESK_LENS_STORAGE_KEY, 'yes');
    expect(readDeskLensPref(store)).toBe('all');
  });

  it("'all' REMOVES the key rather than littering a stale value", () => {
    const store = new FakeStore();
    writeDeskLensPref(store, 'weekends');
    expect(store.getItem(DESK_LENS_STORAGE_KEY)).toBe('weekends');
    writeDeskLensPref(store, 'all');
    expect(store.getItem(DESK_LENS_STORAGE_KEY)).toBeNull();
  });

  it('a throwing storage degrades to all / silence — never a crashed render', () => {
    const dead = new DeadStore();
    expect(readDeskLensPref(dead)).toBe('all');
    expect(() => writeDeskLensPref(dead, 'weekends')).not.toThrow();
    expect(readDeskLensPref(null)).toBe('all');
    expect(() => writeDeskLensPref(null, 'all')).not.toThrow();
    expect(readDeskLensPref(undefined)).toBe('all');
  });
});

// ── 4. The route ─────────────────────────────────────────────────────────────

describe('GET /api/payroll/gate-timeline - the cross-run read', () => {
  const route = readRepo('src/app/api/payroll/gate-timeline/route.ts');

  it('rides the gate read-right quartet — the same read rights the runs list carries', () => {
    expect(route).toContain("hrGuard('hr.payroll.read.all'");
    expect(route).toContain("'HR_MANAGER'");
    expect(route).toContain("'BRANCH_MANAGER'");
    expect(route).toContain("'STORE_OWNER'");
    expect(route).toContain("'ACCOUNTANT'");
  });

  it('store-scoped, read-only, newest-clock ordering with the createdAt tie-break', () => {
    expect(route).toContain('const storeId = session.storeId');
    expect(route).toContain('where: { storeId }');
    expect(route).toContain("orderBy: [{ checkedAt: 'desc' }, { createdAt: 'desc' }]");
    expect(route).not.toContain('.create(');
    expect(route).not.toContain('.update(');
    expect(route).not.toContain('.delete(');
  });

  it('reverses the newest-window read to chronological BEFORE the builder — movement in the direction attempts happen', () => {
    expect(route).toContain('[...events].reverse()');
    expect(route).toContain('buildGateTimeline(');
  });

  it('the payload speaks its window: window constant, totalEvents count, and the reversed rows', () => {
    expect(route).toContain('TIMELINE_WINDOW = 120');
    expect(route).toContain('totalEvents');
    expect(route).toContain('[...rows].reverse()');
    expect(route).toContain('summarizeGateTimeline(rows)');
  });

  it('actor labels resolve in ONE query with the same fallback ladder as the run detail', () => {
    expect(route).toContain("u.name?.trim() || u.email || 'Unknown user'");
    expect(route.match(/db\.user\.findMany/g)?.length).toBe(1);
  });
});

// ── 5. The Gate activity card ────────────────────────────────────────────────

describe('the payroll page\'s Gate activity card', () => {
  const page = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('renders newest-first rows with outcome testids, the moved pill, and run context', () => {
    // The route already hands the payload newest-first — the card renders it
    // as-is (slice for the 8-row bound), never a second reversal. (Re-anchored
    // for v2.142.0: the bound now composes AFTER the blocked-only lens via
    // timelineFiltered — the render contract grew a view preference.)
    expect(page).toContain('(timelineShowAll ? timelineFiltered : timelineFiltered.slice(0, 8)).map(');
    expect(page).toContain('payroll-gate-timeline-row-${i}');
    expect(page).toContain('payroll-gate-timeline-outcome-${i}');
    expect(page).toContain('payroll-gate-timeline-moved-${i}');
    expect(page).toContain('row.runLabel');
    expect(page).toContain('row.runStatus');
  });

  it('carries the honest states: skeleton, error + Retry, empty, and the window line', () => {
    expect(page).toContain('payroll-gate-timeline-loading');
    expect(page).toContain('payroll-gate-timeline-error');
    expect(page).toContain('payroll-gate-timeline-retry');
    expect(page).toContain('payroll-gate-timeline-empty');
    expect(page).toContain('payroll-gate-timeline-window');
  });

  it('the summary chip speaks attempts · runs · last — and the toggle bounds eight rows', () => {
    expect(page).toContain('payroll-gate-timeline-summary');
    expect(page).toContain('timelineFiltered.slice(0, 8)');
    expect(page).toContain('payroll-gate-timeline-toggle');
    expect(page).toContain('aria-expanded={timelineShowAll}');
  });

  it('the timeline has its own loader and refresh — a failure never touches the page error', () => {
    expect(page).toContain('payroll-gate-timeline-refresh');
    expect(page).toContain('const loadTimeline = useCallback');
    expect(page).toContain("fetch('/api/payroll/gate-timeline', { credentials: 'include' })");
  });

  it('the run dialog\'s onChanged re-reads the timeline alongside the table', () => {
    expect(page).toContain('void loadTimeline();');
  });

  it('a BLOCKED prepare is not silence — the dialog echoes the stop through onChanged', () => {
    const dialog = readRepo('src/components/hr/payroll-run-dialog.tsx');
    // The 422 comes AFTER the gate appended its trail row and refreshed the
    // frozen snapshot — the page must re-read even when prepare stops. The
    // lifecycle's prepare step rides the dialog's `validate` action (the
    // validate endpoint calls preparePayrollRun), so BOTH names echo.
    expect(dialog).toContain("if (action === 'prepare' || action === 'validate') onChanged();");
  });
});

// ── 6. The desk lens contract ────────────────────────────────────────────────

describe('the desk page reads and persists the lens', () => {
  const desk = readRepo('src/app/(shell)/hr/timesheets/page.tsx');

  it('the persisted read happens AFTER hydration — never in a lazy initializer', () => {
    // Caught live in E2E: a lazy initializer renders true on the client while
    // the server rendered false, and React never patches stale hydration
    // ATTRIBUTES — the strip's children got fixed while the toggle's
    // aria-pressed stayed stale. The read must ride the microtask-deferred
    // effect (the page load()'s own pattern) so the first client render
    // matches the server exactly. (v2.145.0 re-anchor: the state is the
    // three-way lens; the read maps the legacy '1' to 'weekends'.)
    expect(desk).toContain('Promise.resolve().then(() => setLens(readDeskLensPref(window.localStorage)))');
    expect(desk).not.toContain('useState<boolean>(() =>');
    expect(desk).toContain('const setLensPref = useCallback');
  });

  it('flips persist through the guarded write helper', () => {
    expect(desk).toContain('readDeskLensPref(');
    expect(desk).toContain('writeDeskLensPref(window.localStorage, next)');
  });

  it('the lens helpers live in the DESK\'s pure module — no window access beside the guards', () => {
    const pure = readRepo('src/lib/hr/attendance-desk.ts');
    expect(pure).toContain("DESK_LENS_STORAGE_KEY = 'mbumah.hr.timesheets.lens.weekendsOnly'");
    expect(pure).not.toContain('@/lib/db');
    expect(pure).not.toContain('window.');
  });
});
