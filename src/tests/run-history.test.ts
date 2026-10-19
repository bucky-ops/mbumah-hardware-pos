// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRunHistory, type RunHistorySource } from '@/lib/hr/payroll/run-history';

/**
 * v2.84.0: the run remembers its own steps — a who-did-what timeline built
 * from the lifecycle stamps the PayrollRun row already carries.
 * v2.85.0: the walk gains its missing step — the handover (submitted) gets
 * its own columns and its own event between Prepared and Approved; runs the
 * state machine proves were submitted show the step honestly even when the
 * stamp predates the column.
 *   1. PURE: lifecycle-ordered events, only facts the row stamps (the honest
 *      exceptions: the rejection bounce-back — who + why, never when — and
 *      the state-proven submission), actor labels through the map with an
 *      'Unknown user' floor.
 *   2. SURFACE: the detail route resolves every actor in ONE query and
 *      returns the history additively; the dialog renders the timeline
 *      between the action bar and the payslips (file-level contracts).
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

const FULL: RunHistorySource = {
  createdAt: '2026-10-10T08:00:00Z',
  initiatedBy: 'u-owner',
  status: 'PAID',
  preparedAt: '2026-10-11T09:30:00Z',
  preparedByUserId: 'u-maker',
  submittedAt: '2026-10-11T10:15:00Z',
  submittedById: 'u-maker',
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
    expect(events.map((e) => e.key)).toEqual(['initiated', 'prepared', 'submitted', 'approved', 'posted', 'locked', 'paid']);
    expect(events.map((e) => e.label)).toEqual(['Initiated', 'Prepared', 'Submitted for approval', 'Approved', 'Posted', 'Locked', 'Marked paid']);
    expect(events[1].actorLabel).toBe('Jane Maker');
    expect(events[2].actorLabel).toBe('Jane Maker');
    expect(events[2].atIso).toBe('2026-10-11T10:15:00.000Z');
    expect(events[3].actorLabel).toBe('John Checker');
    expect(events[4].note).toBe('Journal entry JE-2026-0042');
    expect(events[0].atIso).toBe('2026-10-10T08:00:00.000Z');
  });

  it('the handover can carry a different actor than the compute', () => {
    const events = buildRunHistory({ ...FULL, submittedById: 'u-runner' }, { 'u-maker': 'Jane Maker', 'u-runner': 'Peter Runner' });
    const submitted = events.find((e) => e.key === 'submitted');
    expect(submitted && submitted.actorLabel).toBe('Peter Runner');
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
        status: 'DRAFT',
        preparedAt: null, preparedByUserId: null,
        submittedAt: null, submittedById: null,
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

  it('a prepared draft that was never submitted shows Prepared but never promises the handover', () => {
    const events = buildRunHistory(
      {
        ...FULL,
        status: 'DRAFT',
        submittedAt: null, submittedById: null,
        approvedAt: null, approvedByUserId: null,
        postedAt: null, postedByUserId: null,
        lockedAt: null, lockedByUserId: null,
        paidAt: null, journalEntryNumber: null,
      },
      {},
    );
    expect(events.map((e) => e.key)).toEqual(['initiated', 'prepared']);
    expect(events.some((e) => e.key === 'submitted')).toBe(false);
  });

  it('a never-posted run never promises a Posted step', () => {
    const events = buildRunHistory({ ...FULL, postedAt: null, postedByUserId: null, lockedAt: null, lockedByUserId: null, paidAt: null, journalEntryNumber: null, status: 'APPROVED' }, {});
    expect(events.map((e) => e.key)).toEqual(['initiated', 'prepared', 'submitted', 'approved']);
    expect(events.some((e) => e.key === 'posted')).toBe(false);
  });

  it('the submission rides between prepared and approved, stamped', () => {
    const events = buildRunHistory(FULL, {});
    const order = events.map((e) => e.key);
    expect(order.indexOf('prepared')).toBeLessThan(order.indexOf('submitted'));
    expect(order.indexOf('submitted')).toBeLessThan(order.indexOf('approved'));
  });

  it('a run past the handover with a null stamp still shows the step — honestly', () => {
    // The state machine proves a POSTED run was submitted; the column says
    // the stamp predates v2.85.0. The event appears with no stamp and no actor.
    const events = buildRunHistory({ ...FULL, status: 'POSTED', submittedAt: null, submittedById: null }, {});
    const submitted = events.find((e) => e.key === 'submitted');
    expect(submitted).toBeDefined();
    expect(submitted && submitted.atIso).toBeNull();
    expect(submitted && submitted.actorLabel).toBe('—');
    expect(submitted && submitted.label).toBe('Submitted for approval');
  });

  it('a rejected run implies the submission even before the stamp existed', () => {
    const events = buildRunHistory(
      { ...FULL, status: 'REJECTED', submittedAt: null, submittedById: null, approvedAt: null, approvedByUserId: null, rejectedByUserId: 'u-checker', rejectionReason: 'Wrong rates.' },
      {},
    );
    expect(events.map((e) => e.key)).toContain('submitted');
    expect(events.map((e) => e.key)).toContain('rejected');
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
    expect(events[3].actorLabel).toBe('Unknown user'); // approvedByUserId unresolved
    expect(events[0].actorLabel).toBe('Unknown user'); // initiatedBy unresolved
  });

  it('events with no actor at all read the em dash, and the view hides it', () => {
    const events = buildRunHistory(FULL, {});
    expect(events).toHaveLength(7); // initiated, prepared, submitted, approved, posted, locked, paid
    expect(events[6].actorLabel).toBe('—'); // paid has no actor field by schema
  });

  it('a garbage timestamp is dropped, not thrown — and the proven step still shows', () => {
    const events = buildRunHistory({ ...FULL, preparedAt: 'not-a-date', preparedByUserId: 'u-maker' }, { 'u-maker': 'Jane' });
    expect(events.map((e) => e.key)).not.toContain('prepared');
    const garbage = buildRunHistory({ ...FULL, submittedAt: 'not-a-date' }, {});
    const submitted = garbage.find((e) => e.key === 'submitted');
    expect(submitted).toBeDefined(); // the status still proves it
    expect(submitted && submitted.atIso).toBeNull();
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
    // All seven actor fields feed the map (v2.85.0 adds the submitter).
    for (const field of ['initiatedBy', 'preparedByUserId', 'submittedById', 'approvedByUserId', 'rejectedByUserId', 'postedByUserId', 'lockedByUserId']) {
      expect(ROUTE).toContain(`run.${field}`);
    }
    // Additive: the pre-existing response shape is untouched.
    // v2.138.0: the additive gateTrail block rides the same payload.
    expect(ROUTE).toContain('return Response.json({ success: true, data: run, can, disbursement, history, gateTrail });');
    // Best-effort: a history failure must never degrade the run view.
    expect(ROUTE).toContain('} catch {\n      history = [];\n      gateTrail = [];\n    }');
  });

  it('the route hands the journal entry number to the builder', () => {
    expect(ROUTE).toContain('journalEntryNumber: run.journalEntry?.entryNumber ?? null');
  });

  it('the route passes the status and the handover stamps into the builder (v2.85.0)', () => {
    expect(ROUTE).toContain('status: run.status,');
    expect(ROUTE).toContain('submittedAt: run.submittedAt,');
    expect(ROUTE).toContain('submittedById: run.submittedById,');
    // The maker-checker boundary is the handover: the affordance follows.
    expect(ROUTE).toContain('isPreparer: run.preparedByUserId === session.userId || run.submittedById === session.userId,');
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

  it('the handover wears the indigo family, light and dark (v2.85.0)', () => {
    expect(DIALOG).toContain("submitted: 'bg-indigo-500 dark:bg-indigo-400',");
  });

  it('the header counts the steps the run has lived (v2.85.0 styling)', () => {
    expect(DIALOG).toContain('data-testid="payroll-run-history-count"');
    expect(DIALOG).toContain("{history.length} {history.length === 1 ? 'step' : 'steps'}");
  });

  it('the maker-checker copy covers the handover boundary (v2.85.0)', () => {
    expect(DIALOG).toContain('Maker-checker: the maker (preparer or submitter) cannot approve this run');
    expect(DIALOG).toContain('you prepared or submitted this run');
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

describe('v2.86.0 who\u2019s-next surface contracts', () => {
  const LIST_ROUTE = readRepo('src/app/api/payroll/runs/route.ts');
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');
  const DIALOG = readRepo('src/components/hr/payroll-run-dialog.tsx');

  it('the list route exposes the handover stamps additively', () => {
    expect(LIST_ROUTE).toContain('submittedAt: r.submittedAt?.toISOString() ?? null,');
    expect(LIST_ROUTE).toContain('submittedById: r.submittedById,');
    expect(LIST_ROUTE).toContain('return Response.json({ success: true, data });');
  });

  it('the runs table says how long a waiting run has waited (EAT)', () => {
    expect(PAGE).toContain("import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';");
    expect(PAGE).toContain("run.status === 'PENDING_APPROVAL' && run.submittedAt && (");
    expect(PAGE).toContain('waiting since {formatEatStamp(new Date(run.submittedAt))}');
    expect(PAGE).toContain('data-testid="payroll-run-waiting-since"');
    expect(PAGE).toContain('submittedAt: string | null;');
    expect(PAGE).toContain('submittedById: string | null;');
  });

  it('the dialog wears the who\u2019s-next strip between the actions and the filing row', () => {
    const stripAt = DIALOG.indexOf('data-testid="payroll-run-waiting-on"');
    const actionsAt = DIALOG.indexOf("void act('void')");
    const filingAt = DIALOG.indexOf('v2.53.0: filing row');
    expect(stripAt).toBeGreaterThan(-1);
    expect(actionsAt).toBeGreaterThan(-1);
    expect(filingAt).toBeGreaterThan(-1);
    expect(stripAt).toBeGreaterThan(actionsAt);
    expect(stripAt).toBeLessThan(filingAt);
  });

  it('the strip reads the three seats apart, from the history\u2019s own facts', () => {
    expect(DIALOG).toContain("const submittedEvent = history.find((e) => e.key === 'submitted');");
    expect(DIALOG).toContain('const canWaitOnYou = Boolean(can?.approve && !can?.isPreparer);');
    expect(DIALOG).toContain('Waiting on <span className="font-semibold">you</span>{handedPhrase}');
    expect(DIALOG).toContain('Maker-checker: you prepared or submitted this run, so approval must come from a different user{handedPhrase}.');
    expect(DIALOG).toContain('Waiting on an approver{handedPhrase}.');
    expect(DIALOG).toContain("` \u2014 handed over by ${submittedBy}${submittedWhen}`");
  });

  it('the strip is indigo for the eligible checker, amber for the bound maker, muted for spectators', () => {
    expect(DIALOG).toContain('border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300');
    expect(DIALOG).toContain('border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300');
    expect(DIALOG).toContain("'border-border bg-muted/40 text-muted-foreground'");
    expect(DIALOG).toContain('<Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />');
  });

  it('the strip never invents a wait: hidden without a handover, the old note is superseded', () => {
    expect(DIALOG).toContain("status === 'PENDING_APPROVAL' && submittedEvent && (");
    // The standalone maker-checker note is gone — the strip carries it now.
    expect(DIALOG).not.toContain('so approval must come from a\n                  different user');
    // The handover-actor phrases derive only from what the row stamps.
    expect(DIALOG).toContain("submittedEvent?.actorLabel && submittedEvent.actorLabel !== '\u2014' ? submittedEvent.actorLabel : null");
  });
});
