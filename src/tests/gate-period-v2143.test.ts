import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listTimelinePeriods,
  scopeGateTimeline,
  gateTimelineCsvFilename,
  type GateTimelineRow,
} from '@/lib/hr/payroll/gate-timeline';

/**
 * v2.143.0 — the story scopes itself.
 *
 * Gap: the lens (v2.142.0) answered "show me the stops"; it could not answer
 * "what did the gate do in OCTOBER". The read (v2.141.0) already carries each
 * run's period name, so the scope rides the SAME payload — a pure period
 * list, a pure period ∩ lens filter, and an export filename that says when
 * the story is scoped.
 *
 * Covered here:
 *  1. listTimelinePeriods — distinct labels, first-appearance order (the
 *     route feeds newest-first, so the picker lists the newest period first),
 *     DISTINCT runs per period (not row count), unlabeled rows never invent
 *     an entry, non-array degrades to [].
 *  2. scopeGateTimeline — period ∩ lens at ONE composition point: either
 *     dimension alone narrows, both intersect, order preserved, both off is
 *     a COPY (the caller's array is never mutated), unknown period → [] (an
 *     honest empty, never a silent unscoped view), non-array → [].
 *  3. gateTimelineCsvFilename — date-stamped like the desk export; scoped
 *     exports slug the period into the name (a scoped export and the
 *     full-window export must never look alike in a downloads folder); the
 *     clock is INJECTED (the consent filenames' own pattern).
 *  4. The card contract — picker rendered only when a labeled period exists
 *     (no dead control), "All periods" is a real option, the header chip
 *     keeps speaking the route-built ALL count, the scoped counts wear their
 *     own line (the pure summarizer re-run on the scoped set), the show-all
 *     bound composes after BOTH filters, the export maps the scoped set, a
 *     row's run label scopes the card on click, and both honest empties
 *     (scope-empty amber / lens-empty rose) keep their own voices.
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

// ── 1. listTimelinePeriods ───────────────────────────────────────────────────

describe('listTimelinePeriods - the periods the window actually holds', () => {
  it('lists distinct labels with attempt counts, first-appearance ordered', () => {
    // Newest-first feed (the route's reading direction): October first.
    const rows = [
      row({ id: 'e3', runLabel: 'October 2026' }),
      row({ id: 'e2', runLabel: 'September 2026' }),
      row({ id: 'e1', runLabel: 'October 2026' }),
    ];
    expect(listTimelinePeriods(rows)).toEqual([
      { label: 'October 2026', attempts: 2, runs: 1 },
      { label: 'September 2026', attempts: 1, runs: 1 },
    ]);
  });

  it('a period runs count is DISTINCT run ids, not rows', () => {
    const rows = [
      row({ id: 'e2', runId: 'run-b', runLabel: 'October 2026' }),
      row({ id: 'e1', runId: 'run-a', runLabel: 'October 2026' }),
    ];
    expect(listTimelinePeriods(rows)).toEqual([
      { label: 'October 2026', attempts: 2, runs: 2 },
    ]);
  });

  it('unlabeled rows never invent a period entry — they only live under All periods', () => {
    const rows = [row({ runLabel: null }), row({ runLabel: '   ' }), row({ runLabel: 'October 2026' })];
    expect(listTimelinePeriods(rows)).toEqual([
      { label: 'October 2026', attempts: 1, runs: 1 },
    ]);
  });

  it('non-array degrades to [] — never a crash', () => {
    expect(listTimelinePeriods(undefined as unknown as GateTimelineRow[])).toEqual([]);
    expect(listTimelinePeriods(null as unknown as GateTimelineRow[])).toEqual([]);
    expect(listTimelinePeriods('junk' as unknown as GateTimelineRow[])).toEqual([]);
  });

  it('empty window → empty list (the picker never renders for a fresh store)', () => {
    expect(listTimelinePeriods([])).toEqual([]);
  });
});

// ── 2. scopeGateTimeline ─────────────────────────────────────────────────────

describe('scopeGateTimeline - period ∩ lens, one composition point', () => {
  const window = [
    row({ id: 'e4', runLabel: 'October 2026', outcome: 'BLOCKED', tone: 'amber' }),
    row({ id: 'e3', runLabel: 'October 2026', outcome: 'PASSED' }),
    row({ id: 'e2', runLabel: 'September 2026', outcome: 'BLOCKED', tone: 'amber' }),
    row({ id: 'e1', runLabel: 'September 2026', outcome: 'PASSED' }),
  ];

  it('period alone narrows to that period, order preserved', () => {
    const scoped = scopeGateTimeline(window, { periodLabel: 'October 2026' });
    expect(scoped.map((r) => r.id)).toEqual(['e4', 'e3']);
  });

  it('lens alone matches filterGateTimeline semantics', () => {
    const scoped = scopeGateTimeline(window, { blockedOnly: true });
    expect(scoped.map((r) => r.id)).toEqual(['e4', 'e2']);
  });

  it('both dimensions intersect — a PASSED row can never smuggle into a scoped blocked view', () => {
    const scoped = scopeGateTimeline(window, { blockedOnly: true, periodLabel: 'September 2026' });
    expect(scoped.map((r) => r.id)).toEqual(['e2']);
  });

  it('both dimensions off returns a COPY — the caller\'s array is never mutated', () => {
    const source = [row({})];
    const out = scopeGateTimeline(source, {});
    expect(out).toEqual(source);
    expect(out).not.toBe(source);
    out.push(row({ id: 'mutant' }));
    expect(source.length).toBe(1);
  });

  it('an unknown period is an honest empty, never a silent unscoped view', () => {
    expect(scopeGateTimeline(window, { periodLabel: 'November 2026' })).toEqual([]);
  });

  it('null/empty label reads "all"; non-array degrades to []', () => {
    expect(scopeGateTimeline(window, { periodLabel: null }).length).toBe(4);
    expect(scopeGateTimeline(window, { periodLabel: '' }).length).toBe(4);
    expect(scopeGateTimeline(undefined as unknown as GateTimelineRow[], {})).toEqual([]);
  });
});

// ── 3. gateTimelineCsvFilename ───────────────────────────────────────────────

describe('gateTimelineCsvFilename - the file says what it holds', () => {
  it('unscoped stays the desk export\'s own shape: gate-activity-YYYY-MM-DD.csv', () => {
    const now = new Date('2026-10-19T09:30:00.000Z');
    expect(gateTimelineCsvFilename(null, now)).toBe('gate-activity-2026-10-19.csv');
    expect(gateTimelineCsvFilename(undefined, now)).toBe('gate-activity-2026-10-19.csv');
    expect(gateTimelineCsvFilename('', now)).toBe('gate-activity-2026-10-19.csv');
  });

  it('scoped exports slug the period in — a scoped file and the full window never look alike', () => {
    const now = new Date('2026-10-19T09:30:00.000Z');
    expect(gateTimelineCsvFilename('October 2026', now)).toBe(
      'gate-activity-october-2026-2026-10-19.csv',
    );
    // Slug discipline: every non-[a-z0-9] run collapses to one '-', trimmed.
    expect(gateTimelineCsvFilename('  Q4 / FY-2026!! ', now)).toBe(
      'gate-activity-q4-fy-2026-2026-10-19.csv',
    );
  });
});

// ── 4. The card contract ─────────────────────────────────────────────────────

describe("the payroll page's card period scope", () => {
  const page = () => readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('the picker renders only when the window holds a labeled period — no dead control', () => {
    const src = page();
    expect(src).toContain('timelinePeriods.length > 0 ? (');
    expect(src).toContain('payroll-gate-timeline-period-picker');
    expect(src).toContain("value={timelinePeriod ?? '__all__'}");
    expect(src).toContain('All periods');
  });

  it('the header chip keeps speaking the ROUTE-built ALL count — view preference, not a rewrite', () => {
    const src = page();
    expect(src).toContain('{timeline.summary.attempts}');
  });

  it('the scoped counts wear their own line — the pure summarizer re-run on the scoped set', () => {
    const src = page();
    expect(src).toContain('payroll-gate-timeline-scoped');
    expect(src).toContain('summarizeGateTimeline(timelineFiltered)');
  });

  it('the scope composes with the lens at ONE point; the show-all bound reads the scoped set', () => {
    const src = page();
    expect(src).toContain(
      'scopeGateTimeline(timeline?.rows ?? [], {\n        blockedOnly: timelineBlockedOnly,\n        periodLabel: timelinePeriod,\n      })',
    );
    expect(src).toContain('timelineShowAll ? timelineFiltered : timelineFiltered.slice(0, 8)');
  });

  it('the export maps the scoped set and the filename says when it is scoped', () => {
    const src = page();
    expect(src).toContain(
      'scopeGateTimeline(timeline.rows, {\n      blockedOnly: timelineBlockedOnly,\n      periodLabel: timelinePeriod,\n    })',
    );
    expect(src).toContain('gateTimelineCsvFilename(timelinePeriod)');
    expect(src).toContain('filtered to the current period and lens');
  });

  it('a row\'s run label scopes the card on click — the story scopes itself from the row', () => {
    const src = page();
    expect(src).toContain('payroll-gate-timeline-run-');
    expect(src).toContain('setTimelinePeriod(row.runLabel)');
  });

  it('both honest empties keep their own voices: scope-empty amber, lens-empty rose', () => {
    const src = page();
    expect(src).toContain('payroll-gate-timeline-scope-empty');
    expect(src).toContain('payroll-gate-timeline-lens-empty');
    expect(src).toContain('No blocked attempts in this period');
  });
});

// ── 5. The pure module stays pure ────────────────────────────────────────────

describe('the pure module stays pure', () => {
  it('gate-timeline.ts carries the scope family and keeps its no-db/no-network head', () => {
    const src = readRepo('src/lib/hr/payroll/gate-timeline.ts');
    expect(src).toContain('export function listTimelinePeriods');
    expect(src).toContain('export function scopeGateTimeline');
    expect(src).toContain('export function gateTimelineCsvFilename');
    expect(src).toMatch(/PURE module: no db, no network, no clock, no window/);
    expect(src).not.toMatch(/from ['"]@\/lib\/db['"]/);
    expect(src).not.toMatch(/fetch\(/);
  });
});
