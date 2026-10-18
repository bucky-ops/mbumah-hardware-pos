// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The route import chains to the server stack; the parser under test is
// pure, so the seams are stubbed exactly like the report-export suite does.
const db = vi.hoisted(() => ({
  organization: { findUnique: vi.fn() },
  store: { findUnique: vi.fn() },
  performanceReview: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn() },
  reviewCycle: { findMany: vi.fn().mockResolvedValue([]) },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
}));
vi.mock('@/lib/db', () => ({ db, runWithoutTenant: async <T,>(fn: () => Promise<T>) => fn() }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue(undefined),
  HrEntityType: { DATA_EXPORT: 'DataExport' },
}));

import { reviewsToCsv } from '@/lib/hr/performance-csv';
import { parseReviewsExportQuery } from '@/app/api/hr/performance/reviews/export/route';

/**
 * v2.96.0: the performance page files itself.
 *
 *   1. THE FILING DOOR — the Reviews tab's CSV button downloads the EXACT
 *      filtered subset on screen as the governed file: one server builder
 *      (reviewsToCsv) reusing the digest escaper (OWASP formula-injection
 *      guard), the same header-block layout family as the report tabs
 *      (v2.58) and the desk report (v2.70). The route re-runs the service's
 *      listReviews, so the file cannot disagree with the screen.
 *   2. THE PRIVACY FLOOR HOLDS IN THE FILE — the input is the rating-free
 *      list DTO (spec rule 7): a filing copy can carry names, cycle, status
 *      and dates, never a rating or a narrative.
 *   3. HONEST EDGES — an empty filtered list is a 404 (never an empty-looking
 *      sheet), a garbage status is a 400 (never a silent 'all'), the button
 *      rests with an explanation when the filters match nothing.
 *   4. THE BENCH REMEMBERS THE CYCLE — goals carried cycleId since 2.90; the
 *      restore rows now say WHERE a goal was filed (amber cycle badge, or an
 *      honest "No cycle").
 *
 * File-level contracts (the perf-cycle-lifecycle.test.ts pattern) plus the
 * pure builder executed for real.
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

/** Narrow the builder's null path without the forbidden non-null assertion. */
function must(f: ReturnType<typeof reviewsToCsv>) {
  if (!f) throw new Error('expected a governed file, got null');
  return f;
}

const ROWS = [
  {
    employeeName: 'Grace Achieng',
    jobTitle: 'Accounts Assistant',
    cycleName: 'H2 2026 Reviews',
    status: 'DRAFT',
    acknowledgedAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
  },
  {
    employeeName: 'David Otieno',
    jobTitle: null,
    cycleName: 'H2 2026 Reviews',
    status: 'CALIBRATED',
    acknowledgedAt: '2026-10-17T08:30:00.000Z',
    createdAt: '2026-10-02T10:15:00.000Z',
  },
];

const META = {
  organizationName: 'MBUMAH Hardware',
  scopeLabel: 'All branches',
  cycleLabel: 'H2 2026 Reviews',
  statusLabel: 'all',
};

describe('builder — reviewsToCsv is the governed family', () => {
  it('the header block names the report, org, scope, filters and generation time', () => {
    const f = must(reviewsToCsv(ROWS, META, new Date('2026-10-18T04:00:00.000Z')));
    const lines = f.csv.split('\r\n');
    expect(lines[0]).toBe('Report,Performance reviews');
    expect(lines[1]).toBe('Organization,MBUMAH Hardware');
    expect(lines[2]).toBe('Scope,All branches');
    expect(lines[3]).toBe('Cycle,H2 2026 Reviews');
    expect(lines[4]).toBe('Status,all');
    expect(lines[5]).toBe('Generated (UTC),2026-10-18T04:00:00.000Z');
  });

  it('the table carries one row per review, in the order the screen shows', () => {
    const f = must(reviewsToCsv(ROWS, META));
    const lines = f.csv.split('\r\n');
    expect(lines[7]).toBe('Reviews');
    expect(lines[8]).toBe('Employee,Job title,Cycle,Status,Acknowledged,Created');
    expect(lines[9]).toBe('Grace Achieng,Accounts Assistant,H2 2026 Reviews,DRAFT,,2026-10-01');
    expect(lines[10]).toBe('David Otieno,,H2 2026 Reviews,CALIBRATED,2026-10-17,2026-10-02');
    // RFC-4180: trailing CRLF at end of file.
    expect(f.csv.endsWith('\r\n')).toBe(true);
  });

  it('dates are ISO day keys and empty cells are honest for a null acknowledgment', () => {
    const f = must(reviewsToCsv(ROWS, META));
    expect(f.csv).toContain('Grace Achieng,Accounts Assistant,H2 2026 Reviews,DRAFT,,2026-10-01');
    expect(f.csv).not.toContain('T08:30'); // day precision, like the screen
  });

  it('the OWASP formula-injection guard rides the shared escaper', () => {
    const f = must(
      reviewsToCsv(
        [{ ...ROWS[0], employeeName: '=HYPERLINK("http://evil","x")' }],
        META,
      ),
    );
    expect(f.csv).toContain("'=HYPERLINK");
  });

  it('cells with commas or quotes are RFC-4180 quoted and doubled', () => {
    const f = must(
      reviewsToCsv(
        [{ ...ROWS[0], employeeName: 'Otieno, David "Jr"', cycleName: 'H1, 2026' }],
        META,
      ),
    );
    expect(f.csv).toContain('"Otieno, David ""Jr"""');
    expect(f.csv).toContain('"H1, 2026"');
  });

  it('the filename slugs the filter labels — filed copies never overwrite each other', () => {
    expect(must(reviewsToCsv(ROWS, META)).filename).toBe(
      'mbumah-performance-reviews-h2-2026-reviews-all.csv',
    );
    expect(
      must(reviewsToCsv(ROWS, { ...META, cycleLabel: 'All cycles', statusLabel: 'draft' }))
        .filename,
    ).toBe('mbumah-performance-reviews-all-cycles-draft.csv');
  });

  it('an empty list is nothing to file — the builder returns null (route maps to 404)', () => {
    expect(reviewsToCsv([], META)).toBeNull();
  });

  it('the privacy floor is typed in: the row input has no rating field to leak', () => {
    const src = readRepo('src/lib/hr/performance-csv.ts');
    const iface = src.split('export interface ReviewCsvRow')[1]?.split('\n}')[0] ?? '';
    expect(iface).not.toContain('overallRating');
    expect(iface).not.toContain('strengths');
    expect(iface).not.toContain('improvements');
    // The guard is the digest's own escaper — one implementation everywhere.
    expect(src).toContain("import { csvCell } from '@/lib/hr/digest-csv'");
  });
});

describe('route — the export speaks the same guards the list speaks', () => {
  const route = readRepo('src/app/api/hr/performance/reviews/export/route.ts');

  it('read-guarded (hr.performance.review) — anyone who can read the list can file it, nothing widens', () => {
    expect(route).toContain("hrGuard('hr.performance.review')");
  });

  it('the query parser refuses a garbage status honestly (400, never a silent all)', () => {
    const bad = parseReviewsExportQuery(new URLSearchParams('status=ARCHIVED'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.status).toBe(400);
      expect(bad.code).toBe('INVALID_STATUS');
      expect(bad.error).toContain('DRAFT, SUBMITTED, ACKNOWLEDGED, CALIBRATED');
    }
    const good = parseReviewsExportQuery(new URLSearchParams('status=SUBMITTED&cycleId=c1'));
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.status).toBe('SUBMITTED');
      expect(good.cycleId).toBe('c1');
    }
    const bare = parseReviewsExportQuery(new URLSearchParams(''));
    expect(bare.ok).toBe(true);
    if (bare.ok) {
      expect(bare.status).toBeNull();
      expect(bare.cycleId).toBeNull();
    }
  });

  it('the file re-runs listReviews — same service call the tab reads, so no screen drift', () => {
    expect(route).toContain('listReviews(session, {');
    expect(route).toContain("cycleId: parsed.cycleId ?? undefined");
    expect(route).toContain("status: parsed.status ?? undefined");
  });

  it('an empty filtered list is an honest 404 NO_REVIEW_DATA', () => {
    expect(route).toContain('NO_REVIEW_DATA');
    expect(route).toContain('reviews.length === 0');
  });

  it('exports are audited with field names only — no employee names ride the audit row', () => {
    expect(route).toContain('PERFORMANCE_REVIEWS_EXPORTED');
    const audit = route.split('await hrAudit')[1]?.split('}).catch')[0] ?? '';
    expect(audit).toContain('HrEntityType.DATA_EXPORT');
    expect(audit).toContain('count: reviews.length');
    expect(audit).toContain('byteSize: file.byteSize');
    expect(audit).toContain("channel: 'ad_hoc_download'");
    expect(audit).not.toContain('employeeName');
  });

  it('the scope header is the service-truth label, and the cycle label follows the filter', () => {
    expect(route).toContain('digestOrgAndScope(');
    expect(route).toContain("'All cycles'");
    expect(route).toContain("parsed.status.replace(/_/g, ' ').toLowerCase()");
  });
});

describe('console — the filing door and the bench cycle', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('the Reviews tab carries the CSV button in the slate governed family', () => {
    const reviews = page.split('<TabsContent value="reviews"')[1]?.split('<TabsContent value="goals"')[0] ?? '';
    expect(reviews).toContain('data-testid="reviews-csv"');
    expect(reviews).toContain('exportReviewsCsv()');
    expect(reviews).toContain("'Building…'");
    // Honest idle: nothing to file when the filters match nothing.
    expect(reviews).toContain('Nothing to file — no reviews match the current filters');
    expect(reviews).toContain('border-slate-300 text-slate-600');
  });

  it('the export rides the current filters and reports where the action lives', () => {
    const logic = page.split('const exportReviewsCsv')[1]?.split('const run =')[0] ?? '';
    expect(logic).toContain("if (filterCycleId !== 'ALL') qs.set('cycleId', filterCycleId);");
    expect(logic).toContain("if (filterStatus !== 'ALL') qs.set('status', filterStatus);");
    expect(logic).toContain('/api/hr/performance/reviews/export');
    expect(logic).toContain('Content-Disposition');
    expect(logic).toContain('The governed filing format (header block, injection guard)');
    // The note reports where the action lives — under the button, not behind a modal.
    const reviews = page.split('<TabsContent value="reviews"')[1]?.split('<TabsContent value="goals"')[0] ?? '';
    expect(reviews).toContain('data-testid="reviews-csv-note"');
    expect(reviews).toContain('role="status"');
  });

  it('the bench remembers the cycle: an amber badge, or an honest No cycle', () => {
    const bench = page.split('the bench: recently deleted goals')[1]?.split('the cycle detail drawer')[0] ?? '';
    expect(bench).toContain('data-testid={`goal-deleted-cycle-${g.id}`}');
    expect(bench).toContain('border-amber-300 text-amber-700');
    expect(bench).toContain('No cycle');
    expect(bench).toContain('the same cycle it was filed under');
  });
});

describe('anchors — the release sits on the family it extends', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');
  const wn = readRepo('src/lib/whats-new.ts');

  it('prior anchors hold: 2.95 lifecycle, 2.94 notes, 2.93 bench', () => {
    expect(page).toContain('data-testid="cycle-detail-lifecycle"');
    expect(page).toContain('data-testid="cycle-detail-lifecycle-block"');
    expect(page).toContain('data-testid="cycle-detail-notes-edit"');
    expect(page).toContain('data-testid="goal-deleted-open"');
  });

  it("whats-new leads with 2.96.0 and the bullets lead with the filing story", () => {
    expect(wn).toContain("version: '2.96.0'");
    expect(wn).toContain('The performance page files itself');
    expect(wn).toContain('The bench remembers the cycle');
    expect(wn.indexOf("version: '2.96.0'")).toBeLessThan(wn.indexOf("version: '2.95.0'"));
  });
});
