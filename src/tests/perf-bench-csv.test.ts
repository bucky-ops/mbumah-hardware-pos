// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.99.0: the bench files itself — the performance filing family's last
 * gap closes. The Recently deleted bench grows the governed CSV door the
 * reviews (v2.96), cycles and goals (v2.97) lists already carry.
 *
 *   1. THE BUILDER IS THE FAMILY — same header-block layout, the digest
 *      escaper (one OWASP guard shared everywhere), RFC-4180 CRLF, the
 *      honest constant filename, null-on-empty mapped to an honest 404.
 *   2. THE EXIT STORY FILES WHOLE — the Deleted day stamp rides beside the
 *      values the goal left with (current/target/progress), the cycle it
 *      was filed under, and the source that drives it. Reconciling the
 *      bench never means guessing WHEN a goal left.
 *   3. THE WINDOW IS HONEST — the service returns the 50 most recent
 *      deletions; at the cap the header block says "most recent 50
 *      deletions" instead of the file silently posing as the whole bench.
 *   4. THE ROUTE WIDENS NOTHING — hr.performance.manage, the same guard
 *      the bench list answers through; audit PERFORMANCE_BENCH_EXPORTED
 *      carries field names and sizes, never employee names.
 */

import { benchToCsv } from '@/lib/hr/performance-csv';
import { benchWindowLabel } from '@/app/api/hr/goals/deleted/export/route';

const readRepo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Guarded unwrap — the house style prefers guards to `!` (keeps the lint
 *  baseline exactly where it was; the file must add ZERO new warnings). */
function mustFile(f: ReturnType<typeof benchToCsv>) {
  if (!f) throw new Error('nothing filed — builder returned null');
  return f;
}

const ROWS = [
  {
    title: '12 custom warranty calls weekly',
    employeeName: 'Grace Achieng',
    cycleName: null,
    metricSource: 'CUSTOM',
    metricLabel: 'warranty calls',
    status: 'OPEN',
    currentValue: '30.00',
    targetValue: '120.00',
    progressPct: 25,
    dueDate: '2026-12-31T00:00:00.000Z',
    deletedAt: '2026-10-18T09:12:00.000Z',
  },
  {
    title: 'Q4 sales total = KES 2,000,000',
    employeeName: 'David Otieno',
    cycleName: 'H2 2026 Reviews',
    metricSource: 'SALES_TOTAL',
    metricLabel: null,
    status: 'ACHIEVED',
    currentValue: '2100000.00',
    targetValue: '2000000.00',
    progressPct: 100,
    dueDate: null,
    deletedAt: '2026-10-17T15:40:00.000Z',
  },
];

const META = {
  organizationName: 'Mbumah Hardware Ltd',
  scopeLabel: 'All branches',
  windowLabel: 'all deletions',
};

describe('builder — benchToCsv is the governed family', () => {
  it('the header block names the report, org, scope, window and generation time', () => {
    const f = mustFile(benchToCsv(ROWS, META, new Date('2026-10-18T10:00:00.000Z')));
    const lines = f.csv.split('\r\n');
    expect(lines[0]).toBe('Report,Goal bench (recently deleted)');
    expect(lines[1]).toBe('Organization,Mbumah Hardware Ltd');
    expect(lines[2]).toBe('Scope,All branches');
    expect(lines[3]).toBe('Window,all deletions');
    expect(lines[4]).toBe('Generated (UTC),2026-10-18T10:00:00.000Z');
    expect(lines[5]).toBe('');
    expect(lines[6]).toBe('Bench');
  });

  it('the table carries one row per bench goal, newest deletion first, with the Deleted day stamp', () => {
    const f = mustFile(benchToCsv(ROWS, META, new Date('2026-10-18T10:00:00.000Z')));
    const lines = f.csv.split('\r\n');
    expect(lines[7]).toBe(
      'Goal,Employee,Cycle,Source,Metric,Status,Current,Target,Progress %,Due,Deleted',
    );
    expect(lines[8]).toBe(
      '12 custom warranty calls weekly,Grace Achieng,,CUSTOM,warranty calls,OPEN,30.00,120.00,25,2026-12-31,2026-10-18',
    );
    expect(lines[9]).toBe(
      '"Q4 sales total = KES 2,000,000",David Otieno,H2 2026 Reviews,SALES_TOTAL,,ACHIEVED,2100000.00,2000000.00,100,,2026-10-17',
    );
  });

  it('the OWASP formula-injection guard and RFC-4180 quoting ride the shared escaper', () => {
    const f = mustFile(benchToCsv(
      [
        {
          ...ROWS[0],
          title: '=CMD("calc") leading goal',
          employeeName: 'Eve, "The" Admin',
        },
      ],
      META,
      new Date('2026-10-18T10:00:00.000Z'),
    ));
    expect(f.csv).toContain("\"'=CMD(\"\"calc\"\") leading goal\"");
    expect(f.csv).toContain('"Eve, ""The"" Admin"');
  });

  it('the filename is the honest constant — the bench has no filters to slug', () => {
    const f = mustFile(benchToCsv(ROWS, META));
    expect(f.filename).toBe('mbumah-performance-bench.csv');
    expect(f.byteSize).toBe(Buffer.byteLength(f.csv, 'utf8'));
  });

  it('an empty bench is nothing to file — the builder returns null (route maps to 404)', () => {
    expect(benchToCsv([], META)).toBeNull();
  });

  it('the window honesty rides the meta, not a guess: capped benches name their window', () => {
    const f = mustFile(benchToCsv(ROWS, { ...META, windowLabel: 'most recent 50 deletions' }));
    expect(f.csv.split('\r\n')[3]).toBe('Window,most recent 50 deletions');
  });

  it('the route map narrows the DTO to the filing row — no narratives, no notes fields', () => {
    const route = readRepo('src/app/api/hr/goals/deleted/export/route.ts');
    const map = route.split('goals.map((g) => ({')[1]?.split('})),')[0] ?? '';
    expect(map).toContain('title: g.title');
    expect(map).toContain('deletedAt: g.deletedAt');
    expect(map).not.toContain('Notes');
    expect(map).not.toContain('narrative');
  });
});

describe('route — the bench export widens nothing', () => {
  it('rides hr.performance.manage — the SAME guard the bench list answers through', () => {
    const route = readRepo('src/app/api/hr/goals/deleted/export/route.ts');
    expect(route).toContain("hrGuard('hr.performance.manage')");
    expect(route).toContain('listDeletedGoals(session)');
  });

  it('the window label is honest arithmetic, not a vibe', () => {
    expect(benchWindowLabel(1)).toBe('all deletions');
    expect(benchWindowLabel(49)).toBe('all deletions');
    expect(benchWindowLabel(50)).toBe('most recent 50 deletions');
    expect(benchWindowLabel(120)).toBe('most recent 50 deletions');
  });

  it('an empty bench is a 404-shaped code (NO_BENCH_DATA), never an empty-looking sheet', () => {
    const route = readRepo('src/app/api/hr/goals/deleted/export/route.ts');
    expect(route).toContain("'NO_BENCH_DATA'");
    expect(route).toContain("status: 404");
  });

  it('the audit row says what was filed and how big — field names only, never who is in it', () => {
    const route = readRepo('src/app/api/hr/goals/deleted/export/route.ts');
    expect(route).toContain("'PERFORMANCE_BENCH_EXPORTED'");
    expect(route).toContain('HrEntityType.DATA_EXPORT');
    expect(route).toContain('resourceId: file.filename');
    const meta = route.split('metadata: {')[1]?.split('},')[0] ?? '';
    expect(meta).toContain('count');
    expect(meta).toContain('byteSize');
    expect(meta).not.toContain('employeeName');
    expect(meta).not.toContain('title');
  });

  it('the service window contract is unchanged: take 50, newest deletion first', () => {
    const svc = readRepo('src/lib/hr/goal-service.ts');
    expect(svc).toContain("orderBy: { deletedAt: 'desc' }");
    expect(svc).toContain('take: 50');
  });
});

describe('page — the bench door grew the filing door', () => {
  const PAGE = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('the dialog footer carries the Bench CSV button with honest states', () => {
    expect(PAGE).toContain('data-testid="goal-bench-csv"');
    expect(PAGE).toContain("fetch('/api/hr/goals/deleted/export'");
    expect(PAGE).toContain("Nothing to file — the bench is clear");
    expect(PAGE).toContain("Building…");
  });

  it('the note renders where the action lives, both tones', () => {
    expect(PAGE).toContain('data-testid="goal-bench-csv-note"');
    expect(PAGE).toContain('Bench CSV downloaded —');
  });

  it('the 50-cap honesty note rides the dialog when the window is full', () => {
    expect(PAGE).toContain('data-testid="goal-deleted-window-note"');
    expect(PAGE).toContain('most recent 50 deletions');
  });

  it('prior bench anchors survive: restore rows, cycle column, count badge', () => {
    expect(PAGE).toContain('data-testid="goal-deleted-open"');
    expect(PAGE).toContain('data-testid="goal-deleted-count"');
    expect(PAGE).toContain('goal-restore-');
    expect(PAGE).toContain('goal-deleted-cycle-');
    expect(PAGE).toContain('The bench is clear.');
  });
});

describe('whats-new — the family-completes story leads the feed', () => {
  it('2.99.0 leads and tells the bench story', () => {
    const wn = readRepo('src/lib/whats-new.ts');
    const i99 = wn.indexOf("version: '2.99.0'");
    const i98 = wn.indexOf("version: '2.98.0'");
    expect(i99).toBeGreaterThanOrEqual(0);
    expect(i98).toBeGreaterThan(i99);
    expect(wn.slice(i99, i98)).toContain('The bench files itself');
    expect(wn.slice(i99, i98)).toContain('every performance surface a manager can look at now files too');
    expect(wn.slice(i99, i98)).toContain('most recent 50 deletions');
  });
});
