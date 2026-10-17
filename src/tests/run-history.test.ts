// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRunHistory, type RunHistorySource } from '@/lib/hr/payroll/run-history';

/**
 * v2.84.0: the run remembers its own steps — a who-did-what timeline built
 * from the lifecycle stamps the PayrollRun row already carries.
 *   1. PURE: lifecycle-ordered events, only facts the row stamps (the ONE
 *      exception is the rejection bounce-back: who + why, never when), actor
 *      labels through the map with an 'Unknown user' floor.
 *   2. SURFACE: the detail route resolves every actor in ONE query and
 *      returns the history additively; the dialog renders the timeline
 *      between the action bar and the payslips (file-level contracts).
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

const FULL: RunHistorySource = {
  createdAt: '2026-10-10T08:00:00Z',
  initiatedBy: 'u-owner',
  preparedAt: '2026-10-11T09:30:00Z',
  preparedByUserId: 'u-maker',
  approvedAt: '2026-10-12T10:00:00Z',
  approvedByUserId: 'u-checker',
  rejectedByUserId: null,
  rejectionReason: null,
  postedAt: '2026-10-13T11:15:00Z',
  postedByUserId: 'u-poster',
  lockedAt: '2026-10-14T12:00:00Z',
  lockedByUserId: 'u-owner',
  paidAt: '2026-10-15T13:45:00Z',
  journalEntryNumber: 'JE-2026-0042',
};

describe('buildRunHistory — the happy walk', () => {
  it('orders the stamped steps in lifecycle order with resolved names', () => {
    const events = buildRunHistory(FULL, {
      'u-owner': 'Mbumah Owner',
      'u-maker': 'Jane Maker',
      'u-checker': 'John Checker',
      'u-poster': 'Ada Accountant',
    });
    expect(events.map((e) => e.key)).toEqual(['initiated', 'prepared', 'approved', 'posted', 'locked', 'paid']);
    expect(events.map((e) => e.label)).toEqual(['Initiated', 'Prepared', 'Approved', 'Posted', 'Locked', 'Marked paid']);
    expect(events[1].actorLabel).toBe('Jane Maker');
    expect(events[2].actorLabel).toBe('John Checker');
    expect(events[3].note).toBe('Journal entry JE-2026-0042');
    expect(events[0].atIso).toBe('2026-10-10T08:00:00.000Z');
  });

  it('accepts Date objects and normalizes to ISO', () => {
    const events = buildRunHistory({ ...FULL, createdAt: new Date('2026-10-10T08:00:00Z') }, {});
    expect(events[0].atIso).toBe('2026-10-10T08:00:00.000Z');
  });
});

describe('buildRunHistory — honesty contracts', () => {
  it('a fresh draft shows exactly one event (initiated)', () => {
    const events = buildRunHistory(
      {
        createdAt: '2026-10-17T08:00:00Z',
        initiatedBy: 'u-owner',
        preparedAt: null, preparedByUserId: null,
        approvedAt: null, approvedByUserId: null,
        rejectedByUserId: null, rejectionReason: null,
        postedAt: null, postedByUserId: null,
        lockedAt: null, lockedByUserId: null,
        paidAt: null,
      },
      { 'u-owner': 'Mbumah Owner' },
    );
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ key: 'initiated', label: 'Initiated', actorLabel: 'Mbumah Owner' });
  });

  it('a never-posted run never promises a Posted step', () => {
    const events = buildRunHistory({ ...FULL, postedAt: null, lockedAt: null, paidAt: null, journalEntryNumber: null }, {});
    expect(events.map((e) => e.key)).toEqual(['initiated', 'prepared', 'approved']);
    expect(events.some((e) => e.key === 'posted')).toBe(false);
  });

  it('the rejection rides with its reason and an honest null stamp', () => {
    const events = buildRunHistory(
      { ...FULL, approvedAt: null, approvedByUserId: null, rejectedByUserId: 'u-checker', rejectionReason: 'Casual day rates for J. Wanjiku are missing.' },
      { 'u-checker': 'John Checker' },
    );
    const rejected = events.find((e) => e.key === 'rejected');
    expect(rejected).toBeDefined();
    expect(need(rejected).atIso).toBeNull();
    expect(need(rejected).actorLabel).toBe('John Checker');
    expect(need(rejected).note).toBe('Reason: Casual day rates for J. Wanjiku are missing.');
  });

  it('a rejection reason alone (no actor) still surfaces the bounce-back', () => {
    const events = buildRunHistory({ ...FULL, rejectedByUserId: null, rejectionReason: 'Wrong rates.' }, {});
    expect(events.find((e) => e.key === 'rejected')).toBeDefined();
  });

  it('unresolvable actor IDs say Unknown user instead of vanishing', () => {
    const events = buildRunHistory(FULL, { 'u-maker': 'Jane Maker' });
    expect(events[2].actorLabel).toBe('Unknown user'); // approvedByUserId unresolved
    expect(events[0].actorLabel).toBe('Unknown user'); // initiatedBy unresolved
  });

  it('events with no actor at all read the em dash, and the view hides it', () => {
    const events = buildRunHistory(FULL, {});
    expect(events).toHaveLength(6); // initiated, prepared, approved, posted, locked, paid
    expect(events[5].actorLabel).toBe('—'); // paid has no actor field by schema
  });

  it('a garbage timestamp is dropped, not thrown', () => {
    const events = buildRunHistory({ ...FULL, preparedAt: 'not-a-date', preparedByUserId: 'u-maker' }, { 'u-maker': 'Jane' });
    expect(events.map((e) => e.key)).not.toContain('prepared');
  });
});

/** Non-null helper that keeps the lint baseline clean (no `!` assertions). */
function need<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('unexpected null in test');
  return value;
}

describe('v2.84.0 run-history surface contracts', () => {
  const ROUTE = readRepo('src/app/api/payroll/runs/[id]/route.ts');
  const DIALOG = readRepo('src/components/hr/payroll-run-dialog.tsx');

  it('the route resolves every lifecycle actor in ONE query and builds additively', () => {
    expect(ROUTE).toContain("import { buildRunHistory } from '@/lib/hr/payroll/run-history';");
    expect(ROUTE).toContain('db.user.findMany({');
    expect(ROUTE).toContain("where: { id: { in: actorIds } }");
    expect(ROUTE).toContain("select: { id: true, name: true, email: true }");
    expect(ROUTE).toContain("u.name?.trim() || u.email || 'Unknown user'");
    // All six actor fields feed the map.
    for (const field of ['initiatedBy', 'preparedByUserId', 'approvedByUserId', 'rejectedByUserId', 'postedByUserId', 'lockedByUserId']) {
      expect(ROUTE).toContain(`run.${field}`);
    }
    // Additive: the pre-existing response shape is untouched.
    expect(ROUTE).toContain('return Response.json({ success: true, data: run, can, disbursement, history });');
    // Best-effort: a history failure must never degrade the run view.
    expect(ROUTE).toContain('} catch {\n      history = [];\n    }');
  });

  it('the route hands the journal entry number to the builder', () => {
    expect(ROUTE).toContain('journalEntryNumber: run.journalEntry?.entryNumber ?? null');
  });

  it('the dialog renders the timeline between the action bar and the payslips', () => {
    const historyAt = DIALOG.indexOf('data-testid="payroll-run-history"');
    const gateIssuesAt = DIALOG.indexOf('{/* Gate issues */}');
    const payslipsAt = DIALOG.indexOf('{/* Payslip table */}');
    expect(historyAt).toBeGreaterThan(-1);
    expect(gateIssuesAt).toBeGreaterThan(historyAt);
    expect(payslipsAt).toBeGreaterThan(gateIssuesAt);
    expect(DIALOG).toContain("<History className=\"h-3.5 w-3.5\" /> Run history");
    expect(DIALOG).toContain('data-testid={`payroll-run-history-${event.key}`}');
  });

  it('every stamp is EAT, via the same builder the bundle manifest uses', () => {
    expect(DIALOG).toContain("import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';");
    expect(DIALOG).toContain("event.atIso ? formatEatStamp(new Date(event.atIso)) : 'no timestamp recorded'");
  });

  it('each event carries its family dot and the connector line only between events', () => {
    expect(DIALOG).toContain('HISTORY_DOT_STYLES[event.key]');
    expect(DIALOG).toContain("bg-violet-500 dark:bg-violet-400");
    expect(DIALOG).toContain('bg-rose-500 dark:bg-rose-400');
    expect(DIALOG).toContain('{i < history.length - 1 && (');
    expect(DIALOG).toContain('className="absolute left-[5px] top-4 h-full w-px bg-border"');
  });

  it('the rejection note wears the rose family; the journal note the emerald', () => {
    expect(DIALOG).toContain("event.key === 'rejected'");
    expect(DIALOG).toContain("'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'");
    expect(DIALOG).toContain("'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'");
  });

  it('the timeline is null-safe for stale responses and hides when empty', () => {
    expect(DIALOG).toContain('const history = detail?.history ?? [];');
    expect(DIALOG).toContain('{history.length > 0 && (');
  });
});
