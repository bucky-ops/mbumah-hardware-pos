import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  gateTimelineLensFilter,
  listTimelinePeriods,
  scopeGateTimeline,
  type GateTimelineLens,
  type GateTimelineRow,
} from '@/lib/hr/payroll/gate-timeline';

/**
 * v2.144.0 — the lens learns the other outcome.
 *
 * Gap: "show me the stops" got a lens (v2.142.0, blocked-only); the mirror
 * question — "show me the times the gate said YES" — still had to be scanned
 * by eye. The lens becomes a three-way outcome filter (ALL / BLOCKED /
 * PASSED) and the period picker's items wear each period's newest attempt's
 * outcome as a tone dot.
 *
 * Covered here:
 *  1. gateTimelineLensFilter — 'blocked' / 'passed' / 'all'; the UNKNOWN
 *     rows survive ONLY under 'all' (an unreadable outcome is honestly
 *     neither passed nor blocked, so neither lens may claim it); garbage
 *     lens degrades to 'all' (never a guessed filter); order preserved;
 *     copy semantics; non-array degrades to [].
 *  2. scopeGateTimeline with the lens — the ONE composition point keeps its
 *     parity with the standalone filter; period ∩ lens intersects; unknown
 *     period stays an honest empty.
 *  3. listTimelinePeriods — each period now speaks its NEWEST attempt's
 *     outcome, clock-based through summarizeGateTimeline (ONE definition of
 *     "last" everywhere on the card); ties fall back to array order;
 *     attempts/runs/unlabeled rules unchanged.
 *  4. The card contract — the joined segmented trio (role=group, three
 *     aria-pressed members), the families (ALL neutral / BLOCKED rose /
 *     PASSED emerald — the lens dresses as the rows it keeps), both
 *     scopeGateTimeline call sites reading `lens: timelineLens`, the
 *     scope-empty guard reading the lens, the lens-empty's PASSED voice,
 *     the picker dot, and the summary chip still route-built.
 *  5. Purity — the module keeps its no-db/no-network/no-clock head (the
 *     filename's injected default stays the only `new Date()`).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const row = (over: Partial<GateTimelineRow>): GateTimelineRow => ({
  id: 'evt-1',
  runId: 'run-1',
  runLabel: 'October 2026',
  runStatus: 'DRAFT',
  outcome: 'PASSED',
  atIso: '2026-10-19T14:45:00.000Z',
  text: '5 clear',
  tone: 'emerald',
  actorLabel: 'Mbumah Hardware Owner',
  moved: false,
  ...over,
});

// ── 1. gateTimelineLensFilter ────────────────────────────────────────────────

describe('gateTimelineLensFilter - three ways, one honesty rule', () => {
  const rows = [
    row({ id: 'e1', outcome: 'BLOCKED', tone: 'amber' }),
    row({ id: 'e2', outcome: 'PASSED' }),
    row({ id: 'e3', outcome: 'UNKNOWN', tone: 'muted' }),
    row({ id: 'e4', outcome: 'BLOCKED', tone: 'amber' }),
    row({ id: 'e5', outcome: 'PASSED' }),
  ];

  it("'blocked' keeps every BLOCKED row, in order; PASSED and UNKNOWN drop", () => {
    expect(gateTimelineLensFilter(rows, 'blocked').map((r) => r.id)).toEqual(['e1', 'e4']);
  });

  it("'passed' keeps every PASSED row, in order; BLOCKED and UNKNOWN drop", () => {
    expect(gateTimelineLensFilter(rows, 'passed').map((r) => r.id)).toEqual(['e2', 'e5']);
  });

  it('UNKNOWN rows survive ONLY under all — garbage never passes either lens', () => {
    const unknownOnly = [row({ id: 'u1', outcome: 'UNKNOWN', tone: 'muted' })];
    expect(gateTimelineLensFilter(unknownOnly, 'blocked')).toEqual([]);
    expect(gateTimelineLensFilter(unknownOnly, 'passed')).toEqual([]);
    expect(gateTimelineLensFilter(unknownOnly, 'all').map((r) => r.id)).toEqual(['u1']);
  });

  it("'all', undefined, and a garbage lens all keep every row — never a guessed filter", () => {
    expect(gateTimelineLensFilter(rows, 'all').map((r) => r.id)).toEqual([
      'e1',
      'e2',
      'e3',
      'e4',
      'e5',
    ]);
    expect(gateTimelineLensFilter(rows, undefined).length).toBe(5);
    expect(
      gateTimelineLensFilter(rows, 'BLOCKED' as unknown as GateTimelineLens).length,
    ).toBe(5);
    expect(gateTimelineLensFilter(rows, '' as unknown as GateTimelineLens).length).toBe(5);
  });

  it('a view preference, not a data change: copy semantics hold on every branch', () => {
    for (const lens of ['all', 'blocked', 'passed', undefined] as const) {
      const out = gateTimelineLensFilter(rows, lens as GateTimelineLens | undefined);
      expect(out).not.toBe(rows);
      out.push(row({ id: 'mutant' }));
      expect(rows.length).toBe(5);
    }
  });

  it('non-array degrades to [] — never a crash', () => {
    expect(gateTimelineLensFilter(undefined as unknown as GateTimelineRow[], 'blocked')).toEqual([]);
    expect(gateTimelineLensFilter(null as unknown as GateTimelineRow[], 'passed')).toEqual([]);
    expect(gateTimelineLensFilter('junk' as unknown as GateTimelineRow[], 'all')).toEqual([]);
  });
});

// ── 2. scopeGateTimeline with the lens ───────────────────────────────────────

describe('scopeGateTimeline - the ONE composition point grows the lens', () => {
  const window = [
    row({ id: 'e4', runLabel: 'October 2026', outcome: 'BLOCKED', tone: 'amber' }),
    row({ id: 'e3', runLabel: 'October 2026', outcome: 'PASSED' }),
    row({ id: 'e2', runLabel: 'September 2026', outcome: 'BLOCKED', tone: 'amber' }),
    row({ id: 'e1', runLabel: 'September 2026', outcome: 'UNKNOWN', tone: 'muted' }),
  ];

  it('lens alone matches gateTimelineLensFilter parity', () => {
    expect(scopeGateTimeline(window, { lens: 'blocked' }).map((r) => r.id)).toEqual(['e4', 'e2']);
    expect(scopeGateTimeline(window, { lens: 'passed' }).map((r) => r.id)).toEqual(['e3']);
    expect(scopeGateTimeline(window, { lens: 'all' }).length).toBe(4);
  });

  it('period ∩ lens intersect — an UNKNOWN row can never smuggle into a passed view', () => {
    const scoped = scopeGateTimeline(window, { lens: 'passed', periodLabel: 'September 2026' });
    expect(scoped).toEqual([]); // September's PASSED seat is taken by UNKNOWN — honest empty
    expect(scopeGateTimeline(window, { lens: 'passed', periodLabel: 'October 2026' }).map((r) => r.id)).toEqual(['e3']);
  });

  it('a garbage lens degrades to the unfiltered view, never a guessed filter', () => {
    expect(
      scopeGateTimeline(window, { lens: 'PASSED' as unknown as GateTimelineLens }).length,
    ).toBe(4);
  });

  it('an unknown period stays an honest empty; non-array degrades to []', () => {
    expect(scopeGateTimeline(window, { lens: 'passed', periodLabel: 'November 2026' })).toEqual([]);
    expect(scopeGateTimeline(undefined as unknown as GateTimelineRow[], { lens: 'blocked' })).toEqual([]);
  });
});

// ── 3. listTimelinePeriods — the picker dot's data ───────────────────────────

describe('listTimelinePeriods - each period speaks its newest outcome', () => {
  it("lastOutcome is the CLOCK-newest attempt's, not the first-appearance row's", () => {
    // Newest-first feed (the route's direction): October's FIRST row is
    // BLOCKED at 13:50, its second PASSED at 15:20 — the period's last
    // outcome must be PASSED because the clock says so.
    const rows = [
      row({ id: 'e2', outcome: 'BLOCKED', tone: 'amber', atIso: '2026-10-19T13:50:00.000Z' }),
      row({ id: 'e1', outcome: 'PASSED', atIso: '2026-10-19T15:20:00.000Z' }),
    ];
    const periods = listTimelinePeriods(rows);
    expect(periods).toHaveLength(1);
    expect(periods[0].lastOutcome).toBe('PASSED');
    expect(periods[0].lastAtIso).toBe('2026-10-19T15:20:00.000Z');
  });

  it('clock ties fall back to array order (the route has made it deterministic)', () => {
    const rows = [
      row({ id: 'e2', outcome: 'BLOCKED', tone: 'amber', atIso: '2026-10-19T14:45:00.000Z' }),
      row({ id: 'e1', outcome: 'PASSED', atIso: '2026-10-19T14:45:00.000Z' }),
    ];
    expect(listTimelinePeriods(rows)[0].lastOutcome).toBe('PASSED');
  });

  it('unreadable clocks never hijack the pick — a real clock wins over NaN', () => {
    const rows = [
      row({ id: 'e2', outcome: 'BLOCKED', tone: 'amber', atIso: null }),
      row({ id: 'e1', outcome: 'PASSED', atIso: '2026-10-19T09:00:00.000Z' }),
    ];
    expect(listTimelinePeriods(rows)[0].lastOutcome).toBe('PASSED');
    expect(listTimelinePeriods(rows)[0].lastAtIso).toBe('2026-10-19T09:00:00.000Z');
  });

  it('attempts/runs/unlabeled rules ride unchanged (distinct run ids, unlabeled never invents)', () => {
    const rows = [
      row({ id: 'e3', runId: 'run-b', runLabel: 'October 2026', outcome: 'BLOCKED', tone: 'amber', atIso: '2026-10-19T16:00:00.000Z' }),
      row({ id: 'e2', runId: 'run-a', runLabel: 'October 2026' }),
      row({ id: 'e1', runLabel: null }),
    ];
    const periods = listTimelinePeriods(rows);
    expect(periods).toHaveLength(1);
    expect(periods[0].attempts).toBe(2);
    expect(periods[0].runs).toBe(2);
    expect(periods[0].lastOutcome).toBe('BLOCKED');
  });

  it('non-array and empty degrade honestly', () => {
    expect(listTimelinePeriods(undefined as unknown as GateTimelineRow[])).toEqual([]);
    expect(listTimelinePeriods([])).toEqual([]);
  });
});

// ── 4. The card contract ─────────────────────────────────────────────────────

describe("the payroll page's outcome lens trio + picker dots", () => {
  const page = readRepo('src/app/(shell)/hr/payroll/page.tsx');
  const pure = readRepo('src/lib/hr/payroll/gate-timeline.ts');

  it('the lens is a joined segmented group with three aria-pressed members', () => {
    expect(page).toContain('data-testid="payroll-gate-timeline-lens"');
    expect(page).toContain('role="group"');
    expect(page).toContain('data-testid="payroll-gate-timeline-lens-all"');
    expect(page).toContain('data-testid="payroll-gate-timeline-lens-blocked"');
    expect(page).toContain('data-testid="payroll-gate-timeline-lens-passed"');
    expect(page).toContain("aria-pressed={timelineLens === 'all'}");
    expect(page).toContain("aria-pressed={timelineLens === 'blocked'}");
    expect(page).toContain("aria-pressed={timelineLens === 'passed'}");
    expect(page).toContain("useState<GateTimelineLens>('all')");
  });

  it('the lens dresses as the rows it keeps: ALL neutral, BLOCKED rose, PASSED emerald', () => {
    expect(page).toContain('bg-muted text-foreground hover:bg-muted hover:text-foreground');
    expect(page).toContain('border border-rose-300 bg-rose-50 text-rose-800');
    expect(page).toContain('dark:bg-rose-950/50 dark:text-rose-300');
    expect(page).toContain('border border-emerald-300 bg-emerald-50 text-emerald-800');
    expect(page).toContain('dark:bg-emerald-950/50 dark:text-emerald-300');
    expect(page).toContain('Passed only');
    expect(page).toContain('Blocked only');
  });

  it('both composition sites read `lens: timelineLens` — one state, one truth', () => {
    expect(page.match(/lens: timelineLens,/g)?.length).toBe(2);
    expect(page).not.toContain('timelineBlockedOnly');
    expect(page).not.toContain('blockedOnly');
  });

  it('the scope-empty guard reads the lens; the lens-empty speaks the PASSED voice too', () => {
    expect(page).toContain("timelinePeriod && timelineLens === 'all'");
    expect(page).toContain('No passed attempts in this period');
    expect(page).toContain('No passed attempts in the window');
    expect(page).toContain('the attempts on record were stopped or unreadable');
  });

  it('the picker items wear the outcome dot — tone per outcome, word in the title', () => {
    expect(page).toContain('data-testid="payroll-gate-timeline-period-outcome"');
    expect(page).toContain('bg-emerald-500 dark:bg-emerald-400');
    expect(page).toContain('bg-amber-500 dark:bg-amber-400');
    expect(page).toContain('bg-muted-foreground/40');
    expect(page).toContain('Last attempt outcome:');
    expect(page).toContain('p.lastOutcome');
  });

  it('the summary chip stays route-built — a view preference never rewrites the whole story', () => {
    expect(page).toContain('timeline.summary.attempts}');
    expect(page).toContain('summarizeGateTimeline(timelineFiltered)');
  });

  it('the pure module carries the lens family; stays PURE (injected clock unchanged)', () => {
    expect(pure).toContain("export type GateTimelineLens = 'all' | 'blocked' | 'passed'");
    expect(pure).toContain('export function gateTimelineLensFilter');
    expect(pure).toContain("if (lens === 'blocked') return rows.filter((r) => r && r.outcome === 'BLOCKED');");
    expect(pure).toContain("if (lens === 'passed') return rows.filter((r) => r && r.outcome === 'PASSED');");
    const code = pure.replace(/^\s*\/\/.*$/gm, '');
    const clockUses = code.match(/new Date\(\)/g) ?? [];
    expect(clockUses.length).toBe(1); // the filename's injected default only
    expect(code).toContain('when: Date = new Date()');
    expect(!/@prisma\/client|node-fetch|axios|fetch\(|window\./.test(code)).toBe(true);
  });
});
