import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBranchesCsv, type BranchDeskCsvBlock } from '../lib/org/branches-csv';
import { deriveDeskReport, deskReportToCsv, deskReportWindow, type DeskReportVisitRow } from '../lib/hr/desk-report';

/**
 * v2.189.0 — the roster keeps its week.
 *
 * v2.186.0 named yesterday's reviewers; v2.188.0 taught the rows to drill.
 * But the panel's week face stayed anonymous: the tiles counted HOW MANY
 * reviewers were active over the trailing 7 days (`weekReviewers`, v2.64.0)
 * and kept the names to themselves, the branches CSV filed only yesterday's
 * roster, and the printable desk report's reviewer rows carried no share at
 * all. This release the roster keeps its week:
 *
 *   1. the read exposes `stats.weekReviewerRows` — the per-reviewer visit
 *      counts (plus corrections answered) over the SAME trailing-7-day
 *      window the `weekReviewers` NUMBER has counted since v2.64.0,
 *      loudest-first (ties A→Z, the yesterday roster's ordering contract),
 *      capped at 24. Additive under a NEW name: `weekReviewers` keeps its
 *      meaning — no consumer re-keys.
 *   2. the panel grows the week strip — "who pulled the week" — the SAME
 *      share-bar affordance family as yesterday's roster plus the week
 *      face's own clears chip, drilling the SAME ?reviewer= filter; the
 *      strip reads `stats`, never the filtered timeline (org-wide).
 *   3. the branches CSV's desk section grows the "Reviews by reviewer
 *      (7d)" sub-section — shares computed BY THE LIB from the week
 *      block's OWN visits; absent block/roster or a zero-visit week ends
 *      the section above (never a divide-by-zero, never an invented 0%).
 *   4. the printable desk report's reviewer rows wear the share bar (the
 *      top reviewer's bar in the deep emerald), the % figure spoken beside
 *      it, and the report's own CSV gains the Share (%) column at the END.
 *
 * Pinned here: the derivation + additive naming + ordering/cap on the
 * route, the week strip's gate + share math + solo rule + drill semantics
 * with the yesterday strip's v2.186.0/v2.188.0 pins HOLDING, the EXECUTED
 * CSV week round-trip (exact shares, RFC-4180 quoting, absence honesty),
 * the parse tolerance, the report's share bar + CSV Share column EXECUTED,
 * and the version.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const RA = readRepo('src/app/api/org/review-activity/route.ts');
const panels = readRepo('src/components/org/panels.tsx');
const primitives = readRepo('src/components/org/primitives.tsx');
const csvLib = readRepo('src/lib/org/branches-csv.ts');
const orgConsole = readRepo('src/components/workspace/org-console.tsx');
const view = readRepo('src/components/org/desk-report-view.tsx');
const reportLib = readRepo('src/lib/hr/desk-report.ts');
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

// ── 1. The read — the week roster rides additively ──────────────────────────

describe('the read - the week roster rides additively', () => {
  it('derives the week roster from the SAME trailing-7-day window', () => {
    // the raw week rows are fetched alongside the distinct-names count in
    // the same Promise.all — one read, no second round-trip (the tuple
    // order: the count's distinct-names query, then the roster's raw rows)
    expect(RA).toContain('weekReviewerNames, weekRosterRaw, branchRows');
    expect(RA).toMatch(/rawDb\.leaveReviewVisit\.findMany\(\{\s*where:\s*\{\s*createdAt:\s*\{\s*gte: weekAgo \}\s*\},\s*select:\s*\{\s*visitedByName: true,\s*clearedRecheck: true,?\s*\},?\s*\}\)/);
  });

  it('aggregates visits AND clears per reviewer in one pass', () => {
    expect(RA).toContain('const weekRosterAgg = new Map<string, { visits: number; clears: number }>();');
    expect(RA).toContain('entry.visits += 1;');
    expect(RA).toContain('if (row.clearedRecheck) entry.clears += 1;');
  });

  it('orders loudest-first with the A-Z tie, capped at 24 — the yesterday roster ordering contract', () => {
    expect(RA).toContain('.sort((a, b) => b[1].visits - a[1].visits || a[0].localeCompare(b[0]))');
    expect(RA).toContain('.slice(0, 24)');
    expect(RA).toContain('.map(([name, agg]) => ({ name, visits: agg.visits, clears: agg.clears }))');
  });

  it('ships under weekReviewerRows - the weekReviewers COUNT keeps its meaning', () => {
    // additive naming: the roster rides a NEW name; the count is untouched
    expect(RA).toMatch(/weekReviewers: weekReviewerNames\.length/);
    expect(RA).toContain('weekReviewerRows: weekRoster,');
    // and the count's local no longer owns the plural reading
    expect(RA).toContain('weekReviewerNames');
  });

  it('is org-wide by contract: the week rows are NOT narrowed by visitWhere', () => {
    const block = RA.split('// v2.189.0: the WEEK roster')[1]?.split('rawDb.leaveReviewVisit.findMany')[0] ?? '';
    expect(block).toContain('NOT narrowed by visitWhere');
  });
});

// ── 2. The types — additive under stats ─────────────────────────────────────

describe('the types - the roster rides optional', () => {
  it('stats grows weekReviewerRows optional; the four original fields keep their contiguity', () => {
    expect(primitives).toMatch(/stats:\s*\{\s*total: number;\s*weekVisits: number;\s*weekClears: number;\s*weekReviewers: number/);
    expect(primitives).toContain('weekReviewerRows?: Array<{ name: string; visits: number; clears: number }>;');
    expect(primitives).toContain("`weekReviewerRows` because the payload's `weekReviewers` NUMBER (the");
  });
});

// ── 3. The panel — the week strip ───────────────────────────────────────────

describe('the panel - who pulled the week', () => {
  it('the week strip renders when the week had visits AND the payload carried the rows', () => {
    expect(panels).toContain('{stats.weekVisits > 0 && stats.weekReviewerRows && stats.weekReviewerRows.length > 0 && (');
    expect(panels).toContain('data-testid="desk-week-roster"');
  });

  it('the caption speaks the week face — share of the week\'s visits, the drill invitation', () => {
    expect(panels).toContain('who pulled the week · share of {num(stats.weekVisits)} visit{stats.weekVisits === 1 ? \'\' : \'s\'} · click a name to pull their file');
  });

  it('the share math is the strip\'s own: visits over the WEEK total, width capped', () => {
    expect(panels).toContain('const weekShare = stats.weekVisits > 0 ? Math.round((r.visits / stats.weekVisits) * 100) : 0;');
    expect(panels).toContain('style={{ width: `${Math.min(100, weekShare)}%` }}');
  });

  it('six rows render; a busier week says "+N more" honestly', () => {
    expect(panels).toContain('stats.weekReviewerRows.slice(0, 6)');
    expect(panels).toContain('+{stats.weekReviewerRows.length - 6} more reviewer');
    expect(panels).toContain('on the week roster');
  });

  it('the week face\'s own mark: the per-reviewer clears chip', () => {
    expect(panels).toContain('data-testid="desk-week-roster-clears"');
    expect(panels).toContain('title={`${r.name} answered ${r.clears} correction${r.clears === 1 ? \'\' : \'s\'} this week`}');
    expect(panels).toContain('{r.clears > 0 ? (');
  });

  it('the rows drill the SAME ?reviewer= filter — toggle semantics, spoken labels', () => {
    expect(panels).toContain('onClick={() => onFilterChange({ ...filter, reviewer: weekDrilled ? null : r.name })}');
    expect(panels).toContain('aria-pressed={weekDrilled}');
    expect(panels).toContain("aria-label={`${weekDrilled ? 'Stop reviewing' : 'Review'} ${r.name}'s desk visits — ${r.visits} of ${stats.weekVisits} this week`}");
  });

  it('the week strip wears the SAME affordance family as yesterday\'s roster', () => {
    // the drilled row: emerald ring + tint; the calm row: hover brighten
    expect(panels).toContain("'bg-emerald-50/90 ring-1 ring-emerald-300 dark:bg-emerald-500/10 dark:ring-emerald-500/40'");
    expect(panels).toContain("'hover:bg-white/80 dark:hover:bg-slate-800/50'");
    // the bar re-tints while drilled; the figures re-tint with it
    expect(panels).toContain("${weekDrilled ? 'bg-emerald-600' : 'bg-emerald-500/80'}");
    expect(panels).toContain("${weekDrilled ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}");
    // the chevron affordance: hidden until hovered, visible while drilled,
    // wearing the swept emerald token (the v2.149.0 contrast rule)
    expect(panels).toContain("'translate-x-0 text-emerald-800 opacity-100 dark:text-emerald-400'");
    expect(panels).toContain("'-translate-x-0.5 text-slate-500 opacity-0 group-hover:translate-x-0 group-hover:opacity-70 dark:text-slate-500'");
    expect(panels).toContain('${weekDrilled\n                        ? \'translate-x-0 text-emerald-800 opacity-100 dark:text-emerald-400\'');
    // the keyboard wears the house focus ring
    expect(panels).toContain('focus-visible:ring-2 focus-visible:ring-emerald-400');
    // the slate divider keeps the two faces distinguishable (not the digest's amber)
    expect(panels).toContain('className="mb-3 border-t border-slate-100 pt-2 dark:border-slate-800"');
  });

  it('the org-wide contract holds: the week strip reads stats, never the filtered timeline', () => {
    const block = panels.split('data-testid="desk-week-roster"')[1]?.split('{stats.weekReviewerRows.length > 6 && (')[0] ?? '';
    expect(block).toContain('stats.weekReviewerRows.slice(0, 6)');
    expect(block).toContain('onFilterChange(');
    expect(block).not.toContain('recent.filter');
  });

  it('the v2.186.0/v2.188.0 yesterday strip pins HOLD — the week face re-keyed nothing', () => {
    expect(panels).toContain('{yesterday.reviewerRows && yesterday.reviewerRows.length > 1 && (');
    expect(panels).toContain('data-testid="desk-digest-roster"');
    expect(panels).toContain('const share = yesterday.visits > 0 ? Math.round((r.visits / yesterday.visits) * 100) : 0;');
    expect(panels).toContain('const drilled = reviewer === r.name;');
    expect(panels).toContain('yesterday.reviewerRows.slice(0, 6)');
  });
});

// ── 4. The CSV — the week shape, offline ────────────────────────────────────

describe('the branches CSV - the week sub-section', () => {
  it('the desk block grew the optional week shape', () => {
    expect(csvLib).toContain('week?: { visits: number; reviewerRows?: ReadonlyArray<{ name: string; visits: number }> } | null;');
    expect(csvLib).toContain('v2.189.0: the WEEK shape');
  });

  it('EXECUTED: the week roster files with exact lib-computed shares', () => {
    const csv = buildBranchesCsv(
      [
        { name: 'Juja Main', code: 'JJA', location: 'Juja', status: 'ACTIVE', todayRevenue: 1000, todayTransactions: 2, lowStockCount: 0, overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0 },
      ],
      new Date('2026-10-20T09:00:00Z'),
      null,
      desk({
        visits: 5,
        week: { visits: 9, reviewerRows: [{ name: 'Amina', visits: 4 }, { name: 'Baraka', visits: 3 }, { name: 'Chui, J.', visits: 2 }] },
      }),
    );
    // the week section lands AFTER yesterday's roster section
    const yesterdayIdx = csv.indexOf('Reviews by reviewer,Reviewer,Visits,Share (%)');
    const weekIdx = csv.indexOf('Reviews by reviewer (7d),Reviewer,Visits,Share (%)');
    expect(yesterdayIdx).toBeGreaterThan(-1);
    expect(weekIdx).toBeGreaterThan(yesterdayIdx);
    // shares from the week block's OWN visits: 4/9 → 44.44, 3/9 → 33.33, 2/9 → 22.22
    expect(csv).toContain('Amina,4,44.44');
    expect(csv).toContain('Baraka,3,33.33');
    expect(csv).toContain('"Chui, J.",2,22.22'); // the whole-field RFC-4180 quote, pinned exactly
  });

  it('EXECUTED: an absent week block ends the file at the v2.188.0 shape — never a hole', () => {
    const csv = buildBranchesCsv(
      [
        { name: 'Juja Main', code: 'JJA', location: 'Juja', status: 'ACTIVE', todayRevenue: 1000, todayTransactions: 2, lowStockCount: 0, overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0 },
      ],
      new Date('2026-10-20T09:00:00Z'),
      null,
      desk(),
    );
    expect(csv).not.toContain('Reviews by reviewer (7d)');
  });

  it('EXECUTED: the honesty gates — an empty roster, a zero-visit week, and a null block all stay silent', () => {
    const base = [
      { name: 'Juja Main', code: 'JJA', location: 'Juja', status: 'ACTIVE', todayRevenue: 1000, todayTransactions: 2, lowStockCount: 0, overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0 },
    ];
    const at = new Date('2026-10-20T09:00:00Z');
    // roster present, week absent
    expect(buildBranchesCsv(base, at, null, desk()).includes('Reviews by reviewer (7d)')).toBe(false);
    // roster present, zero-visit week — never a divide-by-zero
    expect(buildBranchesCsv(base, at, null, desk({ week: { visits: 0, reviewerRows: [{ name: 'Amina', visits: 0 }] } })).includes('Reviews by reviewer (7d)')).toBe(false);
    // week visits positive, roster empty — nothing to share out
    expect(buildBranchesCsv(base, at, null, desk({ week: { visits: 9, reviewerRows: [] } })).includes('Reviews by reviewer (7d)')).toBe(false);
    // null week
    expect(buildBranchesCsv(base, at, null, desk({ week: null })).includes('Reviews by reviewer (7d)')).toBe(false);
  });
});

// ── 5. The parse — the tolerant ride ────────────────────────────────────────

describe('the export parse - the week rides only when provably sound', () => {
  it('the tolerant parse reads stats.weekReviewerRows with the sound-rows filter', () => {
    expect(orgConsole).toContain('const data = res.json?.data as { yesterday?: unknown; stats?: unknown } | undefined;');
    expect(orgConsole).toContain('weekReviewerRows?: unknown; // v2.189.0: the week roster array');
    expect(orgConsole).toMatch(/Array\.isArray\(st\?\.weekReviewerRows\)/);
    expect(orgConsole).toMatch(/typeof r\?\.name === 'string' && typeof r\?\.visits === 'number'/);
  });

  it('the week block builds only on a numeric denominator AND a non-empty roster', () => {
    expect(orgConsole).toMatch(/typeof st\.weekVisits === 'number' && weekRows && weekRows\.length > 0/);
    expect(orgConsole).toContain('? { visits: st.weekVisits, reviewerRows: weekRows }');
    expect(orgConsole).toContain('week,');
  });
});

// ── 6. The printable twin — the share bar ───────────────────────────────────

describe('the desk report - the rows wear the share', () => {
  it('the reviewer rows compute the share from the report\'s OWN totals', () => {
    expect(view).toContain('const share = data.totals.visits > 0 ? Math.round((r.visits / data.totals.visits) * 100) : 0;');
  });

  it('the share bar rides the strip\'s signature — the loudest row in the deep emerald', () => {
    expect(view).toContain('const loudest = r === data.reviewers[0];');
    expect(view).toContain("${loudest ? 'bg-emerald-600' : 'bg-emerald-500/80'}");
    expect(view).toContain('style={{ width: `${Math.min(100, share)}%` }}');
    expect(view).toContain('data-testid="desk-report-reviewer-share"');
    // the % figure beside the bar carries the share in print
    expect(view).toContain('{share}%');
  });

  it('the caption invites the bars', () => {
    expect(view).toContain('— bars show each reviewer&apos;s share · click a reviewer to read their visits');
  });

  it('the report CSV grew the Share column at the END — lib-computed round2', () => {
    expect(reportLib).toContain("row(['Name', 'Visits', 'Corrections answered', 'Branches', 'Last visit (UTC)', 'Share (%)']);");
    expect(reportLib).toContain('report.totals.visits > 0 ? Math.round((r.visits / report.totals.visits) * 10000) / 100 : \'\',');
  });

  it('EXECUTED: the report CSV carries the exact shares', () => {
    const now = new Date('2026-10-17T14:00:00Z');
    const win7 = { ...deskReportWindow(now, 7), days: 7 };
    let seq = 0;
    const mkRow = (over: Partial<DeskReportVisitRow>): DeskReportVisitRow => {
      seq += 1;
      return {
        id: `visit-${seq}`,
        visitedByName: 'Amina',
        createdAt: new Date(Date.UTC(2026, 9, 16, 9, 0, 0)),
        clearedRecheck: false,
        leaveRequestId: `req-${seq}`,
        leaveRequest: {
          status: 'PENDING',
          storeId: 'store-juja',
          store: { name: 'MBUMAH HARDWARE - Juja Main' },
          employee: { firstName: 'David', lastName: 'Otieno' },
          leaveType: { name: 'Sick Leave' },
        },
        ...over,
      };
    };
    const report = deriveDeskReport(
      [
        mkRow({ visitedByName: 'Amina', createdAt: new Date(Date.UTC(2026, 9, 16, 9, 0, 0)) }),
        mkRow({ visitedByName: 'Amina', createdAt: new Date(Date.UTC(2026, 9, 16, 10, 0, 0)) }),
        mkRow({ visitedByName: 'Baraka', createdAt: new Date(Date.UTC(2026, 9, 16, 11, 0, 0)) }),
      ],
      win7,
    );
    const csv = deskReportToCsv(report, { organizationName: 'O', scopeLabel: 'S' });
    const reviewerSection = csv.slice(csv.indexOf('Reviewers'), csv.indexOf('Most-visited requests'));
    expect(reviewerSection).toContain('Name,Visits,Corrections answered,Branches,Last visit (UTC),Share (%)');
    expect(reviewerSection).toContain('Amina,2,0,1,2026-10-16T10:00:00.000Z,66.67');
    expect(reviewerSection).toContain('Baraka,1,0,1,2026-10-16T11:00:00.000Z,33.33');
  });
});

// ── 7. The version contract ─────────────────────────────────────────────────

describe('the version contract', () => {
  it('package.json rides at 2.198.0', () => {
    expect(pkg.version).toBe('2.198.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.198.0');
    expect(pkg.mbumah.baseVersion).toBe('2.198.0');
  });
});
