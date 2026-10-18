// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.88.0: the cycle shows its shape.
 *
 * The performance console could COUNT a cycle's reviews but never SHOW
 * their shape — how many were drafted, submitted, acknowledged, calibrated
 * — and the reviews tab offered no handles: every review, every cycle, one
 * undifferentiated table. This round:
 *   1. Each cycle row wears a calibration meter (progress bar + "X of N
 *      calibrated" + the honest remainder), fed by per-status counts the
 *      service folds out of one grouped query.
 *   2. The meter is a door: "View reviews" jumps into the Reviews tab
 *      filtered to that cycle (controlled tabs + seed filter).
 *   3. The Reviews tab gains cycle + status filters with live counts, a
 *      "Showing X of Y" line, and one-tap clear.
 *
 * File-level contracts (the perf-review-write.test.ts pattern); the
 * service rules live in stage-g-performance.test.ts.
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('service — the cycle carries its shape', () => {
  const service = readRepo('src/lib/hr/performance-service.ts');

  it('CycleDto grows statusCounts (additive, counts only)', () => {
    expect(service).toContain('export interface CycleStatusCounts');
    expect(service).toMatch(/statusCounts:\s*CycleStatusCounts/);
    expect(service).toMatch(/DRAFT:\s*number/);
    expect(service).toMatch(/SUBMITTED:\s*number/);
    expect(service).toMatch(/ACKNOWLEDGED:\s*number/);
    expect(service).toMatch(/CALIBRATED:\s*number/);
  });

  it('counts fold from one grouped query scoped to the listed cycles', () => {
    expect(service).toContain("db.performanceReview.groupBy({");
    expect(service).toContain("by: ['cycleId', 'status']");
    expect(service).toMatch(/deletedAt:\s*null,\s*cycleId:\s*\{\s*in:/);
    expect(service).toContain('_count: { _all: true }');
  });

  it('unknown statuses fold away; empty cycles read all zeros — never undefined', () => {
    expect(service).toMatch(/countsByCycle\.get\(c\.id\) \?\? \{ DRAFT: 0, SUBMITTED: 0, ACKNOWLEDGED: 0, CALIBRATED: 0 \}/);
    expect(service).toMatch(/if \(row\.status === 'DRAFT' \|\| row\.status === 'SUBMITTED'/);
  });

  it('reviewCount semantics untouched — counts match the unscoped _count', () => {
    expect(service).toMatch(/_count:\s*\{\s*select:\s*\{\s*reviews:\s*true\s*\}\s*\}/);
    expect(service).toMatch(/reviewCount: c\._count\.reviews/);
  });
});

describe('console — the calibration meter', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('cycles tab renders a per-cycle meter with an honest fraction', () => {
    expect(page).toMatch(/data-testid=\{`cycle-meter-\$\{c\.id\}`\}/);
    expect(page).toMatch(/data-testid=\{`cycle-meter-text-\$\{c\.id\}`\}/);
    expect(page).toContain('<ProgressMeter');
    expect(page).toMatch(/\{c\.statusCounts\.CALIBRATED\} of \{c\.reviewCount\} calibrated/);
  });

  it('the meter carries an accessible name and honest tone', () => {
    expect(page).toMatch(/label=\{`Calibration progress for \$\{c\.name\}: \$\{c\.statusCounts\.CALIBRATED\} of \$\{c\.reviewCount\} reviews calibrated`\}/);
    expect(page).toMatch(/calibrationTone/);
    expect(page).toMatch(/pct >= 100 \? 'good' : pct > 0 \? 'info' : 'warn'/);
  });

  it('an empty cycle says so instead of drawing a lie', () => {
    expect(page).toMatch(/c\.reviewCount === 0 \? \(/);
    expect(page).toContain('No reviews yet');
  });

  it('the remainder is named, not hidden', () => {
    expect(page).toMatch(/\$\{c\.statusCounts\.DRAFT\} draft/);
    expect(page).toMatch(/\$\{c\.statusCounts\.SUBMITTED\} submitted/);
    expect(page).toMatch(/\$\{c\.statusCounts\.ACKNOWLEDGED\} acknowledged/);
  });
});

describe('console — the meter is a door (cross-link)', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('each cycle row offers View reviews, wired to the filtered jump', () => {
    expect(page).toMatch(/data-testid=\{`cycle-view-reviews-\$\{c\.id\}`\}/);
    expect(page).toContain('View reviews');
    expect(page).toMatch(/onClick=\{\(\) => viewCycleReviews\(c\.id\)\}/);
  });

  it('the jump seeds the cycle filter, resets status, and switches tabs', () => {
    expect(page).toMatch(/const viewCycleReviews = \(cycleId: string\) => \{/);
    expect(page).toMatch(/setFilterCycleId\(cycleId\);/);
    expect(page).toMatch(/setFilterStatus\('ALL'\);/);
    expect(page).toMatch(/setTab\('reviews'\);/);
  });

  it('tabs are controlled — the cross-link can drive them', () => {
    expect(page).toMatch(/<Tabs value=\{tab\} onValueChange=\{setTab\}/);
    expect(page).toMatch(/const \[tab, setTab\] = useState\('cycles'\);/);
  });

  it('the door only exists when there is something behind it', () => {
    // The cross-link renders inside the reviewCount > 0 branch.
    const meterBlock = page.split('c.reviewCount === 0 ? (')[1] ?? '';
    expect(meterBlock).toContain('cycle-view-reviews-');
    expect(meterBlock.indexOf('cycle-view-reviews-')).toBeLessThan(
      meterBlock.indexOf(') : (') < 0 ? meterBlock.length : meterBlock.indexOf('</TableCell>'),
    );
  });
});

describe('console — the reviews tab gains handles', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('a cycle picker and status chips with live counts', () => {
    expect(page).toContain('data-testid="review-filter-cycle"');
    expect(page).toContain('aria-label="Filter by cycle"');
    expect(page).toContain('<SelectItem value="ALL">All cycles</SelectItem>');
    expect(page).toMatch(/data-testid=\{`review-filter-status-\$\{s\}`\}/);
    expect(page).toMatch(/aria-pressed=\{active\}/);
    expect(page).toMatch(/\{s === 'ALL' \? 'All' : s\.replace\(\/_\/g, ' '\)\.toLowerCase\(\)\}/);
  });

  it('chips count the FULL list, never the filtered subset', () => {
    expect(page).toMatch(/const count = s === 'ALL' \? \(reviews \?\? \[\]\)\.length : reviewStatusCounts\[s as keyof CycleStatusCounts\];/);
    expect(page).toMatch(/status counts stay honest to the FULL loaded list/);
  });

  it('each active status wears its own badge family (same tones as the table)', () => {
    expect(page).toContain("DRAFT: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600'");
    expect(page).toContain("SUBMITTED: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900'");
    expect(page).toContain("ACKNOWLEDGED: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900'");
    expect(page).toContain("CALIBRATED: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900'");
  });

  it('filtering is real: the table renders the filtered subset', () => {
    expect(page).toMatch(/const filteredReviews = useMemo\(/);
    expect(page).toMatch(/filterCycleId === 'ALL' \|\| r\.cycleId === filterCycleId/);
    expect(page).toMatch(/filterStatus === 'ALL' \|\| r\.status === filterStatus/);
    expect(page).toContain('{filteredReviews.map((r) => (');
  });

  it('the picture stays honest: count line, clear button, empty state', () => {
    expect(page).toContain('data-testid="review-filter-count"');
    expect(page).toMatch(/Showing \{filteredReviews\.length\} of \{\(reviews \?\? \[\]\)\.length\} reviews/);
    expect(page).toContain('data-testid="review-filter-clear"');
    expect(page).toContain('No reviews match the current filters.');
    expect(page).toMatch(/const clearFilters = \(\) => \{/);
  });
});

describe('the lists stay rating-free', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('list rows and meters never reference a rating — the dialog still gates it', () => {
    const listRegion = page.split('const [tab, setTab]')[1]?.split('Review detail dialog')[0] ?? '';
    expect(listRegion).not.toContain('overallRating');
    expect(listRegion).not.toContain('strengths');
    expect(listRegion).not.toContain('improvements');
    // The detail dialog keeps its permission-gated rating display.
    expect(page).toContain('detail.overallRating');
  });

  it('the service CycleDto grows counts, not narratives', () => {
    const service = readRepo('src/lib/hr/performance-service.ts');
    const dto = service.split('export interface CycleDto')[1]?.split('}')[0] ?? '';
    expect(dto).toContain('statusCounts');
    expect(dto).not.toContain('overallRating');
    expect(dto).not.toContain('strengths');
  });
});
