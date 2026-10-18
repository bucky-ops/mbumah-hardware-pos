// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The route import chains to the server stack; the parser under test is
// pure, so the seams are stubbed exactly like the reviews-export suite does.
const db = vi.hoisted(() => ({
  goal: { findMany: vi.fn().mockResolvedValue([]) },
  employee: { findUnique: vi.fn() },
  reviewCycle: { findMany: vi.fn().mockResolvedValue([]) },
  organization: { findUnique: vi.fn() },
  store: { findUnique: vi.fn() },
  performanceReview: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
}));
vi.mock('@/lib/db', () => ({ db, runWithoutTenant: async <T,>(fn: () => Promise<T>) => fn() }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue(undefined),
  HrEntityType: { DATA_EXPORT: 'DataExport' },
}));

import { cyclesToCsv, goalsToCsv } from '@/lib/hr/performance-csv';
import { parseGoalsExportQuery } from '@/app/api/hr/goals/export/route';

/**
 * v2.97.0: every performance list files itself — the family completes.
 *
 *   1. THE FAMILY COMPLETES — the Cycles and Goals tabs file through the
 *      SAME governed contract the Reviews tab has carried since v2.96: one
 *      pure server builder per list, the digest escaper (one OWASP formula-
 *      injection guard shared everywhere), the header-block layout family,
 *      RFC-4180 CRLF, honest slug filenames.
 *   2. THE CYCLES FILE KEEPS THE NOTES OUT — the export is read-guarded
 *      (hr.performance.review) while calibrationNotes are manage-only
 *      content; the builder's input slice omits the field, so the leak is
 *      impossible by construction (the same typed floor the reviews file
 *      gives ratings).
 *   3. THE GOALS FILE RIDES THE FILTERS — employee / source / status chips
 *      steer the query; the route re-runs listGoals with the same
 *      predicates (the source predicate joined the service this round), so
 *      the file cannot disagree with the screen. A garbage status or source
 *      is a 400, never a silent 'all'; an empty subset is a 404, never an
 *      empty-looking sheet.
 *   4. HONEST EDGES — the buttons rest with an explanation when there is
 *      nothing to file, and every export lands an audit row with field
 *      names only.
 *
 * File-level contracts (the perf-reviews-csv.test.ts pattern) plus the
 * pure builders and the goals query parser executed for real.
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

/** Narrow the builders' null path without the forbidden non-null assertion. */
function must<T>(f: T | null): T {
  if (!f) throw new Error('expected a governed file, got null');
  return f;
}

const CYCLES = [
  {
    name: 'H2 2026 Reviews',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-12-31T00:00:00.000Z',
    status: 'ACTIVE',
    reviewCount: 2,
    statusCounts: { DRAFT: 1, SUBMITTED: 0, ACKNOWLEDGED: 0, CALIBRATED: 1 },
    createdAt: '2026-09-15T08:00:00.000Z',
  },
  {
    name: 'H1 2026 Reviews',
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-06-30T00:00:00.000Z',
    status: 'CLOSED',
    reviewCount: 0,
    statusCounts: { DRAFT: 0, SUBMITTED: 0, ACKNOWLEDGED: 0, CALIBRATED: 0 },
    createdAt: '2026-01-05T08:00:00.000Z',
  },
];

const CYCLE_META = { organizationName: 'MBUMAH Hardware', scopeLabel: 'All branches' };

const GOALS = [
  {
    title: 'Close 12 custom warranty calls weekly',
    employeeName: 'David Otieno',
    cycleName: 'H2 2026 Reviews',
    metricSource: 'CUSTOM',
    metricLabel: 'warranty calls closed',
    status: 'OPEN',
    currentValue: '4.00',
    targetValue: '12.00',
    progressPct: 33.3,
    dueDate: '2026-11-30T00:00:00.000Z',
  },
  {
    title: 'November sales total',
    employeeName: 'Grace Achieng',
    cycleName: null,
    metricSource: 'SALES_TOTAL',
    metricLabel: null,
    status: 'ACHIEVED',
    currentValue: '150000.00',
    targetValue: '120000.00',
    progressPct: 100,
    dueDate: null,
  },
];

const GOAL_META = {
  organizationName: 'MBUMAH Hardware',
  scopeLabel: 'Juja Main',
  sourceLabel: 'all',
  statusLabel: 'all',
};

describe('builder — cyclesToCsv is the governed family', () => {
  it('the header block names the report, org, scope and generation time (no filters — the list is unfiltered)', () => {
    const f = must(cyclesToCsv(CYCLES, CYCLE_META, new Date('2026-10-18T05:00:00.000Z')));
    const lines = f.csv.split('\r\n');
    expect(lines[0]).toBe('Report,Performance cycles');
    expect(lines[1]).toBe('Organization,MBUMAH Hardware');
    expect(lines[2]).toBe('Scope,All branches');
    expect(lines[3]).toBe('Generated (UTC),2026-10-18T05:00:00.000Z');
  });

  it('the table carries one row per cycle in screen order with the meter rebuilt as columns', () => {
    const f = must(cyclesToCsv(CYCLES, CYCLE_META));
    const lines = f.csv.split('\r\n');
    expect(lines[5]).toBe('Cycles');
    expect(lines[6]).toBe(
      'Cycle,Period start,Period end,Status,Reviews,Calibrated,Draft,Submitted,Acknowledged,Created',
    );
    expect(lines[7]).toBe('H2 2026 Reviews,2026-07-01,2026-12-31,ACTIVE,2,1,1,0,0,2026-09-15');
    expect(lines[8]).toBe('H1 2026 Reviews,2026-01-01,2026-06-30,CLOSED,0,0,0,0,0,2026-01-05');
    // RFC-4180: trailing CRLF at end of file.
    expect(f.csv.endsWith('\r\n')).toBe(true);
  });

  it('statuses stay the raw lifecycle enums and dates stay ISO day keys', () => {
    const f = must(cyclesToCsv(CYCLES, CYCLE_META));
    expect(f.csv).toContain(',ACTIVE,2,1,1,0,0,');
    expect(f.csv).toContain(',CLOSED,0,0,0,0,0,');
    expect(f.csv).not.toContain('T00:00'); // day precision, like the screen
  });

  it('the OWASP formula-injection guard and RFC-4180 quoting ride the shared escaper', () => {
    const f = must(
      cyclesToCsv(
        [{ ...CYCLES[0], name: '=HYPERLINK("http://evil","x")' }],
        CYCLE_META,
      ),
    );
    expect(f.csv).toContain("'=HYPERLINK");
    const q = must(cyclesToCsv([{ ...CYCLES[0], name: 'H2, "both" halves' }], CYCLE_META));
    expect(q.csv).toContain('"H2, ""both"" halves"');
  });

  it('the filename is the honest constant — the cycles list has no filters to slug', () => {
    expect(must(cyclesToCsv(CYCLES, CYCLE_META)).filename).toBe('mbumah-performance-cycles.csv');
  });

  it('an empty list is nothing to file — the builder returns null (route maps to 404)', () => {
    expect(cyclesToCsv([], CYCLE_META)).toBeNull();
  });

  it('the privacy floor is typed in: the row input has NO calibrationNotes field to leak', () => {
    const src = readRepo('src/lib/hr/performance-csv.ts');
    const iface = src.split('export interface CycleCsvRow')[1]?.split('\n}')[0] ?? '';
    expect(iface.length > 0).toBe(true);
    expect(iface).not.toContain('calibrationNotes');
    // The route's mapping narrows the DTO to the filing slice — the notes
    // never even reach the builder's doorstep.
    const route = readRepo('src/app/api/hr/performance/cycles/export/route.ts');
    const map = route.split('cycles.map((c) => ({')[1]?.split('})),')[0] ?? '';
    expect(map.length > 0).toBe(true);
    expect(map).not.toContain('calibrationNotes');
  });
});

describe('builder — goalsToCsv is the governed family', () => {
  it('the header block names the report, org, scope, filters and generation time', () => {
    const f = must(goalsToCsv(GOALS, GOAL_META, new Date('2026-10-18T05:00:00.000Z')));
    const lines = f.csv.split('\r\n');
    expect(lines[0]).toBe('Report,Team goals');
    expect(lines[1]).toBe('Organization,MBUMAH Hardware');
    expect(lines[2]).toBe('Scope,Juja Main');
    expect(lines[3]).toBe('Source,all');
    expect(lines[4]).toBe('Status,all');
    expect(lines[5]).toBe('Generated (UTC),2026-10-18T05:00:00.000Z');
  });

  it('the table carries one row per goal with the metric named honestly and values locale-free', () => {
    const f = must(goalsToCsv(GOALS, GOAL_META));
    const lines = f.csv.split('\r\n');
    expect(lines[7]).toBe('Goals');
    expect(lines[8]).toBe('Goal,Employee,Cycle,Source,Metric,Status,Current,Target,Progress %,Due');
    expect(lines[9]).toBe(
      'Close 12 custom warranty calls weekly,David Otieno,H2 2026 Reviews,CUSTOM,warranty calls closed,OPEN,4.00,12.00,33.3,2026-11-30',
    );
    expect(lines[10]).toBe('November sales total,Grace Achieng,,SALES_TOTAL,,ACHIEVED,150000.00,120000.00,100,');
    expect(f.csv.endsWith('\r\n')).toBe(true);
  });

  it('the OWASP formula-injection guard and RFC-4180 quoting ride the shared escaper', () => {
    const f = must(
      goalsToCsv([{ ...GOALS[0], title: '=HYPERLINK("http://evil","x")' }], GOAL_META),
    );
    expect(f.csv).toContain("'=HYPERLINK");
    const q = must(goalsToCsv([{ ...GOALS[0], title: 'Calls, "both" kinds' }], GOAL_META));
    expect(q.csv).toContain('"Calls, ""both"" kinds"');
  });

  it('the filename slugs the source and status filters — filed copies never overwrite each other', () => {
    expect(must(goalsToCsv(GOALS, GOAL_META)).filename).toBe(
      'mbumah-performance-goals-all-all.csv',
    );
    expect(
      must(goalsToCsv(GOALS, { ...GOAL_META, sourceLabel: 'sales total', statusLabel: 'open' }))
        .filename,
    ).toBe('mbumah-performance-goals-sales-total-open.csv');
  });

  it('an empty list is nothing to file — the builder returns null (route maps to 404)', () => {
    expect(goalsToCsv([], GOAL_META)).toBeNull();
  });

  it('the privacy floor: the row input carries board facts only — no narratives, no notes', () => {
    const src = readRepo('src/lib/hr/performance-csv.ts');
    const iface = src.split('export interface GoalCsvRow')[1]?.split('\n}')[0] ?? '';
    expect(iface.length > 0).toBe(true);
    expect(iface).not.toContain('calibrationNotes');
    expect(iface).not.toContain('strengths');
    expect(iface).not.toContain('improvements');
    // One escaper everywhere: the goals builder reuses the digest guard.
    expect(src).toContain("import { csvCell } from '@/lib/hr/digest-csv'");
  });
});

describe('parser — the goals export refuses garbage honestly', () => {
  it('a garbage status is a 400 INVALID_STATUS (never a silent all)', () => {
    const bad = parseGoalsExportQuery(new URLSearchParams('status=WRONG'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.status).toBe(400);
      expect(bad.code).toBe('INVALID_STATUS');
      expect(bad.error).toContain('OPEN, ACHIEVED, MISSED, CLOSED');
    }
  });

  it('a garbage source is a 400 INVALID_SOURCE (never a silent all)', () => {
    const bad = parseGoalsExportQuery(new URLSearchParams('source=UNKNOWN'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.status).toBe(400);
      expect(bad.code).toBe('INVALID_SOURCE');
      expect(bad.error).toContain('MANUAL, SALES_TOTAL, SALES_COUNT, CUSTOM');
    }
  });

  it('valid filters and bare params pass through honestly', () => {
    const good = parseGoalsExportQuery(
      new URLSearchParams('status=OPEN&source=SALES_TOTAL&employeeId=e1&cycleId=c1'),
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.status).toBe('OPEN');
      expect(good.source).toBe('SALES_TOTAL');
      expect(good.employeeId).toBe('e1');
      expect(good.cycleId).toBe('c1');
    }
    const bare = parseGoalsExportQuery(new URLSearchParams(''));
    expect(bare.ok).toBe(true);
    if (bare.ok) {
      expect(bare.status).toBeNull();
      expect(bare.source).toBeNull();
      expect(bare.employeeId).toBeNull();
      expect(bare.cycleId).toBeNull();
    }
  });
});

describe('routes — both doors speak the same guards the lists speak', () => {
  const cyclesRoute = readRepo('src/app/api/hr/performance/cycles/export/route.ts');
  const goalsRoute = readRepo('src/app/api/hr/goals/export/route.ts');

  it('both routes are read-guarded — anyone who can read the list can file it, nothing widens', () => {
    expect(cyclesRoute).toContain("hrGuard('hr.performance.review')");
    expect(goalsRoute).toContain("hrGuard('hr.performance.review')");
  });

  it('both routes re-run the service call the screen makes — the file cannot drift', () => {
    expect(cyclesRoute).toContain('listCycles(session)');
    expect(goalsRoute).toContain('listGoals(session, {');
    expect(goalsRoute).toContain('employeeId: parsed.employeeId ?? undefined');
    expect(goalsRoute).toContain('cycleId: parsed.cycleId ?? undefined');
    expect(goalsRoute).toContain('status: parsed.status ?? undefined');
    expect(goalsRoute).toContain('source: parsed.source ?? undefined');
  });

  it('the service learned the source predicate (one read path for screen and file)', () => {
    const service = readRepo('src/lib/hr/goal-service.ts');
    expect(service).toContain('source?: string');
    expect(service).toContain('filters.source ? { metricSource: filters.source } : {}');
  });

  it('honest edges: empty lists are 404s with named codes, never empty-looking sheets', () => {
    expect(cyclesRoute).toContain("'NO_CYCLE_DATA'");
    expect(goalsRoute).toContain("'NO_GOAL_DATA'");
    expect(cyclesRoute).toContain('cycles.length === 0');
    expect(goalsRoute).toContain('goals.length === 0');
  });

  it('both exports are audited with field names only — no employee names ride the rows', () => {
    expect(cyclesRoute).toContain("action: 'PERFORMANCE_CYCLES_EXPORTED'");
    expect(goalsRoute).toContain("action: 'PERFORMANCE_GOALS_EXPORTED'");
    expect(cyclesRoute).toContain('HrEntityType.DATA_EXPORT');
    expect(goalsRoute).toContain('HrEntityType.DATA_EXPORT');
    const cyclesAudit = cyclesRoute.split('await hrAudit')[1]?.split('}).catch')[0] ?? '';
    const goalsAudit = goalsRoute.split('await hrAudit')[1]?.split('}).catch')[0] ?? '';
    expect(cyclesAudit).toContain('count: cycles.length');
    expect(cyclesAudit).toContain('byteSize: file.byteSize');
    expect(cyclesAudit).toContain("channel: 'ad_hoc_download'");
    expect(goalsAudit).toContain('count: goals.length');
    expect(goalsAudit).toContain('byteSize: file.byteSize');
    expect(goalsAudit).toContain("channel: 'ad_hoc_download'");
    expect(goalsAudit).not.toContain('employeeName');
    expect(cyclesAudit).not.toContain('employeeName');
  });
});

describe('console — every tab carries its door in the slate governed family', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('the Cycles tab carries the filing door with an honest idle state', () => {
    const cycles = page.split('<TabsContent value="cycles"')[1]?.split('<TabsContent value="reviews"')[0] ?? '';
    expect(cycles).toContain('data-testid="cycles-csv"');
    expect(cycles).toContain("'Building…'");
    expect(cycles).toContain('Nothing to file — no cycles yet');
    expect(cycles).toContain('border-slate-300 text-slate-600');
    expect(cycles).toContain('data-testid="cycles-csv-note"');
    expect(cycles).toContain('exportCyclesCsv()');
  });

  it('the Goals tab carries the filing door riding the current filters', () => {
    const goals = page.split('<TabsContent value="goals"')[1]?.split('<TabsContent value="cycles"')[0] ?? '';
    expect(goals).toContain('data-testid="goals-csv"');
    expect(goals).toContain('Nothing to file — no goals match the current filters');
    expect(goals).toContain('data-testid="goals-csv-note"');
    expect(goals).toContain('exportGoalsCsv()');
    const logic = page.split('const exportGoalsCsv')[1]?.split('const run =')[0] ?? '';
    expect(logic).toContain('/api/hr/goals/export');
    expect(logic).toContain("qs.set('employeeId', filterGoalEmployee)");
    expect(logic).toContain("qs.set('source', filterGoalSource)");
    expect(logic).toContain("qs.set('status', filterGoalStatus)");
    expect(logic).toContain('Content-Disposition');
  });

  it('the doors render for readers (read-level) while create actions stay manage-gated', () => {
    const cycles = page.split('<TabsContent value="cycles"')[1]?.split('<TabsContent value="reviews"')[0] ?? '';
    // The cycles CSV button sits OUTSIDE the canManage conditional — the
    // New cycle button after it stays gated.
    const rowBeforeCard = cycles.split('{cyclesCsvNote ?')[0] ?? '';
    expect(rowBeforeCard).toContain('cycles-csv');
    expect(rowBeforeCard).toContain('canManage ?');
    expect(rowBeforeCard.indexOf('cycles-csv')).toBeLessThan(rowBeforeCard.indexOf('canManage ?'));
  });
});

describe('anchors — the family that came before stays pinned', () => {
  it('v2.96: the reviews builder and its governed filename are untouched', () => {
    const src = readRepo('src/lib/hr/performance-csv.ts');
    expect(src).toContain('export function reviewsToCsv');
    expect(src).toContain('mbumah-performance-reviews-');
  });

  it('v2.95 + v2.94: the lifecycle strip and the calibration notes door survive', () => {
    const page = readRepo('src/app/(shell)/hr/performance/page.tsx');
    expect(page).toContain('cycle-detail-action-error');
    expect(page).toContain('cycle-detail-notes');
    const csv = readRepo('src/tests/perf-cycle-lifecycle.test.ts');
    expect(csv).toContain('lifecycleBlock');
  });

  it('whats-new leads with 2.97.0 and tells the family-completes story', () => {
    const wn = readRepo('src/lib/whats-new.ts');
    const i97 = wn.indexOf("version: '2.97.0'");
    const i96 = wn.indexOf("version: '2.96.0'");
    expect(i97).toBeGreaterThanOrEqual(0);
    expect(i96).toBeGreaterThan(i97);
    expect(wn).toContain('Every performance list files itself');
    expect(wn).toContain('The goals file rides your filters');
  });
});
