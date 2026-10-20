import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBranchesCsv, type BranchDeskCsvBlock } from '../lib/org/branches-csv';

/**
 * v2.186.0 — the reviewer roster rides.
 *
 * The desk's morning note answered "how many" and "who won" (the
 * distinct-reviewer count and the top-reviewer chip) but never shipped the
 * FULL per-reviewer roster — the digest computed it (the `reviewerDigest`
 * map) and kept the rows to itself. This release the rows ride:
 *
 *   1. the read exposes `yesterday.reviewerRows` — the SAME map the
 *      topReviewer figure reads, loudest-first (ties A→Z, the
 *      digestTopReviewer ordering), capped at 24 so a crowded desk cannot
 *      bloat the payload. Additive under a NEW name: the payload's
 *      `reviewers` NUMBER (the distinct count) predates it and keeps its
 *      meaning — no consumer re-keys.
 *   2. the digest strip grows the share-bar roster: WHO pulled the desk,
 *      every reviewer in their avatar hue with an emerald share-of-visits
 *      bar — only when MORE than one reviewer showed (a solo reviewer is
 *      the top chip's whole story), six rows rendered, "+N more" honestly.
 *   3. the branches CSV's desk section grows the "Reviews by reviewer"
 *      sub-section — the offline twin of the roster (the v2.180.0
 *      file-mirrors-screen rule): Reviewer, Visits, Share (%), share
 *      computed BY THE LIB from the block's own visits (never trusted from
 *      the wire), absent roster or a zero-visit window ending the section
 *      above — never a divide-by-zero, never an invented 0% column.
 *   4. the export's tolerant parse grows the field: only provably sound
 *      rows (string name, number visits) survive; an absent field exports
 *      without the sub-section.
 *
 * Pinned here: the derivation + cap + additive naming on the route, the
 * roster gate + share math + "+N more" on the strip, the EXECUTED CSV
 * round-trip (including a comma-bearing name through RFC-4180 quoting and
 * the exact share rounding), the parse tolerance, and the version.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const RA = readRepo('src/app/api/org/review-activity/route.ts');
const panels = readRepo('src/components/org/panels.tsx');
const primitives = readRepo('src/components/org/primitives.tsx');
const csvLib = readRepo('src/lib/org/branches-csv.ts');
const orgConsole = readRepo('src/components/workspace/org-console.tsx');
const pkg = JSON.parse(readRepo('package.json'));

const desk = (over: Partial<BranchDeskCsvBlock> = {}): BranchDeskCsvBlock => ({
  label: 'Mon 19 Oct',
  visits: 12,
  clears: 3,
  reviewers: 3,
  requests: 8,
  busiestBranch: { storeName: 'Juja Main', visits: 6 },
  topReviewer: { name: 'Amina', visits: 6 },
  branches: [{ storeName: 'Juja Main', visits: 6 }],
  reviewerRows: [
    { name: 'Amina', visits: 6 },
    { name: 'Baraka', visits: 4 },
    { name: 'Chui, J.', visits: 2 },
  ],
  ...over,
});

describe('the read - the roster rides additively', () => {
  it('derives digestReviewers from the SAME map the topReviewer reads', () => {
    expect(RA).toContain('const digestReviewers = [...reviewerDigest.entries()]');
    expect(RA.indexOf('const digestTopReviewer = [...reviewerDigest.entries()]')).toBeGreaterThan(-1);
    expect(RA.indexOf('const digestReviewers = [...reviewerDigest.entries()]'))
      .toBeGreaterThan(RA.indexOf('const digestTopReviewer = [...reviewerDigest.entries()]'));
  });

  it('orders loudest-first with the A-Z tie, capped at 24', () => {
    expect(RA).toContain('.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))');
    expect(RA).toContain('.slice(0, 24)');
    expect(RA).toContain('.map(([name, visits]) => ({ name, visits }))');
  });

  it('ships under reviewerRows - the reviewers COUNT keeps its meaning', () => {
    expect(RA).toContain('reviewerRows: digestReviewers,');
    expect(RA).toContain('reviewers: reviewerDigest.size,');
    expect(RA).toContain("named `reviewerRows` so the existing `reviewers` count keeps its");
  });
});

describe('the digest strip - the share-bar roster', () => {
  it('renders only when MORE than one reviewer showed, and only when the roster arrived', () => {
    expect(panels).toContain('{yesterday.reviewerRows && yesterday.reviewerRows.length > 1 && (');
    expect(panels).toContain('data-testid="desk-digest-roster"');
    expect(panels).toContain('data-testid="desk-digest-roster-row"');
  });

  it('speaks the share math: visits over the window total, rounded, width capped', () => {
    expect(panels).toContain('const share = yesterday.visits > 0 ? Math.round((r.visits / yesterday.visits) * 100) : 0;');
    expect(panels).toContain("style={{ width: `${Math.min(100, share)}%` }}");
  });

  it('six rows render; a longer desk says +N more', () => {
    expect(panels).toContain('yesterday.reviewerRows.slice(0, 6)');
    expect(panels).toContain('+{yesterday.reviewerRows.length - 6} more reviewer');
  });

  it('the type carries the roster OPTIONAL - tolerant of an older answer', () => {
    expect(primitives).toContain('reviewerRows?: Array<{ name: string; visits: number }>;');
  });
});

describe('the branches CSV - the offline twin EXECUTED', () => {
  it('appends the Reviews by reviewer sub-section with lib-computed shares', () => {
    const csv = buildBranchesCsv(
      [{ name: 'Juja Main', code: 'JUJ', location: 'Juja', status: 'ACTIVE', todayRevenue: 0, todayTransactions: 0, lowStockCount: 0, overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0 }],
      new Date('2026-10-21T09:00:00.000Z'),
      null,
      desk(),
    );
    expect(csv).toContain('Reviews by reviewer,Reviewer,Visits,Share (%)');
    expect(csv).toContain('Amina,6,50');
    expect(csv).toContain('Baraka,4,33.33');
    // 2/12 = 16.666... -> 16.67 (the lib rounds, the wire is never trusted);
    // the comma-bearing name rides RFC-4180 quoting (the WHOLE field wraps)
    expect(csv).toContain('"Chui, J.",2,16.67');
    expect(csv.indexOf('Reviews by reviewer')).toBeGreaterThan(csv.indexOf('Branch,Visits (yesterday)'));
  });

  it('an absent roster ends the file at the v2.185.0 shape', () => {
    const csv = buildBranchesCsv(
      [{ name: 'Juja Main', code: 'JUJ', location: 'Juja', status: 'ACTIVE', todayRevenue: 0, todayTransactions: 0, lowStockCount: 0, overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0 }],
      new Date('2026-10-21T09:00:00.000Z'),
      null,
      desk({ reviewerRows: undefined }),
    );
    expect(csv).not.toContain('Reviews by reviewer');
    expect(csv).toContain('Branch,Visits (yesterday)');
  });

  it('a zero-visit window never divides - no sub-section, no invented 0%', () => {
    const csv = buildBranchesCsv(
      [{ name: 'Juja Main', code: 'JUJ', location: 'Juja', status: 'ACTIVE', todayRevenue: 0, todayTransactions: 0, lowStockCount: 0, overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0 }],
      new Date('2026-10-21T09:00:00.000Z'),
      null,
      desk({ visits: 0, reviewerRows: [{ name: 'Amina', visits: 0 }] }),
    );
    expect(csv).not.toContain('Reviews by reviewer');
  });

  it('the sub-section is gated in the lib source exactly as executed', () => {
    expect(csvLib).toContain('desk.reviewerRows && desk.reviewerRows.length > 0 && desk.visits > 0');
    expect(csvLib).toContain('Math.round((r.visits / desk.visits) * 10000) / 100');
  });
});

describe('the export parse - only provably sound rows survive', () => {
  it('the parse reads reviewerRows, gates on Array.isArray, filters string+number', () => {
    expect(orgConsole).toContain('Array.isArray(y.reviewerRows)');
    expect(orgConsole).toContain("typeof r?.name === 'string' && typeof r?.visits === 'number'");
  });

  it('an absent field rides as undefined - the export ships without the sub-section', () => {
    expect(orgConsole).toContain(': undefined,');
  });
});

describe('the version contract', () => {
  it('package.json rides at 2.186.0', () => {
    expect(pkg.version).toBe('2.192.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.192.0');
    expect(pkg.mbumah.baseVersion).toBe('2.192.0');
  });
});
