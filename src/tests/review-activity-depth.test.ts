import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.65.0 contracts — the console answers who and where.
 *
 * Gap: v2.64.0 put the org's desk-activity ledger on the console, but the
 * panel only LISTED — twelve newest rows, take it or leave it. A manager
 * asking "how much desk does John Mwangi actually pull?" or "what has the
 * Thika branch's desk been doing?" had to eyeball the timeline and count
 * by hand, and the answer evaporated on the next 30s poll.
 *
 * Covered here:
 *  1. GET /api/org/review-activity: optional ?reviewer drill-down (recent
 *     narrows to that reviewer; reviewerStats rides org-wide totals),
 *     optional ?branch store filter (composes with reviewer via AND),
 *     branches (per-store visit counts, org-wide and filter-stable) always
 *     on the payload, stats never re-keyed, unmatched values yield an
 *     honest empty list, and the v2.57.0 leak-class guard unchanged.
 *  2. The DeskActivity panel: the branch chip row (All branches + per-store
 *     counts with aria-pressed), the drill-down bar (avatar initial,
 *     reviewer name, on-record/cleared/last-visit stats, back button),
 *     clickable timeline rows (full-width buttons with hover + focus ring
 *     + per-row aria-label), deterministic per-reviewer avatar hues,
 *     filter-aware empty states, and the full dark-mode pass.
 *  3. The console page: the filter state lives at page level, serializes
 *     into the poll fetch URL, re-keys `load` for an immediate refetch on
 *     change, and threads filter + onFilterChange into the panel.
 *  4. Types: DeskActivityData grew branches + reviewerStats; DeskActivityFilter
 *     is the shared { reviewer, branch } shape.
 *  5. What's-New 2.65.0 leads with the who-and-where story.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. GET /api/org/review-activity — the drill-down read ───────────────────

describe('GET /api/org/review-activity - the drill-down read', () => {
  const RA = readRepo('src/app/api/org/review-activity/route.ts');

  it('stays gated to the exact ORG_ROLES set kpi-summary uses', () => {
    expect(RA).toContain("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];");
    expect(RA).toMatch(/requireAuth\([\s\S]{0,80}\{\s*roles: ORG_ROLES \},?\s*\)/);
  });

  it('still reads through rawDb inside runWithoutTenant (the v2.57.0 leak class)', () => {
    expect(RA).toContain('return runWithoutTenant(async () => {');
    expect(RA).toMatch(/rawDb\.leaveReviewVisit\.findMany/);
  });

  it('reads the reviewer drill-down param and trims it', () => {
    expect(RA).toContain("const reviewer = url.searchParams.get('reviewer')?.trim() || null;");
  });

  it('reads the branch filter param and trims it', () => {
    expect(RA).toContain("const branch = url.searchParams.get('branch')?.trim() || null;");
  });

  it('narrows the ledger query by visitedByName for the reviewer drill-down', () => {
    expect(RA).toContain('if (reviewer) visitWhere.visitedByName = reviewer;');
  });

  it('narrows the ledger query through the request relation for the branch filter', () => {
    expect(RA).toContain('if (branch) visitWhere.leaveRequest = { storeId: branch };');
  });

  it('composes reviewer + branch as one AND-shaped where (never two queries)', () => {
    expect(RA).toMatch(/const visitWhere[\s\S]{0,200}if \(reviewer\)[\s\S]{0,120}if \(branch\)[\s\S]{0,800}where: visitWhere/);
  });

  it('the drill-down timeline keeps the newest-first 12-row cap', () => {
    expect(RA).toContain('orderBy: { createdAt: \'desc\' },');
    expect(RA).toContain('take: RECENT_LIMIT,');
  });

  it('reviewerStats rides org-wide totals: visits, clears, last visit', () => {
    expect(RA).toMatch(/reviewerStats: \{\s*visits: reviewerVisits,\s*clears: reviewerClears,\s*lastVisitAt: reviewerLast/);
    expect(RA).toMatch(/rawDb\.leaveReviewVisit\.count\(\{ where: \{ visitedByName: reviewer \} \}\)/);
    expect(RA).toMatch(/rawDb\.leaveReviewVisit\.count\(\{ where: \{ visitedByName: reviewer, clearedRecheck: true \} \}\)/);
  });

  it('reviewerStats is only queried when a reviewer was actually named', () => {
    expect(RA).toMatch(/reviewer\s*\?\s*rawDb\.leaveReviewVisit\.count/);
    expect(RA).toMatch(/: Promise\.resolve\(0\)/);
  });

  it('the last-visit lookup is the reviewer\u2019s newest row, tolerating none', () => {
    expect(RA).toMatch(/rawDb\.leaveReviewVisit\.findFirst\(\{\s*where: \{ visitedByName: reviewer \},\s*orderBy: \{ createdAt: 'desc' \},/);
    expect(RA).toContain('lastVisitAt: reviewerLast?.createdAt.toISOString() ?? null');
  });

  it('branches ride the payload as per-store visit counts (org-wide)', () => {
    expect(RA).toMatch(/select: \{ leaveRequest: \{ select: \{ storeId: true, store: \{ select: \{ name: true \} \} \} \} \}/);
    expect(RA).toContain('const branches = [...branchCounts.values()].sort(');
    expect(RA).toContain('(a, b) => b.visits - a.visits || a.storeName.localeCompare(b.storeName),');
  });

  it('the branch breakdown is never narrowed by the caller\u2019s filters', () => {
    expect(RA).toContain("// org-wide and NEVER narrowed by the caller's filters");
  });

  it('stats stay org-wide under every filter (tiles never re-key silently)', () => {
    expect(RA).toMatch(/rawDb\.leaveReviewVisit\.count\(\),/);
    expect(RA).toMatch(/rawDb\.leaveReviewVisit\.count\(\{ where: \{ createdAt: \{ gte: weekAgo \} \} \}\)/);
  });

  it('the recent-row shape is unchanged (store, employee, type, status)', () => {
    expect(RA).toContain('storeName: v.leaveRequest.store?.name ?? null');
    expect(RA).toContain('leaveTypeName: v.leaveRequest.leaveType?.name ?? \'Leave\'');
    expect(RA).toContain('requestStatus: v.leaveRequest.status');
  });

  it('the handler signature grew the request param (query params need it)', () => {
    expect(RA).toContain('async function orgReviewActivityHandler(request: Request): Promise<Response>');
    expect(RA).toContain('const url = new URL(request.url);');
  });
});

// ── 2. The DeskActivity panel — chips, drill-down, rows, dark ───────────────

describe('DeskActivity panel - the console answers who and where', () => {
  const PANELS = readRepo('src/components/org/panels.tsx');

  it('takes the filter + onFilterChange props alongside the data', () => {
    expect(PANELS).toMatch(/export function DeskActivity\(\{ data, filter, onFilterChange \}: \{[\s\S]{0,200}filter: DeskActivityFilter;[\s\S]{0,80}onFilterChange: \(f: DeskActivityFilter\) => void;/);
  });

  it('renders the branch chip row as a labelled group', () => {
    expect(PANELS).toContain('data-testid="desk-branch-chips"');
    expect(PANELS).toContain('role="group"');
    expect(PANELS).toContain('aria-label="Filter desk activity by branch"');
  });

  it('the All-branches chip is pressed exactly when no branch is set', () => {
    expect(PANELS).toContain('data-testid="desk-branch-chip-all"');
    expect(PANELS).toMatch(/aria-pressed=\{!branch\}/);
  });

  it('per-store chips carry the store id testid, tooltip, and visit count', () => {
    expect(PANELS).toContain('data-testid={`desk-branch-chip-${b.storeId}`}');
    expect(PANELS).toContain('title={b.storeName}');
    expect(PANELS).toContain('<span className="tabular-nums opacity-70">{num(b.visits)}</span>');
  });

  it('clicking an active branch chip toggles it back off', () => {
    expect(PANELS).toMatch(/onClick=\{\(\) => setBranch\(active \? null : b\.storeId\)\}/);
  });

  it('the branch chips stay stable while the timeline narrows (org-wide counts)', () => {
    expect(PANELS).toContain('{data.branches.length > 0 ? (');
  });

  it('chips wear the shared short-name strip for the MBUMAH prefix', () => {
    expect(PANELS).toMatch(/const shortStoreName = \(name: string\): string =>/);
    expect(PANELS).toContain("name.replace(/^MBUMAH HARDWARE\\s*-\\s*/i, '') || name");
  });

  it('the drill-down bar names the reviewer and wears the emerald treatment', () => {
    expect(PANELS).toContain('data-testid="desk-drilldown-bar"');
    expect(PANELS).toMatch(/Reviewing \{reviewer\}&apos;s desk visits/);
    expect(PANELS).toContain('border-emerald-200 bg-emerald-50/70');
    expect(PANELS).toContain('dark:border-emerald-500/30 dark:bg-emerald-500/10');
  });

  it('the drill-down bar answers the management question in one line', () => {
    expect(PANELS).toContain('data-testid="desk-drilldown-stats"');
    expect(PANELS).toMatch(/\{num\(data\.reviewerStats\.visits\)\} on record · \{num\(data\.reviewerStats\.clears\)\} cleared a re-check/);
    expect(PANELS).toMatch(/data\.reviewerStats\.lastVisitAt \? ` · last \$\{timeAgo\(data\.reviewerStats\.lastVisitAt\)\}` : ''/);
  });

  it('the drill-down bar hands the narrowed reviewer to the report as a deep link (v2.80.0)', () => {
    expect(PANELS).toContain('data-testid="desk-drilldown-report-link"');
    expect(PANELS).toContain('href={`/org/desk-report?reviewer=${encodeURIComponent(reviewer)}`}');
    expect(PANELS).toContain("title={`Open ${reviewer}'s file in the desk report`}");
    expect(PANELS).toContain('Their file in the report');
    // The chip wears the panel's emerald family — a door, dressed like one.
    const chip = PANELS.split('data-testid="desk-drilldown-report-link"')[1].split('</Link>')[0];
    expect(chip).toContain('border-emerald-200 bg-white');
    expect(chip).toContain('hover:border-emerald-400 hover:bg-emerald-50');
    expect(chip).toContain('focus-visible:ring-emerald-400');
    expect(chip).toContain('dark:border-emerald-500/30 dark:bg-slate-900/60 dark:text-emerald-300');
    expect(chip).toContain('FileText');
    // The clear button stays — the deep link adds a way out, never replaces one.
    expect(PANELS).toContain('data-testid="desk-drilldown-clear"');
  });

  it('the back button clears the reviewer and is labelled for assistive tech', () => {
    expect(PANELS).toContain('data-testid="desk-drilldown-clear"');
    expect(PANELS).toContain('aria-label="Back to all reviewers"');
    expect(PANELS).toMatch(/onClick=\{clearReviewer\}/);
  });

  it('timeline rows are full-width buttons that drill into that reviewer', () => {
    expect(PANELS).toContain('data-testid="desk-visit-row"');
    expect(PANELS).toMatch(/onClick=\{\(\) => onFilterChange\(\{ \.\.\.filter, reviewer: v\.visitedByName \}\)\}/);
    expect(PANELS).toMatch(/aria-label=\{`Review \$\{v\.visitedByName\}'s desk visits`\}/);
    expect(PANELS).toContain('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors');
  });

  it('rows carry the hover + focus-visible affordances in both modes', () => {
    expect(PANELS).toContain('hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:hover:bg-slate-800/40');
  });

  it('every reviewer wears a deterministic hue from a six-tone palette', () => {
    expect(PANELS).toMatch(/const avatarHue = \(name: string\): string =>/);
    expect(PANELS).toMatch(/AVATAR_HUES\[\[\.\.\.name\]\.reduce\(\(acc, ch\) => acc \+ ch\.charCodeAt\(0\), 0\) % AVATAR_HUES\.length\]/);
    expect(PANELS.match(/dark:bg-\w+-500\/20 dark:text-\w+-300/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('empty states are filter-aware and honest', () => {
    expect(PANELS).toContain('data-testid="desk-empty-state"');
    expect(PANELS).toMatch(/No desk visits recorded for \$\{reviewer\}\$\{branch \? ' on this branch' : ''\} yet\./);
    expect(PANELS).toContain('No desk visits recorded for this branch yet — the ledger fills as approvers open leave requests.');
  });

  it('the footer teaches the new interactions', () => {
    expect(PANELS).toContain('Click a row to review that person&apos;s desk visits; click a branch to narrow the trail.');
  });

  it('the panel is dark-mode complete (card, tiles, timeline, text)', () => {
    expect(PANELS).toMatch(/rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/);
    expect(PANELS).toMatch(/divide-y divide-slate-100 dark:divide-slate-800/);
    expect(PANELS).toMatch(/text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100/);
  });

  it('the status chips keep their kind coding with dark variants', () => {
    expect(PANELS).toMatch(/PENDING: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500\/30 dark:bg-amber-500\/10 dark:text-amber-300'/);
    expect(PANELS).toMatch(/APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500\/30 dark:bg-emerald-500\/10 dark:text-emerald-300'/);
    expect(PANELS).toMatch(/REJECTED: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500\/30 dark:bg-rose-500\/10 dark:text-rose-300'/);
    expect(PANELS).toMatch(/CANCELLED: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800\/60 dark:text-slate-400'/);
  });

  it('the emerald cleared-a-re-check chip keeps its dark variants too', () => {
    expect(PANELS).toMatch(/border-emerald-200 bg-emerald-50 px-1\.5 py-px text-\[10px\] font-semibold text-emerald-700 dark:border-emerald-500\/30 dark:bg-emerald-500\/10 dark:text-emerald-300/);
  });
});

// ── 3. The console page — filter state + poll wiring ────────────────────────

describe('Console page - the poll fetches the view the reviewer chose', () => {
  const PAGE = readRepo('src/app/(shell)/console/page.tsx');

  it('the desk filter state lives at page level (survives the 30s poll)', () => {
    expect(PAGE).toMatch(/const \[deskFilter, setDeskFilter\] = useState<DeskActivityFilter>\(\{ reviewer: null, branch: null \}\);/);
  });

  it('the filter serializes into the poll URL (reviewer first, branch second)', () => {
    expect(PAGE).toMatch(/if \(deskFilter\.reviewer\) params\.set\('reviewer', deskFilter\.reviewer\);/);
    expect(PAGE).toMatch(/if \(deskFilter\.branch\) params\.set\('branch', deskFilter\.branch\);/);
    expect(PAGE).toContain('return qs ? `?${qs}` : \'\';');
  });

  it('the poll fetch rides the serialized query', () => {
    expect(PAGE).toContain('authorizedFetchJson(`/api/org/review-activity${deskQuery}`)');
  });

  it('a filter change re-keys load for an immediate refetch', () => {
    expect(PAGE).toMatch(/const load = useCallback\(async \(\) => \{[\s\S]{0,2400}\}, \[deskQuery\]\);/);
  });

  it('filter + onFilterChange thread into the panel', () => {
    expect(PAGE).toContain('<DeskActivity data={deskActivity} filter={deskFilter} onFilterChange={setDeskFilter} />');
  });

  it('the DeskActivityFilter type is imported from primitives', () => {
    expect(PAGE).toContain('type DeskActivityFilter');
  });
});

// ── 4. Types — the payload + the shared filter shape ────────────────────────

describe('Types - DeskActivityData grew the depth fields', () => {
  const PRIM = readRepo('src/components/org/primitives.tsx');

  it('branches: per-store visit counts on the payload', () => {
    expect(PRIM).toMatch(/branches: Array<\{ storeId: string; storeName: string; visits: number \}>;/);
  });

  it('reviewerStats is optional and org-wide (visits, clears, lastVisitAt)', () => {
    expect(PRIM).toMatch(/reviewerStats\?: \{ visits: number; clears: number; lastVisitAt: string \| null \};/);
  });

  it('DeskActivityFilter is the shared { reviewer, branch } shape', () => {
    expect(PRIM).toMatch(/export interface DeskActivityFilter \{\s*reviewer: string \| null;\s*branch: string \| null;\s*\}/);
  });

  it('the stats block is documented as org-wide under every filter', () => {
    expect(PRIM).toContain('stats` stays');
  });
});

// ── 5. What's-New — the release leads with the story ────────────────────────

describe("What's-New 2.65.0", () => {
  const WN = readRepo('src/lib/whats-new.ts');

  it('carries the 2.65.0 entry first', () => {
    expect(WN.indexOf("version: '2.65.0'")).toBeGreaterThanOrEqual(0);
    expect(WN.indexOf("version: '2.65.0'")).toBeLessThan(WN.indexOf("version: '2.64.0'"));
  });

  it('leads with the who-and-where story', () => {
    expect(WN).toContain('The console answers who and where — desk activity drills down per reviewer and filters by branch');
  });

  it('announces the drill-down, the branch chips, the hues, and the dark pass', () => {
    expect(WN).toContain("Click any row on the console\\'s Desk activity panel to review that person\\'s desk visits");
    expect(WN).toContain('Branch chips under the stat tiles narrow the trail to one store');
    expect(WN).toContain('Every reviewer wears their own colour');
    expect(WN).toContain('The whole panel is now dark-mode complete');
  });

  it('keeps five bullets (the 3-6 shop-floor contract)', () => {
    const entry = WN.slice(WN.indexOf("version: '2.65.0'"), WN.indexOf("version: '2.64.0'"));
    expect(entry.match(/^ {6}'.*',$/gm)?.length).toBe(5);
  });
});
